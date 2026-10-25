import { newNonce, toBase64Url } from './pairing';

export type Role = 'baby' | 'parent';
export type Signal =
  | { type: 'hello' }
  | { type: 'ready'; echo: string }
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit };
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const HEADER = 22; // version (1), role (1), random session (16), counter (4)

function validSignal(value: unknown): value is Signal {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'hello':
      return true;
    case 'ready':
      return typeof message.echo === 'string' && /^[\w-]{22}$/.test(message.echo);
    case 'offer':
    case 'answer':
      return typeof message.sdp === 'string' && message.sdp.length < 60_000;
    case 'ice': {
      const candidate = message.candidate as RTCIceCandidateInit | null;
      return (
        !!candidate &&
        typeof candidate === 'object' &&
        typeof candidate.candidate === 'string' &&
        (candidate.sdpMid == null || typeof candidate.sdpMid === 'string') &&
        (candidate.sdpMLineIndex == null || Number.isInteger(candidate.sdpMLineIndex))
      );
    }
    default:
      return false;
  }
}

// Each instance belongs to one peer arrival. The ready challenge binds it to
// the peer's fresh session, so a transcript from an earlier connection cannot pair.
export class SecureChannel {
  private nonce = newNonce();
  readonly session = toBase64Url(this.nonce);
  private sent = 0;
  private received = 0;
  private peerSession?: string;
  private authenticated = false;
  constructor(
    private key: CryptoKey,
    private role: Role,
  ) {}

  async seal(signal: Signal): Promise<ArrayBuffer> {
    if (this.sent === 0xffffffff)
      throw new Error('Pairing session exhausted. Generate a new code.');
    const header = new Uint8Array(HEADER);
    header[0] = 1;
    header[1] = this.role === 'baby' ? 0 : 1;
    header.set(this.nonce, 2);
    new DataView(header.buffer).setUint32(18, ++this.sent);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: header, tagLength: 128 },
      this.key,
      encoder.encode(JSON.stringify(signal)),
    );
    const packet = new Uint8Array(HEADER + 12 + encrypted.byteLength);
    packet.set(header);
    packet.set(iv, HEADER);
    packet.set(new Uint8Array(encrypted), HEADER + 12);
    return packet.buffer;
  }

  async open(packet: ArrayBuffer): Promise<{ signal: Signal; session: string }> {
    if (packet.byteLength < HEADER + 12 + 16 || packet.byteLength > 65536)
      throw new Error('Invalid encrypted signal.');
    const data = new Uint8Array(packet);
    const expectedRole = this.role === 'baby' ? 1 : 0;
    if (data[0] !== 1 || data[1] !== expectedRole) throw new Error('Unexpected signaling sender.');
    const session = toBase64Url(data.slice(2, 18));
    const counter = new DataView(packet).getUint32(18);
    if (this.peerSession && this.peerSession !== session)
      throw new Error('The pairing session changed. Scan a new code.');
    if (counter <= this.received) throw new Error('Replayed signaling message rejected.');
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: data.slice(HEADER, HEADER + 12),
        additionalData: data.slice(0, HEADER),
        tagLength: 128,
      },
      this.key,
      data.slice(HEADER + 12),
    );
    const signal: unknown = JSON.parse(decoder.decode(plain));
    if (!validSignal(signal)) throw new Error('Invalid signaling message.');
    if (!this.peerSession && signal.type !== 'hello') throw new Error('Pairing hello required.');
    if (signal.type === 'hello' && this.peerSession) throw new Error('Duplicate pairing hello.');
    if (signal.type === 'ready') {
      if (signal.echo !== this.session || this.authenticated)
        throw new Error('Invalid pairing challenge.');
      this.authenticated = true;
    } else if (signal.type !== 'hello' && !this.authenticated) {
      throw new Error('Pairing challenge required before signaling.');
    }
    this.peerSession = session;
    this.received = counter;
    return { signal, session };
  }
}
