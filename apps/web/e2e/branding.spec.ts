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
