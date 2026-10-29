import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startBaby } from './helpers';

async function observe(page: Page) {
  await page.addInitScript(() => {
    const peers: RTCPeerConnection[] = [];
    const NativePeer = RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(config?: RTCConfiguration) {
        super(config);
        peers.push(this);
      }
    };
    (window as any).__peers = peers;
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__captures = [];
    navigator.mediaDevices.getUserMedia = (constraints) => {
      (window as any).__captures.push(constraints);
      return capture(constraints);
    };
  });
}

async function chooseMode(baby: Page, mode: string) {
  await baby.getByRole('button', { name: 'Options', exact: true }).click();
  await baby.getByLabel('Monitoring mode').selectOption(mode);
  await expect(baby.getByLabel('Monitoring mode')).toBeEnabled();
  await baby.getByRole('button', { name: 'Close options' }).click();
}

async function soundIsLive(parent: Page) {
  await expect(parent.getByRole('status')).toHaveText('Connected');
  await expect.poll(async () => Number(await parent.getByRole('meter', {
    name: 'Live sound level',
  }).getAttribute('aria-valuenow'))).toBeGreaterThan(10);
}

test('audio-only starts and recovers without a camera, and can add video without reconnecting', async ({ page: baby, browser }) => {
  await observe(baby);
  await baby.goto('/');
  await baby.getByRole('button', { name: /Baby unit/ }).click();
  await baby.getByLabel('Monitoring mode').selectOption('audio');
  await baby.getByRole('button', { name: 'Start microphone', exact: true }).click();
  await baby.getByRole('button', { name: 'Copy pairing link', exact: true }).click();
  const link = await baby.evaluate(() => navigator.clipboard.readText());
  expect(await baby.evaluate(() => (window as any).__captures.map((c: MediaStreamConstraints) => c.video))).toEqual([false]);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.goto(link);
    await soundIsLive(parent);
    await expect(parent.getByText('Audio only · camera is off', { exact: true })).toBeVisible();
    const endedAudio = await baby.getByLabel('Baby camera preview').evaluate((video: HTMLVideoElement) => {
      const track = (video.srcObject as MediaStream).getAudioTracks()[0];
      track.stop();
      track.dispatchEvent(new Event('ended'));
      return track.id;
    });
    await expect.poll(() => baby.getByLabel('Baby camera preview').evaluate((video: HTMLVideoElement, oldId) => {
      const track = (video.srcObject as MediaStream).getAudioTracks()[0];
      return track.readyState === 'live' && track.id !== oldId;
    }, endedAudio)).toBe(true);
    await expect.poll(() => baby.evaluate(() => (window as any).__captures.map(
      (c: MediaStreamConstraints) => c.video,
    ))).toEqual([false, false]);
    await soundIsLive(parent);
    const audioId = await baby.getByLabel('Baby camera preview').evaluate(
      (video: HTMLVideoElement) => (video.srcObject as MediaStream).getAudioTracks()[0].id,
    );
    await parent.waitForTimeout(6_500); // Beyond the frozen-picture threshold.
    await expect(parent.getByText('Video may be frozen.')).toHaveCount(0);
    await expect(parent.getByRole('button', { name: 'Picture in Picture', exact: true })).toHaveCount(0);
    await chooseMode(baby, 'video');
    await expect.poll(() => parent.getByLabel('Live baby video').evaluate(
      (video: HTMLVideoElement) => video.videoWidth,
    )).toBeGreaterThan(0);
    await soundIsLive(parent);
    expect(await baby.evaluate(() => (window as any).__peers.length)).toBe(1);
    expect(await baby.getByLabel('Baby camera preview').evaluate(
      (video: HTMLVideoElement) => (video.srcObject as MediaStream).getAudioTracks()[0].id,
    )).toBe(audioId);
  } finally { await context.close(); }
});

test('manual modes stop camera transmission, retain sound, and restore normal video', async ({ page: baby, browser }) => {
  await observe(baby);
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.goto(link);
    await soundIsLive(parent);
    const audioId = await baby.getByLabel('Baby camera preview').evaluate((video: HTMLVideoElement) => {
      const stream = video.srcObject as MediaStream;
      (window as any).__oldCamera = stream.getVideoTracks()[0];
      return stream.getAudioTracks()[0].id;
    });
    await chooseMode(baby, 'audio');
    await expect(parent.getByLabel('Live baby audio')).toBeAttached();
    expect(await baby.evaluate(() => ({
      camera: (window as any).__oldCamera.readyState,
      videoSender: (window as any).__peers[0].getSenders().some((s: RTCRtpSender) => s.track?.kind === 'video'),
    }))).toEqual({ camera: 'ended', videoSender: false });
    await soundIsLive(parent);
    // A permission failure must leave the existing microphone and connection usable.
    await baby.evaluate(() => {
      (window as any).__capture = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    });
    await chooseMode(baby, 'video');
    await expect(baby.getByRole('alert')).toContainText('Could not change monitoring mode');
    await expect(parent.getByLabel('Live baby audio')).toBeAttached();
    await soundIsLive(parent);
    await baby.evaluate(() => { navigator.mediaDevices.getUserMedia = (window as any).__capture; });
    await chooseMode(baby, 'reduced');
    await expect.poll(() => baby.getByLabel('Baby camera preview').evaluate((video: HTMLVideoElement) => {
      const settings = (video.srcObject as MediaStream).getVideoTracks()[0]?.getSettings();
      return !!settings && settings.width! <= 640 && settings.height! <= 360 && settings.frameRate! <= 10;
    })).toBe(true);
    await expect.poll(() => parent.getByLabel('Live baby video').evaluate(
      (video: HTMLVideoElement) => video.videoWidth,
    )).toBeGreaterThan(0);
    await chooseMode(baby, 'video');
    await expect.poll(() => baby.getByLabel('Baby camera preview').evaluate(
      (video: HTMLVideoElement) => (video.srcObject as MediaStream).getVideoTracks()[0]?.getSettings().width,
    )).toBe(1280);
    await soundIsLive(parent);
    expect(await baby.evaluate(() => (window as any).__peers.length)).toBe(1);
    expect(await baby.getByLabel('Baby camera preview').evaluate(
      (video: HTMLVideoElement) => (video.srcObject as MediaStream).getAudioTracks()[0].id,
    )).toBe(audioId);
    await baby.setViewportSize({ width: 390, height: 844 });
    await baby.getByRole('button', { name: 'Options', exact: true }).click();
    const sheet = baby.getByRole('dialog', { name: 'Options' });
    await expect.poll(async () => (await sheet.boundingBox())?.x).toBe(0);
    await baby.screenshot({ path: 'test-results/media-options-mobile.png' });
    expect(await baby.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
