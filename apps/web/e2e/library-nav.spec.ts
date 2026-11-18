import { expect, test, type Page } from '@playwright/test';
import { signInAsCoach } from './helpers';

// iPad and desktop: Workouts, Exercises and Programs sit behind one Library item in the side menu. It opens a pop-up
// beside it with the three as big buttons, and each of the three lists has a Workouts | Exercises | Programs row at
// the top. The iPhone's Library tab and sheet are in phone-nav.spec.ts.

const library = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Library' });
const popup = (page: Page) => page.getByRole('dialog', { name: 'Library' });

for (const [device, size] of [
  ['iPad portrait', { width: 820, height: 1180 }],
  ['iPad landscape', { width: 1180, height: 820 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  test(`on ${device} the Library item opens a pop-up beside it and a choice opens that page`, async ({ page }) => {
    await page.setViewportSize(size);
    await signInAsCoach(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const gone of ['Workouts', 'Programs', 'Exercises']) await expect(nav.getByRole('link', { name: gone })).toHaveCount(0);
    await expect(library(page)).toHaveAttribute('aria-expanded', 'false');

    await library(page).click();
    await expect(library(page)).toHaveAttribute('aria-expanded', 'true');
    const choices = popup(page).getByRole('link');
    await expect(choices).toHaveCount(3);
    await expect(choices.nth(0)).toHaveAccessibleName(/^Workouts Single sessions you build and assign/);
    await expect(choices.nth(1)).toHaveAccessibleName(/^Exercise library/);
    await expect(choices.nth(2)).toHaveAccessibleName(/^Programs/);
    await expect(choices.nth(0)).toBeFocused();
    const button = (await library(page).boundingBox())!;
    const box = (await popup(page).boundingBox())!;
    expect(box.x).toBeGreaterThan(button.x + button.width);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    for (const choice of await choices.all()) expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Tab goes round the choices and the Library button.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-library-menu]') || document.activeElement?.getAttribute('aria-label') === 'Library')).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(popup(page)).toBeHidden();
    await expect(library(page)).toBeFocused();

    await library(page).click();
    await page.mouse.click(size.width - 20, size.height - 20);
    await expect(popup(page)).toBeHidden();

    await library(page).click();
    await popup(page).getByRole('link', { name: /^Exercise library/ }).click();
    await expect(page).toHaveURL(/\/exercises$/);
    await expect(popup(page)).toBeHidden();
    await expect(library(page)).toHaveAttribute('aria-current', 'true');

    const sections = page.getByRole('navigation', { name: 'Library sections' });
    await expect(sections.getByRole('link', { name: 'Exercises' })).toHaveAttribute('aria-current', 'page');
    await sections.getByRole('link', { name: 'Workouts' }).click();
    await expect(page).toHaveURL(/\/workouts$/);
    await expect(sections.getByRole('link', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
    for (const link of await sections.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

test('Library stays lit on a detail page, and the old addresses still open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsCoach(page);
  await page.goto('/workouts/new');
  await expect(library(page)).toHaveAttribute('aria-current', 'true');
  for (const path of ['/programs', '/exercises', '/workouts']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(library(page)).toHaveAttribute('aria-current', 'true');
  }
  await page.goto('/clients');
  await expect(library(page)).not.toHaveAttribute('aria-current');
});
