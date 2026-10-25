import { fromBase64Url, validateRelay } from '../signal/pairing';
import { validateStun } from '../rtc/ice';

export const PAIRING_STORAGE_KEY = 'bambicam.remembered.v1';
export interface RememberedPairing {
  secret: string;
  relay: string;
  stun: string;
}

export function loadRemembered(pageUrl: string): RememberedPairing | null {
  try {
    const value = JSON.parse(localStorage.getItem(PAIRING_STORAGE_KEY) ?? 'null');
    if (
      !value ||
      value.version !== 1 ||
      typeof value.secret !== 'string' ||
      typeof value.relay !== 'string' ||
      typeof value.stun !== 'string'
    )
      return null;
    fromBase64Url(value.secret, 32);
    return {
      secret: value.secret,
      relay: validateRelay(value.relay, pageUrl),
      stun: validateStun(value.stun),
    };
  } catch {
    return null;
  } // Private browsing, blocked storage, or stale data.
}

export function saveRemembered(pairing: RememberedPairing) {
  localStorage.setItem(PAIRING_STORAGE_KEY, JSON.stringify({ version: 1, ...pairing }));
}
export function forgetRemembered() {
  localStorage.removeItem(PAIRING_STORAGE_KEY);
}
