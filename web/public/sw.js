// Retirement endpoint for browsers still running an older bambicam worker.
// New app versions never register this script. Keep it at the old URL so even
// a cached old app can receive the cleanup through the browser's update check.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Replace the old fetch handler without navigating or interrupting media.
      await self.clients.claim();
      try {
        const prefix = `bambicam-shell:${new URL(self.registration.scope).pathname}:`;
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key.startsWith(prefix)).map((key) => caches.delete(key)),
        );
      } finally {
        await self.registration.unregister();
      }
    })(),
  );
});

// Deliberately no fetch handler, precache, or forced page reload.
