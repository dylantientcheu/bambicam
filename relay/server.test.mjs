import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { get } from 'node:http';
import { createConnection } from 'node:net';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createRelay } from './server.mjs';

async function setup(t, options) {
  const relay = createRelay(options);
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  t.after(() => relay.close());
  return { ...relay, url: `ws://127.0.0.1:${relay.server.address().port}/relay` };
}
async function open(url) {
  const ws = new WebSocket(url);
  await once(ws, 'open');
  return ws;
}
function nextControl(ws) {
  return once(ws, 'message').then(([data]) => JSON.parse(data.toString()).type);
}
async function join(ws, room = 'a'.repeat(32)) {
  const message = nextControl(ws);
  ws.send(JSON.stringify({ join: room }));
  assert.equal(await message, 'joined');
}

function rejectedUpgrade(url) {
  return new Promise((resolve, reject) => {
    const request = get(url.replace('ws:', 'http:'), {
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      },
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      reject(new Error('Expected upgrade rejection'));
    });
  });
}

test('two peers join, a third is refused, binary bytes are unchanged, and empty rooms disappear', async (t) => {
  const relay = await setup(t);
  const baby = await open(relay.url);
  await join(baby);
  const parent = await open(relay.url);
  const peerJoined = nextControl(baby);
  await join(parent);
  assert.equal(await peerJoined, 'peer-joined');
  const third = await open(relay.url);
  const thirdClosed = once(third, 'close');
  third.send(JSON.stringify({ join: 'a'.repeat(32) }));
  const [code, reason] = await thirdClosed;
  assert.equal(code, 1008);
  assert.equal(reason.toString(), 'Room full');
  const received = once(parent, 'message');
  const payload = Buffer.from([0, 1, 2, 255, 43]);
  baby.send(payload);
  const [data, binary] = await received;
  assert.ok(binary);
  assert.deepEqual(data, payload);
  const peerLeft = nextControl(parent);
  baby.close();
  assert.equal(await peerLeft, 'peer-left');
  assert.equal(relay.rooms.get('a'.repeat(32)).size, 1);
  const serverClosed = once([...relay.rooms.get('a'.repeat(32))][0], 'close');
  const parentClosed = once(parent, 'close');
  parent.close();
  await parentClosed;
  await serverClosed;
  assert.equal(relay.rooms.size, 0);
});

test('separate rooms cannot see each other and sockets cannot switch rooms', async (t) => {
  const relay = await setup(t);
  const first = await open(relay.url);
  const second = await open(relay.url);
  await join(first, 'a'.repeat(32));
  await join(second, 'b'.repeat(32));
  let received = false;
  second.on('message', () => {
    received = true;
  });
  first.send(Buffer.from('opaque'));
  const closed = once(first, 'close');
  first.send(JSON.stringify({ join: 'b'.repeat(32) }));
  assert.equal((await closed)[0], 1008);
  assert.equal(received, false);
});

test('invalid joins, unjoined idle sockets, oversized frames, and room exhaustion are bounded', async (t) => {
  const relay = await setup(t, { joinTimeoutMs: 100, maxRooms: 1 });
  for (const value of [
    'null',
    '{}',
    '{"join":"bad"}',
    JSON.stringify({ join: ['a'.repeat(32)] }),
    'not json',
  ]) {
    const ws = await open(relay.url);
    const closed = once(ws, 'close');
    ws.send(value);
    assert.equal((await closed)[0], 1008);
  }
  const idle = await open(relay.url);
  assert.equal((await once(idle, 'close'))[0], 1008);
  const first = await open(relay.url);
  await join(first);
  const second = await open(relay.url);
  const secondClosed = once(second, 'close');
  second.send(JSON.stringify({ join: 'b'.repeat(32) }));
  assert.equal((await secondClosed)[0], 1013);
  const oversized = once(first, 'close');
  first.send(Buffer.alloc(65537));
  assert.equal((await oversized)[0], 1009);
});

test('unjoined sockets count toward capacity and closing one frees capacity', async (t) => {
  const relay = await setup(t, { maxConnections: 1 });
  const first = await open(relay.url);
  assert.equal(await rejectedUpgrade(relay.url), 503);
  const closed = once(first, 'close');
  first.close();
  await closed;
  const replacement = await open(relay.url);
  await join(replacement);
});

test('upgrade bursts are rejected and the next window admits a new peer', async (t) => {
  const relay = await setup(t, { maxUpgradesPerWindow: 1, upgradeWindowMs: 100 });
  const first = await open(relay.url);
  await join(first);
  assert.equal(await rejectedUpgrade(relay.url), 429);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const second = await open(relay.url);
  await join(second);
  const received = once(second, 'message');
  first.send(Buffer.from('after burst'));
  assert.equal((await received)[0].toString(), 'after burst');
});

test('binary traffic is bounded by bytes as well as message count', async (t) => {
  const relay = await setup(t, { maxBytesPerSecond: 1024 });
  const ws = await open(relay.url);
  await join(ws);
  const closed = once(ws, 'close');
  ws.send(Buffer.alloc(1024));
  const [code, reason] = await closed;
  assert.equal(code, 1008);
  assert.equal(reason.toString(), 'Too many bytes');
});

test('health exposes no rooms and only the exact relay path accepts upgrades', async (t) => {
  const relay = await setup(t);
  const health = await fetch(relay.url.replace('ws:', 'http:').replace('/relay', '/health'));
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok\n');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(await rejectedUpgrade(`${relay.url}?room=private`), 404);
  assert.equal(await rejectedUpgrade(relay.url.replace('/relay', '/other')), 404);
});

test('shutdown is idempotent and closes incomplete HTTP requests within a bound', async (t) => {
  const relay = await setup(t, { shutdownTimeoutMs: 50 });
  const socket = createConnection({ port: relay.server.address().port, host: '127.0.0.1' });
  await once(socket, 'connect');
  socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\n');
  const closed = once(socket, 'close');
  const started = performance.now();
  const first = relay.close();
  assert.equal(first, relay.close());
  await first;
  await closed;
  assert.ok(performance.now() - started < 1000);
});
