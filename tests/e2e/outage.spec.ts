import type { Page } from '@playwright/test';
import { createRelay } from '../../relay/server.mjs';
import { expect, test } from './fixtures';

async function observe(page: Page) {
  await page.addInitScript(() => {
    const peers: RTCPeerConnection[] = [];
    const Native = RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        super(config);
        peers.push(this);
      }
    };
    (window as any).__peers = peers;
  });
}

test('local media and mode changes survive a real relay shutdown; rotation still revokes the peer', async ({ page: baby, browser }) => {
  await observe(baby);
  await baby.goto('/');
  const origin = new URL(baby.url()).origin;
  let relay = createRelay({ allowedOrigins: [origin] });
  const listen = (port: number) => new Promise<void>((resolve, reject) => {
    relay.server.once('error', reject);
    relay.server.listen(port, '127.0.0.1', () => {
      relay.server.off('error', reject);
      resolve();
    });
  });
  await listen(0);
  const port = (relay.server.address() as { port: number }).port;
  const context = await browser.newContext();
  try {
    await baby.getByRole('button', { name: /Baby unit/ }).click();
    await baby.getByRole('button', { name: 'Options', exact: true }).click();
    await baby.getByText('Advanced', { exact: true }).click();
    await baby.getByLabel('Relay address').fill(`ws://127.0.0.1:${port}/relay`);
    await baby.getByLabel('Connection preference').selectOption('local');
    await expect(baby.getByLabel('STUN server (optional)')).toHaveValue('');
    await expect(baby.getByText('Local media does not mean the app and connection service are hosted locally.')).toBeVisible();
    await baby.getByRole('button', { name: 'Close options' }).click();
    await baby.getByRole('button', { name: 'Start camera & microphone' }).click();
    await baby.getByRole('button', { name: 'Copy pairing link', exact: true }).click();
    const link = await baby.evaluate(() => navigator.clipboard.readText());
    const parent = await context.newPage();
    await observe(parent);
    await parent.goto(link);
    await parent.getByRole('button', { name: 'Use these servers' }).click();
    await expect(parent.getByRole('status')).toHaveText('Connected');
    await expect(baby.getByRole('status')).toHaveText('Connected');
    const video = parent.getByLabel('Live baby video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
    const id = await video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).id);
    for (const page of [baby, parent])
      expect(await page.evaluate(() => (window as any).__peers[0].getConfiguration().iceServers)).toEqual([]);

    // Relay controls and packets cannot replace the authenticated live peer.
    for (const room of relay.rooms.values()) for (const socket of room) {
      socket.send(JSON.stringify({ type: 'peer-left' }));
      socket.send(JSON.stringify({ type: 'peer-joined' }));
      socket.send(Buffer.alloc(50), { binary: true });
    }
    await relay.close();
    for (const page of [baby, parent]) {
      await expect(page.getByText(/Monitoring continues/)).toBeVisible();
      await expect(page.getByRole('status')).toHaveText('Connected');
    }
    await parent.waitForTimeout(2_500); // At least one failed signaling retry.
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(before);
    expect(await video.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).id)).toBe(id);

    await baby.getByRole('button', { name: 'Options', exact: true }).click();
    await baby.getByLabel('Monitoring mode').selectOption('audio');
    await expect(baby.getByLabel('Monitoring mode')).toBeEnabled();
    await baby.getByRole('button', { name: 'Close options' }).click();
    await expect(parent.getByText('Audio only · camera is off', { exact: true })).toBeVisible();
    await expect.poll(async () => Number(await parent.getByRole('meter', {
      name: 'Live sound level',
    }).getAttribute('aria-valuenow'))).toBeGreaterThan(10);

    relay = createRelay({ allowedOrigins: [origin] });
    await listen(port);
    for (const page of [baby, parent]) {
      await expect(page.getByText(/Monitoring continues/)).toHaveCount(0, { timeout: 20_000 });
      expect(await page.evaluate(() => (window as any).__peers.length)).toBe(1);
    }
    await relay.close();
    await expect(baby.getByText(/Monitoring continues/)).toBeVisible();
    await baby.getByRole('button', { name: 'Options', exact: true }).click();
    await baby.getByRole('button', { name: 'New pairing code', exact: true }).click();
    await expect(parent.getByRole('status')).toHaveText('Reconnecting');
    await expect.poll(() => parent.getByLabel('Live baby audio').evaluate(
      (v: HTMLVideoElement) => v.srcObject,
    )).toBe(null);
    expect(await parent.evaluate(() => (window as any).__peers[0].connectionState)).toBe('closed');
  } finally {
    await context.close();
    await relay.close();
  }
});
