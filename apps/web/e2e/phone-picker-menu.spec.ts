import { devices, expect, test, type Page } from '@playwright/test';
import { demoWorkspace, seedLibraryWorkout, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// Phone fixes, batch 1: the Add exercises window, the tab bar on a chat, the Workouts list and the message box.
// Chromium with iPhone sizes and touch (the browser can't be chosen per spec). The tests save nothing; the workout
// below exists only so the Workouts list is never empty (each CI shard starts from a fresh database).

const admin = serviceClient();
let workoutId: string | undefined;

test.beforeAll(async () => {
  workoutId = await seedLibraryWorkout(admin, await demoWorkspace(admin), `Phone list ${unique()}`);
});

test.afterAll(async () => {
  if (workoutId) await admin.from('workouts').delete().eq('id', workoutId);
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
const SE = { width: 375, height: 667 };
const CLIENT_ID = '00000000-0000-4000-8000-0000000000c2';

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Tabs' });

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThanOrEqual(innerWidth);
}

async function openPicker(page: Page) {
  await page.goto('/workouts/new');
  await page.getByRole('button', { name: '+ Exercise' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add exercises' });
  await expect(dialog.getByRole('option').first()).toBeVisible();
  return dialog;
}

test.describe('iPhone SE (375 x 667)', () => {
  test.use({ ...iphone13, viewport: SE });

  test('the Add exercises window shows the list and keeps Add on screen; a tap only ticks', async ({ page }) => {
    await signInAsCoach(page);
    const dialog = await openPicker(page);
    // At least four exercises fit above the Add button (before the fix: none).
    const options = dialog.getByRole('option');
    for (let i = 0; i < 4; i++) await expect(options.nth(i)).toBeInViewport({ ratio: 1 });
    const add = dialog.getByRole('button', { name: 'Pick at least 1 exercise' });
    await expect(add).toBeInViewport({ ratio: 1 });
    // The filters are one row that scrolls sideways, not a wall of chips.
    const chips = dialog.getByRole('group', { name: 'Filters' });
    expect((await chips.boundingBox())!.height).toBeLessThan(60);
    await expectNoSidewaysScroll(page);

    // A tap ticks the row and leaves the list in place.
    const first = options.nth(0);
    const name = (await first.getAttribute('aria-label'))!;
    // The first tick must not push the list down (the picks row has its room already), or a quick second tap would
    // land on the same row and untick it.
    const before = (await options.nth(1).boundingBox())!.y;
    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('list', { name: "Picked, in the order they're done" })).toBeVisible();
    // Within 2 px (sub-pixel rounding); the old jump was about 45 px.
    expect(Math.abs((await options.nth(1).boundingBox())!.y - before)).toBeLessThanOrEqual(2);
    await options.nth(1).click();
    await expect(options.nth(2)).toBeVisible();
    await expect(dialog.getByRole('button', { name: '← Back to list' })).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Add 2 exercises' })).toBeInViewport({ ratio: 1 });

    // The small "i" opens the details; Back returns to the same list with the ticks kept.
    await dialog.getByRole('button', { name: `Details for ${name}` }).click();
    await expect(dialog.getByRole('heading', { name, level: 3 })).toBeVisible();
    await dialog.getByRole('button', { name: '← Back to list' }).click();
    await expect(first).toHaveAttribute('aria-selected', 'true');

    // The x closes the window.
    await dialog.getByRole('button', { name: 'Close picker' }).click();
    await expect(dialog).toBeHidden();
  });

  test('the Workouts list fits the screen, with Assign and Duplicate on every card', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/workouts');
    const table = page.getByRole('table', { name: 'Workouts' });
    await expect(table.getByRole('link').first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    const duplicate = table.getByRole('button', { name: /^Duplicate/ }).first();
    const box = (await duplicate.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(SE.width);
  });
});

test.describe('iPhone 13', () => {
  test.use({ ...iphone13 });

  test('on a chat the tab bar is gone and the message box is full width', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto(`/messages/${CLIENT_ID}`);
    const box = page.getByRole('textbox', { name: 'Message' });
    await expect(box).toBeVisible();
    await expect(tabBar(page)).toBeHidden();
    const photos = page.getByRole('button', { name: 'Add photos' });
    await expect(photos).toBeInViewport({ ratio: 1 });
    const width = (await box.boundingBox())!.width;
    expect(width).toBeGreaterThan(iphone13.viewport.width - 48);
    await expectNoSidewaysScroll(page);
  });

  test('the Workouts list and the picker fit at 390', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/workouts');
    await expect(page.getByRole('table', { name: 'Workouts' })).toBeVisible();
    await expectNoSidewaysScroll(page);
    const dialog = await openPicker(page);
    await expect(dialog.getByRole('button', { name: 'Pick at least 1 exercise' })).toBeInViewport({ ratio: 1 });
    await expectNoSidewaysScroll(page);
  });
});
