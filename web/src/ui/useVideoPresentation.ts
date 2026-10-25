import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

type SafariVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

// Keep iPhone live streams in the page when expanding. Handing the same video
// between the native fullscreen player and PiP can leave the phone UI stuck.
// Capability checks alone are insufficient: both fullscreen APIs can be exposed.
const inlineFullView = /iPhone|iPod/.test(navigator.userAgent);

export function useVideoPresentation(
  video: RefObject<HTMLVideoElement | null>,
  frame: RefObject<HTMLDivElement | null>,
  stream: MediaStream | null,
) {
  const [pipAvailable, setPipAvailable] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = video.current as SafariVideo;
    const container = frame.current;
    function update() {
      const ready = !!stream && element.readyState >= 1 && element.videoWidth > 0;
      // Safari can report standard PiP support even when a Home Screen app
      // cannot actually enter it. Its per-video capability probe is stricter.
      let supportsPip = false;
      try {
        supportsPip = element.webkitSupportsPresentationMode
          ? element.webkitSupportsPresentationMode('picture-in-picture')
          : document.pictureInPictureEnabled &&
            typeof element.requestPictureInPicture === 'function';
      } catch {
        /* Unsupported live stream or container. */
      }
      setPipAvailable(ready && supportsPip);
      setNativeFullscreen(
        !inlineFullView && (!!document.fullscreenEnabled || !!element.webkitSupportsFullscreen),
      );
      setPip(
        document.pictureInPictureElement === element ||
          element.webkitPresentationMode === 'picture-in-picture',
      );
      setFullscreen(
        document.fullscreenElement === frame.current ||
          !!element.webkitDisplayingFullscreen ||
          element.webkitPresentationMode === 'fullscreen',
      );
    }
    const events = [
      'loadedmetadata',
      'resize',
      'emptied',
      'enterpictureinpicture',
      'leavepictureinpicture',
      'webkitpresentationmodechanged',
      'webkitbeginfullscreen',
      'webkitendfullscreen',
    ];
    for (const name of events) element.addEventListener(name, update);
    document.addEventListener('fullscreenchange', update);
    update();
    setError('');
    return () => {
      for (const name of events) element.removeEventListener(name, update);
      document.removeEventListener('fullscreenchange', update);
      if (document.pictureInPictureElement === element)
        void document.exitPictureInPicture().catch(() => {});
      if (container && document.fullscreenElement === container)
        void document.exitFullscreen().catch(() => {});
      try {
        if (
          element.webkitPresentationMode === 'picture-in-picture' ||
          element.webkitPresentationMode === 'fullscreen'
        )
          element.webkitSetPresentationMode?.('inline');
        if (element.webkitDisplayingFullscreen) element.webkitExitFullscreen?.();
      } catch {
        /* The browser may already have closed the presentation. */
      }
    };
  }, [stream]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const before = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    frame.current?.querySelector<HTMLButtonElement>('[data-expand]')?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setExpanded(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(
        frame.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', keyboard);
      before?.focus();
    };
  }, [expanded]);

  async function togglePip() {
    const element = video.current as SafariVideo;
    setError('');
    // Release the expanded page's focus/scroll trap when moving video into PiP.
    setExpanded(false);
    try {
      if (
        element.webkitSupportsPresentationMode?.('picture-in-picture') &&
        element.webkitSetPresentationMode
      ) {
        element.webkitSetPresentationMode(
          element.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture',
        );
      } else if (document.pictureInPictureElement === element) {
        await document.exitPictureInPicture();
      } else {
        await element.requestPictureInPicture();
      }
    } catch {
      setError(
        'Picture in Picture could not start. On iPhone, try Safari rather than the Home Screen app. Keep the video open if PiP is unavailable.',
      );
    }
  }

  async function toggleFullscreen() {
    const element = video.current as SafariVideo;
    setError('');
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (inlineFullView) {
      // No native player transition: preserve the element, stream, and controls.
      if (pip) await togglePip();
      setExpanded(true);
      return;
    }
    try {
      if (document.fullscreenElement === frame.current) await document.exitFullscreen();
      else if (
        element.webkitDisplayingFullscreen ||
        element.webkitPresentationMode === 'fullscreen'
      ) {
        if (element.webkitExitFullscreen) element.webkitExitFullscreen();
        else element.webkitSetPresentationMode?.('inline');
      } else if (document.fullscreenEnabled && frame.current?.requestFullscreen)
        await frame.current.requestFullscreen();
      else if (element.webkitSupportsFullscreen && element.webkitEnterFullscreen)
        element.webkitEnterFullscreen();
      else setExpanded(true);
    } catch {
      setExpanded(true);
      setError('Browser fullscreen is unavailable. This expanded view fills the page instead.');
    }
  }

  return {
    pipAvailable,
    nativeFullscreen,
    pip,
    fullscreen,
    expanded,
    error,
    togglePip,
    toggleFullscreen,
  };
}
