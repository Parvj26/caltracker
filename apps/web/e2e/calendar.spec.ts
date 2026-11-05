import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProgram, createWorkout, serviceClient, setRow, signInAsCoach } from './helpers';

// Client calendar and assignment (phase 2 Task 16). Every test builds its own workouts and programs with unique
// names, so tests can share the demo client and still run side by side.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; programs: string[] } = { workouts: [], programs: [] };
let clientId: string;

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const client = data.users.find((u) => u.email === 'client@demo.local');
  if (!client) throw new Error('Demo client client@demo.local not found; run pnpm db:reset.');
  clientId = client.id;
});

test.afterAll(async () => {
  if (created.workouts.length) {
    // Client copies first (they keep the library name), then assignments, programs and library workouts.
    await admin.from('workouts').delete().in('name', created.workouts).not('client_id', 'is', null);
  }
  if (created.programs.length) {
    await admin.from('program_assignments').delete().in('program_name', created.programs);
    await admin.from('programs').delete().in('name', created.programs);
  }
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts).is('client_id', null);
});

/* ---------- Plain YYYY-MM-DD maths (UTC only, never local time) ---------- */
const MS_DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(toMs(d) + n * MS_DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(toMs(d)).getUTCDay() || 7; // Monday 1 ... Sunday 7
const nextMonday = (today: string) => addDays(today, 8 - weekday(today));
const fmt = (d: string, weekdayToo: boolean) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    ...(weekdayToo ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
  }).format(new Date(toMs(d)));
const monthOf = (d: string) => d.slice(0, 7);
const nextMonth = (month: string) => addDays(`${month}-28`, 7).slice(0, 7);

/** Today in the browser's own time zone (what the app must use). */
const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));

const calendarUrl = (month?: string) => `/clients/${clientId}${month ? `?month=${month}` : ''}`;
const day = (page: Page, date: string): Locator => page.locator(`[data-date="${date}"]`);
const item = (page: Page, date: string, name: string): Locator =>
  day(page, date).getByRole('button', { name, exact: true });

/** How many items called `name` are on the calendar in the given days, across the months they fall in. */
async function countOnCalendar(page: Page, name: string, dates: string[]): Promise<number> {
  let total = 0;
  for (const month of [...new Set(dates.map(monthOf))]) {
    await page.goto(calendarUrl(month));
    total += await page.locator(`[data-date^="${month}-"]`).getByRole('button', { name, exact: true }).count();
  }
  return total;
}

async function openAssign(page: Page, program: string) {
  await page.getByRole('button', { name: 'Assign program' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign a program' });
  await dialog.getByLabel('Program').selectOption({ label: program });
  return dialog;
}

async function assignFromNextMonday(page: Page, program: string): Promise<string> {
  await page.goto(calendarUrl());
  const monday = nextMonday(await browserToday(page));
  const dialog = await openAssign(page, program);
  await expect(dialog.getByLabel('Start date')).toHaveValue(monday);
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(dialog).toBeHidden();
  return monday;
}

test('assign a program from next Monday; a double click still copies it once', async ({ page }) => {
  const workout = `Full body ${unique()}`;
  const program = `Strength 2wk ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  await createProgram(page, program, 2, [
    { week: 1, day: 1, workoutName: workout },
    { week: 2, day: 3, workoutName: workout },
  ]);

  // The client's name on the Clients list opens their calendar.
  await page.goto('/clients');
  await page.getByRole('table', { name: 'Clients' }).getByRole('link', { name: 'Demo Client', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Demo Client' })).toBeVisible();

  const monday = nextMonday(await browserToday(page));
  const end = addDays(monday, 13);
  const dialog = await openAssign(page, program);
  await expect(dialog.getByLabel('Start date')).toHaveValue(monday);
  await expect(dialog.getByText(`2 workouts from ${fmt(monday, true)} to ${fmt(end, true)}`)).toBeVisible();

  // A start date in the past is allowed, with a note.
  await dialog.getByLabel('Start date').fill(addDays(monday, -14));
  await expect(dialog.getByText('This start date is in the past. Workouts before today will show as missed later.')).toBeVisible();
  await dialog.getByLabel('Start date').fill(monday);
  await expect(dialog.getByText('This start date is in the past.', { exact: false })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Assign', exact: true }).dblclick();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('region', { name: 'Assigned programs' }).getByText(`${program} · ${fmt(monday, false)} – ${fmt(end, false)}`)).toBeVisible();

  await page.goto(calendarUrl(monthOf(monday)));
  await expect(item(page, monday, workout)).toHaveCount(1);
  await page.goto(calendarUrl(monthOf(addDays(monday, 9))));
  await expect(item(page, addDays(monday, 9), workout)).toHaveCount(1);
  expect(await countOnCalendar(page, workout, [monday, addDays(monday, 9)])).toBe(2);

  const { count } = await admin.from('program_assignments').select('id', { count: 'exact', head: true }).eq('program_name', program);
  expect(count).toBe(1);
});

test("editing the library workout leaves the client's copy alone, and the other way round", async ({ page }) => {
  const workout = `Upper ${unique()}`;
  const program = `Copy check ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  await createProgram(page, program, 1, [{ week: 1, day: 1, workoutName: workout }]);
  const monday = await assignFromNextMonday(page, program);

  const { data: library } = await admin.from('workouts').select('id').eq('name', workout).is('client_id', null).single();
  const weight = (p: Page) => setRow(p, 'Barbell Squat', 'set 1').getByLabel(/^Weight/);

  // The library template goes to 100.
  await page.goto(`/workouts/${library!.id}`);
  await weight(page).fill('100');
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // The client's copy still says 60.
  await page.goto(calendarUrl(monthOf(monday)));
  await day(page, monday).getByRole('button', { name: `Options for ${workout}`, exact: true }).click();
  await day(page, monday).getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/workouts/[0-9a-f-]{36}$`));
  await expect(page.getByText("Demo Client's workout for", { exact: false })).toBeVisible();
  await expect(weight(page)).toHaveValue('60');

  // Editing the copy to 70 leaves the library at 100.
  await weight(page).fill('70');
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(weight(page)).toHaveValue('70');
  await page.goto(`/workouts/${library!.id}`);
  await expect(weight(page)).toHaveValue('100');

  // The back link returns to the calendar.
  await page.goBack();
  await page.getByRole('link', { name: /Demo Client's calendar/ }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}\\?month=${monthOf(monday)}$`));
});

/** Drag with real pointer events: press, move in 10 steps (past the 4 px activation distance), release. */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('Drag source or target is not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function addFromLibrary(page: Page, date: string, workout: string) {
  await day(page, date).getByRole('button', { name: `Add a workout to ${fmt(date, true)}`, exact: true }).click();
  const picker = page.getByRole('dialog', { name: `Add a workout to ${fmt(date, true)}` });
  await picker.getByLabel('Search workouts').fill(workout);
  await picker.getByRole('button', { name: workout, exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(item(page, date, workout)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
}

test('"+" on a day adds one library workout', async ({ page }) => {
  const workout = `Single ${unique()}`;
  created.workouts.push(workout);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  const month = nextMonth(monthOf(await browserToday(page)));
  const date = `${month}-11`;

  await page.goto(calendarUrl(month));
  await addFromLibrary(page, date, workout);
  await page.reload();
  await expect(item(page, date, workout)).toHaveCount(1);

  const { data } = await admin.from('workouts').select('assignment_id, source_workout_id, scheduled_on').eq('name', workout).eq('client_id', clientId);
  expect(data).toHaveLength(1);
  expect(data![0]!.assignment_id).toBeNull();
  expect(data![0]!.source_workout_id).not.toBeNull();
  expect(data![0]!.scheduled_on).toBe(date);
});

test('move one item with "Move to…", drag another, then delete one', async ({ page }) => {
  const first = `Mover ${unique()}`;
  const second = `Dragger ${unique()}`;
  created.workouts.push(first, second);
  await signInAsCoach(page);
  await createWorkout(page, first);
  await createWorkout(page, second);
  const month = nextMonth(monthOf(await browserToday(page)));
  const d = (n: number) => `${month}-${String(n).padStart(2, '0')}`;

  await page.goto(calendarUrl(month));
  await addFromLibrary(page, d(10), first);
  await addFromLibrary(page, d(12), second);

  // Move to… (the keyboard path).
  await day(page, d(10)).getByRole('button', { name: `Options for ${first}`, exact: true }).click();
  await day(page, d(10)).getByRole('menuitem', { name: 'Move to…' }).click();
  const move = page.getByRole('dialog', { name: `Move ${first}` });
  await move.getByLabel('Date').fill(d(15));
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toBeHidden();
  await expect(item(page, d(15), first)).toBeVisible();
  await expect(item(page, d(10), first)).toHaveCount(0);

  // Drag. A tall window keeps both days on screen, so dnd-kit doesn't auto-scroll mid-drag.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await drag(page, item(page, d(12), second), day(page, d(20)));
  await expect(item(page, d(20), second)).toBeVisible();
  await expect(item(page, d(12), second)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();

  await page.reload();
  await expect(item(page, d(15), first)).toBeVisible();
  await expect(item(page, d(20), second)).toBeVisible();
  await expect(item(page, d(10), first)).toHaveCount(0);
  await expect(item(page, d(12), second)).toHaveCount(0);

  // Delete (asks first).
  await day(page, d(15)).getByRole('button', { name: `Options for ${first}`, exact: true }).click();
  await day(page, d(15)).getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: `Delete ${first}?` });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(item(page, d(15), first)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
  await page.reload();
  await expect(item(page, d(15), first)).toHaveCount(0);
  await expect(item(page, d(20), second)).toBeVisible();
});

test('remove a program from the calendar from today on', async ({ page }) => {
  const workout = `Legs ${unique()}`;
  const program = `Remove me ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  await createProgram(page, program, 1, [
    { week: 1, day: 1, workoutName: workout },
    { week: 1, day: 3, workoutName: workout },
  ]);
  const monday = await assignFromNextMonday(page, program);
  const today = await browserToday(page);

  const panel = page.getByRole('region', { name: 'Assigned programs' });
  await panel.getByRole('button', { name: `Remove ${program} from calendar`, exact: true }).click();
  const confirm = page.getByRole('dialog', { name: `Remove ${program} from the calendar?` });
  await expect(confirm.getByText(`Removes 2 upcoming workouts from ${fmt(today, true)}. Past workouts stay.`)).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(panel.getByText(program)).toHaveCount(0);

  expect(await countOnCalendar(page, workout, [monday, addDays(monday, 2)])).toBe(0);
  const { count } = await admin.from('workouts').select('id', { count: 'exact', head: true }).eq('name', workout).eq('client_id', clientId);
  expect(count).toBe(0);
});

test('"today" is the browser\'s own date (Auckland)', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'Pacific/Auckland' });
  const page = await context.newPage();
  try {
    await signInAsCoach(page);
    await page.goto(calendarUrl());
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
    const today = page.locator('[aria-current="date"]');
    await expect(today).toHaveCount(1);
    await expect(today).toHaveAttribute('data-date', expected);
  } finally {
    await context.close();
  }
});

test('a coach gets a 404 for someone who is not their client', async ({ page }) => {
  await signInAsCoach(page);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const coachId = data.users.find((u) => u.email === 'coach@demo.local')!.id;
  for (const id of [randomUUID(), coachId, 'not-a-uuid']) {
    const res = await page.goto(`/clients/${id}`);
    expect(res?.status(), id).toBe(404);
  }
  const res = await page.goto(`/clients/${clientId}/workouts/${randomUUID()}`);
  expect(res?.status()).toBe(404);
});
