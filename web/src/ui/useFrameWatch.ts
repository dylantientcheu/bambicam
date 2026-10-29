import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';

const STALE_AFTER_MS = 5_000;

/**
 * Seconds since the last new video frame was painted, or 0 while frames keep
 * arriving. A WebRTC connection can report "connected" while frames stop; to a
 * parent a frozen frame of a sleeping baby looks like a sleeping baby.
 */
export function useFrameWatch(video: RefObject<HTMLVideoElement | null>, stream: MediaStream | null, enabled = true) {
  const [staleSeconds, setStaleSeconds] = useState(0);
  useEffect(() => {
    setStaleSeconds(0);
    const element = video.current;
    if (!stream || !element || !enabled) return;
    let alive = true;
    let last = performance.now();
    let frameHandle: number | undefined;
    let frames = 0;
    const fresh = () => {
      last = performance.now();
    };
    function onFrame() {
      if (!alive) return;
      fresh();
      frameHandle = element!.requestVideoFrameCallback(onFrame);
    }
    const paints = typeof element.requestVideoFrameCallback === 'function';
    if (paints) frameHandle = element.requestVideoFrameCallback(onFrame);
    const timer = setInterval(() => {
      if (!paints) {
        // Fallback: count decoded frames instead of painted ones.
        const quality = element.getVideoPlaybackQuality?.();
        if (quality && quality.totalVideoFrames !== frames) {
          frames = quality.totalVideoFrames;
          fresh();
        }
      }
      const expected =
        document.visibilityState === 'visible' &&
        !element!.paused &&
        stream!.getVideoTracks().some((track) => track.readyState === 'live');
      if (!expected) {
        fresh(); // Hidden tabs and paused players legitimately paint nothing.
        setStaleSeconds(0);
        return;
      }
      const gap = performance.now() - last;
      setStaleSeconds(gap >= STALE_AFTER_MS ? Math.floor(gap / 1000) : 0);
    }, 1_000);
    document.addEventListener('visibilitychange', fresh);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', fresh);
      if (frameHandle !== undefined) element.cancelVideoFrameCallback?.(frameHandle);
    };
  }, [stream, enabled]);
  return staleSeconds;
}
