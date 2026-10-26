import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startBaby } from './helpers';

async function observePeers(page: Page) {
  await page.addInitScript(() => {
    const peers: RTCPeerConnection[] = [];
    const NativePeer = RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(config?: RTCConfiguration) {
        super(config);
        peers.push(this);
      }
    };
    Object.assign(window, { __peers: peers });
  });
}

const video = (page: Page) => page.getByLabel('Live baby video');

test('a link cannot contact a different relay until its servers are approved', async ({ page: baby, browser }) => {
  const link = new URL(await startBaby(baby));
  const params = new URLSearchParams(link.hash.slice(1));
  params.set('r', 'wss://other.invalid/relay');
  params.set('s', 'stun:other.invalid:3478');
  link.hash = params.toString();
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    let contacted = 0;
    await parent.routeWebSocket('wss://other.invalid/relay', (socket) => {
      contacted++;
      socket.close();
    });
    await parent.goto(link.href);
    await expect(parent.getByRole('heading', { name: 'This code uses different servers.' })).toBeVisible();
    expect(new URL(parent.url()).hash).toBe('');
    expect(contacted).toBe(0);
    await expect(parent.getByText('Relay: wss://other.invalid/relay', { exact: true })).toBeVisible();
    await parent.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(contacted).toBe(0);
    // Pasted links and fragment-only navigation must enforce the same gate.
    await parent.getByRole('button', { name: /Parent unit/ }).click();
    await parent.getByText('Have a pairing link?', { exact: true }).click();
    await parent.getByLabel('Pairing link', { exact: true }).fill(link.href);
    await parent.getByRole('button', { name: 'Use pairing link', exact: true }).click();
    await expect(parent.getByRole('button', { name: 'Use these servers' })).toBeVisible();
    expect(contacted).toBe(0);
    await parent.getByRole('button', { name: 'Cancel', exact: true }).click();
    await parent.evaluate((hash) => { location.hash = hash; }, link.hash);
    await expect(parent.getByRole('button', { name: 'Use these servers' })).toBeVisible();
    expect(contacted).toBe(0);
    await parent.getByRole('button', { name: 'Use these servers' }).click();
    await expect.poll(() => contacted).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('a different STUN operator waits for approval before connecting to the ordinary relay', async ({ page: baby, browser }) => {
  const link = new URL(await startBaby(baby));
  const params = new URLSearchParams(link.hash.slice(1));
  params.set('s', 'stun:other.invalid:3478');
  link.hash = params.toString();
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    const sockets: string[] = [];
    parent.on('websocket', (socket) => { if (socket.url().includes('/relay')) sockets.push(socket.url()); });
    await parent.goto(link.href);
    await expect(parent.getByRole('button', { name: 'Use these servers' })).toBeVisible();
    expect(sockets).toEqual([]);
    await expect(baby.getByRole('status')).toHaveText('Waiting for the other device');
  } finally {
    await context.close();
  }
});

async function connect(baby: Page, parent: Page, link: string) {
  await parent.goto(link);
  await expect(parent.getByRole('status')).toHaveText('Connected', { timeout: 20_000 });
  await expect(baby.getByRole('status')).toHaveText('Connected');
  await expect
    .poll(() => video(parent).evaluate((element: HTMLVideoElement) => element.videoWidth))
    .toBeGreaterThan(0);
}

async function advancing(parent: Page) {
  const before = await video(parent).evaluate((element: HTMLVideoElement) => element.currentTime);
  await expect
    .poll(() => video(parent).evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(before);
}

test('advanced settings show the direct media path without cluttering the video', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await connect(baby, parent, link);
    for (const device of [parent, baby]) {
      await device.getByRole('button', { name: 'Options', exact: true }).click();
      await device.getByText('Advanced', { exact: true }).click();
    }
    // ICE can choose host or STUN candidates even for two local browser peers.
    for (const device of [parent, baby])
      await expect(device.locator('.path-note')).toHaveText(
        /^Direct (on your network|across networks, found with STUN)$/,
      );
    for (const device of [parent, baby])
      await device.getByRole('button', { name: 'Close options' }).click();
    await parent.getByRole('button', { name: 'Stop & go back' }).click();
    await expect(baby.getByRole('status')).toHaveText(/Waiting|Reconnecting/);
    await expect(baby.locator('.path-note')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a frozen picture is flagged while the connection still says live, and clears when frames return', async ({
  page: baby,
  browser,
}) => {
  await observePeers(baby);
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await connect(baby, parent, link);
    await advancing(parent);
    // Stop sending video frames without touching the connection or the camera.
    await baby.evaluate(async () => {
      const pc = (window as any).__peers.at(-1) as RTCPeerConnection;
      const sender = pc.getSenders().find((candidate) => candidate.track?.kind === 'video')!;
      (window as any).__videoTrack = sender.track;
      await sender.replaceTrack(null);
    });
    const badge = parent.locator('[data-stale]');
    await expect(badge).toContainText(/No new picture for \d+s/, { timeout: 15_000 });
    await expect(parent.getByRole('status')).toHaveText('Connected');
    await expect(parent.getByRole('alert')).toContainText('may be frozen');
    await baby.evaluate(async () => {
      const pc = (window as any).__peers.at(-1) as RTCPeerConnection;
      const sender = pc.getSenders().find((candidate) => candidate.track === null)!;
      await sender.replaceTrack((window as any).__videoTrack);
    });
    await expect(badge).toHaveCount(0, { timeout: 15_000 });
    await expect(parent.getByRole('alert')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a camera interruption is shown, and an ended camera is reacquired without a rescan', async ({
  page: baby,
  browser,
}) => {
  const errors: string[] = [];
  baby.on('pageerror', (error) => errors.push(error.message));
  const link = await startBaby(baby);
  const preview = baby.getByLabel('Baby camera preview');
  const tracks = await preview.evaluate((element: HTMLVideoElement) => {
    const captured = (element.srcObject as MediaStream).getTracks();
    (window as any).__captured = captured;
    return captured.map((track) => track.id);
  });
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await connect(baby, parent, link);
    // The system mutes capture during a phone call or while the app is in the background.
    await baby.evaluate(() => {
      const track = (window as any).__captured[0] as MediaStreamTrack;
      Object.defineProperty(track, 'muted', { configurable: true, value: true });
      track.dispatchEvent(new Event('mute'));
    });
    await expect(baby.locator('[data-capture="paused"]')).toContainText('paused by the system');
    await baby.evaluate(() => {
      const track = (window as any).__captured[0] as MediaStreamTrack;
      Object.defineProperty(track, 'muted', { configurable: true, value: false });
      track.dispatchEvent(new Event('unmute'));
    });
    await expect(baby.locator('[data-capture]')).toHaveCount(0);
    // A track that ends for good is reacquired from the same devices.
    await baby.evaluate(() =>
      ((window as any).__captured[0] as MediaStreamTrack).dispatchEvent(new Event('ended')),
    );
    await expect
      .poll(() =>
        preview.evaluate((element: HTMLVideoElement) =>
          (element.srcObject as MediaStream).getTracks().map((track) => track.id),
        ),
      )
      .not.toEqual(tracks);
    expect(
      await baby.evaluate(() =>
        (window as any).__captured.every((track: MediaStreamTrack) => track.readyState === 'ended'),
      ),
    ).toBe(true);
    await expect(baby.locator('[data-capture]')).toHaveCount(0);
    await expect(baby.getByRole('alert')).toHaveCount(0);
    await expect(baby.getByRole('status')).toHaveText('Connected');
    await expect(parent.getByRole('status')).toHaveText('Connected');
    await advancing(parent);
    await parent.waitForTimeout(6_000);
    await expect(parent.locator('[data-stale]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
