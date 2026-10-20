// Main visitor journey. By default runs against the local demo build (no
// credentials). With E2E_BASE_URL pointing at a deployment configured with
// Supabase, the same steps exercise the live backend.
import { expect, test } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function selectRegion(page, name) {
  // Use the accessible text alternative: it is stable while the organism rotates.
  await page.locator('.world-text summary').click();
  await page.locator('.world-text').getByRole('button', { name: `Select ${name}` }).click();
}

test('visitor journey: explore, select, leave a trace, discover, share, reload', async ({ page }) => {
  // 1. Open the website — the concept is explained without the animation.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One internet');
  await expect(page.locator('.organism')).toHaveAttribute('data-renderer', /webgl|2d/);

  // 2. Explore the organism (drag and zoom controls).
  const box = await page.locator('.organism-stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Zoom in' }).click();

  // 3. Select a region.
  await selectRegion(page, 'The Pulse');
  const panel = page.locator('.region-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'The Pulse' })).toBeVisible();
  await expect(page).toHaveURL(/region=the-pulse/);
  const tracesBefore = Number(await panel.locator('dt:text("Accepted traces") + dd').textContent());

  // 4. Submit a valid trace.
  await panel.getByRole('button', { name: 'Leave a trace here' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Leave your trace' })).toBeVisible();
  await dialog.getByRole('radio', { name: /Ripple/ }).check();
  await dialog.getByRole('button', { name: 'Leave your trace' }).click();

  // 5. The backend accepted it (only shown after a successful response).
  await expect(dialog.getByRole('heading', { name: 'Trace accepted' })).toBeVisible();
  await expect(dialog.getByText('Energy added')).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'My trace in Internet Organism' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to the organism' }).click();

  // 6. The world reflects the change.
  await expect(panel.locator('dt:text("Accepted traces") + dd')).toHaveText(String(tracesBefore + 1));
  await expect(page.locator('.ticker')).toContainText('ripple in The Pulse');

  // A second trace right away hits the server-side cooldown and says so.
  await page.getByRole('button', { name: 'Leave your trace' }).last().click();
  await dialog.getByRole('button', { name: 'Leave your trace' }).click();
  await expect(dialog.getByRole('heading', { name: 'Not recorded' })).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText(/still absorbing|limit/);
  await page.keyboard.press('Escape');

  // 7. Open a discovery.
  await page.goto('/discoveries');
  await expect(page.getByRole('heading', { name: 'Discoveries', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: /First trace in The Pulse|The first trace/ }).first().click();
  await expect(page).toHaveURL(/\/discovery\//);
  await expect(page.getByText('Triggered by a visitor').first()).toBeVisible();

  // 8. Share a public link.
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied.')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/discovery\/[a-z0-9-]+\?ref=copy$/);

  // 9. Reload and verify persistence.
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Discovery not found');
  await page.goto('/explore/the-pulse');
  await expect(page.locator('dt:text("All-time traces") + dd')).toHaveText(String(tracesBefore + 1));
});

test('deep links and unknown routes', async ({ page }) => {
  await page.goto('/explore/the-core');
  await expect(page.getByRole('heading', { name: 'The Core', level: 1 })).toBeVisible();
  await page.goto('/discovery/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Discovery not found' })).toBeVisible();
  await page.goto('/this/route/does/not/exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('corrupted local demo data recovers to the seeded world', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('io:demo:world:v1', '{"broken":');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One internet');
  await page.locator('.world-text summary').click();
  await expect(page.locator('.world-text li')).toHaveCount(6);
});
