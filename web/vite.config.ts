import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const cert = process.env.HTTPS_CERT;
const key = process.env.HTTPS_KEY;
if (Boolean(cert) !== Boolean(key)) throw new Error('Set both HTTPS_CERT and HTTPS_KEY.');

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'development-style-policy',
      apply: 'serve',
      // Vite injects CSS for hot reload; production keeps the strict static policy.
      transformIndexHtml: (html) =>
        html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined,
    proxy: { '/relay': { target: 'ws://127.0.0.1:8787', ws: true } },
    headers: { 'Referrer-Policy': 'no-referrer' },
  },
  preview: { host: '0.0.0.0', proxy: { '/relay': { target: 'ws://127.0.0.1:8787', ws: true } } },
});
