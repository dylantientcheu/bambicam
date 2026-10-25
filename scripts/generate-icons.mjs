// Run once when the brand mark changes; PNGs are checked in, not generated at runtime.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const directory = new URL('../web/public/icons/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['maskable-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    const data = await page.evaluate((size) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.scale(size / 64, size / 64);
      context.fillStyle = '#6d5798';
      context.fillRect(0, 0, 64, 64);
      context.strokeStyle = '#fff';
      context.lineWidth = 4;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(16, 32);
      context.quadraticCurveTo(23, 41, 30, 32);
      context.moveTo(35, 32);
      context.quadraticCurveTo(42, 41, 49, 32);
      context.stroke();
      return canvas.toDataURL('image/png').split(',')[1];
    }, size);
    await writeFile(new URL(name, directory), Buffer.from(data, 'base64'));
  }
} finally {
  await browser.close();
}
