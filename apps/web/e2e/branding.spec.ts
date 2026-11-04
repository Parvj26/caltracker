import { expect, test } from '@playwright/test';

test('sign-in page is branded', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByLabel('CalTracker')).toBeVisible();
  await expect(page.getByText('Welcome back, coach!')).toBeVisible();

  const lime = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ct-lime').trim(),
  );
  expect(lime).toBe('#C8F169');

  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(bodyFont).toContain('Bricolage');

  const button = page.getByRole('button', { name: 'Sign in' });
  await expect(button).toHaveCSS('background-color', 'rgb(18, 18, 18)');
  const boxShadow = await button.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(boxShadow).toContain('rgb(200, 241, 105)');
});

test('"Forgot password?" on sign-in is a 44 px tap target', async ({ page }) => {
  await page.goto('/sign-in');
  const box = await page.getByRole('link', { name: 'Forgot password?' }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

for (const [width, height] of [[1024, 768], [1180, 820], [1280, 800]] as const) {
  test(`brand panel preview tiles fit inside the panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/sign-in');
    const panel = await page.locator('[data-auth-panel]').boundingBox();
    expect(panel).not.toBeNull();
    const tiles = page.locator('[data-preview-tile]');
    await expect(tiles).toHaveCount(3);
    for (const tile of await tiles.all()) {
      const box = await tile.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(panel!.x);
      expect(box!.y).toBeGreaterThanOrEqual(panel!.y);
      expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(panel!.y + panel!.height);
    }
  });
}

const OLD_ERROR_RED = 'rgb(176, 0, 32)';
const PAGES = [
  { name: 'forgot-password', path: '/forgot-password', signInAs: null },
  { name: 'set-password', path: '/set-password', signInAs: 'coach@demo.local', heading: 'Set your password' },
  { name: 'auth confirm', path: '/auth/confirm?token_hash=x&type=recovery', signInAs: null, button: 'Continue' },
  { name: 'not-a-coach', path: '/not-a-coach', signInAs: 'client@demo.local' },
  { name: 'invite (not found)', path: '/invite/not-a-real-token', signInAs: null },
] as const;

for (const p of PAGES) {
  test(`${p.name} page is branded`, async ({ page }) => {
    if (p.signInAs) {
      await page.goto('/sign-in');
      await page.getByLabel('Email').fill(p.signInAs);
      await page.getByLabel('Password').fill('demo-password-123');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).not.toHaveURL(/sign-in/);
    }
    await page.goto(p.path);
    await expect(page).toHaveURL(new RegExp(p.path.split('?')[0]!));
    if ('heading' in p) await expect(page.getByRole('heading', { name: p.heading })).toBeVisible();
    if ('button' in p) await expect(page.getByRole('button', { name: p.button })).toBeVisible();
    await expect(page.getByLabel('CalTracker').first()).toBeVisible();
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(bodyFont).toContain('Bricolage');
    const hasOldRed = await page.evaluate(
      (red) => [...document.querySelectorAll('*')].some((el) => getComputedStyle(el).color === red),
      OLD_ERROR_RED,
    );
    expect(hasOldRed).toBe(false);
  });
}
