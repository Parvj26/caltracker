import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { addDays, formatPlainDay } from '@caltracker/shared';
import { browserToday, demoWorkspace, freshClient, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import { seedSectionedWorkout, serviceClient, signInAsCoach } from './helpers';

// Round 2 mockups #2 and #5: the session logger's unticked-sets warning and Discard confirm, and one phone pattern
// for pop-up windows (full screen, ✕ at the top, buttons stuck to the bottom, quick days first, no keyboard on open).
// iPhone SE size with touch. Each test makes its own client, so nothing else is on their calendar, and removes it.

const admin = serviceClient();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
const SE = { width: 375, height: 667 };
const created = { clients: [] as string[], workouts: [] as string[], programs: [] as string[] };
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});
test.afterAll(async () => {
  if (created.workouts.length) {
    await admin.from('workout_logs').delete().in('workout_id', created.workouts);
    await admin.from('workouts').delete().in('id', created.workouts);
  }
  if (created.programs.length) {
    await admin.from('program_assignments').delete().in('program_id', created.programs);
    await admin.from('programs').delete().in('id', created.programs);
  }
  // Deleting a client takes their calendar workouts and logs with them.
  for (const id of created.clients) await admin.auth.admin.deleteUser(id);
});

test.use({ ...iphone13, viewport: SE });

async function newClient(): Promise<string> {
  const id = await freshClient(admin, workspaceId, 'Pia', `Pop${unique()}`);
  created.clients.push(id);
  return id;
}

/** The control is fully on screen, with no scrolling. */
async function expectOnScreen(page: Page, control: Locator) {
  const box = (await control.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y, 'top on screen').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'bottom on screen').toBeLessThanOrEqual(viewport.height);
}

/** Today's two-exercise workout (Barbell Squat, Bench Press; 2 sets each), opened in the logger and started. */
async function startSession(page: Page): Promise<{ client: string; workoutId: string }> {
  const client = await newClient();
  await signInAsCoach(page);
  const today = await browserToday(page);
  const workoutId = await seedSectionedWorkout(admin, {
    workspaceId,
    clientId: client,
    name: `Logger ${unique()}`,
    scheduledOn: today,
    sections: [],
    blocks: [{ exercises: ['Barbell Squat'] }, { exercises: ['Bench Press'] }],
  });
  created.workouts.push(workoutId);
  await page.goto(`/clients/${client}/log/${workoutId}`);
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
  return { client, workoutId };
}

async function tickFirstSet(page: Page) {
  const tick = page.getByRole('button', { name: 'Done: Barbell Squat Set 1 of 2' });
  await tick.click();
  await expect(tick).toHaveAttribute('aria-pressed', 'true');
}

const logOf = async (workoutId: string) => {
  const log = await admin.from('workout_logs').select('id, status').eq('workout_id', workoutId).single();
  if (log.error) throw log.error;
  const sets = await admin.from('log_sets').select('completed_at').eq('log_id', log.data.id);
  return { status: log.data.status, ticked: (sets.data ?? []).filter((s) => s.completed_at !== null).length };
};

test.describe('session logger', () => {
  test('Finish with unticked sets warns, lists them, and Mark all done and finish ticks every set', async ({ page }) => {
    test.slow();
    const { client, workoutId } = await startSession(page);
    await tickFirstSet(page);
    await page.getByRole('button', { name: 'Finish session' }).click();

    const sheet = page.getByRole('dialog', { name: "3 sets aren't ticked" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('listitem')).toHaveText([/Barbell Squat\s*1 of 2 ticked/, /Bench Press\s*0 of 2 ticked/]);
    const markAll = sheet.getByRole('button', { name: 'Mark all done and finish' });
    for (const b of [markAll, sheet.getByRole('button', { name: 'Finish anyway (1 set)' }), sheet.getByRole('button', { name: 'Keep logging' })]) {
      await expectOnScreen(page, b);
    }
    await markAll.click();
    await expect(page).toHaveURL(new RegExp(`/clients/${client}/logs/[0-9a-f-]{36}(\\?award=1)?$`));
    await expect.poll(() => logOf(workoutId)).toEqual({ status: 'completed', ticked: 4 });
  });

  test('Finish anyway keeps only the ticked sets', async ({ page }) => {
    test.slow();
    const { client, workoutId } = await startSession(page);
    await tickFirstSet(page);
    await page.getByRole('button', { name: 'Finish session' }).click();
    await page.getByRole('dialog', { name: "3 sets aren't ticked" }).getByRole('button', { name: 'Finish anyway (1 set)' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${client}/logs/[0-9a-f-]{36}(\\?award=1)?$`));
    await expect.poll(() => logOf(workoutId)).toEqual({ status: 'completed', ticked: 1 });
  });

  test('Keep logging closes the warning and the session carries on', async ({ page }) => {
    test.slow();
    const { client, workoutId } = await startSession(page);
    await tickFirstSet(page);
    await page.getByRole('button', { name: 'Finish session' }).click();
    const sheet = page.getByRole('dialog', { name: "3 sets aren't ticked" });
    await sheet.getByRole('button', { name: 'Keep logging' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/clients/${client}/log/${workoutId}$`));
    await expect(page.getByRole('button', { name: 'Finish session' })).toBeEnabled();
    expect((await logOf(workoutId)).status).toBe('in_progress');
  });

  test('Cancel session… sits apart at the bottom and asks "Discard this session?" first', async ({ page }) => {
    test.slow();
    const { client, workoutId } = await startSession(page);
    await tickFirstSet(page);
    const finish = page.getByRole('button', { name: 'Finish session' });
    const handBack = page.getByRole('button', { name: /^Hand back to/ });
    const cancel = page.getByRole('button', { name: 'Cancel session…' });
    // Finish is the standard black primary button, and Cancel is red and well below Hand back.
    expect(await finish.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(18, 18, 18)');
    expect(await cancel.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(179, 38, 30)');
    const below = (await cancel.boundingBox())!.y - ((await handBack.boundingBox())!.y + (await handBack.boundingBox())!.height);
    expect(below).toBeGreaterThanOrEqual(24);

    await cancel.click();
    const sheet = page.getByRole('dialog', { name: 'Discard this session?' });
    await expect(sheet.getByText('The 1 set ticked and the notes are deleted')).toBeVisible();
    // Keep logging first: nothing is thrown away.
    await sheet.getByRole('button', { name: 'Keep logging' }).click();
    await expect(sheet).toBeHidden();
    expect((await logOf(workoutId)).status).toBe('in_progress');

    await cancel.click();
    await expectOnScreen(page, sheet.getByRole('button', { name: 'Discard session' }));
    await sheet.getByRole('button', { name: 'Discard session' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${client}/training`));
    await expect.poll(async () => (await logOf(workoutId)).status).toBe('discarded');
  });
});

test.describe('pop-up windows', () => {
  test('Move to…: full screen, quick days first, and Tomorrow moves it to tomorrow', async ({ page }) => {
    test.slow();
    const client = await newClient();
    await signInAsCoach(page);
    const today = await browserToday(page);
    const tomorrow = addDays(today, 1);
    const name = `Move quick ${unique()}`;
    created.workouts.push(await seedSectionedWorkout(admin, { workspaceId, clientId: client, name, scheduledOn: today, sections: [], blocks: [{ exercises: ['Barbell Squat'] }] }));
    await page.goto(`/clients/${client}/training?view=2w`);
    const cell = page.locator(`[data-date="${today}"]`);
    await cell.getByRole('button', { name: `Options for ${name}`, exact: true }).click();
    await cell.getByRole('menuitem', { name: 'Move to…' }).click();

    const dialog = page.getByRole('dialog', { name: `Move ${name}` });
    // No keyboard and no date picker on open: the window itself has focus.
    await expect(dialog).toBeFocused();
    const box = (await dialog.boundingBox())!;
    expect(Math.round(box.height)).toBe(SE.height);
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
    // Its own day (today) is not offered; Tomorrow is picked to start with.
    await expect(dialog.getByRole('button', { name: /^Today/ })).toHaveCount(0);
    const tomorrowChip = dialog.getByRole('button', { name: /^Tomorrow/ });
    await expect(tomorrowChip).toHaveAttribute('aria-pressed', 'true');
    await tomorrowChip.click();
    const move = dialog.getByRole('button', { name: `Move to ${formatPlainDay(tomorrow)}` });
    await expectOnScreen(page, move);
    await expectOnScreen(page, dialog.getByRole('button', { name: 'Cancel' }));
    await move.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Moved ${name} to ${formatPlainDay(tomorrow)}.`)).toBeVisible();
    await expect
      .poll(async () => (await admin.from('workouts').select('scheduled_on').eq('client_id', client).eq('name', name).single()).data?.scheduled_on)
      .toBe(tomorrow);
  });

  test('Assign workout: client list with avatars and status, no keyboard on open, buttons on screen', async ({ page }) => {
    test.slow();
    const client = await newClient();
    const name = `Phone pop assign ${unique()}`;
    created.workouts.push(await seedLibraryWorkout(admin, workspaceId, name));
    await signInAsCoach(page);
    await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
    await page.getByRole('button', { name: `Assign ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Assign ${name}` });
    await expect(dialog.getByRole('list', { name: 'Clients' })).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog.getByLabel('Search clients')).not.toBeFocused();

    const last = (await admin.auth.admin.getUserById(client)).data.user!.user_metadata.last_name as string;
    await dialog.getByLabel('Search clients').fill(last);
    const row = dialog.getByRole('listitem').filter({ hasText: last });
    await expect(row.getByText('PP', { exact: true })).toBeVisible();
    await expect(row.getByText('Nothing planned')).toBeVisible();

    await expect(dialog.getByRole('button', { name: /^Today/ })).toHaveAttribute('aria-pressed', 'true');
    for (const b of [dialog.getByRole('button', { name: 'Cancel' }), dialog.getByRole('button', { name: 'Assign', exact: true })]) await expectOnScreen(page, b);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('Add a workout and Assign a program: full screen, ✕ on top, quick days, buttons on screen', async ({ page }) => {
    test.slow();
    const client = await newClient();
    const program = `Phone pop program ${unique()}`;
    created.programs.push(await seedProgram(admin, workspaceId, program, 4, []));
    await signInAsCoach(page);
    const today = await browserToday(page);
    await page.goto(`/clients/${client}/training`);

    await page.getByRole('button', { name: '+ Add workout' }).click();
    const add = page.getByRole('dialog', { name: 'Add a workout' });
    await expect(add).toBeFocused();
    expect(Math.round((await add.boundingBox())!.height)).toBe(SE.height);
    await expect(add.getByRole('button', { name: /^Today/ })).toHaveAttribute('aria-pressed', 'true');
    await expectOnScreen(page, add.getByRole('button', { name: 'Cancel' }));
    await add.getByRole('button', { name: 'Close' }).click();
    await expect(add).toBeHidden();

    await page.getByRole('button', { name: 'Assign program' }).first().click();
    const assign = page.getByRole('dialog', { name: 'Assign a program' });
    await expect(assign).toBeFocused();
    await assign.getByRole('radio', { name: program, exact: true }).check();
    // A program starts next Monday by default: the Next Mon quick day (or Tomorrow on a Sunday).
    const nextMon = addDays(today, 8 - (((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1));
    await expect(assign.getByRole('button', { name: nextMon === addDays(today, 1) ? /^Tomorrow/ : /^Next Mon/ })).toHaveAttribute('aria-pressed', 'true');
    await assign.getByRole('button', { name: 'Pick a date…' }).click();
    await expect(assign.getByLabel('Start date', { exact: true })).toHaveValue(nextMon);
    for (const b of [assign.getByRole('button', { name: 'Cancel' }), assign.getByRole('button', { name: 'Assign', exact: true })]) await expectOnScreen(page, b);
  });
});
