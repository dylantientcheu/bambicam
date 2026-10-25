/** Remove the old offline shell without touching pairings or other apps on this origin. */
export async function retireOfflineCache() {
  const scope = new URL('./', document.baseURI);
  const script = new URL('sw.js', scope).href;
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => {
            const worker = registration.active ?? registration.waiting ?? registration.installing;
            return registration.scope === scope.href && worker?.scriptURL === script;
          })
          .map((registration) => registration.unregister()),
      );
    } catch {
      // Storage restrictions must not prevent live monitoring.
    }
  }
  if ('caches' in window) {
    try {
      const prefix = `bambicam-shell:${scope.pathname}:`;
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(prefix)).map((key) => caches.delete(key)),
      );
    } catch {
      // A browser that denies Cache Storage can still run the app online.
    }
  }
}
