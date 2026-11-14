import { expect, test, type Page } from '@playwright/test';
import { seedLog, seedSectionedWorkout, serviceClient, signInAsCoach, dateField } from './helpers';
import { addDays, browserToday, clickCounter, demoWorkspace, freshClient, unique } from './assign-helpers';

// Copy to… (the calendar card's ⋯ menu): a client's workout, as it is, onto another day and/or other clients.
// Before there was no way to do this short of rebuilding the workout by hand for each client. Now: ⋯, Copy to…,
// tick the other client, Copy = 4 clicks for this client next week plus one more client.
const admin = serviceClient();
const users: string[] = [];
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

async function openMenu(page: Page, clientId: string, date: string, name: string) {
  await page.goto(`/clients/${clientId}/training?view=month&from=${date}`);
  return page.locator(`[data-date="${date}"]`).getByRole('button', { name: `Options for ${name}`, exact: true });
}

test("copy a client's customised workout to next week and to another client in 4 clicks", async ({ page }) => {
  const tag = unique();
  const a = await freshClient(admin, workspaceId, 'Ada', `Copy${tag}`);
  const b = await freshClient(admin, workspaceId, 'Bea', `Copy${tag}`);
  users.push(a, b);
  await signInAsCoach(page);
  const today = await browserToday(page);
  const date = addDays(today, 1);
  const name = `Copy me ${tag}`;
  // A hand-made workout with two blocks (what the coach built for Ada), 2 sets each.
  const source = await seedSectionedWorkout(admin, {
    workspaceId, clientId: a, name, scheduledOn: date, sections: [],
    blocks: [{ exercises: ['Barbell Squat'] }, { exercises: ['Barbell Deadlift'] }],
  });

  const clicks = clickCounter();
  await clicks.on(await openMenu(page, a, date, name));
  await clicks.on(page.getByRole('menuitem', { name: 'Copy to…' }));
  const dialog = page.getByRole('dialog', { name: `Copy ${name} to…` });
  // A week later, with Ada already ticked.
  await expect((await dateField(dialog))).toHaveValue(addDays(date, 7));
  await dialog.getByLabel('Search clients').fill(`Copy${tag}`);
  await expect(dialog.getByRole('checkbox', { name: `Ada Copy${tag}`, exact: true })).toBeChecked();
  await clicks.on(dialog.getByRole('checkbox', { name: `Bea Copy${tag}`, exact: true }));
  await clicks.on(dialog.getByRole('button', { name: 'Copy to 2 clients', exact: true }));
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Copied ${name} to 2 clients.`)).toBeVisible();
  expect(clicks.count).toBe(4);

  // Ada's calendar shows the copy a week on.
  await page.goto(`/clients/${a}/training?view=month&from=${addDays(date, 7)}`);
  await expect(page.locator(`[data-date="${addDays(date, 7)}"]`).getByRole('button', { name, exact: true })).toBeVisible();

  const copies = await admin
    .from('workouts')
    .select('id, client_id, scheduled_on, assignment_id, planned_on, customised_at')
    .eq('name', name)
    .neq('id', source);
  expect(copies.data!.map((c) => c.client_id).sort()).toEqual([a, b].sort());
  for (const c of copies.data!) {
    // A separate, customised single workout: Live Sync never touches it.
    expect(c).toMatchObject({ scheduled_on: addDays(date, 7), assignment_id: null, planned_on: null });
    expect(c.customised_at).toBeTruthy();
    const sets = await admin.from('workout_sets').select('id', { count: 'exact', head: true }).eq('workout_id', c.id);
    expect(sets.count).toBe(4);
  }
});

test('a done workout copies as a fresh plan, with no log', async ({ page }) => {
  const tag = unique();
  const a = await freshClient(admin, workspaceId, 'Dee', `Done${tag}`);
  users.push(a);
  await signInAsCoach(page);
  const today = await browserToday(page);
  const date = addDays(today, -1);
  const name = `Done copy ${tag}`;
  const source = await seedSectionedWorkout(admin, { workspaceId, clientId: a, name, scheduledOn: date, sections: [], blocks: [{ exercises: ['Barbell Squat'] }] });
  await seedLog(admin, { workspaceId, clientId: a, name, plannedWorkoutId: source, startedAt: `${date}T10:00:00Z` });

  await (await openMenu(page, a, date, name)).click();
  await page.getByRole('menuitem', { name: 'Copy to…' }).click();
  const dialog = page.getByRole('dialog', { name: `Copy ${name} to…` });
  await expect((await dateField(dialog))).toHaveValue(addDays(date, 7));
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Copied ${name} to 1 client.`)).toBeVisible();

  const copy = await admin.from('workouts').select('id, scheduled_on').eq('name', name).neq('id', source).single();
  expect(copy.data?.scheduled_on).toBe(addDays(date, 7));
  const logs = await admin.from('workout_logs').select('id').eq('workout_id', copy.data!.id);
  expect(logs.data).toEqual([]);
  // Not done, so it opens for editing, unlike the original.
  await page.goto(`/clients/${a}/training?view=month&from=${addDays(date, 7)}`);
  await page.locator(`[data-date="${addDays(date, 7)}"]`).getByRole('button', { name: `Options for ${name}`, exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
});
