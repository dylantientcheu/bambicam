import type { Role } from '../signal/crypto';
import { derivePairing } from '../signal/pairing';
import { iceServers } from './ice';
import { createPeer, type Path } from './peer';
import type { CaptureMode } from '../baby/capture';

export type Stage = 'connecting' | 'waiting' | 'pairing' | 'live' | 'reconnecting' | 'ended';
interface Options {
  role: Role;
  secret: string;
  relay: string;
  stun: string;
  stream?: MediaStream;
  mode?: CaptureMode;
  onStage: (stage: Stage) => void;
  onStream: (stream: MediaStream | null) => void;
  onPath?: (path: Path | null) => void;
  onError: (message: string) => void;
  onJoinRejected?: () => void;
  onSignaling?: (ready: boolean) => void;
  onMode?: (mode: CaptureMode) => void;
}
export interface MonitorHandle {
  close: () => void;
  /** Send a reacquired camera/microphone to the current and future peers. */
  replaceStream: (stream: MediaStream, mode?: CaptureMode) => Promise<void>;
}

export async function connectMonitor(options: Options): Promise<MonitorHandle> {
  const servers = iceServers(options.stun);
  const { key, roomId } = await derivePairing(options.secret);
  let stopped = false;
  let attempts = 0;
  let hadPeer = false;
  let established = false;
  let mediaLive = false;
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
    established = false;
    mediaLive = false;
    peer?.close();
    peer = undefined;
    options.onStream(null);
    options.onPath?.(null);
  }
  function dropSocket() {
    clearTimeout(timer);
    const old = ws;
    ws = undefined; // Invalidate callbacks before closing the socket.
    options.onSignaling?.(false);
    old?.close();
  }
  function close() {
    if (stopped) return;
    stopped = true;
    clearTimeout(retry);
    dropPeer();
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
    if (!established) {
      dropPeer();
      status('reconnecting', message);
    } else if (mediaLive) status('live', '');
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
    if (established) return;
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
      if (!established && event.code === 1008 && event.reason !== 'Room full') {
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
        // A live authenticated peer cannot be replaced by a relay arrival or
        // replay. Wait for the actual media/control connection to fail first.
        if (!established) peer?.receive(data);
        return;
      }
      try {
        const message = JSON.parse(data);
        if (message.type === 'joined') waitForPeer();
        else if (message.type === 'peer-rejected') options.onJoinRejected?.();
        else if (message.type === 'peer-left') {
          options.onSignaling?.(false);
          if (!established) {
            dropPeer();
            notice = 'The other device left. Waiting for it to return; keep both apps open.';
            waitForPeer();
          }
        } else if (message.type === 'peer-joined') {
          clearTimeout(timer);
          attempts = 0;
          options.onSignaling?.(true);
          if (peer) return;
          hadPeer = true;
          status('pairing');
          // Peer callbacks belong to the media session, not a particular socket.
          const activePeer = () => !stopped && peer === next;
          const next = createPeer({
            key,
            role: options.role,
            stream: options.stream,
            mode: options.mode,
            iceServers: servers,
            send: (packet) => {
              if (activePeer() && ws?.readyState === WebSocket.OPEN) ws.send(packet);
            },
            onStream: (stream) => {
              if (activePeer()) options.onStream(stream);
            },
            onConnected: () => {
              if (!activePeer()) return;
              established = true;
              mediaLive = true;
              attempts = 0;
              status('live', '');
            },
            onPath: (path) => {
              if (activePeer()) options.onPath?.(path);
            },
            onInterrupted: () => {
              if (activePeer()) {
                mediaLive = false;
                status('reconnecting', 'Connection interrupted. Trying to recover…');
              }
            },
            onLost: () => {
              if (activePeer()) {
                dropPeer();
                reconnect(
                  servers.length
                    ? 'A direct connection could not be maintained. Some mobile, guest, or restricted networks block it. Try the same Wi-Fi. Retrying automatically; no media relay is configured.'
                    : 'Could not connect directly. Use the same Wi-Fi with device isolation disabled, or enable STUN in Connection settings. Retrying automatically.',
                );
              }
            },
            onInvalid: () => {
              if (activePeer())
                fail(
                  'The secure handshake could not be verified. Generate a new code and scan it again.',
                );
            },
            onStopped: () => {
              if (!activePeer()) return;
              dropPeer();
              reconnect('The other device left or its connection stopped. Waiting for it to return; keep both apps open.');
            },
            onMode: (mode) => { if (activePeer()) options.onMode?.(mode); },
          });
          peer = next;
        }
      } catch {
        if (established) reconnect('Connection service unavailable. Retrying automatically.');
        else fail('Could not start a secure session. Check connection settings and try again.');
      }
    };
  }
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  status('connecting');
  connect();
  return {
    close,
    async replaceStream(stream, mode = options.mode) {
      if (stopped) return;
      const currentPeer = peer;
      await currentPeer?.replaceStream(stream, mode);
      if (stopped) return;
      options.stream = stream;
      options.mode = mode;
      if (peer !== currentPeer) await peer?.replaceStream(stream, mode);
    },
  };
}
