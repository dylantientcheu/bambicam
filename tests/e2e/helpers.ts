import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export async function startBaby(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Baby unit/ }).click();
  await page.getByRole('button', { name: 'Start camera & microphone' }).click();
  await expect(page.getByRole('img', { name: /Scan this pairing code/ })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    /^(Waiting for parent|Waiting for the other device)$/,
  );
  await page.getByRole('button', { name: /^Copy (pairing )?link$/ }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}
