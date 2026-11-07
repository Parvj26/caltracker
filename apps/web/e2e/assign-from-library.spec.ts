import { expect, test } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';
import {
  addDays,
  browserToday,
  clickCounter,
  demoWorkspace,
  freshClient,
  nextMonday,
  seedLibraryWorkout,
  seedProgram,
  unique,
} from './assign-helpers';

// Assign from the library: a workout or program goes onto several clients' calendars from one dialog. Before, each
// client took 5 clicks (open the client, Training, + Add workout, pick, Add): 15 for three clients. Now it is
// Assign, a tick per client, and Assign: 5 for three.
const admin = serviceClient();
const created = { users: [] as string[], workouts: [] as string[], programs: [] as string[] };
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  if (created.programs.length) {
    await admin.from('program_assignments').delete().in('program_name', created.programs);
    await admin.from('programs').delete().in('name', created.programs);
  }
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts);
});

async function clients(n: number, tag: string) {
  const last = `${tag}${unique()}`;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await freshClient(admin, workspaceId, `C${i + 1}`, last));
  created.users.push(...ids);
  return { last, ids, names: ids.map((_, i) => `C${i + 1} ${last}`) };
}

test('assign a library workout to three clients from the Workouts list in 5 clicks', async ({ page }) => {
  const name = `Lib push ${unique()}`;
  created.workouts.push(name);
  const workoutId = await seedLibraryWorkout(admin, workspaceId, name);
  const { last, ids, names } = await clients(3, 'Lib');

  await signInAsCoach(page);
  await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
  const today = await browserToday(page);
  const clicks = clickCounter();

  await clicks.on(page.getByRole('button', { name: `Assign ${name}`, exact: true }));
  const dialog = page.getByRole('dialog', { name: `Assign ${name}` });
  await expect(dialog.getByLabel('Date')).toHaveValue(today);
  // Search narrows the list (typing isn't a click).
  await dialog.getByLabel('Search clients').fill(last);
  for (const n of names) await clicks.on(dialog.getByRole('checkbox', { name: n, exact: true }));
  await clicks.on(dialog.getByRole('button', { name: 'Assign to 3 clients', exact: true }));
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Assigned ${name} to 3 clients.`)).toBeVisible();
  expect(clicks.count).toBe(5);

  // One copy per client, on today, made by copy_workout: a single workout (no program day), with the library
  // content's hash recorded, and not customised.
  const copies = await admin
    .from('workouts')
    .select('client_id, scheduled_on, assignment_id, planned_on, source_hash, customised_at')
    .eq('source_workout_id', workoutId)
    .not('client_id', 'is', null);
  expect(copies.error).toBeNull();
  expect(copies.data!.map((c) => c.client_id).sort()).toEqual([...ids].sort());
  for (const c of copies.data!) {
    expect(c).toMatchObject({ scheduled_on: today, assignment_id: null, planned_on: null, customised_at: null });
    expect(c.source_hash).toBeTruthy();
  }
  // Each copy carries the workout's exercise.
  const blocks = await admin.from('workout_blocks').select('id, workouts!inner(source_workout_id)').eq('workouts.source_workout_id', workoutId);
  expect(blocks.data).toHaveLength(3);

  // It is on the client's calendar.
  await page.goto(`/clients/${ids[0]}/training`);
  await expect(page.locator(`[data-date="${today}"]`).getByRole('button', { name, exact: true })).toBeVisible();
});

test('assign a program from its page: a clash shows first, then Add alongside assigns everyone', async ({ page }) => {
  const workout = `Lib legs ${unique()}`;
  const program = `Lib block ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program);
  const workoutId = await seedLibraryWorkout(admin, workspaceId, workout);
  const programId = await seedProgram(admin, workspaceId, program, 2, [
    { week: 1, day: 1, workoutId },
    { week: 2, day: 3, workoutId },
  ]);
  const { last, ids, names } = await clients(2, 'Prog');

  await signInAsCoach(page);
  const monday = nextMonday(await browserToday(page));
  // The second client already has something on next Monday.
  const busy = `Busy ${unique()}`;
  created.workouts.push(busy);
  const taken = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: ids[1]!, scheduled_on: monday, name: busy });
  expect(taken.error).toBeNull();

  await page.goto(`/programs/${programId}`);
  const clicks = clickCounter();
  await clicks.on(page.getByRole('button', { name: 'Assign program', exact: true }));
  const dialog = page.getByRole('dialog', { name: `Assign ${program}` });
  await expect(dialog.getByLabel('Start date')).toHaveValue(monday);
  await dialog.getByLabel('Search clients').fill(last);
  await clicks.on(dialog.getByRole('button', { name: 'Select all shown', exact: true }));
  await expect(dialog.getByText('1 client already has a workout on some of these days')).toBeVisible();
  await expect(dialog.getByText(`${names[1]}:`, { exact: false })).toBeVisible();
  await clicks.on(dialog.getByRole('button', { name: 'Add alongside', exact: true }));
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Assigned ${program} to 2 clients.`)).toBeVisible();
  expect(clicks.count).toBe(3);

  for (const id of ids) {
    const a = await admin.from('program_assignments').select('id, start_date').eq('client_id', id).eq('program_id', programId);
    expect(a.data).toEqual([expect.objectContaining({ start_date: monday })]);
    // Live Sync bookkeeping: each copy stands for its program day.
    const w = await admin.from('workouts').select('scheduled_on, planned_on, source_hash').eq('assignment_id', a.data![0]!.id).order('scheduled_on');
    expect(w.data).toEqual([
      expect.objectContaining({ scheduled_on: monday, planned_on: monday }),
      expect.objectContaining({ scheduled_on: addDays(monday, 9), planned_on: addDays(monday, 9) }),
    ]);
  }
  // Nothing already there was replaced.
  const still = await admin.from('workouts').select('id').eq('client_id', ids[1]!).eq('name', busy);
  expect(still.data).toHaveLength(1);
});

test("each client's next free day: a busy client gets the first empty day", async ({ page }) => {
  const name = `Lib free ${unique()}`;
  created.workouts.push(name);
  const workoutId = await seedLibraryWorkout(admin, workspaceId, name);
  const { last, ids, names } = await clients(2, 'Free');

  await signInAsCoach(page);
  const today = await browserToday(page);
  const busy = `Busy ${unique()}`;
  created.workouts.push(busy);
  const taken = await admin.from('workouts').insert(
    [today, addDays(today, 1)].map((d) => ({ workspace_id: workspaceId, client_id: ids[0]!, scheduled_on: d, name: busy })),
  );
  expect(taken.error).toBeNull();

  await page.goto(`/workouts/${workoutId}`);
  await page.getByRole('button', { name: 'Assign workout', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Assign ${name}` });
  await dialog.getByLabel('Search clients').fill(last);
  await dialog.getByRole('checkbox', { name: names[0]!, exact: true }).click();
  await dialog.getByRole('checkbox', { name: names[1]!, exact: true }).click();
  await dialog.getByLabel("Each client's next free day").check();
  await dialog.getByRole('button', { name: 'Assign to 2 clients', exact: true }).click();
  await expect(dialog).toBeHidden();

  const copies = await admin.from('workouts').select('client_id, scheduled_on').eq('source_workout_id', workoutId);
  const dayOf = new Map(copies.data!.map((c) => [c.client_id, c.scheduled_on]));
  expect(dayOf.get(ids[0]!)).toBe(addDays(today, 2));
  expect(dayOf.get(ids[1]!)).toBe(today);
});

test('a client removed while the dialog is open is reported; the others are assigned', async ({ page }) => {
  const name = `Lib gone ${unique()}`;
  created.workouts.push(name);
  const workoutId = await seedLibraryWorkout(admin, workspaceId, name);
  const { last, ids, names } = await clients(2, 'Gone');

  await signInAsCoach(page);
  await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
  await page.getByRole('button', { name: `Assign ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Assign ${name}` });
  await dialog.getByLabel('Search clients').fill(last);
  await dialog.getByRole('button', { name: 'Select all shown', exact: true }).click();
  // The second client stops being a client before the coach presses Assign.
  const removed = await admin.from('workspace_members').delete().eq('user_id', ids[1]!).eq('workspace_id', workspaceId);
  expect(removed.error).toBeNull();
  await dialog.getByRole('button', { name: 'Assign to 2 clients', exact: true }).click();

  await expect(dialog.getByText(`Assigned ${name} to 1 of 2 clients. 1 couldn't be assigned.`)).toBeVisible();
  await expect(dialog.getByText('Assigned ✓')).toHaveCount(1);
  await expect(dialog.getByText(/may no longer be your client/)).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: names[0]!, exact: true })).toBeDisabled();
  const copies = await admin.from('workouts').select('client_id').eq('source_workout_id', workoutId);
  expect(copies.data!.map((c) => c.client_id)).toEqual([ids[0]]);
});
