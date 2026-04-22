# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> workspace app serves a document with a visible body
- Location: e2e/smoke.spec.ts:3:5

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3000/
Call log:
  - navigating to "http://127.0.0.1:3000/", waiting until "domcontentloaded"

```

# Test source

```ts
  1 | import { expect, test } from '@playwright/test';
  2 | 
  3 | test('workspace app serves a document with a visible body', async ({ page }) => {
> 4 |   const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    |                               ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3000/
  5 |   expect(response?.ok() ?? false).toBeTruthy();
  6 |   await expect(page.locator('body')).toBeVisible();
  7 | });
  8 | 
```