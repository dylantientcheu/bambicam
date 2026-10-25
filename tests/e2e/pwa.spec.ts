import { expect, test } from './fixtures';
import { startBaby } from './helpers';

test('iPhone installation explains Share and Home Screen limitations', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Add to Home Screen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    page.getByLabel('Installation instructions').getByText('Add to Home Screen', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Picture in Picture may work', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/install-iphone.png' });
  await dialog.getByRole('button', { name: 'Close options' }).click();
  await expect(dialog).not.toBeVisible();
});

test('install prompt is used when available and disappears after app installation', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    (window as any).__prompts = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true }) as any;
    event.prompt = async () => {
      (window as any).__prompts++;
      return { outcome: 'accepted' };
    };
    window.dispatchEvent(event);
  });
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Add to Home Screen', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__prompts)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(
    page.getByRole('button', { name: 'Add to Home Screen', exact: true }),
  ).not.toBeVisible();
});

// Reproduce the previous worker's cached navigation, including its refresh escape.
const legacyWorker = `
  const CACHE = 'bambicam-shell:/:legacy-test';
  const INDEX = new URL('index.html', self.registration.scope).href;
  self.addEventListener('install', event => event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.put(INDEX, new Response('<title>Old cached bambicam</title>', {
      headers: {'Content-Type': 'text/html'}
    }));
    await self.skipWaiting();
  })()));
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', event => {
    if (event.request.mode === 'navigate' && !new URL(event.request.url).search) {
      event.respondWith(caches.match(INDEX).then(cached => cached || fetch(event.request)));
    }
  });
`;

test('installation metadata stays available without registering a worker or caching the app', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__workerRegistrations = 0;
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (...args) => {
      (window as any).__workerRegistrations++;
      return register(...args);
    };
  });
  await startBaby(page);
  const manifest = await page.evaluate(() =>
    fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href).then((response) =>
      response.json(),
    ),
  );
  expect(manifest).toMatchObject({ id: './', start_url: './', display: 'standalone' });
  expect(manifest.icons.map((icon: any) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
  expect(await page.evaluate(() => (window as any).__workerRegistrations)).toBe(0);
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(0);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('opening the current app retires its old cache while preserving pairings and other apps', async ({
  page,
  context,
}) => {
  await context.route('**/migration-setup.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Migration setup</title>' }),
  );
  await context.route('**/sw.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: new URL(route.request().url()).pathname === '/sw.js' ? legacyWorker : '// Other app',
    }),
  );
  await page.goto('/migration-setup.html');
  const remembered = await page.evaluate(async () => {
    const pairing = JSON.stringify({
      version: 1,
      secret: 'A'.repeat(43),
      relay: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/relay`,
      stun: '',
    });
    localStorage.setItem('bambicam.remembered.v1', pairing);
    localStorage.setItem('other-app', 'keep');
    for (const name of ['bambicam-shell:/other/:keep', 'other-app-cache']) {
      const cache = await caches.open(name);
      await cache.put('/keep', new Response('keep'));
    }
    await navigator.serviceWorker.register('/other/sw.js', { scope: '/other/' });
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return pairing;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.goto('/');
  await expect(page).toHaveTitle('Old cached bambicam');
  await page.goto('/?refresh=1');
  await expect(page.getByRole('button', { name: 'Connect to baby', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
      ),
    )
    .toEqual(['/other/']);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).sort()))
    .toEqual(['bambicam-shell:/other/:keep', 'other-app-cache']);
  expect(await page.evaluate(() => localStorage.getItem('bambicam.remembered.v1'))).toBe(
    remembered,
  );
  expect(await page.evaluate(() => localStorage.getItem('other-app'))).toBe('keep');
  await page.goto('/');
  await expect(page).toHaveTitle('bambicam — a little closer');
  await expect(page.getByRole('button', { name: 'Connect to baby', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});

test('an old worker updates to the retirement script without reloading or interrupting live video', async ({
  page,
  context,
}) => {
  let retire = false;
  await context.route('**/sw.js', (route) =>
    retire
      ? route.continue()
      : route.fulfill({ contentType: 'application/javascript', body: legacyWorker }),
  );
  const link = await startBaby(page);
  const parent = await context.newPage();
  await parent.goto(link);
  await expect(parent.getByRole('status')).toHaveText(/^(Live|Connected)$/);
  const video = parent.getByLabel('Live baby video');
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  const before = await video.evaluate((element: HTMLVideoElement) => ({
    document: performance.timeOrigin,
    stream: (element.srcObject as MediaStream).id,
    tracks: (element.srcObject as MediaStream).getTracks().map((track) => track.id),
    time: element.currentTime,
  }));
  // Install after app startup to exercise the worker-only migration path used by
  // an already-open old build, independent of the new app's startup cleanup.
  await page.evaluate(async () => {
    const cache = await caches.open('other-app-cache');
    await cache.put('/keep', new Response('keep'));
    localStorage.setItem('bambicam.remembered.v1', 'preserve-me');
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(() => caches.keys())).toContain('bambicam-shell:/:legacy-test');
  retire = true;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
  });
  await expect
    .poll(() =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    )
    .toBe(0);
  expect(await page.evaluate(() => caches.keys())).toEqual(['other-app-cache']);
  expect(await page.evaluate(() => localStorage.getItem('bambicam.remembered.v1'))).toBe(
    'preserve-me',
  );
  expect(
    await video.evaluate((element: HTMLVideoElement) => ({
      document: performance.timeOrigin,
      stream: (element.srcObject as MediaStream).id,
      tracks: (element.srcObject as MediaStream).getTracks().map((track) => track.id),
      live: (element.srcObject as MediaStream)
        .getTracks()
        .every((track) => track.readyState === 'live'),
    })),
  ).toEqual({
    document: before.document,
    stream: before.stream,
    tracks: before.tracks,
    live: true,
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(before.time);
  await expect(parent.getByRole('status')).toHaveText(/^(Live|Connected)$/);
  await page.reload();
  await expect(page.getByRole('button', { name: /Baby unit/ })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
});
