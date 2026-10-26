import type { Role } from '../signal/crypto';
import { derivePairing } from '../signal/pairing';
import { iceServers } from './ice';
import { createPeer, type Path } from './peer';

export type Stage = 'connecting' | 'waiting' | 'pairing' | 'live' | 'reconnecting' | 'ended';
interface Options {
  role: Role;
  secret: string;
  relay: string;
  stun: string;
  stream?: MediaStream;
  onStage: (stage: Stage) => void;
  onStream: (stream: MediaStream | null) => void;
  onPath?: (path: Path | null) => void;
  onError: (message: string) => void;
  onJoinRejected?: () => void;
}
export interface MonitorHandle {
  close: () => void;
  /** Send a reacquired camera/microphone to the current and future peers. */
  replaceStream: (stream: MediaStream) => void;
}

export async function connectMonitor(options: Options): Promise<MonitorHandle> {
  const servers = iceServers(options.stun);
  const { key, roomId } = await derivePairing(options.secret);
  let stopped = false;
  let attempts = 0;
  let hadPeer = false;
  let notice = '';
  let ws: WebSocket | undefined;
  let peer: ReturnType<typeof createPeer> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function status(stage: Stage, message = notice) {
    notice = message;
    options.onStage(stage);
    options.onError(message);
  }
  function dropPeer() {
    peer?.close();
    peer = undefined;
    options.onStream(null);
    options.onPath?.(null);
  }
  function dropSocket() {
    clearTimeout(timer);
    const old = ws;
    ws = undefined; // Invalidate callbacks before closing the socket.
    dropPeer();
    old?.close();
  }
  function close() {
    if (stopped) return;
    stopped = true;
    clearTimeout(retry);
    dropSocket();
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
  }
  function fail(message: string) {
    close();
    status('ended', message);
  }
  function reconnect(message: string) {
    if (stopped) return;
    dropSocket();
    status('reconnecting', message);
    clearTimeout(retry);
    const delay = Math.min(15_000, 1_000 * 2 ** Math.min(attempts++, 4));
    retry = setTimeout(connect, delay + Math.random() * 500);
  }
  function resume() {
    if (!stopped && !ws && document.visibilityState === 'visible') {
      clearTimeout(retry);
      connect();
    }
  }
  function waitForPeer() {
    clearTimeout(timer);
    status(hadPeer ? 'reconnecting' : 'waiting');
    if (options.role === 'parent')
      timer = setTimeout(() => {
        options.onError(
          'Waiting for the baby unit. Keep its app open. If it restarted or has a new code, scan that code again.',
        );
      }, 30_000);
  }
  function connect() {
    retry = undefined;
    if (stopped) return;
    // navigator.onLine is only a hint; a LAN relay may be reachable even when
    // the OS reports no Internet. Let the actual connection decide.
    let socket: WebSocket;
    try {
      socket = new WebSocket(options.relay);
    } catch {
      fail('Cannot open this relay address. Check Connection settings and try again.');
      return;
    }
    ws = socket;
    socket.binaryType = 'arraybuffer';
    const current = () => !stopped && ws === socket;
    timer = setTimeout(() => {
      if (current())
        reconnect(
          'Cannot reach the relay. Check the network and relay address. Retrying automatically.',
        );
    }, 12_000);
    socket.onopen = () => {
      if (current()) socket.send(JSON.stringify({ join: roomId }));
    };
    // Transport errors also emit close, which owns the single retry timer.
    socket.onerror = () => {};
    socket.onclose = (event) => {
      if (!current()) return;
      if (event.code === 1008 && event.reason !== 'Room full') {
        fail('The relay refused this session. Check the relay address or scan a new code.');
      } else
        reconnect(
          event.reason === 'Room full'
            ? 'This baby unit is busy: another parent is connected. If you do not recognize it, use New pairing code on the baby phone. Retrying automatically.'
            : 'The relay connection was lost. Reconnecting automatically; keep both apps open.',
        );
    };
    socket.onmessage = ({ data }) => {
      if (!current()) return;
      if (data instanceof ArrayBuffer) {
        peer?.receive(data);
        return;
      }
      try {
        const message = JSON.parse(data);
        if (message.type === 'joined') waitForPeer();
        else if (message.type === 'peer-rejected') options.onJoinRejected?.();
        else if (message.type === 'peer-left') {
          dropPeer();
          notice = 'The other device left. Waiting for it to return; keep both apps open.';
          waitForPeer();
        } else if (message.type === 'peer-joined' && !peer) {
          hadPeer = true;
          clearTimeout(timer);
          status('pairing');
          const next = createPeer({
            key,
            role: options.role,
            stream: options.stream,
            iceServers: servers,
            send: (packet) => {
              if (current() && peer === next) socket.send(packet);
            },
            onStream: (stream) => {
              if (current() && peer === next) options.onStream(stream);
            },
            onConnected: () => {
              if (!current() || peer !== next) return;
              attempts = 0;
              status('live', '');
            },
            onPath: (path) => {
              if (current() && peer === next) options.onPath?.(path);
            },
            onInterrupted: () => {
              if (current() && peer === next)
                status('reconnecting', 'Connection interrupted. Trying to recover…');
            },
            onLost: () => {
              if (current() && peer === next)
                reconnect(
                  servers.length
                    ? 'A direct connection could not be maintained. Some mobile, guest, or restricted networks block it. Try the same Wi-Fi. Retrying automatically; no media relay is configured.'
                    : 'Could not connect directly. Use the same Wi-Fi with device isolation disabled, or enable STUN in Connection settings. Retrying automatically.',
                );
            },
            onInvalid: () => {
              if (current() && peer === next)
                fail(
                  'The secure handshake could not be verified. Generate a new code and scan it again.',
                );
            },
          });
          peer = next;
        }
      } catch {
        fail('Could not start a secure session. Check connection settings and try again.');
      }
    };
  }
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  status('connecting');
  connect();
  return {
    close,
    replaceStream(stream) {
      if (stopped) return;
      options.stream = stream;
      void peer?.replaceStream(stream).catch(() => {});
    },
  };
}
