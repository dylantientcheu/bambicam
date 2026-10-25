import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const url = new URL(process.argv[2] || 'ws://127.0.0.1:8787/relay');
assert.ok(['ws:', 'wss:'].includes(url.protocol));
const health = new URL('/health', url);
health.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
const response = await fetch(health, { signal: AbortSignal.timeout(10_000) });
assert.equal(response.status, 200);
assert.equal((await response.text()).trim(), 'ok');
const signal = AbortSignal.timeout(15_000);
const sockets = [];
try {
  const room = randomBytes(16).toString('hex');
  for (let i = 0; i < 2; i++) {
    const ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    sockets.push(ws);
    await once(ws, 'open', { signal });
    const joined = once(ws, 'message', { signal });
    ws.send(JSON.stringify({ join: room }));
    assert.equal(JSON.parse((await joined)[0].toString()).type, 'joined');
  }
  // Drain the peer-joined control before sending opaque signaling bytes.
  await new Promise((resolve) => setImmediate(resolve));
  const payload = randomBytes(64);
  const received = new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    sockets[1].on('message', (data, binary) => {
      if (!binary) return;
      signal.removeEventListener('abort', abort);
      resolve(data);
    });
  });
  sockets[0].send(payload);
  assert.deepEqual(await received, payload);
  console.log('Relay smoke passed: HTTPS/HTTP health, two-peer join, opaque binary forwarding.');
} finally {
  for (const ws of sockets) ws.terminate();
}
