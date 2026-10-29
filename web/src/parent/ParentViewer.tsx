import { useEffect, useRef, useState } from 'preact/hooks';
import { useFrameWatch } from '../ui/useFrameWatch';
import { Video } from '../ui/Video';
import { IconButton } from '../ui/IconButton';
import { useVideoPresentation } from '../ui/useVideoPresentation';
import { AudioLevel } from './AudioLevel';
import './viewer.css';
import type { CaptureMode } from '../baby/capture';

export function ParentViewer({
  stream,
  status,
  live,
  notice,
  mode,
  signalingReady,
}: {
  stream: MediaStream | null;
  status: string;
  live: boolean;
  notice: string;
  mode: CaptureMode;
  signalingReady: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [controls, setControls] = useState(true);
  const view = useVideoPresentation(video, frame, stream);
  const staleSeconds = useFrameWatch(video, stream, mode !== 'audio');
  const stale = staleSeconds > 0;
  useEffect(() => {
    if (mode === 'audio' && view.pip) void view.togglePip();
  }, [mode, view.pip]);

  function reveal() {
    setControls(true);
    clearTimeout(timer.current);
    if (!stream || !live || view.pip) return;
    timer.current = setTimeout(() => {
      // Keyboard users must keep their focused control in view.
      if (!frame.current?.querySelector(':focus-visible')) setControls(false);
    }, 3_500);
  }
  useEffect(() => {
    reveal();
    return () => clearTimeout(timer.current);
  }, [stream, live, view.expanded, view.fullscreen, view.pip]);

  return (
    <div
      ref={frame}
      class={`parent-viewer ${view.expanded ? 'is-expanded' : ''} ${controls ? 'controls-visible' : ''}`}
      aria-label="Parent video player"
      onPointerDown={reveal}
      onFocusCapture={reveal}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') reveal();
      }}
    >
      <div class="viewer-picture">
        <Video
          videoRef={video}
          stream={stream}
          status={status === 'Connected' ? undefined : status}
          audioOnly={mode === 'audio'}
        />
        {view.pip && (
          <div class="pip-placeholder">
            <p>Playing in Picture in Picture</p>
            <button class="viewer-return" onClick={view.togglePip}>
              Bring video back
            </button>
          </div>
        )}
      </div>
      {(stale || (!live && stream) || notice || view.error || (live && !signalingReady)) && (
        <div class="viewer-notice" role={stale || !live || notice || view.error ? 'alert' : undefined} data-stale={stale ? 'true' : undefined}>
          <p>
            {stale
              ? 'Video may be frozen.'
              : view.error
                ? 'This view isn’t available.'
                : live && !notice
                  ? 'Monitoring continues. Connection setup is unavailable; retrying in the background.'
                  : 'Connection interrupted. Retrying…'}
          </p>
          {stale ? (
            <small>No new picture for {staleSeconds}s. Check the baby phone.</small>
          ) : (
            (notice || view.error) && (
              <details>
                <summary>Details</summary>
                <p>{view.error || notice}</p>
              </details>
            )
          )}
        </div>
      )}
      <div class="viewer-meter">
        <AudioLevel stream={stream} />
      </div>
      <div class="viewer-toolbar" aria-label="Viewing controls">
        {((mode !== 'audio' && view.pipAvailable) || view.pip) && (
          <IconButton
            icon="pip"
            pressed={view.pip}
            label={view.pip ? 'Exit Picture in Picture' : 'Picture in Picture'}
            onClick={view.togglePip}
          />
        )}
        <IconButton
          expand
          icon={view.fullscreen || view.expanded ? 'collapse' : 'expand'}
          pressed={view.fullscreen || view.expanded}
          label={
            view.fullscreen || view.expanded
              ? 'Exit full view'
              : view.nativeFullscreen
                ? 'Full screen'
                : 'Expand view'
          }
          onClick={view.toggleFullscreen}
        />
      </div>
    </div>
  );
}
