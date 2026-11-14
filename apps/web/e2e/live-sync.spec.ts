import { expect, test, type Page } from '@playwright/test';
import { createProgram, createWorkout, programCell, serviceClient, signInAsCoach, dateField } from './helpers';

// Program Live Sync (spec: docs/superpowers/specs/2026-11-06-live-sync-design.md): with the switch on, program edits
// reach the calendars of clients already on the program.

const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; programs: string[]; users: string[] } = { workouts: [], programs: [], users: [] };

test.afterAll(async () => {
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  if (created.programs.length) {
    await admin.from('program_assignments').delete().in('program_name', created.programs);
    await admin.from('programs').delete().in('name', created.programs);
  }
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts);
});

/* Plain YYYY-MM-DD maths (UTC only). */
const MS_DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(toMs(d) + n * MS_DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(toMs(d)).getUTCDay() || 7;
const browserToday = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
const liveSwitch = (page: Page) => page.getByRole('switch', { name: 'Live Sync' });
const status = (page: Page) => page.getByTestId('live-sync-status');

async function freshClient(): Promise<string> {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  const user = await admin.auth.admin.createUser({
    email: `live-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: 'Live', last_name: `Sync${unique()}` },
  });
  if (user.error) throw user.error;
  created.users.push(user.data.user.id);
  const member = await admin.from('workspace_members').insert({ workspace_id: ws.data.id, user_id: user.data.user.id, role: 'client' });
  if (member.error) throw member.error;
  return user.data.user.id;
}

async function addSlot(page: Page, week: number, day: number, workoutName: string) {
  await page.getByRole('button', { name: `Add a workout to week ${week}, day ${day}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Add a workout to Week ${week}, Day ${day}` });
  await dialog.getByLabel('Search workouts').fill(workoutName);
  await dialog.getByRole('button', { name: workoutName, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(programCell(page, week, day).getByRole('button', { name: workoutName, exact: true })).toBeVisible();
  await saved(page);
}

/** The calendar item for `name` on `date` (opening that date's month). */
async function calendarItem(page: Page, client: string, date: string, name: string) {
  await page.goto(`/clients/${client}/training?month=${date.slice(0, 7)}`);
  return page.locator(`[data-date="${date}"]`).locator('li').filter({ hasText: name });
}

test('Live Sync on: program edits reach the client calendar, tagged Live; off: they do not', async ({ page }) => {
  test.slow();
  const id = unique();
  const [legs, push, program] = [`LS Legs ${id}`, `LS Push ${id}`, `LS Program ${id}`];
  created.workouts.push(legs, push);
  created.programs.push(program);
  const client = await freshClient();

  await signInAsCoach(page);
  await createWorkout(page, legs);
  await createWorkout(page, push);
  await createProgram(page, program, 2, [{ week: 1, day: 1, workoutName: legs }]);
  const programUrl = page.url();

  // New programs start with Live Sync on. Turn it off for now.
  await expect(liveSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(status(page)).toContainText('Live Sync on · 0 clients');
  await liveSwitch(page).click();
  await expect(liveSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await expect(status(page)).toHaveText('Live Sync off');

  // Assign it from next Monday.
  await page.goto(`/clients/${client}/training`);
  const today = await browserToday(page);
  const monday = addDays(today, 8 - weekday(today));
  await page.getByRole('button', { name: 'Assign program' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign a program' });
  await dialog.getByRole('radio', { name: program, exact: true }).check();
  await expect((await dateField(dialog, 'Start date'))).toHaveValue(monday);
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(await calendarItem(page, client, monday, legs)).toHaveCount(1);

  // Off: adding a workout to the program doesn't reach the client.
  await page.goto(programUrl);
  await addSlot(page, 1, 3, push);
  await expect(await calendarItem(page, client, addDays(monday, 2), push)).toHaveCount(0);

  // On: the catch-up sync adds it.
  await page.goto(programUrl);
  await liveSwitch(page).click();
  await expect(liveSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await expect(status(page)).toContainText(/Live Sync on · 1 client · last synced (just now|1 min ago)/);
  const caughtUp = await calendarItem(page, client, addDays(monday, 2), push);
  await expect(caughtUp).toHaveCount(1);
  await expect(caughtUp).toContainText('Live');

  // An edit while on reaches the client straight away.
  await page.goto(programUrl);
  await addSlot(page, 2, 2, legs);
  const added = await calendarItem(page, client, addDays(monday, 8), legs);
  await expect(added).toHaveCount(1);
  await expect(added).toContainText(`${program} · Live`);
});
