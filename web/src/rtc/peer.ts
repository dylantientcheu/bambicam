import { SecureChannel, type Role, type Signal } from '../signal/crypto';

/** How media travels: directly on one network, directly across networks via
 *  STUN, through a media relay (never configured here), or not yet known. */
export type Path = 'lan' | 'stun' | 'relay' | 'unknown';

interface Options {
  key: CryptoKey;
  role: Role;
  stream?: MediaStream;
  iceServers: RTCIceServer[];
  send: (packet: ArrayBuffer) => void;
  onStream: (stream: MediaStream) => void;
  onConnected: () => void;
  onPath?: (path: Path) => void;
  onInterrupted: () => void;
  onLost: () => void;
  onInvalid: () => void;
}

// Every arrival gets a fresh challenge, including a peer reloading while our
// relay socket stays open. Old asynchronous work cannot affect its replacement.
export function createPeer(options: Options) {
  const channel = new SecureChannel(options.key, options.role);
  const pc = new RTCPeerConnection({ iceServers: options.iceServers });
  const remote = new MediaStream();
  const pendingIce: RTCIceCandidateInit[] = [];
  let closed = false;
  let ready = false;
  let descriptionReceived = false;
  let incoming = Promise.resolve();
  let outgoing = Promise.resolve();
  let grace: ReturnType<typeof setTimeout> | undefined;
  let pathTimer: ReturnType<typeof setInterval> | undefined;
  let lastPath: Path | undefined;
  const timeout = setTimeout(() => options.onLost(), 25_000);

  // The selected ICE pair can change while connected, so keep checking.
  async function reportPath() {
    if (closed || !options.onPath) return;
    let path: Path;
    try {
      path = await readPath(pc);
    } catch {
      path = 'unknown';
    }
    if (closed || path === lastPath) return;
    lastPath = path;
    options.onPath(path);
  }

  function send(signal: Signal) {
    outgoing = outgoing
      .then(async () => {
        if (closed) return;
        const packet = await channel.seal(signal);
        if (!closed) options.send(packet);
      })
      .catch(() => {
        if (!closed) options.onLost();
      });
    return outgoing;
  }
  async function setRemote(type: 'offer' | 'answer', sdp: string) {
    if (descriptionReceived) throw new Error('Unexpected second description.');
    descriptionReceived = true;
    await pc.setRemoteDescription({ type, sdp });
    for (const candidate of pendingIce.splice(0)) {
      if (closed) return;
      await pc.addIceCandidate(candidate);
    }
  }
  async function receive(packet: ArrayBuffer) {
    if (closed) return;
    const { signal, session } = await channel.open(packet);
    if (closed) return;
    switch (signal.type) {
      case 'hello':
        await send({ type: 'ready', echo: session });
        break;
      case 'ready':
        ready = true;
        if (options.role === 'baby') {
          const offer = await pc.createOffer();
          if (closed) return;
          await pc.setLocalDescription(offer);
          if (!closed) await send({ type: 'offer', sdp: pc.localDescription!.sdp });
        }
        break;
      case 'offer':
        if (!ready || options.role !== 'parent') throw new Error('Unexpected offer.');
        await setRemote('offer', signal.sdp);
        if (closed) return;
        const answer = await pc.createAnswer();
        if (closed) return;
        await pc.setLocalDescription(answer);
        if (!closed) await send({ type: 'answer', sdp: pc.localDescription!.sdp });
        break;
      case 'answer':
        if (!ready || options.role !== 'baby') throw new Error('Unexpected answer.');
        await setRemote('answer', signal.sdp);
        break;
      case 'ice':
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
        else {
          if (pendingIce.length >= 128) throw new Error('Too many ICE candidates.');
          pendingIce.push(signal.candidate);
        }
        break;
    }
  }

  const kinds = new Map<RTCRtpSender, string>();
  for (const track of options.stream?.getTracks() ?? [])
    kinds.set(pc.addTrack(track, options.stream!), track.kind);
  pc.onicecandidate = ({ candidate }) => {
    if (candidate && !closed) void send({ type: 'ice', candidate: candidate.toJSON() });
  };
  pc.ontrack = ({ track }) => {
    if (closed) return;
    remote.addTrack(track);
    options.onStream(remote);
  };
  pc.onconnectionstatechange = () => {
    if (closed) return;
    if (pc.connectionState === 'connected') {
      clearTimeout(timeout);
      clearTimeout(grace);
      grace = undefined;
      options.onConnected();
      void reportPath();
      pathTimer ??= setInterval(() => void reportPath(), 10_000);
    } else if (pc.connectionState === 'disconnected') {
      options.onInterrupted();
      grace ??= setTimeout(() => options.onLost(), 8_000);
    } else if (pc.connectionState === 'failed') options.onLost();
  };
  void send({ type: 'hello' });
  return {
    receive(packet: ArrayBuffer) {
      incoming = incoming
        .then(() => receive(packet))
        .catch(() => {
          if (!closed) options.onInvalid();
        });
    },
    /** Swap capture tracks in place, without renegotiation, after the camera
     *  or microphone was reacquired. Kinds without a new track go silent. */
    async replaceStream(stream: MediaStream) {
      if (closed) return;
      await Promise.all(
        pc.getSenders().map((sender) => {
          const kind = kinds.get(sender);
          if (!kind) return undefined;
          const track = stream.getTracks().find((candidate) => candidate.kind === kind) ?? null;
          return sender.replaceTrack(track);
        }),
      );
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      clearTimeout(grace);
      clearInterval(pathTimer);
      pc.close();
      remote.getTracks().forEach((track) => track.stop());
    },
  };
}

async function readPath(pc: RTCPeerConnection): Promise<Path> {
  const stats = await pc.getStats();
  let pair: RTCIceCandidatePairStats | undefined;
  stats.forEach((report) => {
    const transport = report as RTCTransportStats;
    if (transport.type === 'transport' && transport.selectedCandidatePairId)
      pair = stats.get(transport.selectedCandidatePairId) as RTCIceCandidatePairStats | undefined;
  });
  if (!pair)
    stats.forEach((report) => {
      const candidate = report as RTCIceCandidatePairStats;
      if (candidate.type === 'candidate-pair' && candidate.nominated && candidate.state === 'succeeded')
        pair = candidate; // Browsers without transport stats.
    });
  if (!pair) return 'unknown';
  const types = [pair.localCandidateId, pair.remoteCandidateId].map(
    (id) => (stats.get(id) as { candidateType?: string } | undefined)?.candidateType,
  );
  if (types.includes('relay')) return 'relay';
  if (types.every((type) => type === 'host')) return 'lan';
  if (types.some((type) => type === 'srflx' || type === 'prflx')) return 'stun';
  return 'unknown';
}
