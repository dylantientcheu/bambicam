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
const ORIGIN = 'http://localhost:5173';

async function open(url, options = {}) {
  const ws = new WebSocket(url, { origin: ORIGIN, ...options });
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

function rejectedUpgrade(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = get(url.replace('ws:', 'http:'), {
      headers: Object.fromEntries(Object.entries({
        Origin: ORIGIN,
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        ...headers,
      }).filter(([, value]) => value !== undefined)),
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
  const rejectedNotices = [nextControl(baby), nextControl(parent)];
  const thirdClosed = once(third, 'close');
  third.send(JSON.stringify({ join: 'a'.repeat(32) }));
  const [code, reason] = await thirdClosed;
  assert.equal(code, 1008);
  assert.equal(reason.toString(), 'Room full');
  assert.deepEqual(await Promise.all(rejectedNotices), ['peer-rejected', 'peer-rejected']);
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
  assert.equal(health.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(await rejectedUpgrade(`${relay.url}?room=private`), 404);
  assert.equal(await rejectedUpgrade(relay.url.replace('/relay', '/other')), 404);
});

test('only exact allowed origins can upgrade, before spending the global upgrade budget', async (t) => {
  const relay = await setup(t, { allowedOrigins: ['https://monitor.example'], maxUpgradesPerWindow: 1 });
  for (const Origin of [undefined, 'null', ORIGIN, 'https://monitor.example.evil', 'https://monitor.example/'])
    assert.equal(await rejectedUpgrade(relay.url, { Origin }), 403);
  const ws = await open(relay.url, { origin: 'https://monitor.example' });
  await join(ws);
  for (const allowedOrigins of [[], ['*'], ['https://monitor.example/path'], ['https://user@monitor.example']])
    assert.throws(() => createRelay({ allowedOrigins }));
});

test('direct clients cannot bypass source caps by forging proxy headers; close frees capacity', async (t) => {
  const relay = await setup(t, { maxConnectionsPerSource: 1 });
  const first = await open(relay.url, { headers: { 'X-Real-IP': '192.0.2.1' } });
  await join(first);
  assert.equal(await rejectedUpgrade(relay.url, { 'X-Real-IP': '192.0.2.2', 'X-Forwarded-For': '192.0.2.3' }), 429);
  const serverSocket = [...relay.rooms.values()][0].values().next().value;
  const closed = once(serverSocket._socket, 'close');
  first.close();
  await closed;
  const replacement = await open(relay.url);
  await join(replacement);
});

test('explicit proxy mode requires a single valid IP and groups equivalent addresses and IPv6 subnets', async (t) => {
  const relay = await setup(t, { trustProxy: true, maxConnectionsPerSource: 1 });
  for (const value of [undefined, 'unknown', '192.0.2.1, 192.0.2.2', '[2001:db8::1]', 'fe80::1%eth0'])
    assert.equal(await rejectedUpgrade(relay.url, { 'X-Real-IP': value }), 400);
  await open(relay.url, { headers: { 'X-Real-IP': '192.0.2.1' } });
  assert.equal(await rejectedUpgrade(relay.url, { 'X-Real-IP': '::ffff:192.0.2.1' }), 429);
  await open(relay.url, { headers: { 'X-Real-IP': '192.0.2.2' } });
  await open(relay.url, { headers: { 'X-Real-IP': '2001:db8:1::1' } });
  assert.equal(await rejectedUpgrade(relay.url, { 'X-Real-IP': '2001:0db8:0001:0000:ffff::2' }), 429);
  await open(relay.url, { headers: { 'X-Real-IP': '2001:db8:2::1' } });
});

test('a throttled source cannot consume the global allowance for other sources', async (t) => {
  const relay = await setup(t, {
    trustProxy: true, maxUpgradesPerSource: 1, maxUpgradesPerWindow: 2,
  });
  const headers = { 'X-Real-IP': '192.0.2.1' };
  const first = await open(relay.url, { headers });
  await join(first);
  for (let i = 0; i < 3; i++) assert.equal(await rejectedUpgrade(relay.url, headers), 429);
  const other = await open(relay.url, { headers: { 'X-Real-IP': '192.0.2.2' } });
  await join(other);
});

test('room creation is capped per source while existing rooms remain joinable and slots are reclaimed', async (t) => {
  const relay = await setup(t, { trustProxy: true, maxRoomsPerSource: 1 });
  const sourceA = { headers: { 'X-Real-IP': '192.0.2.1' } };
  const sourceB = { headers: { 'X-Real-IP': '192.0.2.2' } };
  const first = await open(relay.url, sourceA);
  await join(first);
  const secondRoom = await open(relay.url, sourceB);
  await join(secondRoom, 'b'.repeat(32));
  const refused = await open(relay.url, sourceA);
  const refusedClosed = once(refused, 'close');
  refused.send(JSON.stringify({ join: 'c'.repeat(32) }));
  assert.equal((await refusedClosed)[0], 1013);
  const peer = await open(relay.url, sourceA);
  await join(peer, 'b'.repeat(32));
  const roomClosed = once([...relay.rooms.get('a'.repeat(32))][0], 'close');
  first.close();
  await roomClosed;
  const replacement = await open(relay.url, sourceA);
  await join(replacement, 'c'.repeat(32));
});

test('source churn stays rate limited after disconnect, and idle source records expire in a bounded table', async (t) => {
  const relay = await setup(t, {
    trustProxy: true, maxSources: 1, maxUpgradesPerSource: 1, sourceWindowMs: 100,
  });
  const headers = { 'X-Real-IP': '192.0.2.1' };
  const first = await open(relay.url, { headers });
  await join(first);
  const closed = once([...relay.rooms.values()][0].values().next().value._socket, 'close');
  first.close();
  await closed;
  assert.equal(await rejectedUpgrade(relay.url, headers), 429);
  assert.equal(await rejectedUpgrade(relay.url, { 'X-Real-IP': '192.0.2.2' }), 503);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const next = await open(relay.url, { headers: { 'X-Real-IP': '192.0.2.2' } });
  await join(next);
});

test('a lone socket expires despite pongs and signaling; a paired room is not expired', async (t) => {
  const relay = await setup(t, { aloneTimeoutMs: 150, heartbeatMs: 30 });
  const alone = await open(relay.url);
  await join(alone);
  const chatter = setInterval(() => {
    if (alone.readyState === WebSocket.OPEN) alone.send(Buffer.from('keepalive'));
  }, 20);
  t.after(() => clearInterval(chatter));
  const [code, reason] = await once(alone, 'close');
  assert.equal(code, 1013);
  assert.equal(reason.toString(), 'Waiting for peer timed out');
  const baby = await open(relay.url);
  await join(baby, 'b'.repeat(32));
  const parent = await open(relay.url);
  await join(parent, 'b'.repeat(32));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(baby.readyState, WebSocket.OPEN);
  assert.equal(parent.readyState, WebSocket.OPEN);
  const parentClosed = once(parent, 'close');
  baby.close();
  assert.equal((await parentClosed)[0], 1013);
});

test('a maximum-size frame passes but an additional frame cannot overfill a slow receiver', async (t) => {
  const relay = await setup(t);
  const baby = await open(relay.url);
  await join(baby);
  const parent = await open(relay.url);
  const joined = nextControl(baby);
  await join(parent);
  await joined;
  await new Promise((resolve) => setImmediate(resolve));
  const received = once(parent, 'message');
  const payload = Buffer.alloc(64 * 1024, 7);
  baby.send(payload);
  assert.deepEqual((await received)[0], payload);
  const serverParent = [...[...relay.rooms.values()][0]][1];
  Object.defineProperty(serverParent, 'bufferedAmount', { get: () => 64 * 1024 - 100 });
  const closed = once(parent, 'close');
  baby.send(Buffer.alloc(101));
  assert.equal((await closed)[0], 1006);
});

test('aggregate send buffering is capped across rooms and released when writes finish', async (t) => {
  const relay = await setup(t, { maxTotalBufferedBytes: 128 });
  const pairs = [];
  for (const id of ['a', 'b']) {
    const sender = await open(relay.url);
    await join(sender, id.repeat(32));
    const receiver = await open(relay.url);
    const joined = nextControl(sender);
    await join(receiver, id.repeat(32));
    await joined;
    pairs.push([sender, receiver]);
  }
  await new Promise((resolve) => setImmediate(resolve));
  const serverReceiver = [...relay.rooms.get('a'.repeat(32))][1];
  const send = serverReceiver.send.bind(serverReceiver);
  let release;
  serverReceiver.send = (data, options, callback) => send(data, options, (error) => {
    if (options.binary) release = () => callback(error);
    else callback(error);
  });
  const first = once(pairs[0][1], 'message');
  pairs[0][0].send(Buffer.alloc(64));
  await first;
  const closed = once(pairs[1][1], 'close');
  pairs[1][0].send(Buffer.alloc(64));
  assert.equal((await closed)[0], 1006);
  release();
  serverReceiver.send = send;
  const next = once(pairs[0][1], 'message');
  pairs[0][0].send(Buffer.alloc(64, 1));
  assert.deepEqual((await next)[0], Buffer.alloc(64, 1));
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
