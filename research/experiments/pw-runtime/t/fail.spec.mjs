import { test, expect } from '@playwright/test';
test('assertion failure', async ({ page }) => {
  await page.setContent('<h1>Hello</h1><button>Go</button>');
  await expect(page.getByRole('heading')).toHaveText('Goodbye', { timeout: 1200 });
});
test('action timeout', async ({ page }) => {
  await page.setContent('<button disabled>Go</button>');
  await page.getByRole('button', { name: 'Go' }).click({ timeout: 1000 });
});
