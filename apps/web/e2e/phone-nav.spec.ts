import { expect, test, type Page } from '@playwright/test';
import { signInAsCoach } from './helpers';

// iPhone-width coach menu ("Option B"): below the 600 px tablet breakpoint the side rail gives way to a floating
// menu button that opens a bottom sheet of big tiles. iPad and desktop keep the side menu.

const IPHONE = { width: 390, height: 844 };
const TILES = ['Home', 'Clients', 'Workouts', 'Programs', 'Exercises', 'Meals', 'Activity', 'Community', 'Inbox', 'Profile', 'Help & feedback', 'Sign out'];

const menuButton = (page: Page) => page.getByRole('button', { name: 'Menu', exact: true });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Menu' });

test.describe('on an iPhone', () => {
  test.use({ viewport: IPHONE, hasTouch: true, isMobile: true });

  test('the side rail is gone and a floating menu button sits bottom-left', async ({ page }) => {
    await signInAsCoach(page);
    await expect(page.locator('[data-coach-sidebar]')).toBeHidden();
    const button = menuButton(page);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeInViewport({ ratio: 1 });
    const box = (await button.boundingBox())!;
    expect(box.width).toBe(60);
    expect(box.height).toBe(60);
    expect(box.x).toBe(16);
    await expect.poll(async () => { const b = (await button.boundingBox())!; return b.y + b.height; }).toBe(IPHONE.height - 16);
    // Page content uses the full width, and nothing pushes the page wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(IPHONE.width);
    const main = (await page.locator('#main-content').boundingBox())!;
    expect(main.x).toBe(0);
    expect(main.width).toBe(IPHONE.width);
  });

  test('the menu opens as a sheet of tiles in menu order, with the current page marked', async ({ page }) => {
    await signInAsCoach(page);
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
    const dialog = sheet(page);
    await expect(dialog).toBeVisible();
    const tiles = dialog.locator('a[aria-label], button[aria-label]');
    const names = (await tiles.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))).map((n) => n.replace(/, \d+ unread$/, ''));
    expect(names).toEqual(TILES);
    for (const tile of await tiles.all()) {
      expect(Math.round((await tile.boundingBox())!.height)).toBe(96);
    }
    // Three tiles to a row.
    const [first, , third, fourth] = await Promise.all([0, 1, 2, 3].map(async (i) => (await tiles.nth(i).boundingBox())!));
    expect(third!.y).toBe(first!.y);
    expect(fourth!.y).toBeGreaterThan(first!.y);
    const current = dialog.getByRole('link', { name: 'Clients' });
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(current).toHaveCSS('background-color', 'rgb(200, 241, 105)');
    await expect(dialog.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');
    await expect(dialog.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy' })).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Terms' })).toBeVisible();
  });

  test('a tile navigates and closes the sheet', async ({ page }) => {
    await signInAsCoach(page);
    await menuButton(page).click();
    await sheet(page).getByRole('link', { name: 'Workouts' }).click();
    await expect(page).toHaveURL(/\/workouts$/);
    await expect(sheet(page)).toBeHidden();
    await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
    await menuButton(page).click();
    await expect(sheet(page).getByRole('link', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
  });

  test('Escape and the backdrop close the sheet and focus returns to the button', async ({ page }) => {
    await signInAsCoach(page);
    await menuButton(page).click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();

    await menuButton(page).click();
    await expect(sheet(page)).toBeVisible();
    // The dimmed area above the sheet.
    await page.mouse.click(IPHONE.width / 2, 40);
    await expect(sheet(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    await expect(page).toHaveURL(/\/clients$/);
  });

  test('Tab stays inside the open sheet', async ({ page }) => {
    await signInAsCoach(page);
    await menuButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toBeVisible();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      expect(await sheet(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await sheet(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
  });

  test('the red dot on the button matches the Inbox unread count', async ({ page }) => {
    await signInAsCoach(page);
    await menuButton(page).click();
    const label = (await sheet(page).getByRole('link', { name: /^Inbox/ }).getAttribute('aria-label')) ?? '';
    await page.keyboard.press('Escape');
    const dot = menuButton(page).locator('[data-menu-dot]');
    if (/\d+ unread/.test(label)) await expect(dot).toBeVisible();
    else await expect(dot).toHaveCount(0);
  });

  test('on the workout editor the save bar is at the top, clear of the button', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/workouts/new');
    // On a phone the builder's save bar (Save and + Exercise) sits at the top of the screen, so the menu button keeps
    // its usual place at the bottom and covers neither.
    const save = (await page.getByRole('button', { name: 'Save workout' }).boundingBox())!;
    const button = (await menuButton(page).boundingBox())!;
    expect(save.y + save.height).toBeLessThan(button.y);
    await expect(menuButton(page)).toHaveCSS('bottom', '16px');
  });
});

test('on an iPad the side rail stays and there is no menu button', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await signInAsCoach(page);
  await expect(page.locator('[data-coach-sidebar]')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workouts' })).toBeVisible();
  await expect(menuButton(page)).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
});
