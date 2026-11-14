import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { formatPlainDay } from '@caltracker/shared';
import { addDays, browserToday, demoWorkspace, freshClient, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// iPhone quick fixes B (2026-11-13 Safari review): the calendar, its dialogs, Programs and the live view. CI runs
// Chromium with iPhone and iPad sizes, so iOS-only behaviour (a native picker popping open, Safari's wide date field,
// its heavy ‹ › glyphs) is covered by what Chromium can show: where focus lands, boxes staying inside their
// container, and unit tests (show-dialog.test.ts, menu-placement.test.ts). Each CI shard starts from an empty
// database, so every test seeds its own client, workouts and programs, and removes them afterwards.

const admin = serviceClient();
let workspaceId: string;
const created = { clients: [] as string[], workouts: [] as string[], programs: [] as string[] };

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  // Deleting a client takes their calendar workouts and assignments with them.
  for (const id of created.clients) await admin.auth.admin.deleteUser(id);
  if (created.programs.length) {
    await admin.from('program_assignments').delete().in('program_id', created.programs);
    await admin.from('programs').delete().in('id', created.programs);
  }
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
const SE = { width: 375, height: 667 };
const shortDay = formatPlainDay;

async function newClient(): Promise<string> {
  const id = await freshClient(admin, workspaceId, 'Quinn', `QuickB${unique()}`);
  created.clients.push(id);
  return id;
}

async function libraryWorkout(name: string): Promise<string> {
  const id = await seedLibraryWorkout(admin, workspaceId, name);
  created.workouts.push(id);
  return id;
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThanOrEqual(innerWidth);
}

/** The element's text fits inside its own box (nothing spills out sideways). */
async function expectTextInside(locator: Locator) {
  const { scrollWidth, clientWidth } = await locator.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth, 'text spills out of its box').toBeLessThanOrEqual(clientWidth);
}

/** `inner` lies within `outer` (to the pixel). */
async function expectWithin(inner: Locator, outer: Locator) {
  const a = (await inner.boundingBox())!;
  const b = (await outer.boundingBox())!;
  expect(a.x).toBeGreaterThanOrEqual(b.x - 0.5);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
}

/** Adds `workout` with the page's "+ Add workout" on the date the dialog starts on (today). */
async function addToday(page: Page, workout: string) {
  await page.getByRole('button', { name: '+ Add workout' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a workout' });
  await dialog.getByLabel('Search workouts').fill(workout);
  await dialog.getByRole('button', { name: workout, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe('iPhone SE (375 x 667)', () => {
  test.use({ ...iphone13, viewport: SE });

  test('"Add a workout" starts on the search box, not the date field, which stays inside the window', async ({ page }) => {
    const client = await newClient();
    await libraryWorkout(`Focus ${unique()}`);
    await signInAsCoach(page);
    await page.goto(`/clients/${client}/training`);
    await page.getByRole('button', { name: '+ Add workout' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a workout' });
    const date = dialog.getByLabel('Date');
    await expect(dialog.getByLabel('Search workouts')).toBeFocused();
    await expect(date).not.toBeFocused();
    await expectWithin(date, dialog);
  });

  test('the toast\'s Undo and Dismiss keep their words inside the button', async ({ page }) => {
    test.slow();
    const client = await newClient();
    const name = `A rather long workout name ${unique()}`;
    await libraryWorkout(name);
    await signInAsCoach(page);
    await page.goto(`/clients/${client}/training`);
    await addToday(page, name);
    const toast = page.getByText(`Added ${name} to`).locator('..');
    for (const label of ['Undo', 'Dismiss']) await expectTextInside(toast.getByRole('button', { name: label, exact: true }));
    await expectNoSidewaysScroll(page);
  });

  test('the assign-program list keeps every row whole: a long name wraps and its size line still shows', async ({ page }) => {
    test.slow();
    const client = await newClient();
    const tag = unique();
    // Enough programs that the list scrolls (it squashed its rows before).
    for (let i = 0; i < 8; i++) created.programs.push(await seedProgram(admin, workspaceId, `12-Week Hypertrophy Block — Phase ${i + 1} ${tag}`, 12, []));
    await signInAsCoach(page);
    await page.goto(`/clients/${client}/training`);
    await page.getByRole('button', { name: 'Assign program' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Assign a program' });
    const row = dialog.locator('label').filter({ hasText: `Phase 1 ${tag}` });
    await row.scrollIntoViewIfNeeded();
    const { scrollHeight, clientHeight } = await row.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(scrollHeight, 'the row is squashed').toBeLessThanOrEqual(clientHeight);
    await expect(row.getByText('12 weeks')).toBeVisible();
    await expectWithin(dialog.getByLabel('Start date'), dialog);
  });

  test('the Programs list fits: Assign and Duplicate are whole and on screen, with no sideways scroll', async ({ page }) => {
    const name = `12-Week Hypertrophy Block — Phase 1 ${unique()}`;
    created.programs.push(await seedProgram(admin, workspaceId, name, 12, []));
    await signInAsCoach(page);
    await page.goto('/programs');
    const row = page.getByRole('table', { name: 'Programs' }).getByRole('row').filter({ hasText: name });
    for (const button of [row.getByRole('button', { name: `Assign ${name}` }), row.getByRole('button', { name: /^Duplicate/ })]) {
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport({ ratio: 1 });
      await expectTextInside(button);
    }
    await expectNoSidewaysScroll(page);
  });
});

test('"Move to…" says where it went, and Undo moves it back', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });
  const client = await newClient();
  const name = `Move undo ${unique()}`;
  await libraryWorkout(name);
  await signInAsCoach(page);
  await page.goto(`/clients/${client}/training?view=2w`);
  const today = await browserToday(page);
  const later = addDays(today, 2);
  await addToday(page, name);
  const day = (d: string) => page.locator(`[data-date="${d}"]`);
  await expect(day(today).getByRole('button', { name, exact: true })).toBeVisible();

  await day(today).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await day(today).getByRole('menuitem', { name: 'Move to…' }).click();
  const move = page.getByRole('dialog', { name: `Move ${name}` });
  // The date field is not where the window starts (iOS would open its picker).
  await expect(move.getByLabel('Date')).not.toBeFocused();
  await move.getByLabel('Date').fill(later);
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText(`Moved ${name} to ${shortDay(later)}.`)).toBeVisible();
  await expect(day(later).getByRole('button', { name, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText(`Moved ${name} back to ${shortDay(today)}.`)).toBeVisible();
  await expect(day(today).getByRole('button', { name, exact: true })).toBeVisible();
  await expect(day(later).getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
  const saved = await admin.from('workouts').select('scheduled_on').eq('client_id', client).eq('name', name).single();
  expect(saved.data?.scheduled_on).toBe(today);
});

test('Undo after "Move to…" only says it moved back when it could: a workout deleted since is not "moved back"', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });
  const client = await newClient();
  const name = `Move gone ${unique()}`;
  await libraryWorkout(name);
  await signInAsCoach(page);
  await page.goto(`/clients/${client}/training?view=2w`);
  const today = await browserToday(page);
  const later = addDays(today, 2);
  await addToday(page, name);
  const day = (d: string) => page.locator(`[data-date="${d}"]`);

  await day(today).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await day(today).getByRole('menuitem', { name: 'Move to…' }).click();
  const move = page.getByRole('dialog', { name: `Move ${name}` });
  await move.getByLabel('Date').fill(later);
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText(`Moved ${name} to ${shortDay(later)}.`)).toBeVisible();

  // Deleted while the move's toast (and its Undo) is still showing.
  await day(later).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await day(later).getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: `Delete ${name}?` });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toBeHidden();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText(`Couldn't move ${name} back to ${shortDay(today)}.`)).toBeVisible();
  await expect(page.getByText(`Moved ${name} back to`)).toHaveCount(0);
  await expect(day(today).getByRole('button', { name, exact: true })).toHaveCount(0);
});

test('switching the calendar view keeps the page where it is', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 600 });
  const client = await newClient();
  const name = `Scroll ${unique()}`;
  await libraryWorkout(name);
  await signInAsCoach(page);
  await page.goto(`/clients/${client}/training?view=2w`);
  await addToday(page, name);
  const views = page.getByRole('navigation', { name: 'Calendar view' });
  await expect(views.getByRole('link')).toHaveText(['1 week', '2 weeks', '4 weeks', 'Month']);
  await views.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await views.getByRole('link', { name: '4 weeks', exact: true }).click();
  await expect(views.getByRole('link', { name: '4 weeks', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
});

test.describe('program dialogs', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('"Copy week" and a workout\'s "Copy to…" start on the window, not the Week select', async ({ page }) => {
    const workout = `Copy focus ${unique()}`;
    const workoutId = await libraryWorkout(workout);
    const program = await seedProgram(admin, workspaceId, `Copy focus ${unique()}`, 3, [{ week: 1, day: 1, workoutId }]);
    created.programs.push(program);
    await signInAsCoach(page);
    await page.goto(`/programs/${program}`);

    await page.getByRole('button', { name: 'Copy week 1' }).click();
    const copyWeek = page.getByRole('dialog', { name: 'Copy week 1' });
    await expect(copyWeek).toBeFocused();
    await expect(copyWeek.getByRole('combobox')).not.toBeFocused();
    // Keyboard users go on from the window to its first control.
    await page.keyboard.press('Tab');
    await expect(copyWeek.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(copyWeek).toBeHidden();

    await page.getByRole('button', { name: `Options for ${workout}` }).click();
    await page.getByRole('menuitem', { name: 'Copy to…' }).click();
    const copyTo = page.getByRole('dialog', { name: `Copy ${workout}` });
    await expect(copyTo).toBeFocused();
    await expect(copyTo.getByLabel('Week')).not.toBeFocused();
  });
});

test.describe('iPad mini portrait (744 x 1133)', () => {
  test.use({ viewport: { width: 744, height: 1133 }, hasTouch: true });

  test('the program grid shows all seven days without scrolling sideways', async ({ page }) => {
    const program = await seedProgram(admin, workspaceId, `iPad mini ${unique()}`, 2, []);
    created.programs.push(program);
    await signInAsCoach(page);
    await page.goto(`/programs/${program}`);
    const grid = page.getByRole('table', { name: 'Program weeks' });
    await expect(grid.getByRole('columnheader', { name: 'Day 7' })).toBeInViewport({ ratio: 1 });
    const scroll = await grid.evaluate((el) => ({ scrollWidth: el.parentElement!.scrollWidth, clientWidth: el.parentElement!.clientWidth }));
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
    await expectNoSidewaysScroll(page);
  });
});
