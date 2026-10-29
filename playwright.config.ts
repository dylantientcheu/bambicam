import { defineConfig } from '@playwright/test';

const baseURL = process.env.BAMBICAM_TEST_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL,
    browserName: 'chromium',
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        // Optional same-machine transport for hosts with unreliable LAN/mDNS
        // routing between isolated contexts. Physical LAN acceptance is separate.
        ...(process.env.BAMBICAM_TEST_LOOPBACK === '1'
          ? ['--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] : []),
      ],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
