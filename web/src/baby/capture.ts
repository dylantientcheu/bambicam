export type CaptureState = 'live' | 'paused' | 'recovering';

/** Rear camera, 720p, and untouched audio: a nursery is quiet and processing
 *  built for calls removes exactly the small sounds a parent listens for. */
export function captureConstraints(previous?: MediaStream): MediaStreamConstraints {
  const device = (kind: 'video' | 'audio') =>
    previous?.getTracks().find((track) => track.kind === kind)?.getSettings().deviceId;
  const video = device('video');
  const audio = device('audio');
  return {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(video ? { deviceId: { ideal: video } } : {}),
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(audio ? { deviceId: { ideal: audio } } : {}),
    },
  };
}

export function startCapture(previous?: MediaStream): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(captureConstraints(previous));
}

/** Permission problems do not fix themselves; device and system interruptions often do. */
export function isTransient(error: unknown): boolean {
  return !(error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name));
}

/**
 * Follow a capture stream: `paused` while the system mutes a track (a phone
 * call, the app sent to the background), `live` when every track delivers
 * again, and `ended` once a track is gone for good and must be reacquired.
 */
export function watchCapture(
  stream: MediaStream,
  handlers: { onState: (state: 'live' | 'paused') => void; onEnded: () => void },
): () => void {
  const tracks = stream.getTracks();
  let ended = false;
  const update = () => {
    if (ended) return;
    handlers.onState(tracks.some((track) => track.muted) ? 'paused' : 'live');
  };
  const end = () => {
    if (ended) return;
    ended = true;
    handlers.onEnded();
  };
  for (const track of tracks) {
    track.addEventListener('mute', update);
    track.addEventListener('unmute', update);
    track.addEventListener('ended', end);
  }
  update();
  return () => {
    for (const track of tracks) {
      track.removeEventListener('mute', update);
      track.removeEventListener('unmute', update);
      track.removeEventListener('ended', end);
    }
  };
}

export function whenVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', check);
      resolve();
    };
    document.addEventListener('visibilitychange', check);
  });
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
