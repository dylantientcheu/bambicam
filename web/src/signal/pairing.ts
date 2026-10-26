import { DEFAULT_STUN, validateStun } from '../rtc/ice';

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function fromBase64Url(value: string, length: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('This pairing code is not valid. Scan a new code.');
  let bytes;
  try {
    bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
      char.charCodeAt(0),
    );
  } catch {
    throw new Error('This pairing code is not valid. Scan a new code.');
  }
  if (bytes.length !== length || toBase64Url(bytes) !== value)
    throw new Error('This pairing code is not valid. Scan a new code.');
  return bytes;
}

export const newSecret = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
export const newNonce = () => crypto.getRandomValues(new Uint8Array(16));

export async function derivePairing(secret: string) {
  const material = await crypto.subtle.importKey('raw', fromBase64Url(secret, 32), 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const params = (label: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: encoder.encode(label),
  });
  const [room, key] = await Promise.all([
    crypto.subtle.deriveBits(params('bambicam/room'), material, 128),
    crypto.subtle.deriveKey(
      params('bambicam/signal'),
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
  ]);
  return {
    roomId: Array.from(new Uint8Array(room), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    key,
  };
}

export function validateRelay(value: string, pageUrl: string): string {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a full ws:// or wss:// relay address.');
  }
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error('Use a ws:// or wss:// address without credentials, a query, or a fragment.');
  }
  if (new URL(pageUrl).protocol === 'https:' && url.protocol !== 'wss:')
    throw new Error('An HTTPS page needs a secure wss:// relay.');
  return url.href;
}

export function defaultRelay(pageUrl: string): string {
  const url = new URL('/relay', pageUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export function needsServerApproval(
  pairing: { relay: string; stun: string },
  trusted: { relay: string; stun: string },
): boolean {
  // Turning STUN off introduces no new recipient of network metadata.
  return pairing.relay !== trusted.relay || (pairing.stun !== '' && pairing.stun !== trusted.stun);
}

export function pairingUrl(
  secret: string,
  relay: string,
  pageUrl: string,
  stun = DEFAULT_STUN,
): string {
  fromBase64Url(secret, 32);
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = new URLSearchParams({
    p: secret,
    r: validateRelay(relay, pageUrl),
    s: validateStun(stun),
  }).toString();
  return url.href;
}

export function parsePairing(
  value: string,
  pageUrl: string,
): { secret: string; relay: string; stun: string } {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Paste a complete bambicam pairing link.');
  }
  const current = new URL(pageUrl);
  if (
    url.origin !== current.origin ||
    url.pathname !== current.pathname ||
    url.username ||
    url.password
  ) {
    throw new Error('Open bambicam at the same address on both devices, then scan again.');
  }
  const params = new URLSearchParams(url.hash.slice(1));
  const secret = params.get('p') ?? '';
  fromBase64Url(secret, 32);
  return {
    secret,
    relay: validateRelay(params.get('r') ?? defaultRelay(pageUrl), pageUrl),
    stun: validateStun(params.get('s') ?? DEFAULT_STUN),
  };
}
