import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProgram, createWorkout, programCell, serviceClient, signInAsCoach } from './helpers';

// Program builder (phase 2 Task 15): a weekly grid of library workouts.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; programs: string[] } = { workouts: [], programs: [] };

test.afterAll(async () => {
  if (created.programs.length) await admin.from('programs').delete().in('name', created.programs);
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts).is('client_id', null);
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

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();

test('build a 2-week program, drag a workout, then shrink to 1 week after a warning', async ({ page }) => {
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
  await expect(page.getByRole('columnheader', { name: 'Day 7' })).toBeVisible();

  // Drag the Week 1 Day 1 chip to Week 1 Day 4.
  const chip = programCell(page, 1, 1).getByRole('button', { name: workout, exact: true });
  await drag(page, chip, programCell(page, 1, 4));
  await expect(programCell(page, 1, 4).getByRole('button', { name: workout, exact: true })).toBeVisible();
  await expect(programCell(page, 1, 1).getByRole('button', { name: workout, exact: true })).toHaveCount(0);
  await saved(page);

  await page.reload();
  await expect(programCell(page, 1, 4).getByRole('button', { name: workout, exact: true })).toBeVisible();
  await expect(programCell(page, 2, 3).getByRole('button', { name: workout, exact: true })).toBeVisible();
  await expect(programCell(page, 1, 1).getByRole('button', { name: workout, exact: true })).toHaveCount(0);

  // Shrinking to 1 week would remove the Week 2 workout: the coach is told first.
  await page.getByLabel('Weeks', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save details' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove workouts?' });
  await expect(confirm).toContainText("Week 2 has 1 workout. It'll be removed from this program.");
  await confirm.getByRole('button', { name: 'Remove and save' }).click();
  await expect(confirm).toBeHidden();
  await expect(programCell(page, 2, 3)).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel('Weeks', { exact: true })).toHaveValue('1');
  await expect(programCell(page, 2, 3)).toHaveCount(0);
  await expect(programCell(page, 1, 4).getByRole('button', { name: workout, exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Program weeks' }).getByRole('button', { name: workout, exact: true })).toHaveCount(1);

  // The list shows it with its length and number of workouts.
  await page.goto('/programs');
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: program, exact: true }) });
  await expect(row.getByRole('cell').nth(1)).toHaveText('1');
  await expect(row.getByRole('cell').nth(2)).toHaveText('1');
});

test('remove a workout from the grid with its menu', async ({ page }) => {
  const workout = `Upper ${unique()}`;
  const program = `Hypertrophy ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  await createProgram(page, program, 1, [
    { week: 1, day: 2, workoutName: workout },
    { week: 1, day: 5, workoutName: workout },
  ]);

  const cell = programCell(page, 1, 2);
  await cell.getByRole('button', { name: `Options for ${workout}`, exact: true }).click();
  await cell.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(cell.getByRole('button', { name: workout, exact: true })).toHaveCount(0);
  await saved(page);

  // Move to… is the menu's other path (no dragging needed).
  await programCell(page, 1, 5).getByRole('button', { name: `Options for ${workout}`, exact: true }).click();
  await programCell(page, 1, 5).getByRole('menuitem', { name: 'Move to…' }).click();
  const move = page.getByRole('dialog', { name: `Move ${workout}` });
  await move.getByLabel('Day').selectOption('7');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toBeHidden();
  await expect(programCell(page, 1, 7).getByRole('button', { name: workout, exact: true })).toBeVisible();
  await saved(page);

  await page.reload();
  await expect(programCell(page, 1, 2).getByRole('button', { name: workout, exact: true })).toHaveCount(0);
  await expect(programCell(page, 1, 5).getByRole('button', { name: workout, exact: true })).toHaveCount(0);
  await expect(programCell(page, 1, 7).getByRole('button', { name: workout, exact: true })).toBeVisible();
});

test('a change that fails to save is undone and the coach is told', async ({ page }) => {
  const workout = `Lower ${unique()}`;
  const program = `Rollback ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  await createProgram(page, program, 1, [{ week: 1, day: 1, workoutName: workout }]);

  // Server actions are POSTs to the page: make them fail.
  await page.route(/\/programs\/[0-9a-f-]{36}$/, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 500, body: 'down' }) : route.continue(),
  );
  const cell = programCell(page, 1, 1);
  await cell.getByRole('button', { name: `Options for ${workout}`, exact: true }).click();
  await cell.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.getByText("Couldn't save that change, so it was undone. Please try again.")).toBeVisible();
  await expect(cell.getByRole('button', { name: workout, exact: true })).toBeVisible();

  await page.unroute(/\/programs\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(programCell(page, 1, 1).getByRole('button', { name: workout, exact: true })).toBeVisible();
});

test('the Programs page explains what a program is', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/programs');
  await expect(
    page.getByText('A program arranges workouts into weeks. Assign it to a client and every workout lands on their calendar.'),
  ).toBeVisible();
});

test('a change refused because the app was just updated asks the coach to reload', async ({ page }) => {
  const workout = `Stale ${unique()}`;
  const program = `Stale deploy ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  await createProgram(page, program, 1, [{ week: 1, day: 1, workoutName: workout }]);

  // What Next 16 answers when a page from before a deploy calls a server action the new deploy doesn't have.
  const url = /\/programs\/[0-9a-f-]{36}$/;
  await page.route(url, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 409,
          headers: { 'content-type': 'text/plain', 'x-nextjs-action-not-found': '1' },
          body: 'Server Action unavailable.',
        })
      : route.continue(),
  );
  const cell = programCell(page, 1, 1);
  await cell.getByRole('button', { name: `Options for ${workout}`, exact: true }).click();
  await cell.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.getByText('CalTracker was just updated. Reload the page to continue.')).toBeVisible();
  await expect(page.getByText("Couldn't save that change", { exact: false })).toHaveCount(0);
  await expect(cell.getByRole('button', { name: workout, exact: true })).toBeVisible();

  await page.unroute(url);
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByText('CalTracker was just updated.', { exact: false })).toHaveCount(0);
  await expect(programCell(page, 1, 1).getByRole('button', { name: workout, exact: true })).toBeVisible();
});

test.describe('a coach with an empty library', () => {
  const email = `empty-coach-${unique()}@example.test`;
  const password = 'empty-coach-password-123';
  let coachId: string | undefined;
  let workspaceId: string | undefined;

  test.beforeAll(async () => {
    const user = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: 'Empty', last_name: 'Coach' },
    });
    if (user.error) throw user.error;
    coachId = user.data.user.id;
    const ws = await admin.from('workspaces').insert({ name: `Empty Gym ${unique()}` }).select('id').single();
    if (ws.error) throw ws.error;
    workspaceId = ws.data.id;
    const member = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: coachId, role: 'owner' });
    if (member.error) throw member.error;
  });

  test.afterAll(async () => {
    if (workspaceId) {
      await admin.from('programs').delete().eq('workspace_id', workspaceId);
      await admin.from('workspaces').delete().eq('id', workspaceId);
    }
    if (coachId) await admin.auth.admin.deleteUser(coachId);
  });

  test('sees "No workouts yet" and a link to create one, in the library and the "+" picker', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/home$/);

    await page.goto('/programs/new');
    await page.getByLabel('Program name').fill(`First program ${unique()}`);
    await page.getByLabel('Weeks', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Create program' }).click();
    await expect(page).toHaveURL(/\/programs\/[0-9a-f-]{36}$/);

    const library = page.getByRole('region', { name: 'Library' });
    await expect(library.getByText('No workouts yet. A program is built from workouts in your library.')).toBeVisible();
    await expect(library.getByRole('link', { name: 'Create a workout' })).toHaveAttribute('href', '/workouts/new');

    await page.getByRole('button', { name: 'Add a workout to week 1, day 1', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Add a workout to Week 1, Day 1' });
    await expect(picker.getByText('No workouts yet. A program is built from workouts in your library.')).toBeVisible();
    await expect(picker.getByRole('link', { name: 'Create a workout' })).toHaveAttribute('href', '/workouts/new');
    await picker.getByRole('link', { name: 'Create a workout' }).click();
    await expect(page).toHaveURL(/\/workouts\/new$/);
  });
});
