// Layout checks across device sizes: no horizontal scrolling on any page,
// and the primary action is always fully visible on the home screen.
import { expect, test } from '@playwright/test';

const SIZES = [
  ['small phone', 320, 568], ['phone', 390, 844], ['large phone', 430, 932], ['phone landscape', 844, 390],
  ['tablet', 768, 1024], ['tablet landscape', 1024, 768], ['laptop', 1280, 800], ['desktop', 1920, 1080], ['wide', 2560, 1440],
];
const PAGES = ['/', '/explore', '/explore/the-pulse', '/discoveries', '/discovery/initial-structure', '/evolution', '/about', '/profile', '/settings', '/privacy'];

for (const [name, width, height] of SIZES) {
  test(`${name} (${width}×${height}) fits every page`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    }
    await page.goto('/');
    const cta = page.locator('.btn-trace');
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box.y + box.height, 'Leave your trace is cut off at the bottom').toBeLessThanOrEqual(height);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    // The trace dialog fits on screen.
    await cta.click();
    const dialog = await page.locator('dialog[open]').boundingBox();
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(height + 1);
  });
}
