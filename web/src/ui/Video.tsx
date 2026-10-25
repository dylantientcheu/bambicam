import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';

export function Video({
  stream,
  local = false,
  status,
  notice,
  videoRef,
}: {
  stream: MediaStream | null;
  local?: boolean;
  status?: string;
  notice?: string;
  /** Optional ref so a parent component can control the same video element. */
  videoRef?: RefObject<HTMLVideoElement | null>;
}) {
  const own = useRef<HTMLVideoElement>(null);
  const video = videoRef ?? own;
  const [needsPlay, setNeedsPlay] = useState(false);
  useEffect(() => {
    const element = video.current!;
    element.srcObject = stream;
    let active = true;
    if (!stream) setNeedsPlay(false);
    if (stream)
      void element
        .play()
        .then(() => {
          if (active) setNeedsPlay(false);
        })
        .catch(() => {
          if (active && !local) setNeedsPlay(true);
        });
    return () => {
      active = false;
      element.srcObject = null;
    };
  }, [stream, local]);
  async function play() {
    try {
      await video.current!.play();
      setNeedsPlay(false);
    } catch {
      setNeedsPlay(true);
    }
  }
  return (
    <div class="video-frame">
      <video
        ref={video}
        autoPlay
        playsInline
        muted={local}
        aria-label={local ? 'Baby camera preview' : 'Live baby video'}
      />
      {!stream && (
        <div class="video-placeholder">
          <span class="sleepy-eyes">
            <Icon name="sleep" size={64} />
          </span>
          <p>{status ?? 'Your little one will appear here.'}</p>
          {notice && <p>{notice}</p>}
        </div>
      )}
      {needsPlay && (
        <div class="play-overlay">
          <button class="button" onClick={play}>
            Play video &amp; sound
          </button>
        </div>
      )}
    </div>
  );
}
