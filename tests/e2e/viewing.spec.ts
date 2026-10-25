import { expect, test } from './fixtures';
import { startBaby } from './helpers';

test('parent can use native fullscreen and Picture in Picture with a live stream', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.goto(link);
    await expect(parent.getByRole('status')).toHaveText(/^(Live|Connected)$/);
    await expect
      .poll(() =>
        parent
          .getByLabel('Live baby video')
          .evaluate((element: HTMLVideoElement) => element.videoWidth),
      )
      .toBeGreaterThan(0);
    const fullscreen = parent.getByRole('button', { name: 'Full screen', exact: true });
    await fullscreen.click();
    await expect
      .poll(() => parent.evaluate(() => document.fullscreenElement?.getAttribute('aria-label')))
      .toBe('Parent video player');
    await expect(parent.getByRole('button', { name: 'Fill view' })).toHaveCount(0);
    expect(await videoFit(parent)).toBe('contain');
    await parent.screenshot({ path: 'test-results/parent-fullscreen.png' });
    await parent.getByRole('button', { name: 'Exit full view' }).click();
    await expect.poll(() => parent.evaluate(() => document.fullscreenElement)).toBe(null);
    await parent.getByRole('button', { name: 'Picture in Picture', exact: true }).click();
    await expect.poll(() => parent.evaluate(() => !!document.pictureInPictureElement)).toBe(true);
    await parent.getByRole('button', { name: 'Exit Picture in Picture', exact: true }).click();
    await expect.poll(() => parent.evaluate(() => document.pictureInPictureElement)).toBe(null);
    await parent.setViewportSize({ width: 390, height: 844 });
    await parent.screenshot({ path: 'test-results/parent-mobile.png', fullPage: true });
    expect(await parent.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await parent.getByRole('button', { name: 'Picture in Picture', exact: true }).click();
    await expect.poll(() => parent.evaluate(() => !!document.pictureInPictureElement)).toBe(true);
    await baby.getByRole('button', { name: /^Stop( & go back)?$/ }).click();
    await expect(parent.getByRole('status')).toHaveText('Reconnecting');
    await expect.poll(() => parent.evaluate(() => document.pictureInPictureElement)).toBe(null);
    expect(
      await parent
        .getByLabel('Live baby video')
        .evaluate((element: HTMLVideoElement) => element.srcObject),
    ).toBe(null);
  } finally {
    await context.close();
  }
});

test('Safari presentation methods are used and a negative per-video PiP probe overrides standard support', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext();
  try {
    const parent = await context.newPage();
    await parent.addInitScript(() => {
      const prototype = HTMLVideoElement.prototype as any;
      (window as any).__allowPip = true;
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
      Object.defineProperty(document, 'pictureInPictureEnabled', {
        configurable: true,
        value: true,
      });
      prototype.webkitSupportsPresentationMode = () => (window as any).__allowPip;
      prototype.webkitSetPresentationMode = function (mode: string) {
        this.webkitPresentationMode = mode;
        this.dispatchEvent(new Event('webkitpresentationmodechanged'));
      };
      prototype.webkitSupportsFullscreen = true;
      prototype.webkitEnterFullscreen = function () {
        this.webkitDisplayingFullscreen = true;
        this.dispatchEvent(new Event('webkitbeginfullscreen'));
      };
      prototype.webkitExitFullscreen = function () {
        this.webkitDisplayingFullscreen = false;
        this.dispatchEvent(new Event('webkitendfullscreen'));
      };
      prototype.requestPictureInPicture = () => {
        throw new Error('Standard PiP must not be used when Safari supports presentation mode.');
      };
    });
    await parent.goto(link);
    await expect(parent.getByRole('status')).toHaveText(/^(Live|Connected)$/);
    await parent.getByRole('button', { name: 'Picture in Picture', exact: true }).click();
    await expect(
      parent.getByRole('button', { name: 'Exit Picture in Picture', exact: true }),
    ).toBeVisible();
    await parent.getByRole('button', { name: 'Exit Picture in Picture', exact: true }).click();
    await parent.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect(parent.getByRole('button', { name: 'Exit full view' })).toBeVisible();
    await parent.getByRole('button', { name: 'Exit full view' }).click();
    await parent.getByLabel('Live baby video').evaluate((element) => {
      (window as any).__allowPip = false;
      element.dispatchEvent(new Event('resize'));
    });
    await expect(
      parent.getByRole('button', { name: 'Picture in Picture', exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('expanded fallback fills the viewport and exits with Escape', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext({ viewport: { width: 844, height: 390 } });
  try {
    const parent = await context.newPage();
    await parent.addInitScript(() => {
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
      Object.defineProperty(HTMLVideoElement.prototype, 'webkitSupportsFullscreen', {
        configurable: true,
        value: false,
      });
    });
    await parent.goto(link);
    await expect(parent.getByRole('status')).toHaveText(/^(Live|Connected)$/);
    await expect
      .poll(() =>
        parent
          .getByLabel('Live baby video')
          .evaluate((element: HTMLVideoElement) => element.videoWidth),
      )
      .toBeGreaterThan(0);
    await parent.getByRole('button', { name: 'Expand view', exact: true }).click();
    await expect(parent.getByRole('button', { name: 'Exit full view' })).toBeVisible();
    const size = await parent.getByLabel('Parent video player', { exact: true }).boundingBox();
    expect(size).toMatchObject({ x: 0, y: 0, width: 844, height: 390 });
    await parent.screenshot({ path: 'test-results/parent-landscape.png' });
    await parent.keyboard.press('Escape');
    await expect(parent.getByRole('button', { name: 'Expand view', exact: true })).toBeFocused();
  } finally {
    await context.close();
  }
});

test('screen wake lock is reacquired on return and released on stop', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__wakeRequests = 0;
    (window as any).__wakeReleases = 0;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          (window as any).__wakeRequests++;
          const lock = new EventTarget() as any;
          lock.released = false;
          lock.release = async () => {
            lock.released = true;
            (window as any).__wakeReleases++;
            lock.dispatchEvent(new Event('release'));
          };
          (window as any).__wakeLock = lock;
          return lock;
        },
      },
    });
  });
  await startBaby(page);
  await expect.poll(() => page.evaluate(() => (window as any).__wakeRequests)).toBe(1);
  await page.evaluate(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await (window as any).__wakeLock.release();
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => (window as any).__wakeRequests)).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__wakeRequests)).toBe(2);
  await page.getByRole('button', { name: /^Stop( & go back)?$/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__wakeReleases)).toBe(2);
});

async function videoFit(page: import('@playwright/test').Page) {
  return page
    .getByLabel('Live baby video')
    .evaluate((element) => getComputedStyle(element).objectFit);
}

// Exercise both iPhone API routes with real WebRTC. Native iOS PiP rendering
// itself still requires the physical-device acceptance check.
for (const [browserName, userAgent, standardFullscreen] of [
  [
    'Safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',
    false,
  ],
  [
    'Chrome',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/145.0.0.0 Mobile/15E148 Safari/604.1',
    true,
  ],
] as const) {
  test(`iPhone ${browserName} full view stays inline and PiP leaves the stream and controls usable`, async ({
    page: baby,
    browser,
  }) => {
    const link = await startBaby(baby);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent });
    try {
      const parent = await context.newPage();
      await parent.addInitScript((standard) => {
        const prototype = HTMLVideoElement.prototype as any;
        (window as any).__nativeFullscreenCalls = 0;
        Object.defineProperty(document, 'fullscreenEnabled', {
          configurable: true,
          value: standard,
        });
        const requestFullscreen = Element.prototype.requestFullscreen;
        Element.prototype.requestFullscreen = function (...args) {
          (window as any).__nativeFullscreenCalls++;
          return requestFullscreen.apply(this, args);
        };
        prototype.webkitSupportsFullscreen = true;
        prototype.webkitEnterFullscreen = function () {
          (window as any).__nativeFullscreenCalls++;
          this.webkitDisplayingFullscreen = true;
          this.dispatchEvent(new Event('webkitbeginfullscreen'));
        };
        prototype.webkitExitFullscreen = function () {
          this.webkitDisplayingFullscreen = false;
          this.dispatchEvent(new Event('webkitendfullscreen'));
        };
        prototype.webkitSupportsPresentationMode = () => true;
        prototype.webkitSetPresentationMode = function (mode: string) {
          this.webkitPresentationMode = mode;
          this.dispatchEvent(new Event('webkitpresentationmodechanged'));
        };
      }, standardFullscreen);
      await parent.goto(link);
      await expect(parent.getByRole('status')).toHaveText('Connected');
      const video = parent.getByLabel('Live baby video');
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
        .toBeGreaterThan(0);
      const streamId = await video.evaluate(
        (element: HTMLVideoElement) => (element.srcObject as MediaStream).id,
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        await parent.getByRole('button', { name: /^(Full screen|Expand view)$/ }).click();
        expect(await parent.evaluate(() => (window as any).__nativeFullscreenCalls)).toBe(0);
        const player = parent.getByLabel('Parent video player', { exact: true });
        expect(await player.boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
        if (attempt === 2)
          await parent.screenshot({
            path: `test-results/iphone-${browserName.toLowerCase()}-full-view.png`,
          });
        await parent.getByRole('button', { name: 'Exit full view' }).click();
        await parent.getByRole('button', { name: 'Picture in Picture', exact: true }).click();
        await expect(
          parent.getByText('Playing in Picture in Picture', { exact: true }),
        ).toBeVisible();
        await parent.getByRole('button', { name: 'Bring video back', exact: true }).click();
        await expect(
          parent.getByText('Playing in Picture in Picture', { exact: true }),
        ).toHaveCount(0);
        await parent.getByRole('button', { name: 'Options', exact: true }).click();
        await expect(parent.getByRole('dialog', { name: 'Options', exact: true })).toBeVisible();
        await parent.getByRole('button', { name: 'Close options', exact: true }).click();
        const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
        await expect
          .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
          .toBeGreaterThan(before);
        expect(
          await video.evaluate(
            (element: HTMLVideoElement) => (element.srcObject as MediaStream).id,
          ),
        ).toBe(streamId);
        await expect(parent.getByRole('status')).toHaveText('Connected');
      }
      // PiP can also be requested directly from the expanded player.
      await parent.getByRole('button', { name: 'Expand view', exact: true }).click();
      await parent.getByRole('button', { name: 'Picture in Picture', exact: true }).click();
      await expect(parent.getByRole('button', { name: 'Exit full view' })).toHaveCount(0);
      expect(await parent.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
      await parent.getByRole('button', { name: 'Bring video back', exact: true }).click();
      await parent.getByRole('button', { name: 'Stop & go back', exact: true }).click();
      await expect(parent.getByRole('button', { name: /Baby unit/ })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
