import { expect, test } from './fixtures';
import { startBaby } from './helpers';

test('setup and maintenance live in a keyboard-accessible sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add to Home Screen' })).not.toBeVisible();
  await expect(page.getByLabel('Relay address')).not.toBeVisible();
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Options' });
  await expect(sheet).toBeVisible();
  const bounds = await sheet.boundingBox();
  expect(bounds!.x).toBe(0);
  expect(bounds!.width).toBe(390);
  expect(bounds!.y + bounds!.height).toBeCloseTo(844, 0);
  await expect(sheet.getByRole('button', { name: 'Add to Home Screen' })).toBeVisible();
  await sheet.getByText('Advanced', { exact: true }).click();
  await expect(page.getByLabel('Relay address')).toBeEditable();
  await page.screenshot({ path: 'test-results/options-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeFocused();
});

test('live controls fade, return on interaction, and adapt to phone orientation without reconnecting', async ({
  page: baby,
  browser,
}) => {
  const link = await startBaby(baby);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
    await expect(parent.getByRole('status')).toHaveText('Connected');
    const video = parent.getByLabel('Live baby video');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBeGreaterThan(0);
    const id = await video.evaluate(
      (element: HTMLVideoElement) => (element.srcObject as MediaStream).id,
    );
    await expect(parent.getByRole('heading')).toHaveCount(0);
    await expect(parent.getByRole('button', { name: 'Fill view' })).toHaveCount(0);
    await expect(parent.getByRole('button', { name: 'Remember this baby unit' })).not.toBeVisible();
    await expect(parent.getByRole('button', { name: 'Add to Home Screen' })).not.toBeVisible();
    const toolbar = parent.getByLabel('Viewing controls');
    await expect
      .poll(() => toolbar.evaluate((element) => getComputedStyle(element).opacity), {
        timeout: 7_000,
      })
      .toBe('0');
    await video.click();
    await expect
      .poll(() => toolbar.evaluate((element) => getComputedStyle(element).opacity))
      .toBe('1');
    const expand = parent.getByRole('button', { name: 'Expand view', exact: true });
    expect(await expand.innerText()).toBe(''); // Custom icon, with an accessible name.
    await expand.click();
    const player = parent.getByLabel('Parent video player', { exact: true });
    expect(await player.boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
    await parent.setViewportSize({ width: 844, height: 390 });
    expect(await player.boundingBox()).toMatchObject({ x: 0, y: 0, width: 844, height: 390 });
    expect(await video.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain');
    expect(
      await video.evaluate((element: HTMLVideoElement) => (element.srcObject as MediaStream).id),
    ).toBe(id);
    await expect(parent.getByRole('status')).toHaveText('Connected');
    await parent.screenshot({ path: 'test-results/minimal-landscape.png' });
    await parent.keyboard.press('Escape');
    await expect(expand).toBeFocused();
    await parent.setViewportSize({ width: 390, height: 844 });
    expect(
      await parent.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
    ).toBe(true);
    await video.click();
    await parent.mouse.move(0, 0);
    await parent.screenshot({ path: 'test-results/minimal-parent.png' });
  } finally {
    await context.close();
  }
});
