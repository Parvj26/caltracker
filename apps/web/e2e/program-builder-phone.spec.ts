import { devices, expect, test, type Page } from '@playwright/test';
import { demoWorkspace, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import { programCell, serviceClient, signInAsCoach } from './helpers';

// The program builder on an iPhone and an iPad (phone audit, 2026-11-11): week tabs with the days listed down the page,
// tap a Library workout to pick its day, "Copy to…" for one workout, and swipes that scroll instead of dragging.
// Chromium with each device's size and touch (the browser can't be chosen per spec).
const admin = serviceClient();
const created: { workouts: string[]; programs: string[] } = { workouts: [], programs: [] };

test.afterAll(async () => {
  if (created.programs.length) await admin.from('programs').delete().in('name', created.programs);
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts).is('client_id', null);
});

/** A 3-week program with one workout on week 1, day 1, and a second library workout; opens the program page. */
async function seed(page: Page) {
  const workspaceId = await demoWorkspace(admin);
  const placed = `Upper ${unique()}`;
  const spare = `Lower ${unique()}`;
  const program = `Phone plan ${unique()}`;
  created.workouts.push(placed, spare);
  created.programs.push(program);
  const placedId = await seedLibraryWorkout(admin, workspaceId, placed);
  await seedLibraryWorkout(admin, workspaceId, spare);
  const id = await seedProgram(admin, workspaceId, program, 3, [{ week: 1, day: 1, workoutId: placedId }]);
  await signInAsCoach(page);
  await page.goto(`/programs/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: program })).toBeVisible();
  return { id, placed, spare };
}

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThanOrEqual(innerWidth);
}

/** A one-finger swipe (Chrome DevTools touch events), from (x, y) by (dx, dy), slowly enough to scroll, not to fling. */
async function swipe(page: Page, x: number, y: number, dx: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Tap a Library workout, pick a week and day in "Add to which day?", and check it landed there. */
async function addFromLibrary(page: Page, workout: string, week: number, day: number) {
  await page.getByRole('region', { name: 'Library' }).getByRole('button', { name: workout, exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: `Add ${workout}` });
  await expect(dialog.getByText('Add to which day?')).toBeVisible();
  await dialog.getByLabel('Week').selectOption(String(week));
  await dialog.getByLabel('Day').selectOption(String(day));
  await dialog.getByRole('button', { name: 'Add', exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(programCell(page, week, day).getByRole('button', { name: workout, exact: true })).toBeVisible();
  await saved(page);
}

/** "Copy to…" from a chip's ⋯ menu onto two days (one in another week), then checks both have it. */
async function copyToTwoDays(page: Page, workout: string, switchWeek: (week: number) => Promise<void>) {
  await programCell(page, 1, 1).getByRole('button', { name: `Options for ${workout}`, exact: true }).tap();
  await programCell(page, 1, 1).getByRole('menuitem', { name: 'Copy to…' }).tap();
  const dialog = page.getByRole('dialog', { name: `Copy ${workout}` });
  // The day it's on can't be picked.
  await expect(dialog.getByRole('checkbox', { name: /Day 1/ })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Day 4' }).check();
  await dialog.getByLabel('Week').selectOption('2');
  await dialog.getByRole('checkbox', { name: 'Day 2' }).check();
  await expect(dialog.getByRole('status')).toHaveText('Copies to Week 1, Day 4 and Week 2, Day 2.');
  await dialog.getByRole('button', { name: 'Copy to 2 days' }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Copied “${workout}” to Week 1, Day 4 and Week 2, Day 2.`)).toBeVisible();
  await saved(page);
  await switchWeek(1);
  await expect(programCell(page, 1, 4).getByRole('button', { name: workout, exact: true })).toBeVisible();
  await switchWeek(2);
  await expect(programCell(page, 2, 2).getByRole('button', { name: workout, exact: true })).toBeVisible();
  // Saved: a copy points at the same library workout, like a copied week.
  const { data } = await admin.from('program_workouts').select('week, day, workouts!inner(name)').eq('workouts.name', workout).order('week').order('day');
  expect(data?.map((r) => [r.week, r.day])).toEqual([[1, 1], [1, 4], [2, 2]]);
}

test.describe('iPhone', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  test.use(iphone);

  const tab = (page: Page, week: number) => page.getByRole('tab', { name: `Week ${week}`, exact: true });
  const switchWeek = (page: Page) => async (week: number) => {
    await tab(page, week).tap();
    await expect(tab(page, week)).toHaveAttribute('aria-selected', 'true');
  };

  test('week tabs show one week, days listed down the page, plan before the settings', async ({ page }) => {
    const { placed } = await seed(page);
    await expectNoSidewaysScroll(page);
    // No wide grid on a phone.
    await expect(page.getByRole('table', { name: 'Program weeks' })).toHaveCount(0);
    await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');
    for (const d of [1, 2, 3, 4, 5, 6, 7]) await expect(programCell(page, 1, d)).toBeVisible();
    await expect(programCell(page, 1, 1).getByRole('button', { name: placed, exact: true })).toBeVisible();
    // The days are one under another.
    const d1 = (await programCell(page, 1, 1).boundingBox())!;
    const d2 = (await programCell(page, 1, 2).boundingBox())!;
    expect(d2.y).toBeGreaterThan(d1.y + d1.height - 1);

    await switchWeek(page)(2);
    await expect(programCell(page, 2, 1)).toBeVisible();
    await expect(programCell(page, 1, 1)).toHaveCount(0);
    await expect(programCell(page, 2, 1).getByRole('button', { name: placed, exact: true })).toHaveCount(0);

    // Settings fold away below the plan: closed, then open with Weeks and Save beside it once changed.
    const toggle = page.getByRole('button', { name: /Program settings/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect((await toggle.boundingBox())!.y).toBeGreaterThan((await programCell(page, 2, 7).boundingBox())!.y);
    await expect(page.getByLabel('Weeks', { exact: true })).toBeHidden();
    await toggle.tap();
    await expect(page.getByRole('switch', { name: 'Live Sync' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Auto progression' })).toBeVisible();
    await page.getByLabel('Weeks', { exact: true }).fill('4');
    await page.getByRole('button', { name: 'Save weeks' }).tap();
    await expect(tab(page, 4)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save weeks' })).toHaveCount(0);
    await expectNoSidewaysScroll(page);

    // + Week adds a fifth week and shows it.
    await page.getByRole('button', { name: '+ Week', exact: true }).tap();
    await expect(tab(page, 5)).toHaveAttribute('aria-selected', 'true');
    await saved(page);
  });

  test('tap a Library workout to add it to a chosen day', async ({ page }) => {
    const { spare } = await seed(page);
    await addFromLibrary(page, spare, 3, 5);
    // It shows the week it went to.
    await expect(tab(page, 3)).toHaveAttribute('aria-selected', 'true');
  });

  test('Copy to… puts one workout on two days', async ({ page }) => {
    const { placed } = await seed(page);
    await copyToTwoDays(page, placed, switchWeek(page));
  });

  test('a swipe that starts on a workout scrolls the page instead of dragging it', async ({ page }) => {
    const { placed } = await seed(page);
    const chip = programCell(page, 1, 1).getByRole('button', { name: placed, exact: true });
    const box = (await chip.boundingBox())!;
    const before = await page.evaluate(() => window.scrollY);
    await swipe(page, box.x + 20, box.y + box.height / 2, 0, -250);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 100);
    // Still on its day, nothing moved, no summary opened.
    await expect(programCell(page, 1, 1).getByRole('button', { name: placed, exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the day editor has Save in its top bar', async ({ page }) => {
    await seed(page);
    await page.getByRole('button', { name: 'Add a workout to week 1, day 3', exact: true }).tap();
    await page.getByRole('dialog', { name: 'Add a workout to Week 1, Day 3' }).getByRole('button', { name: /New workout/ }).tap();
    const sheet = page.getByRole('dialog', { name: 'New workout' });
    const top = sheet.locator('header').getByRole('button', { name: 'Save', exact: true });
    await expect(top).toBeVisible();
    const close = sheet.getByRole('button', { name: 'Close' });
    expect(Math.abs((await top.boundingBox())!.y - (await close.boundingBox())!.y)).toBeLessThan(10);
    // The top Save is the editor's Save: an empty workout gets the editor's own message.
    await top.tap();
    await expect(sheet.getByText('Check the highlighted fields.')).toBeVisible();
  });
});

test.describe('iPad portrait', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...ipad } = devices['iPad Mini'];
  test.use({ ...ipad, viewport: { width: 820, height: 1180 } });

  const noSwitch = async () => {};

  test('all seven days fit, the plan comes before the Library, and a sideways swipe on a chip is not a drag', async ({ page }) => {
    const { placed } = await seed(page);
    await expectNoSidewaysScroll(page);
    const table = page.getByRole('table', { name: 'Program weeks' });
    const scroller = table.locator('xpath=..');
    expect(await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const day7 = (await page.getByRole('columnheader', { name: 'Day 7' }).boundingBox())!;
    expect(day7.x + day7.width).toBeLessThanOrEqual(820);
    const library = (await page.getByRole('region', { name: 'Library' }).boundingBox())!;
    expect(library.y).toBeGreaterThan((await table.boundingBox())!.y);

    const chip = programCell(page, 1, 1).getByRole('button', { name: placed, exact: true });
    const box = (await chip.boundingBox())!;
    await swipe(page, box.x + 16, box.y + box.height / 2, 0, -200);
    await expect(chip).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('tap a Library workout to add it, and Copy to… two days', async ({ page }) => {
    const { placed, spare } = await seed(page);
    await addFromLibrary(page, spare, 2, 6);
    await copyToTwoDays(page, placed, noSwitch);
  });
});

test.describe('iPad landscape', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...ipad } = devices['iPad Mini landscape'];
  test.use({ ...ipad, viewport: { width: 1180, height: 820 } });

  test('the plan comes first with all seven days, the Library below it', async ({ page }) => {
    await seed(page);
    await expectNoSidewaysScroll(page);
    const table = page.getByRole('table', { name: 'Program weeks' });
    expect(await table.locator('xpath=..').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const library = (await page.getByRole('region', { name: 'Library' }).boundingBox())!;
    const plan = (await table.boundingBox())!;
    expect(library.y).toBeGreaterThanOrEqual(plan.y + plan.height);
  });
});
