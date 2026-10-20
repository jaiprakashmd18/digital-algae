import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const path of ['/', '/explore', '/discoveries', '/evolution', '/about', '/settings', '/profile', '/privacy', '/support']) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .exclude('.organism-stage')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  });
}

test('keyboard users can reach regions and the trace dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^The Core:/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.region-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Leave a trace here' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('falls back to the 2D organism when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/.test(type)) return null;
      return orig.call(this, type, ...rest);
    };
  });
  await page.goto('/');
  await expect(page.locator('.organism')).toHaveAttribute('data-renderer', '2d');
  await expect(page.getByText('2D view')).toBeVisible();
});

test('reduced motion preference is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings');
  await expect(page.getByRole('radio', { name: 'Follow system' })).toBeChecked();
  await page.getByRole('radio', { name: 'Reduced', exact: true }).check();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('io:prefs:v1')).motion);
  expect(stored).toBe('reduce');
});
