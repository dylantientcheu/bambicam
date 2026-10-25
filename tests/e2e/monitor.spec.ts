import { expect, test } from './fixtures';
import { startBaby } from './helpers';

test('two devices pair, receive real WebRTC audio/video tracks, and stop cleanly', async ({
  page: baby,
  browser,
}) => {
  const errors: string[] = [];
  baby.on('pageerror', (error) => errors.push(error.message));
  const link = await startBaby(baby);
  const context = await browser.newContext();
  const parent = await context.newPage();
  parent.on('pageerror', (error) => errors.push(error.message));
  try {
    await parent.goto(link);
    expect(new URL(parent.url()).hash).toBe('');
    await expect(parent.getByRole('status')).toHaveText(/^(Live|Connected)$/, { timeout: 20_000 });
    await expect(baby.getByRole('status')).toHaveText(/^(Live|Connected)$/);
    const video = parent.getByLabel('Live baby video');
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => ({
          hasFrames: element.videoWidth > 0,
          audio: (element.srcObject as MediaStream)
            ?.getAudioTracks()
            .filter((track) => track.readyState === 'live').length,
          video: (element.srcObject as MediaStream)
            ?.getVideoTracks()
            .filter((track) => track.readyState === 'live').length,
          playing: !element.paused,
          muted: element.muted,
        })),
      )
      .toMatchObject({ hasFrames: true, audio: 1, video: 1, playing: true, muted: false });
    const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(before);
    expect(await parent.evaluate(() => localStorage.length)).toBe(0);
    expect(await baby.evaluate(() => localStorage.length)).toBe(0);
    // Read decoded PCM from the remote track: a track object alone is not proof
    // that sound actually crossed the peer connection.
    expect(
      await video.evaluate(async (element: HTMLVideoElement) => {
        const track = (element.srcObject as MediaStream).getAudioTracks()[0];
        const processor = new (window as any).MediaStreamTrackProcessor({ track });
        const reader = processor.readable.getReader();
        try {
          for (let i = 0; i < 100; i++) {
            const { value } = await reader.read();
            const samples = new Float32Array(value.numberOfFrames);
            value.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
            value.close();
            if (samples.some((sample) => Math.abs(sample) > 0.001)) return true;
          }
          return false;
        } finally {
          await reader.cancel();
        }
      }),
    ).toBe(true);
    await parent.getByRole('button', { name: /^Stop( & go back)?$/ }).click();
    await expect(baby.getByRole('alert')).toContainText('other device left');
    await baby.getByLabel('Baby camera preview').evaluate((element: HTMLVideoElement) => {
      (window as any).__captured = (element.srcObject as MediaStream).getTracks();
    });
    await baby.getByRole('button', { name: /^Stop( & go back)?$/ }).click();
    expect(
      await baby.evaluate(() =>
        (window as any).__captured.every((track: MediaStreamTrack) => track.readyState === 'ended'),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('scanning a QR code opens the live feed directly and releases the scanner camera', async ({
  page: baby,
  browser,
}) => {
  await startBaby(baby);
  const qr = await baby.getByRole('img', { name: /Scan this pairing code/ }).getAttribute('src');
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.addInitScript((imageSource) => {
      Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: undefined });
      navigator.mediaDevices.getUserMedia = async () => {
        const image = new Image();
        image.src = imageSource!;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 320;
        const drawing = canvas.getContext('2d')!;
        drawing.fillStyle = '#f8f5ee';
        drawing.fillRect(0, 0, 320, 320);
        drawing.drawImage(image, 0, 0, 320, 320);
        const stream = canvas.captureStream(10);
        (window as any).__scannerStream = stream;
        return stream;
      };
    }, qr);
    await parent.goto(new URL('/', baby.url()).href);
    await parent.getByRole('button', { name: /Parent unit/ }).click();
    await parent.getByRole('button', { name: /^Scan (pairing )?code$/ }).click();
    await expect(parent.getByRole('status')).toHaveText('Connected', { timeout: 10_000 });
    await expect(parent.getByRole('button', { name: 'Connect to baby', exact: true })).toHaveCount(
      0,
    );
    expect(
      await parent.evaluate(() =>
        (window as any).__scannerStream
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === 'ended'),
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        parent.getByLabel('Live baby video').evaluate((element: HTMLVideoElement) => ({
          playing: !element.paused,
          width: element.videoWidth,
          audio: (element.srcObject as MediaStream)?.getAudioTracks().length,
        })),
      )
      .toMatchObject({ playing: true, audio: 1 });
    await expect
      .poll(() =>
        parent
          .getByLabel('Live baby video')
          .evaluate((element: HTMLVideoElement) => element.videoWidth),
      )
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('unused pairing expires after ten minutes', async ({ page }) => {
  await page.clock.install();
  const before = await startBaby(page);
  await page.clock.fastForward(10 * 60 * 1000 + 1);
  await expect(
    page.getByRole('button', { name: /^Copy (pairing )?link$/, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Copy (pairing )?link$/, exact: true }).click();
  const after = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(after).hash).not.toBe(new URL(before).hash);
});

test('denied capture explains how to recover and the layout fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Denied', 'NotAllowedError');
    };
  });
  await page.getByRole('button', { name: /Baby unit/ }).click();
  await page.getByRole('button', { name: 'Start camera & microphone' }).click();
  await expect(page.getByRole('alert')).toContainText('Allow both permissions');
  await expect(page.getByRole('button', { name: 'Start camera & microphone' })).toBeEnabled();
});

test('new code replaces the room and invalid links give a useful error on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const firstLink = await startBaby(page);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: /^New (pairing )?code$/ }).click();
  await expect(
    page.getByRole('button', { name: /^Copy (pairing )?link$/, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Copy (pairing )?link$/, exact: true }).click();
  const nextLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(nextLink).hash).not.toBe(new URL(firstLink).hash);
  await page.getByRole('button', { name: /^Stop( & go back)?$/ }).click();
  await page.getByRole('button', { name: /Parent unit/ }).click();
  await page.getByText(/^(Paste a link|Have a pairing link\?)$/).click();
  await page
    .getByRole('textbox', { name: 'Pairing link' })
    .fill('https://unrelated.example/#p=bad');
  await page.getByRole('button', { name: /^Use (pairing )?link$/ }).click();
  await expect(page.getByRole('alert')).toContainText('same address');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('rotating a live pairing disconnects the parent, and a camera that cannot be reacquired ends capture', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.goto(link);
    await expect(parent.getByRole('status')).toHaveText(/^(Live|Connected)$/);
    await baby.getByRole('button', { name: 'Options', exact: true }).click();
    await baby.getByRole('button', { name: /^New (pairing )?code$/ }).click();
    await expect(parent.getByRole('status')).toHaveText('Reconnecting');
    await expect(baby.getByRole('img', { name: /Scan this pairing code/ })).toBeVisible();
    await baby.getByLabel('Baby camera preview').evaluate((element: HTMLVideoElement) => {
      const stream = element.srcObject as MediaStream;
      (window as any).__captured = stream.getTracks();
      // Permission withdrawn: reacquiring is pointless, so capture must end.
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      };
      stream.getVideoTracks()[0].dispatchEvent(new Event('ended'));
    });
    await expect(baby.getByRole('alert')).toContainText('camera or microphone stopped');
    await expect(baby.getByRole('button', { name: 'Start camera & microphone' })).toBeVisible();
    await expect
      .poll(() =>
        baby.evaluate(() =>
          (window as any).__captured.every(
            (track: MediaStreamTrack) => track.readyState === 'ended',
          ),
        ),
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});

test('opening the same QR link again in an existing parent tab reconnects without losing the feed', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.addInitScript(() => {
      (window as any).__peerCount = 0;
      const NativePeer = RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(config?: RTCConfiguration) {
          super(config);
          (window as any).__peerCount++;
        }
      };
    });
    await parent.goto(link);
    await expect(parent.getByRole('status')).toHaveText('Connected');
    const video = parent.getByLabel('Live baby video');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBeGreaterThan(0);
    // App strips the pairing fragment, so scanning it again is a hash navigation.
    await parent.evaluate((pairing) => {
      location.hash = new URL(pairing).hash;
    }, link);
    await expect.poll(() => parent.evaluate(() => (window as any).__peerCount)).toBe(2);
    await expect(parent.getByRole('status')).toHaveText('Connected');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => !!element.srcObject), {
        timeout: 10_000,
      })
      .toBe(true);
    const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(before);
    expect(new URL(parent.url()).hash).toBe('');
  } finally {
    await context.close();
  }
});
