import { test as base, expect } from '@playwright/test';

// Generate PCM in the browser rather than requiring a host microphone/audio
// capture service. The app and the actual WebRTC transport remain unmodified.
export const test = base.extend({
  browser: async ({ browser }, use) => {
    const newContext = browser.newContext;
    if (process.env.BAMBICAM_TEST_LOOPBACK === '1') {
      // Chromium exposes loopback ICE interfaces only to contexts with capture
      // permission. Apply the same synthetic-device grant to both test peers.
      browser.newContext = (options = {}) => newContext.call(browser, {
        ...options,
        permissions: options.permissions ?? ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
      });
    }
    try { await use(browser); } finally { browser.newContext = newContext; }
  },
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (!constraints?.audio) return capture(constraints);
        const stream = constraints.video
          ? await capture({ video: constraints.video, audio: false })
          : new MediaStream();
        const audio = new (window as any).MediaStreamTrackGenerator({ kind: 'audio' });
        const writer = audio.writable.getWriter();
        let frame = 0;
        const timer = setInterval(async () => {
          if (audio.readyState === 'ended') {
            clearInterval(timer);
            await writer.close();
            return;
          }
          const samples = Float32Array.from(
            { length: 480 },
            (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * (frame * 480 + i)) / 48000),
          );
          const data = new (window as any).AudioData({
            format: 'f32',
            sampleRate: 48000,
            numberOfFrames: 480,
            numberOfChannels: 1,
            timestamp: frame++ * 10000,
            data: samples,
          });
          try {
            await writer.write(data);
          } catch {
            clearInterval(timer);
          } finally {
            data.close();
          }
        }, 10);
        stream.addTrack(audio);
        return stream;
      };
    });
    await use(page);
  },
});

export { expect };
