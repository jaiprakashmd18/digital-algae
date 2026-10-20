import { expect, test } from '@playwright/test';

test('mobile: menu, primary action and touch-sized controls', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Open menu' });
  await expect(toggle).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore' })).toBeHidden();
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Regions of the organism');

  await page.goto('/');
  const cta = page.locator('.btn-trace');
  await expect(cta).toBeInViewport();
  const size = await cta.boundingBox();
  expect(size.height).toBeGreaterThanOrEqual(44);
  await cta.tap();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Leave your trace' })).toBeVisible();

  // No horizontal scrolling on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
