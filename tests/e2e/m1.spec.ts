import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startBaby } from './helpers';

async function observeConnections(page: Page) {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    const peers: RTCPeerConnection[] = [];
    const sessions: string[] = [];
    const NativeSocket = WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(data);
          if (new DataView(data).getUint32(18) === 1)
            sessions.push(Array.from(bytes.slice(2, 18)).join(','));
        }
        super.send(data);
      }
    };
    const NativePeer = RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(config?: RTCConfiguration) {
        super(config);
        peers.push(this);
      }
    };
    Object.assign(window, {
      __sockets: sockets,
      __peers: peers,
      __sessions: sessions,
    });
  });
}

async function connected(parent: Page) {
  await expect(parent.getByRole('status')).toHaveText('Connected', {
    timeout: 20_000,
  });
  await expect
    .poll(() =>
      parent
        .getByLabel('Live baby video')
        .evaluate(
          (video: HTMLVideoElement) =>
            video.videoWidth > 0 &&
            !video.paused &&
            (video.srcObject as MediaStream)
              ?.getAudioTracks()
              .some((track) => track.readyState === 'live'),
        ),
    )
    .toBe(true);
}

async function closeSocket(page: Page) {
  await page.evaluate(() => (window as any).__sockets.at(-1).close());
}

test('either side reconnects repeatedly with fresh handshakes and the original camera', async ({
  page: baby,
  browser,
}) => {
  await observeConnections(baby);
  const link = await startBaby(baby);
  const tracks = await baby
    .getByLabel('Baby camera preview')
    .evaluate((video: HTMLVideoElement) =>
      (video.srcObject as MediaStream).getTracks().map((track) => track.id),
    );
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await observeConnections(parent);
    await parent.goto(link);
    await connected(parent);
    for (const device of [parent, baby, parent, baby]) {
      const before = await device.evaluate(() => (window as any).__sessions.length);
      await closeSocket(device);
      await expect(device.getByRole('status')).toHaveText('Reconnecting');
      await expect
        .poll(() => device.evaluate(() => (window as any).__sessions.length))
        .toBeGreaterThan(before);
      await connected(parent);
      await expect(baby.getByRole('status')).toHaveText('Connected');
    }
    for (const device of [parent, baby]) {
      const sessions = await device.evaluate(() => (window as any).__sessions as string[]);
      expect(new Set(sessions).size).toBe(sessions.length);
      expect(sessions.length).toBeGreaterThanOrEqual(5);
    }
    expect(
      await baby
        .getByLabel('Baby camera preview')
        .evaluate((video: HTMLVideoElement) =>
          (video.srcObject as MediaStream).getTracks().map((track) => track.id),
        ),
    ).toEqual(tracks);
    const after = await parent
      .getByLabel('Live baby video')
      .evaluate((video: HTMLVideoElement) => video.currentTime);
    await expect
      .poll(() =>
        parent
          .getByLabel('Live baby video')
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(after);
    await parent.getByRole('button', { name: 'Stop & go back' }).click();
    await expect
      .poll(() =>
        parent.evaluate(() =>
          (window as any).__peers.every((pc: RTCPeerConnection) => pc.connectionState === 'closed'),
        ),
      )
      .toBe(true);
    await parent.clock.install();
    const socketCount = await parent.evaluate(() => (window as any).__sockets.length);
    await parent.clock.fastForward(60_000);
    expect(await parent.evaluate(() => (window as any).__sockets.length)).toBe(socketCount);
    expect(
      await parent.evaluate(() =>
        (window as any).__peers.every((pc: RTCPeerConnection) => pc.connectionState === 'closed'),
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test('a failed media connection is rebuilt automatically without rescanning', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await observeConnections(parent);
    await parent.goto(link);
    await connected(parent);
    await parent.evaluate(() => {
      const pc = (window as any).__peers.at(-1) as RTCPeerConnection;
      Object.defineProperty(pc, 'connectionState', {
        configurable: true,
        value: 'failed',
      });
      pc.dispatchEvent(new Event('connectionstatechange'));
    });
    await expect(parent.getByRole('status')).toHaveText('Reconnecting');
    await expect(parent.getByRole('alert')).toContainText(
      'Some mobile, guest, or restricted networks',
    );
    await connected(parent);
    expect(await parent.evaluate(() => (window as any).__peers.length)).toBe(2);
  } finally {
    await context.close();
  }
});

test('remember is opt-in, reload reconnects without a scan, and forget removes only the pairing', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.goto(link);
    await connected(parent);
    expect(await parent.evaluate(() => localStorage.length)).toBe(0);
    await parent.getByRole('button', { name: 'Options', exact: true }).click();
    await parent.getByRole('button', { name: 'Remember this baby unit', exact: true }).click();
    expect(await baby.evaluate(() => localStorage.length)).toBe(0);
    await parent.reload();
    await expect(parent.getByRole('heading', { name: 'Baby camera' })).toBeVisible();
    expect(new URL(parent.url()).hash).toBe('');
    await parent.getByRole('button', { name: 'Connect to baby', exact: true }).click();
    await connected(parent);
    await parent.evaluate(() => localStorage.setItem('unrelated', 'keep'));
    await parent.getByRole('button', { name: 'Options', exact: true }).click();
    await parent.getByRole('button', { name: 'Forget baby unit' }).click();
    await expect(
      parent.getByRole('button', { name: /Baby unit/, exact: false }).first(),
    ).toBeVisible();
    expect(await parent.evaluate(() => Object.keys(localStorage))).toEqual(['unrelated']);
    await parent.reload();
    await expect(parent.getByRole('button', { name: /Parent unit/ })).toBeVisible();
    await expect(parent.getByRole('button', { name: 'Use remembered baby unit' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('blocked pairing storage leaves live monitoring usable', async ({ page: baby, browser }) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Blocked', 'SecurityError');
      };
    });
    await parent.goto(link);
    await connected(parent);
    await parent.getByRole('button', { name: 'Options', exact: true }).click();
    await parent.getByRole('button', { name: 'Remember this baby unit', exact: true }).click();
    await expect(parent.getByRole('alert')).toContainText('could not save the pairing');
    expect(await parent.evaluate(() => localStorage.length)).toBe(0);
  } finally {
    await context.close();
  }
});

test('night mode keeps capture live and the meter follows sound and silence', async ({
  page: baby,
  browser,
}) => {
  await baby.setViewportSize({ width: 390, height: 844 });
  const link = await startBaby(baby);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const parent = await context.newPage();
    await parent.goto(link);
    await connected(parent);
    const meter = parent.getByRole('meter', { name: 'Live sound level' });
    await expect
      .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
      .toBeGreaterThan(10);
    await baby.getByRole('button', { name: 'Dim screen' }).click();
    await expect(baby.getByRole('dialog', { name: 'Night mode' })).toBeVisible();
    await baby.screenshot({ path: 'test-results/baby-night-mode.png' });
    expect(
      await baby
        .getByLabel('Baby camera preview')
        .evaluate((video: HTMLVideoElement) =>
          (video.srcObject as MediaStream)
            .getTracks()
            .every((track) => track.readyState === 'live'),
        ),
    ).toBe(true);
    await expect
      .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
      .toBeGreaterThan(10);
    await baby.getByRole('button', { name: 'Show controls' }).click();
    await expect(baby.getByRole('dialog', { name: 'Night mode' })).not.toBeVisible();
    await expect(baby.getByRole('button', { name: 'Dim screen' })).toBeFocused();
    await baby.getByLabel('Baby camera preview').evaluate((video: HTMLVideoElement) => {
      (video.srcObject as MediaStream).getAudioTracks()[0].enabled = false;
    });
    await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBe(0);
    await baby.getByRole('button', { name: 'Dim screen' }).click();
    await parent.getByRole('button', { name: 'Stop & go back' }).click();
    await expect(baby.getByRole('dialog', { name: 'Night mode' })).not.toBeVisible();
    await expect(baby.getByRole('status')).toHaveText('Reconnecting');
  } finally {
    await context.close();
  }
});

test('an already paired code survives the unused-code timer during a disconnect', async ({
  page: baby,
  browser,
}) => {
  await baby.clock.install();
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.goto(link);
    await connected(parent);
    await expect(baby.getByRole('status')).toHaveText('Connected');
    await baby.clock.fastForward(15_001);
    await expect(baby.getByRole('dialog', { name: 'Night mode' })).toBeVisible();
    await parent.getByRole('button', { name: 'Stop & go back' }).click();
    await expect(baby.getByRole('status')).toHaveText('Reconnecting');
    await baby.clock.fastForward(10 * 60 * 1000);
    await baby.getByRole('button', { name: 'Copy pairing link', exact: true }).click();
    expect(await baby.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await parent.goto(link);
    await connected(parent);
  } finally {
    await context.close();
  }
});

test('LAN-only configuration is carried to the parent without STUN traffic', async ({
  page: baby,
  browser,
}) => {
  await observeConnections(baby);
  await baby.goto('/');
  await baby.getByRole('button', { name: /Baby unit/ }).click();
  await baby.getByRole('button', { name: 'Options', exact: true }).click();
  await baby.getByText('Advanced', { exact: true }).click();
  await baby.getByLabel('STUN server (optional)').fill('');
  await baby.getByRole('button', { name: 'Close options' }).click();
  await baby.getByRole('button', { name: 'Start camera & microphone' }).click();
  await expect(baby.getByRole('status')).toHaveText('Waiting for the other device');
  await baby.getByRole('button', { name: 'Copy pairing link', exact: true }).click();
  const link = await baby.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await observeConnections(parent);
    await parent.goto(link);
    await parent.getByRole('button', { name: 'Options', exact: true }).click();
    await parent.getByText('Advanced', { exact: true }).click();
    await expect(parent.getByLabel('STUN server (optional)')).toHaveValue('');
    await parent.getByRole('button', { name: 'Close options' }).click();
    await connected(parent);
    for (const device of [parent, baby])
      expect(
        await device.evaluate(() => (window as any).__peers.at(-1).getConfiguration().iceServers),
      ).toEqual([]);
  } finally {
    await context.close();
  }
});

test('a parent retries through an offline period and resumes when the network returns', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await observeConnections(parent);
    await parent.goto(link);
    await connected(parent);
    await context.setOffline(true);
    await closeSocket(parent);
    await expect(parent.getByRole('status')).toHaveText('Reconnecting');
    await expect
      .poll(() => parent.evaluate(() => (window as any).__sockets.length))
      .toBeGreaterThan(1);
    // Stale media is cleared from a render effect, so allow it a moment.
    await expect
      .poll(() =>
        parent.getByLabel('Live baby video').evaluate((video: HTMLVideoElement) => video.srcObject),
      )
      .toBe(null);
    await expect(parent.getByRole('status')).toHaveText('Reconnecting');
    await context.setOffline(false);
    await connected(parent);
    await expect(parent.getByRole('alert')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a full room recovers when the old parent leaves without replacing its camera', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    await first.goto(link);
    await connected(first);
    const next = await context.newPage();
    await next.goto(link);
    await expect(next.getByRole('alert')).toContainText('baby unit is busy');
    await connected(first);
    await first.getByRole('button', { name: 'Stop & go back' }).click();
    await connected(next);
    await expect(baby.getByRole('status')).toHaveText('Connected');
  } finally {
    await context.close();
  }
});
