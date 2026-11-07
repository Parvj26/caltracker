import { expect, test, type Locator } from '@playwright/test';
import { serviceClient } from './helpers';
import {
  addDays,
  browserToday,
  clickCounter,
  deleteCoach,
  newCoachWithClient,
  seedLibraryWorkout,
  seedProgram,
  signInAs,
} from './assign-helpers';

// Recent and Most used: every workout picker opens with the coach's last-used workouts and their most used ones,
// before the full list; the program picker starts on the coach's last-assigned program; and "+ Add workout" saves
// on the tap (no confirm step), with Undo.
// Clicks to add a recent workout with "+ Add workout": before 3 plus typing a search (open, pick, Add); now 2 (open,
// tap it under Recent).
const admin = serviceClient();
type Coach = Awaited<ReturnType<typeof newCoachWithClient>>;
const coaches: Coach[] = [];

test.afterAll(async () => {
  for (const c of coaches) await deleteCoach(admin, c);
});

/**
 * A coach whose history is: A..H each added once (A newest), and I added three times before that. So Recent is
 * A..H, Most used is I, and J (never used) is only under All workouts.
 */
async function coachWithHistory() {
  const coach = await newCoachWithClient(admin, 'Recent');
  coaches.push(coach);
  const names = 'ABCDEFGHIJ'.split('').map((l) => `Lib ${l}`);
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = await seedLibraryWorkout(admin, coach.workspaceId, n);
  const used = ['Lib I', 'Lib I', 'Lib I', 'Lib H', 'Lib G', 'Lib F', 'Lib E', 'Lib D', 'Lib C', 'Lib B', 'Lib A']; // oldest first
  const start = Date.now() - used.length * 60_000;
  const rows = used.map((n, i) => ({
    workspace_id: coach.workspaceId,
    client_id: coach.clientId,
    scheduled_on: addDays(new Date().toISOString().slice(0, 10), -30 + i),
    name: n,
    source_workout_id: ids[n]!,
    created_by: coach.coachId,
    created_at: new Date(start + i * 60_000).toISOString(),
  }));
  const ins = await admin.from('workouts').insert(rows);
  if (ins.error) throw ins.error;
  return { coach, ids };
}

const names = (list: Locator) => list.getByRole('button').allTextContents();

test('+ Add workout opens with Recent and Most used, and one tap on a recent workout adds it, with Undo', async ({ page }) => {
  const { coach, ids } = await coachWithHistory();
  await signInAs(page, coach.email);
  await page.goto(`/clients/${coach.clientId}/training`);
  const today = await browserToday(page);

  const clicks = clickCounter();
  await clicks.on(page.getByRole('button', { name: '+ Add workout', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Add a workout' });
  const recent = dialog.getByRole('region', { name: 'Recent' });
  await expect.poll(() => names(recent)).toEqual(['Lib A', 'Lib B', 'Lib C', 'Lib D', 'Lib E', 'Lib F', 'Lib G', 'Lib H']);
  expect(await names(dialog.getByRole('region', { name: 'Most used' }))).toEqual(['Lib I']);
  expect(await names(dialog.getByRole('region', { name: 'All workouts' }))).toEqual(['Lib J']);
  await expect(dialog.getByLabel('Date')).toHaveValue(today);

  await clicks.on(recent.getByRole('button', { name: 'Lib A', exact: true }));
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/^Added Lib A to /)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
  expect(clicks.count).toBe(2);
  const added = await admin.from('workouts').select('id, scheduled_on').eq('client_id', coach.clientId).eq('source_workout_id', ids['Lib A']!).eq('scheduled_on', today);
  expect(added.data).toHaveLength(1);

  // Undo takes it off again.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Removed Lib A.')).toBeVisible();
  await expect
    .poll(async () => (await admin.from('workouts').select('id').eq('client_id', coach.clientId).eq('source_workout_id', ids['Lib A']!).eq('scheduled_on', today)).data?.length)
    .toBe(0);

  // Typing searches the whole library in one list.
  await page.getByRole('button', { name: '+ Add workout', exact: true }).click();
  await dialog.getByLabel('Search workouts').fill('lib');
  await expect(dialog.getByRole('region', { name: 'Recent' })).toHaveCount(0);
  await expect(dialog.getByRole('list', { name: 'Library workouts' }).getByRole('button')).toHaveCount(10);
});

test("a day's \"+\" picker and the program grid's \"+\" also open with Recent", async ({ page }) => {
  const { coach } = await coachWithHistory();
  const programId = await seedProgram(admin, coach.workspaceId, 'Grid', 1, []);
  await signInAs(page, coach.email);
  await page.goto(`/clients/${coach.clientId}/training`);
  const today = await browserToday(page);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${today}T00:00:00Z`));
  await page.locator(`[data-date="${today}"]`).getByRole('button', { name: `Add workout to ${fmt}`, exact: true }).click();
  const picker = page.getByRole('dialog', { name: `Add a workout to ${fmt}` });
  await expect(picker.getByRole('region', { name: 'Recent' }).getByRole('button').first()).toHaveText('Lib A');
  await picker.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`/programs/${programId}`);
  await page.getByRole('button', { name: 'Add a workout to week 1, day 1', exact: true }).click();
  const grid = page.getByRole('dialog', { name: 'Add a workout to Week 1, Day 1' });
  await expect(grid.getByRole('region', { name: 'Recent' }).getByRole('button').first()).toHaveText('Lib A');
  await expect(grid.getByRole('region', { name: 'Most used' }).getByRole('button')).toHaveText(['Lib I']);
});

test("the program picker starts on the coach's most recently assigned program", async ({ page }) => {
  const coach = await newCoachWithClient(admin, 'LastProg');
  coaches.push(coach);
  const w = await seedLibraryWorkout(admin, coach.workspaceId, 'Day one');
  await seedProgram(admin, coach.workspaceId, 'Aardvark block', 1, [{ week: 1, day: 1, workoutId: w }]);
  const zebra = await seedProgram(admin, coach.workspaceId, 'Zebra block', 1, [{ week: 1, day: 1, workoutId: w }]);
  // This coach last assigned Zebra (to the client, long ago).
  const a = await admin.from('program_assignments').insert({
    workspace_id: coach.workspaceId, client_id: coach.clientId, program_id: zebra, program_name: 'Zebra block', weeks: 1,
    start_date: '2026-01-05', created_by: coach.coachId,
  });
  expect(a.error).toBeNull();

  await signInAs(page, coach.email);
  await page.goto(`/clients/${coach.clientId}/training`);
  await page.getByRole('button', { name: 'Assign program', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Assign a program' }).getByLabel('Program')).toHaveValue(zebra);

});
