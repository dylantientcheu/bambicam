export const DEFAULT_STUN = 'stun:stun.cloudflare.com:3478';

// One STUN endpoint, or blank for LAN only. Never relay media through TURN.
export function validateStun(value: string): string {
  const stun = value.trim();
  if (!stun) return '';
  const match = /^stun:([a-z0-9.-]+|\[[a-f0-9:]+\])(?::([0-9]{1,5}))?$/i.exec(stun);
  if (!match || (match[2] && (+match[2] < 1 || +match[2] > 65535)))
    throw new Error(
      'Use a STUN address such as stun:stun.cloudflare.com:3478, or leave it blank for the same Wi-Fi only.',
    );
  return stun;
}

export function iceServers(stun: string): RTCIceServer[] {
  const url = validateStun(stun);
  return url ? [{ urls: url }] : [];
}
