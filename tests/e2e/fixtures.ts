import { test as base, expect } from '@playwright/test';

// Generate PCM in the browser rather than requiring a host microphone/audio
// capture service. The app and the actual WebRTC transport remain unmodified.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (!constraints?.audio) return capture(constraints);
        const stream = await capture({ video: constraints.video, audio: false });
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
