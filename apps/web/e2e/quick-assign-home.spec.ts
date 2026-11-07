import { expect, test, type Locator } from '@playwright/test';
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

// Home's quick Assign: every client row has Assign, which opens a Workout / Program dialog on Home itself.
// Before: a workout took 5 clicks and two page loads (Open, Training, + Add workout, pick, Add); a program 3 clicks
// and a page load, and only from Program ending / Nothing planned rows. Now a workout is 2 clicks (Assign, pick),
// a program 3 (Assign, Program, Assign), with no page load.
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

async function expandGroup(group: Locator) {
  await expect(group).toBeVisible();
  const showAll = group.getByRole('button', { name: /^Show all \d+$/ });
  if (await showAll.count()) await showAll.click();
}

test("a workout from a Today's clients row in 2 clicks, on the client's next free day, with Undo", async ({ page }) => {
  const last = `Quick${unique()}`;
  const clientId = await freshClient(admin, workspaceId, 'Quinn', last);
  created.users.push(clientId);
  const lib = `Home lib ${unique()}`;
  created.workouts.push(lib);
  const libId = await seedLibraryWorkout(admin, workspaceId, lib);

  await signInAsCoach(page);
  const today = await browserToday(page);
  // Today is taken, so the next free day is tomorrow.
  const busy = `Today ${unique()}`;
  created.workouts.push(busy);
  expect((await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: clientId, scheduled_on: today, name: busy })).error).toBeNull();

  await page.goto('/home');
  const row = page.locator('#today li').filter({ hasText: `Quinn ${last}` });
  const clicks = clickCounter();
  await clicks.on(row.getByRole('button', { name: `Assign to Quinn ${last}`, exact: true }));
  const dialog = page.getByRole('dialog', { name: `Assign to Quinn ${last}` });
  await expect(page).toHaveURL(/\/home$/);
  await expect(dialog.getByRole('tab', { name: 'Workout' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByLabel('Date')).toHaveValue(addDays(today, 1));
  await dialog.getByLabel('Search workouts').fill(lib);
  await clicks.on(dialog.getByRole('button', { name: lib, exact: true }));
  await expect(dialog).toBeHidden();
  const toast = page.getByText(new RegExp(`^Added ${lib} to .+ for Quinn ${last}\\.$`));
  await expect(toast).toBeVisible();
  expect(clicks.count).toBe(2);

  const copy = await admin.from('workouts').select('id, scheduled_on, source_hash').eq('client_id', clientId).eq('source_workout_id', libId);
  expect(copy.data).toEqual([expect.objectContaining({ scheduled_on: addDays(today, 1) })]);
  expect(copy.data![0]!.source_hash).toBeTruthy();

  // Undo removes it again.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Removed it again.')).toBeVisible();
  const after = await admin.from('workouts').select('id').eq('client_id', clientId).eq('source_workout_id', libId);
  expect(after.data).toEqual([]);
});

test('a program from a Nothing planned row in 3 clicks, starting next Monday', async ({ page }) => {
  const last = `Prog${unique()}`;
  const clientId = await freshClient(admin, workspaceId, 'Pia', last);
  created.users.push(clientId);
  const lib = `Home day ${unique()}`;
  const program = `Home prog ${unique()}`;
  created.workouts.push(lib);
  created.programs.push(program);
  const libId = await seedLibraryWorkout(admin, workspaceId, lib);
  const programId = await seedProgram(admin, workspaceId, program, 1, [
    { week: 1, day: 1, workoutId: libId },
    { week: 1, day: 4, workoutId: libId },
  ]);

  await signInAsCoach(page);
  await page.goto('/home');
  const monday = nextMonday(await browserToday(page));
  const group = page.getByRole('region', { name: /^Nothing planned/ });
  await expandGroup(group);
  const clicks = clickCounter();
  await clicks.on(group.locator('li').filter({ hasText: last }).getByRole('button', { name: `Assign to Pia ${last}` }));
  const dialog = page.getByRole('dialog', { name: `Assign to Pia ${last}` });
  await clicks.on(dialog.getByRole('tab', { name: 'Program' }));
  // Picking from the list is part of choosing, not an extra step (part 3 makes the last-used program the default).
  await dialog.getByRole('combobox', { name: 'Program' }).selectOption({ label: program });
  await expect(dialog.getByLabel('Start date')).toHaveValue(monday);
  await expect(dialog.getByText(/^2 workouts from /)).toBeVisible();
  await clicks.on(dialog.getByRole('button', { name: 'Assign', exact: true }));
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Assigned ${program} to Pia ${last}: 2 workouts added.`)).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
  expect(clicks.count).toBe(3);

  const a = await admin.from('program_assignments').select('start_date').eq('client_id', clientId).eq('program_id', programId);
  expect(a.data).toEqual([{ start_date: monday }]);
});

test('client search on Home lands on Training', async ({ page }) => {
  const last = `Find${unique()}`;
  const clientId = await freshClient(admin, workspaceId, 'Fay', last);
  created.users.push(clientId);
  await signInAsCoach(page);
  await page.goto('/home');
  await page.getByRole('combobox', { name: 'Find a client' }).fill(last);
  await page.getByRole('option', { name: new RegExp(`Fay ${last}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/training$`));
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();
});
