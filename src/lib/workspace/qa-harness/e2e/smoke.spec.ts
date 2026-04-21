import { expect, test } from '@playwright/test';

test('workspace app serves a document with a visible body', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response?.ok() ?? false).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
});
