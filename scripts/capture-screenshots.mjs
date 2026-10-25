import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:8080';
await mkdir('docs/images', { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      let tick = 0;
      const draw = () => {
        ctx.fillStyle = '#e4ddd3';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#b9aa9b';
        ctx.fillRect(70, 130, 500, 240);
        ctx.fillStyle = '#f7f3ed';
        ctx.fillRect(90, 150, 460, 200);
        ctx.fillStyle = '#d2bebc';
        ctx.beginPath();
        ctx.ellipse(320 + Math.sin(tick++ / 30) * 4, 250, 75, 50, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#655a56';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Synthetic preview — no camera footage', 320, 420);
        requestAnimationFrame(draw);
      };
      draw();
      const stream = canvas.captureStream(15);
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const destination = audio.createMediaStreamDestination();
      gain.gain.value = 0.02;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      await audio.resume();
      stream.addTrack(destination.stream.getAudioTracks()[0]);
      return stream;
    };
  });
  const baby = await context.newPage();
  const parent = await context.newPage();
  await baby.goto(base);
  await expect(baby.getByRole('button', { name: /Baby unit/ })).toBeVisible();
  await baby.screenshot({ path: 'docs/images/home.png' });
  await baby.getByRole('button', { name: /Baby unit/ }).click();
  await baby.getByRole('button', { name: 'Start camera & microphone' }).click();
  await expect(baby.getByRole('img', { name: /Scan this pairing code/ })).toBeVisible();
  await baby.getByRole('button', { name: /^Copy (pairing )?link$/ }).click();
  const link = await baby.evaluate(() => navigator.clipboard.readText());
  await parent.goto(link);
  await expect(parent.getByRole('status')).toHaveText('Connected', { timeout: 30_000 });
  await parent.waitForFunction(() => {
    const video = document.querySelector('video');
    return video?.videoWidth > 0 && video.currentTime > 2;
  });
  await parent.screenshot({ path: 'docs/images/parent.png' });
  console.log('Hosted pairing and live synthetic WebRTC passed; screenshots saved without a pairing QR.');
} finally {
  await browser.close();
}
