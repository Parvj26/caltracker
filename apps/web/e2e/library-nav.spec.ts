import { expect, test, type Page } from '@playwright/test';
import { signInAsCoach } from './helpers';

// iPad and desktop: Workouts, Exercises and Programs sit behind one Library item in the side menu (ui-rules §8
// "Library menu"). Desktop (labelled sidebar, 1200 and up): Library opens in place with the three indented under it,
// and is open on any library page. iPad (icon rail): a small menu beside the icon, no dimming. Each of the three lists
// has a Workouts | Exercises | Programs row at the top. The iPhone's Library tab and sheet are in phone-nav.spec.ts.

const library = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Library' });
const menu = (page: Page) => page.getByRole('menu', { name: 'Library' });
const sub = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('list', { name: 'Library' });
const SHOTS = process.env.LIBRARY_SHOTS_DIR;

for (const [device, size] of [
  ['iPad portrait', { width: 820, height: 1180 }],
  ['iPad landscape', { width: 1180, height: 820 }],
] as const) {
  test(`on ${device} the Library icon opens a small menu beside it, without dimming, and a choice opens that page`, async ({ page }) => {
    await page.setViewportSize(size);
    await signInAsCoach(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const gone of ['Workouts', 'Programs', 'Exercises']) await expect(nav.getByRole('link', { name: gone })).toHaveCount(0);
    await expect(library(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(library(page)).toHaveAttribute('aria-haspopup', 'menu');

    await library(page).click();
    await expect(library(page)).toHaveAttribute('aria-expanded', 'true');
    const choices = menu(page).getByRole('menuitem');
    await expect(choices).toHaveCount(3);
    await expect(choices.nth(0)).toHaveAccessibleName('Workouts Single sessions');
    await expect(choices.nth(1)).toHaveAccessibleName(/^Exercise library/);
    await expect(choices.nth(2)).toHaveAccessibleName(/^Programs/);
    await expect(choices.nth(0)).toBeFocused();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/library-${size.width}.png` });
    const button = (await library(page).boundingBox())!;
    const box = (await menu(page).boundingBox())!;
    expect(box.x).toBeGreaterThan(button.x + button.width);
    expect(box.x - (button.x + button.width)).toBeLessThan(30);
    // Level with the icon.
    expect(Math.abs(box.y - button.y)).toBeLessThan(60);
    expect(box.width).toBeLessThanOrEqual(250);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    // No dimming: the page under it is what a tap far away lands on.
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('main'), [size.width - 30, size.height - 30])).toBe(true);
    for (const choice of await choices.all()) {
      const { height } = (await choice.boundingBox())!;
      expect(height).toBeGreaterThanOrEqual(44);
      expect(height).toBeLessThanOrEqual(60);
    }
    await page.keyboard.press('ArrowDown');
    await expect(choices.nth(1)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await expect(library(page)).toBeFocused();

    // A tap outside (on the page's title, not a link) closes it.
    await library(page).click();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(menu(page)).toBeHidden();

    // Back closes the menu and stays on the page.
    const here = page.url();
    await library(page).click();
    await expect(menu(page)).toBeVisible();
    await page.goBack();
    await expect(menu(page)).toBeHidden();
    expect(page.url()).toBe(here);

    await library(page).click();
    await menu(page).getByRole('menuitem', { name: /^Exercise library/ }).click();
    await expect(page).toHaveURL(/\/exercises$/);
    await expect(menu(page)).toBeHidden();
    await expect(library(page)).toHaveAttribute('aria-current', 'true');
    // One Back from the new page goes to the page it was opened on (no leftover step for the menu).
    await page.goBack();
    expect(page.url()).toBe(here);
    await page.goForward();
    await expect(page).toHaveURL(/\/exercises$/);

    const sections = page.getByRole('navigation', { name: 'Library sections' });
    await expect(sections.getByRole('link', { name: 'Exercises' })).toHaveAttribute('aria-current', 'page');
    await sections.getByRole('link', { name: 'Workouts' }).click();
    await expect(page).toHaveURL(/\/workouts$/);
    await expect(sections.getByRole('link', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
    for (const link of await sections.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

test('on desktop Library opens in place in the sidebar, open and lit on library pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsCoach(page);
  // Not on a library page: folded, no pop-up of any kind.
  await expect(library(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(sub(page)).toHaveCount(0);
  await library(page).click();
  await expect(library(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  const items = sub(page).getByRole('link');
  await expect(items).toHaveText(['Workouts', 'Exercise library', 'Programs']);
  // Indented under Library.
  const lib = (await library(page).boundingBox())!;
  const first = (await items.nth(0).boundingBox())!;
  expect(first.x).toBeGreaterThan(lib.x + 8);
  expect(first.y).toBeGreaterThan(lib.y);

  await items.nth(2).click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(sub(page).getByRole('link', { name: 'Programs' })).toHaveAttribute('aria-current', 'page');
  await expect(library(page)).toHaveAttribute('aria-expanded', 'true');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/library-1440.png` });

  // Folds away and opens again on a click.
  await library(page).click();
  await expect(sub(page)).toHaveCount(0);
  await library(page).click();
  await expect(sub(page).getByRole('link', { name: 'Programs' })).toHaveAttribute('aria-current', 'page');

  // A detail page: still open, its list lit.
  await page.goto('/workouts/new');
  await expect(sub(page).getByRole('link', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
  await page.goto('/clients');
  await expect(sub(page)).toHaveCount(0);
});

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

test('Back while the iPad menu is open closes it and stays on the page', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signInAsCoach(page);
  await page.goto('/programs');
  await library(page).click();
  await expect(menu(page)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(menu(page)).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/clients$/);
});
