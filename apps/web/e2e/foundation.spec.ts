import { test, expect } from '@playwright/test';
for (const width of [320, 375, 430, 768, 1024, 1366, 1920]) {
  test(`workspace navigation and language at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Grounded in precision.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('Display language').selectOption('bn');
    await expect(page.getByRole('heading', { name: 'সেটিংস' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'সেটিংস' })).toBeVisible();
    await page.getByRole('link', { name: 'হোম', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'নির্ভুলতায় দৃঢ় ভিত্তি।' })).toBeVisible();
  });
}
test('desktop navigation can be collapsed and expanded', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true');
});
