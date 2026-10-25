import type { Path } from '../rtc/peer';

/** Connection diagnostics, available in Options → Advanced. */
export const pathLabel: Record<Path, string> = {
  lan: 'Direct on your network',
  stun: 'Direct across networks, found with STUN',
  relay: 'Through a media relay',
  unknown: '',
};
