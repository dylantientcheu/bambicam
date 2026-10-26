import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const HSTS = 'max-age=31536000';
const DEFAULT_ORIGINS = [
  'https://bambi.cam',
  ...['localhost', '127.0.0.1'].flatMap((host) =>
    [5173, 4173, 8080].map((port) => `http://${host}:${port}`)),
];

// Canonicalize IPv4-mapped addresses and group IPv6 by /64, so alternate
// spellings and rotating addresses on one ordinary IPv6 subnet share a cap.
function sourceKey(address) {
  const family = typeof address === 'string' ? isIP(address) : 0;
  if (family === 4) return address;
  if (family !== 6 || address.includes('%')) return null;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::').map((part) => part ? part.split(':') : []);
  const parts = right ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  const words = parts.map((part) => parseInt(part, 16));
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff)
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
  return `${words.slice(0, 4).map((word) => word.toString(16)).join(':')}::/64`;
}

// The relay understands room IDs and control messages, never encrypted payloads.
export function createRelay({
  maxRooms = 1000,
  maxConnections = 2048,
  maxUpgradesPerWindow = 60,
  upgradeWindowMs = 1000,
  maxConnectionsPerSource = 32,
  maxRoomsPerSource = 16,
  maxUpgradesPerSource = 120,
  sourceWindowMs = 60_000,
  maxSources = 4096,
  allowedOrigins = DEFAULT_ORIGINS,
  // Opt in only behind an edge that overwrites X-Real-IP and prevents bypass.
  trustProxy = false,
  maxBytesPerSecond = 256 * 1024,
  maxBufferedBytes = 64 * 1024,
  maxTotalBufferedBytes = 8 * 1024 * 1024,
  joinTimeoutMs = 5000,
  aloneTimeoutMs = 10 * 60 * 1000,
  heartbeatMs = 30_000,
  shutdownTimeoutMs = 3000,
} = {}) {
  const rooms = new Map();
  const roomOwners = new WeakMap();
  const rejectedNotices = new WeakMap();
  const sources = new Map();
  const origins = new Set(allowedOrigins);
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error('Allowed origins must be exact http(s) origins without paths.');
  }
  if (!origins.size) throw new Error('At least one allowed origin is required.');
  const sockets = new Set();
  let bufferedBytes = 0;
  let closing;
  let upgrades = 0;
  let upgradeWindowStart = performance.now();
  const server = createServer({ headersTimeout: 10_000, requestTimeout: 10_000 }, (req, res) => {
    const healthy = !closing && req.url === '/health' && ['GET', 'HEAD'].includes(req.method);
    res.writeHead(healthy ? 200 : closing ? 503 : 404, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': HSTS,
    });
    res.end(healthy ? 'ok\n' : 'Not found\n');
  });
  // Also bound connections that never finish their HTTP upgrade. Leave a small
  // allowance for health probes when the WebSocket capacity is reached.
  server.maxConnections = maxConnections + 16;
  server.setTimeout(10_000, (socket) => socket.destroy());
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
    closeTimeout: 2000,
  });
  wss.on('headers', (headers) => headers.push(`Strict-Transport-Security: ${HSTS}`));
  function pruneSources() {
    const now = performance.now();
    for (const [key, source] of sources) {
      if (!source.connections && !source.rooms && now - source.windowStart >= sourceWindowMs)
        sources.delete(key);
    }
  }
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const reject = (status) => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\nRetry-After: 1\r\nStrict-Transport-Security: ${HSTS}\r\n\r\n`);
      socket.setTimeout(1000, () => socket.destroy());
    };
    if (req.url !== '/relay') return reject('404 Not Found');
    // This blocks drive-by browser connections, not non-browser impersonation.
    if (!origins.has(req.headers.origin)) return reject('403 Forbidden');
    if (closing || wss.clients.size >= maxConnections) return reject('503 Service Unavailable');
    if (performance.now() - upgradeWindowStart >= upgradeWindowMs) {
      upgradeWindowStart = performance.now();
      upgrades = 0;
    }
    // Bound the source table as well as total work under a distributed flood.
    const key = sourceKey(trustProxy ? req.headers['x-real-ip'] : req.socket.remoteAddress);
    if (!key) return reject('400 Bad Request');
    let source = sources.get(key);
    if (!source) {
      if (sources.size >= maxSources) pruneSources();
      if (sources.size >= maxSources) return reject('503 Service Unavailable');
      source = { connections: 0, rooms: 0, upgrades: 0, windowStart: performance.now() };
      sources.set(key, source);
    }
    if (performance.now() - source.windowStart >= sourceWindowMs) {
      source.upgrades = 0;
      source.windowStart = performance.now();
    }
    if (++source.upgrades > maxUpgradesPerSource || source.connections >= maxConnectionsPerSource)
      return reject('429 Too Many Requests');
    // A throttled source must not keep consuming everyone else's allowance.
    if (++upgrades > maxUpgradesPerWindow) return reject('429 Too Many Requests');
    source.connections++;
    socket.once('close', () => source.connections--);
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, source));
  });
  function send(ws, data, binary = false) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const size = Buffer.byteLength(data) + 10; // Largest unmasked frame header.
    if (ws.bufferedAmount + size > maxBufferedBytes + 10 || bufferedBytes + size > maxTotalBufferedBytes) {
      // Do not queue a close frame behind an already stalled receiver.
      ws.terminate();
      return;
    }
    bufferedBytes += size;
    ws.send(data, { binary }, () => { bufferedBytes -= size; });
  }
  const control = (ws, type) => {
    send(ws, JSON.stringify({ type }));
  };

  wss.on('connection', (ws, source) => {
    let roomId;
    let alive = true;
    let messages = 0;
    let bytes = 0;
    let windowStart = performance.now();
    let aloneTimer;
    ws.stopWaiting = () => clearTimeout(aloneTimer);
    ws.waitForPeer = () => {
      clearTimeout(aloneTimer);
      aloneTimer = setTimeout(() => ws.close(1013, 'Waiting for peer timed out'), aloneTimeoutMs);
      aloneTimer.unref();
    };
    const joinTimer = setTimeout(() => ws.close(1008, 'Join required'), joinTimeoutMs);
    joinTimer.unref();
    ws.on('error', () => {}); // Transport errors are followed by close; never log payloads.
    ws.on('pong', () => {
      alive = true;
    });
    ws.isAlive = () => alive;
    ws.markPending = () => {
      alive = false;
    };
    ws.on('message', (data, binary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (performance.now() - windowStart >= 1000) {
        messages = 0;
        bytes = 0;
        windowStart = performance.now();
      }
      if (++messages > 100) return ws.close(1008, 'Too many messages');
      bytes += data.length;
      if (bytes > maxBytesPerSecond) return ws.close(1008, 'Too many bytes');
      if (!roomId) {
        if (binary || data.length > 128) return ws.close(1008, 'Invalid join');
        let join;
        try {
          join = JSON.parse(data.toString());
        } catch {
          return ws.close(1008, 'Invalid join');
        }
        if (
          !join ||
          typeof join !== 'object' ||
          Object.keys(join).length !== 1 ||
          typeof join.join !== 'string' ||
          !/^[a-f0-9]{32}$/.test(join.join)
        ) {
          return ws.close(1008, 'Invalid room');
        }
        let room = rooms.get(join.join);
        if (room?.size >= 2) {
          // Relay controls are advisory, not proof that a third peer has the key.
          const now = performance.now();
          if (now - (rejectedNotices.get(room) ?? -Infinity) >= 10_000) {
            rejectedNotices.set(room, now);
            for (const peer of room) control(peer, 'peer-rejected');
          }
          return ws.close(1008, 'Room full');
        }
        if (!room) {
          if (rooms.size >= maxRooms || source.rooms >= maxRoomsPerSource)
            return ws.close(1013, 'Relay busy');
          room = new Set();
          roomOwners.set(room, source);
          source.rooms++;
        }
        roomId = join.join;
        room.add(ws);
        rooms.set(roomId, room);
        clearTimeout(joinTimer);
        control(ws, 'joined');
        if (room.size === 2) for (const peer of room) {
          peer.stopWaiting();
          control(peer, 'peer-joined');
        }
        else ws.waitForPeer();
        return;
      }
      if (!binary) return ws.close(1008, 'Binary signals required');
      for (const peer of rooms.get(roomId) ?? []) {
        if (peer === ws || peer.readyState !== WebSocket.OPEN) continue;
        send(peer, data, true);
      }
    });
    ws.on('close', () => {
      clearTimeout(joinTimer);
      ws.stopWaiting();
      const room = rooms.get(roomId);
      if (!room) return;
      room.delete(ws);
      if (!room.size) {
        rooms.delete(roomId);
        roomOwners.get(room).rooms--;
      } else for (const peer of room) {
        control(peer, 'peer-left');
        peer.waitForPeer();
      }
    });
  });
  const heartbeat = setInterval(() => {
    pruneSources();
    for (const ws of wss.clients) {
      if (!ws.isAlive()) {
        ws.terminate();
        continue;
      }
      ws.markPending();
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();
  return {
    server,
    rooms,
    close: () => {
      if (closing) return closing;
      closing = new Promise((resolve, reject) => {
        clearInterval(heartbeat);
        const deadline = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
        }, shutdownTimeoutMs);
        deadline.unref();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close((error) => {
          clearTimeout(deadline);
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections();
      });
      return closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.RELAY_TRUST_PROXY && !['true', 'false'].includes(process.env.RELAY_TRUST_PROXY))
    throw new Error('RELAY_TRUST_PROXY must be true or false.');
  const relay = createRelay({
    allowedOrigins: process.env.RELAY_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()),
    trustProxy: process.env.RELAY_TRUST_PROXY === 'true',
  });
  const port = Number(process.env.PORT || 8787);
  relay.server.listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`bambicam relay listening on port ${port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => void relay.close().catch(() => { process.exitCode = 1; }));
}
