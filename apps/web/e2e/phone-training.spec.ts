import { devices, expect, test, type Page } from '@playwright/test';
import { addDays, browserToday, demoWorkspace, freshClient, nextMonday, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// Phone fixes, batch 2: the client Training tab (calendar swipes, arrows by the dates, the month as dots, assigned
// program rows that open the program), the assign dialog's program rows and the Programs list's row links. Chromium
// with iPhone sizes and touch (the browser can't be chosen per spec). Each CI shard starts from an empty database, so
// every test makes its own client, workouts and program, and they are removed afterwards.

const admin = serviceClient();
const created = { users: [] as string[], workouts: [] as string[], programs: [] as string[] };

test.afterAll(async () => {
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  if (created.programs.length) {
    await admin.from('program_assignments').delete().in('program_name', created.programs);
    await admin.from('programs').delete().in('name', created.programs);
  }
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
test.use({ ...iphone13, viewport: { width: 375, height: 667 } });

/** "Thursday 12 November 2026", as the calendar says it. */
const longDay = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${d}T00:00:00Z`),
  );
/** "Thu 12 Nov", as the day's "+" says it. */
const shortDay = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`));
const mondayOf =(d: string) => addDays(d, 1 - (new Date(`${d}T00:00:00Z`).getUTCDay() || 7));

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThanOrEqual(innerWidth);
}

/** A sideways finger swipe through Chrome's real touch input (so native scrolling and dnd-kit both see it). */
async function swipe(page: Page, from: { x: number; y: number }, dx: number) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
  await send('touchStart', from.x, from.y);
  for (let i = 1; i <= 10; i++) {
    await send('touchMove', from.x + (dx * i) / 10, from.y);
    await page.waitForTimeout(16);
  }
  await send('touchEnd', from.x + dx, from.y);
}

/** A new client of the demo workspace with one planned workout on `date` (the browser's today, unless given). */
async function clientWithWorkout(page: Page, tag: string, offset = 0) {
  const workspaceId = await demoWorkspace(admin);
  const clientId = await freshClient(admin, workspaceId, 'Pippa', `Phone${tag}`);
  created.users.push(clientId);
  const date = addDays(await browserToday(page), offset);
  const name = `Phone day ${tag}`;
  created.workouts.push(name);
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: clientId, scheduled_on: date, name });
  if (w.error) throw w.error;
  return { workspaceId, clientId, date, name };
}

test('the month view fits the phone: a dot per day with workouts, the tapped day listed under it', async ({ page }) => {
  await signInAsCoach(page);
  const tag = unique();
  const { clientId, date, name } = await clientWithWorkout(page, tag);
  await page.goto(`/clients/${clientId}/training?view=month&from=${date}`);

  const grid = page.getByRole('table', { name: /\d{4}$/ });
  await expect(grid).toBeVisible();
  await expectNoSidewaysScroll(page);
  // Today starts picked, and its workout is listed under the grid.
  const todayButton = page.getByRole('button', { name: `${longDay(date)}: 1 workout`, exact: true });
  await expect(todayButton).toHaveAttribute('aria-pressed', 'true');
  const panel = page.getByRole('region', { name: longDay(date), exact: true });
  await expect(panel.getByText(name, { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: `Add workout to ${shortDay(date)}`, exact: true })).toBeVisible();
  // Every day button is a full tap target.
  const box = (await todayButton.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);

  // Another day of the month with nothing on it: tapping it shows that day instead.
  const other = `${date.slice(0, 7)}-${date.slice(8) === '15' ? '16' : '15'}`;
  await page.getByRole('button', { name: `${longDay(other)}: no workouts`, exact: true }).click();
  const otherPanel = page.getByRole('region', { name: longDay(other), exact: true });
  await expect(otherPanel.getByText('No workouts', { exact: true })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});

test('a sideways swipe changes the week, but not when it starts on a workout card; the arrows sit by the dates', async ({ page }) => {
  await signInAsCoach(page);
  const tag = unique();
  const { clientId, date, name } = await clientWithWorkout(page, tag);
  const monday = mondayOf(date);
  await page.goto(`/clients/${clientId}/training?view=1w&from=${date}`);

  // ‹ and › are 48 px and either side of the dates.
  const title = page.getByRole('heading', { level: 2, name: /–/ });
  const prev = page.getByRole('link', { name: 'Previous week' });
  const next = page.getByRole('link', { name: 'Next week' });
  const [p, t, n] = [(await prev.boundingBox())!, (await title.boundingBox())!, (await next.boundingBox())!];
  for (const b of [p, n]) {
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  expect(p.x + p.width).toBeLessThanOrEqual(t.x + 1);
  expect(t.x + t.width).toBeLessThanOrEqual(n.x + 1);

  // A swipe that starts on the card is left to the card: the week stays.
  const card = page.locator(`[data-date="${date}"]`).getByRole('listitem').filter({ hasText: name });
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const c = (await card.boundingBox())!;
  await swipe(page, { x: 300, y: c.y + c.height / 2 }, -200);
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(new RegExp(`from=${date}`));

  // Right to left on the dates: the next week.
  await title.scrollIntoViewIfNeeded();
  const tb = (await title.boundingBox())!;
  await swipe(page, { x: 300, y: tb.y + tb.height / 2 }, -200);
  await expect(page).toHaveURL(new RegExp(`view=1w&from=${addDays(monday, 7)}`));
  // Left to right: back again.
  const tb2 = (await title.boundingBox())!;
  await swipe(page, { x: 75, y: tb2.y + tb2.height / 2 }, 200);
  await expect(page).toHaveURL(new RegExp(`view=1w&from=${monday}`));
});

test('the assign dialog lists programs with full names; the assigned row opens the program', async ({ page }) => {
  test.slow();
  await signInAsCoach(page);
  const tag = unique();
  const { workspaceId, clientId } = await clientWithWorkout(page, tag, -3);
  const workout = `Phone lib ${tag}`;
  created.workouts.push(workout);
  const workoutId = await seedLibraryWorkout(admin, workspaceId, workout);
  const program = `Strength Block ${tag} — Phase 2 Hypertrophy`;
  created.programs.push(program);
  const programId = await seedProgram(admin, workspaceId, program, 4, [
    { week: 1, day: 1, workoutId },
    { week: 2, day: 1, workoutId },
  ]);

  await page.goto(`/clients/${clientId}/training`);
  await page.getByRole('button', { name: 'Assign program', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign a program' });
  const choice = dialog.getByRole('radio', { name: program, exact: true });
  await expect(choice).toHaveAccessibleDescription('4 weeks · 2 workouts');
  // The whole name shows (it wraps; nothing is cut off), and the row is a full tap target.
  const nameText = dialog.getByText(program, { exact: true });
  await expect(nameText).toBeVisible();
  expect(await nameText.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // `has` is matched inside each label, so the radio locator must not start from the dialog.
  const row = dialog.locator('label').filter({ has: page.getByRole('radio', { name: program, exact: true }) });
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoSidewaysScroll(page);
  await nameText.click();
  await expect(choice).toBeChecked();
  await expect(dialog.getByLabel('Start date')).toHaveValue(nextMonday(await browserToday(page)));
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(dialog).toBeHidden();

  const panel = page.getByRole('region', { name: 'Assigned programs' });
  await panel.getByRole('button', { name: / on the calendar/ }).click();
  const link = panel.getByRole('link', { name: new RegExp(`^${program}`) });
  await expect(link).toBeVisible();
  await expect(panel.getByRole('button', { name: `Options for ${program}`, exact: true })).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/programs/${programId}$`));
});

test('the whole Programs row opens the program; Assign stays its own button', async ({ page }) => {
  await signInAsCoach(page);
  const tag = unique();
  const workspaceId = await demoWorkspace(admin);
  const program = `Row link ${tag}`;
  created.programs.push(program);
  const programId = await seedProgram(admin, workspaceId, program, 3, []);

  await page.goto('/programs');
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: program, exact: true }) });
  await expect(row).toBeVisible();
  // Assign opens its dialog and stays on the list.
  await row.getByRole('button', { name: new RegExp(`^Assign`) }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/programs$/);
  // A tap on the weeks column opens the program.
  await row.getByRole('cell', { name: '3', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/programs/${programId}$`));
});
