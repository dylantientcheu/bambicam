import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

// The relay understands room IDs and control messages, never encrypted payloads.
export function createRelay({
  maxRooms = 1000,
  maxConnections = 2048,
  maxUpgradesPerWindow = 60,
  upgradeWindowMs = 1000,
  maxBytesPerSecond = 256 * 1024,
  joinTimeoutMs = 5000,
  heartbeatMs = 30_000,
  shutdownTimeoutMs = 3000,
} = {}) {
  const rooms = new Map();
  const sockets = new Set();
  let closing;
  let upgrades = 0;
  let upgradeWindowStart = performance.now();
  const server = createServer({ headersTimeout: 10_000, requestTimeout: 10_000 }, (req, res) => {
    const healthy = !closing && req.url === '/health' && ['GET', 'HEAD'].includes(req.method);
    res.writeHead(healthy ? 200 : closing ? 503 : 404, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
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
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const reject = (status) => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\nRetry-After: 1\r\n\r\n`);
      socket.setTimeout(1000, () => socket.destroy());
    };
    if (closing || wss.clients.size >= maxConnections) return reject('503 Service Unavailable');
    if (performance.now() - upgradeWindowStart >= upgradeWindowMs) {
      upgradeWindowStart = performance.now();
      upgrades = 0;
    }
    // Global rather than per-IP: no forwarded-IP trust or retained IP counters.
    if (++upgrades > maxUpgradesPerWindow) return reject('429 Too Many Requests');
    if (req.url !== '/relay') return reject('404 Not Found');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  const control = (ws, type) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type }));
  };

  wss.on('connection', (ws) => {
    let roomId;
    let alive = true;
    let messages = 0;
    let bytes = 0;
    let windowStart = performance.now();
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
        const room = rooms.get(join.join) ?? new Set();
        if (room.size >= 2) return ws.close(1008, 'Room full');
        if (!rooms.has(join.join) && rooms.size >= maxRooms) return ws.close(1013, 'Relay busy');
        roomId = join.join;
        room.add(ws);
        rooms.set(roomId, room);
        clearTimeout(joinTimer);
        control(ws, 'joined');
        if (room.size === 2) for (const peer of room) control(peer, 'peer-joined');
        return;
      }
      if (!binary) return ws.close(1008, 'Binary signals required');
      for (const peer of rooms.get(roomId) ?? []) {
        if (peer === ws || peer.readyState !== WebSocket.OPEN) continue;
        if (peer.bufferedAmount > 256 * 1024) {
          peer.close(1013, 'Slow receiver');
          continue;
        }
        peer.send(data, { binary: true });
      }
    });
    ws.on('close', () => {
      clearTimeout(joinTimer);
      const room = rooms.get(roomId);
      if (!room) return;
      room.delete(ws);
      if (!room.size) rooms.delete(roomId);
      else for (const peer of room) control(peer, 'peer-left');
    });
  });
  const heartbeat = setInterval(() => {
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
  const relay = createRelay();
  const port = Number(process.env.PORT || 8787);
  relay.server.listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`bambicam relay listening on port ${port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => void relay.close().catch(() => { process.exitCode = 1; }));
}
