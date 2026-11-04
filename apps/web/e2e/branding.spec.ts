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
