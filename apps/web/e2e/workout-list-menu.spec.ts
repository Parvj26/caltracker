import { devices, expect, test, type Page } from '@playwright/test';
import { targetFieldsFor } from '@caltracker/shared';
import { demoWorkspace, seedLibraryWorkout, seedProgram, unique } from './assign-helpers';
import { serviceClient, signInAsCoach, workoutPageMenu } from './helpers';

// The Workouts list's ⋯: Preview, Rename and Delete… on iPad and desktop (beside Assign and Duplicate); on an iPhone,
// Assign and ⋯, which opens a sheet from the bottom with Preview, Duplicate, Rename and Delete…. Delete asks first and
// refuses a workout a program still uses. Each test seeds its own workouts and removes what is left.

const admin = serviceClient();
const created = { workouts: [] as string[], programs: [] as string[], invites: [] as string[] };
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});
test.afterAll(async () => {
  if (created.invites.length) await admin.from('client_invites').delete().in('id', created.invites);
  if (created.programs.length) await admin.from('programs').delete().in('id', created.programs);
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
});

async function seed(prefix: string): Promise<{ id: string; name: string }> {
  const name = `${prefix} ${unique()}`;
  const id = await seedLibraryWorkout(admin, workspaceId, name);
  created.workouts.push(id);
  return { id, name };
}

async function openList(page: Page, name: string) {
  await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('table', { name: 'Workouts' }).getByRole('link', { name, exact: true })).toBeVisible();
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const [device, size] of [
  ['iPad portrait', { width: 820, height: 1180 }],
  ['iPad landscape', { width: 1180, height: 820 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  test(`on ${device} ⋯ sits beside Assign and Duplicate and holds Preview, Rename and Delete…`, async ({ page }) => {
    await page.setViewportSize(size);
    const w = await seed('Menu');
    await signInAsCoach(page);
    await openList(page, w.name);
    const row = page.getByRole('row').filter({ hasText: w.name });
    await expect(row.getByRole('button', { name: `Assign ${w.name}` })).toBeVisible();
    await expect(row.getByRole('button', { name: `Duplicate ${w.name}` })).toBeVisible();
    const more = row.getByRole('button', { name: `More actions for ${w.name}` });
    const box = (await more.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await more.click();
    const menu = page.getByRole('menu', { name: `More actions for ${w.name}` });
    await expect(menu.getByRole('menuitem')).toHaveText(['Preview', 'Rename', 'Delete…']);
    expect(await noSidewaysScroll(page)).toBe(true);

    // Preview: read-only, its exercises with their sets.
    await menu.getByRole('menuitem', { name: 'Preview' }).click();
    const preview = page.getByRole('dialog', { name: w.name });
    await expect(preview.getByRole('group', { name: 'Exercises' }).getByRole('listitem')).toHaveCount(1);
    await expect(preview.getByText('Barbell Squat')).toBeVisible();
    await expect(preview.getByRole('textbox')).toHaveCount(0);
    await preview.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(preview).toBeHidden();
    await expect(more).toBeFocused();
  });
}

test('Rename saves the new name and keeps the exercises', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('Rename');
  await signInAsCoach(page);
  await openList(page, w.name);
  await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename workout' });
  const field = dialog.getByRole('textbox', { name: 'Name' });
  await expect(field).toHaveValue(w.name);

  await field.fill('   ');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeVisible();

  const renamed = `${w.name} renamed`;
  await field.fill(renamed);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('table', { name: 'Workouts' }).getByRole('link', { name: renamed, exact: true })).toBeVisible();

  const row = await admin.from('workouts').select('name, workout_blocks(workout_exercises(id))').eq('id', w.id).single();
  expect(row.data?.name).toBe(renamed);
  expect(row.data?.workout_blocks.flatMap((b) => b.workout_exercises)).toHaveLength(1);
});

test('Delete… asks first, then removes an unused workout from the library', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('Delete');
  await signInAsCoach(page);
  await openList(page, w.name);
  const more = page.getByRole('button', { name: `More actions for ${w.name}` });

  // Cancel keeps it.
  await more.click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const ask = page.getByRole('alertdialog', { name: `Delete “${w.name}”?` });
  await expect(ask).toContainText("It's removed from your library. Workouts already on clients' calendars and their logged history stay.");
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toBeHidden();
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(1);

  await more.click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await ask.getByRole('button', { name: 'Delete workout' }).click();
  await expect(ask).toBeHidden();
  await expect(page.getByRole('table', { name: 'Workouts' }).getByRole('link', { name: w.name, exact: true })).toHaveCount(0);
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(0);
});

test('Delete… refuses a workout a program still uses, and the program keeps its day', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('InUse');
  const programId = await seedProgram(admin, workspaceId, `Uses ${unique()}`, 1, [{ week: 1, day: 1, workoutId: w.id }]);
  created.programs.push(programId);
  await signInAsCoach(page);
  await openList(page, w.name);
  await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const told = page.getByRole('alertdialog', { name: `“${w.name}” is still in use` });
  await expect(told).toContainText('Used in 1 program — remove it from that program first.');
  await expect(told.getByRole('button', { name: 'Delete workout' })).toHaveCount(0);
  await told.getByRole('button', { name: 'OK' }).click();
  await expect(told).toBeHidden();
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(1);
  expect((await admin.from('program_workouts').select('id').eq('program_id', programId)).data).toHaveLength(1);
});

test("the workout page's Delete workout refuses too while a program uses it, then deletes once it's free", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('PageInUse');
  const programId = await seedProgram(admin, workspaceId, `Uses ${unique()}`, 1, [
    { week: 1, day: 1, workoutId: w.id },
    { week: 1, day: 2, workoutId: w.id },
  ]);
  created.programs.push(programId);
  await signInAsCoach(page);
  await page.goto(`/workouts/${w.id}`);
  await workoutPageMenu(page, w.name, 'Delete…');
  const told = page.getByRole('alertdialog', { name: `“${w.name}” is still in use` });
  await expect(told).toContainText('Used in 1 program — remove it from that program first.');
  await expect(told.getByRole('button', { name: 'Delete workout' })).toHaveCount(0);
  await told.getByRole('button', { name: 'OK' }).click();
  await expect(told).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/workouts/${w.id}$`));
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(1);
  expect((await admin.from('program_workouts').select('id').eq('program_id', programId)).data).toHaveLength(2);

  // Out of the program, it can go.
  await admin.from('program_workouts').delete().eq('program_id', programId);
  await workoutPageMenu(page, w.name, 'Delete…');
  const ask = page.getByRole('alertdialog', { name: `Delete “${w.name}”?` });
  await ask.getByRole('button', { name: 'Delete workout' }).click();
  await expect(page).toHaveURL(/\/workouts$/);
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(0);
});

test("Delete… refuses a workout in the starting plan of an invited client who hasn't joined yet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('InvitePlan');
  const owner = await admin.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'owner').limit(1).single();
  if (owner.error) throw owner.error;
  const invite = await admin
    .from('client_invites')
    .insert({ workspace_id: workspaceId, created_by: owner.data.user_id, email: `plan-${unique()}@example.com`, first_name: 'Ivy', last_name: 'Plan', token_hash: `test-${unique()}` })
    .select('id')
    .single();
  if (invite.error) throw invite.error;
  created.invites.push(invite.data.id);
  const item = await admin.from('client_invite_plan_items').insert({ invite_id: invite.data.id, workspace_id: workspaceId, workout_id: w.id, start_on: '2099-01-01' });
  if (item.error) throw item.error;

  await signInAsCoach(page);
  await openList(page, w.name);
  await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const told = page.getByRole('alertdialog', { name: `“${w.name}” is still in use` });
  await expect(told).toContainText("It's in the starting plan of 1 invited client who hasn't joined yet — change that plan first.");
  await expect(told.getByRole('button', { name: 'Delete workout' })).toHaveCount(0);
  await told.getByRole('button', { name: 'OK' }).click();
  expect((await admin.from('client_invite_plan_items').select('id').eq('invite_id', invite.data.id)).data).toHaveLength(1);
});

test('the server refuses the delete when a program starts using the workout after the window opened', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('Race');
  await signInAsCoach(page);
  await openList(page, w.name);
  await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const ask = page.getByRole('alertdialog', { name: `Delete “${w.name}”?` });
  // The window checked and found it unused; now a program picks it up before Delete is pressed.
  await expect(ask.getByRole('button', { name: 'Delete workout' })).toBeEnabled();
  const programId = await seedProgram(admin, workspaceId, `Late ${unique()}`, 1, [{ week: 1, day: 1, workoutId: w.id }]);
  created.programs.push(programId);
  await ask.getByRole('button', { name: 'Delete workout' }).click();
  await expect(ask).toContainText("It's still used in a program or in an invited client's starting plan. Remove it from there first.");
  await expect(ask).toBeVisible();
  expect((await admin.from('workouts').select('id').eq('id', w.id)).data).toHaveLength(1);
  expect((await admin.from('program_workouts').select('id').eq('program_id', programId)).data).toHaveLength(1);
});

/** A library workout with notes, two sections, a straight block, a superset and a pick-one group. */
async function seedRichWorkout(name: string): Promise<string> {
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, name, notes: 'Warm up well.\nKeep rest short.' }).select('id').single();
  if (w.error) throw w.error;
  const upper = { id: crypto.randomUUID(), name: 'Upper' };
  const finisher = { id: crypto.randomUUID(), name: 'Finisher' };
  const blocks = [
    { kind: 'straight' as const, section: upper, exercises: ['Barbell Squat'] },
    { kind: 'superset' as const, section: upper, exercises: ['Pushups', 'Pullups'] },
    { kind: 'choice' as const, section: finisher, exercises: ['Plank', 'Bodyweight Squat'] },
  ];
  for (const [position, b] of blocks.entries()) {
    const blk = await admin
      .from('workout_blocks')
      .insert({ workout_id: w.data.id, workspace_id: workspaceId, position, kind: b.kind, section_id: b.section.id, section_name: b.section.name })
      .select('id')
      .single();
    if (blk.error) throw blk.error;
    for (const [k, exName] of b.exercises.entries()) {
      const ex = await admin.from('exercises').select('id, tracking_type').eq('name', exName).is('workspace_id', null).limit(1).single();
      if (ex.error) throw ex.error;
      const we = await admin
        .from('workout_exercises')
        .insert({ block_id: blk.data.id, workout_id: w.data.id, workspace_id: workspaceId, position: k, exercise_id: ex.data.id, note: `note ${k}` })
        .select('id')
        .single();
      if (we.error) throw we.error;
      const sets = await admin.from('workout_sets').insert(
        // Only the targets the exercise measures, as the builder saves them.
        [0, 1, 2].map((p) => {
          const fields = targetFieldsFor(ex.data.tracking_type);
          return {
            workout_exercise_id: we.data.id, workout_id: w.data.id, workspace_id: workspaceId, position: p, rest_seconds: 90,
            ...(fields.includes('reps') ? { target_reps_min: 8 + p, target_reps_max: 10 + p } : {}),
            ...(fields.includes('weight') ? { target_weight_kg: 20 + p * 5 } : {}),
            ...(fields.includes('duration') ? { target_duration_s: 30 + p * 15 } : {}),
            ...(fields.includes('distance') ? { target_distance_m: 400 } : {}),
          };
        }),
      );
      if (sets.error) throw sets.error;
    }
  }
  return w.data.id;
}

/** The workout as stored, without timestamps, in a stable order. */
async function storedTree(id: string) {
  const r = await admin
    .from('workouts')
    .select('name, notes, workout_blocks(*, workout_exercises(*, workout_sets(*)))')
    .eq('id', id)
    .single();
  if (r.error) throw r.error;
  const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.endsWith('_at')));
  const byPos = <T extends { position: number }>(xs: T[]) => [...xs].sort((a, b) => a.position - b.position);
  return {
    name: r.data.name,
    notes: r.data.notes,
    blocks: byPos(r.data.workout_blocks).map(({ workout_exercises, ...b }) => ({
      ...strip(b),
      exercises: byPos(workout_exercises).map(({ workout_sets, ...e }) => ({ ...strip(e), sets: byPos(workout_sets).map(strip) })),
    })),
  };
}

test('after Rename saves, the address has no ?sheet=, and the next pop-up opens and closes clean', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const w = await seed('Rename addr');
  await signInAsCoach(page);
  await openList(page, w.name);
  const listUrl = page.url();
  await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename workout' });
  await expect.poll(() => new URL(page.url()).searchParams.get('sheet')).toMatch(/^rename-/);
  await dialog.getByRole('textbox', { name: 'Name' }).fill(`${w.name} renamed`);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  // The save's refresh must not write the closed pop-up back into the address.
  await expect.poll(() => new URL(page.url()).searchParams.get('sheet')).toBeNull();
  await expect(page.getByRole('table', { name: 'Workouts' }).getByRole('link', { name: `${w.name} renamed`, exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('sheet')).toBeNull();

  // The next pop-up: its own ?sheet= only, and nothing left after it closes.
  await page.getByRole('button', { name: `Assign ${w.name} renamed`, exact: true }).click();
  const assign = page.getByRole('dialog', { name: `Assign ${w.name} renamed` });
  await expect(assign).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.getAll('sheet')).toEqual([`assign-workout-${w.id}`]);
  await assign.getByRole('button', { name: 'Close' }).click();
  await expect(assign).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.get('sheet')).toBeNull();
  expect(page.url()).toBe(listUrl);
  // And one Back leaves the list (no leftover steps from either pop-up).
  await page.goBack();
  await expect(page).not.toHaveURL(listUrl);
});

test('Rename keeps sections, the superset, the pick-one group, notes and sets exactly as they were', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Rich ${unique()}`;
  const id = await seedRichWorkout(name);
  created.workouts.push(id);
  const before = await storedTree(id);

  await signInAsCoach(page);
  await openList(page, name);
  // Preview groups by section and marks the superset.
  await page.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Preview' }).click();
  const preview = page.getByRole('dialog', { name });
  await expect(preview.getByRole('group', { name: 'Upper' })).toContainText('Superset');
  await expect(preview.getByRole('group', { name: 'Finisher' })).toContainText('Pick one: Plank or Bodyweight Squat');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename workout' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(`${name} v2`);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const after = await storedTree(id);
  expect(after).toEqual({ ...before, name: `${name} v2` });
});

test.describe('iPhone', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
  test.use({ ...iphone13 });

  for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
    test(`at ${viewport.width} a row shows Assign and ⋯, which opens a sheet with all four actions`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const w = await seed('Phone');
      await signInAsCoach(page);
      await openList(page, w.name);
      const row = page.getByRole('table', { name: 'Workouts' }).locator('tbody tr').filter({ hasText: w.name });
      await expect(row.getByRole('button', { name: `Assign ${w.name}` })).toBeVisible();
      await expect(row.getByRole('button', { name: `Duplicate ${w.name}` })).toBeHidden();
      const more = row.getByRole('button', { name: `More actions for ${w.name}` });
      await expect(more).toBeVisible();
      const box = (await more.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(await noSidewaysScroll(page)).toBe(true);

      await more.click();
      const sheet = page.getByRole('dialog', { name: w.name });
      const items = sheet.getByRole('button').filter({ hasNotText: 'Close' });
      await expect(items).toHaveText(['Preview', 'Duplicate', 'Rename', 'Delete…']);
      for (const item of await items.all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const sheetBox = (await sheet.boundingBox())!;
      expect(Math.round(sheetBox.y + sheetBox.height)).toBe(viewport.height);

      // Escape closes it; Rename from the sheet opens the rename window.
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await more.click();
      await sheet.getByRole('button', { name: 'Rename' }).click();
      const rename = page.getByRole('dialog', { name: 'Rename workout' });
      await expect(rename.getByRole('textbox', { name: 'Name' })).toHaveValue(w.name);
      await expect(rename.getByRole('button', { name: 'Save' })).toBeInViewport({ ratio: 1 });
      await rename.getByRole('button', { name: 'Cancel' }).click();
      await expect(rename).toBeHidden();

      // Delete… from the sheet asks first.
      await more.click();
      await sheet.getByRole('button', { name: 'Delete…' }).click();
      const ask = page.getByRole('alertdialog', { name: `Delete “${w.name}”?` });
      await expect(ask.getByRole('button', { name: 'Delete workout' })).toBeEnabled();
      await ask.getByRole('button', { name: 'Delete workout' }).click();
      await expect(ask).toBeHidden();
      await expect(row).toHaveCount(0);
    });
  }

  test('Duplicate from the sheet makes the copy and opens it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const w = await seed('PhoneCopy');
    await signInAsCoach(page);
    await openList(page, w.name);
    await page.getByRole('button', { name: `More actions for ${w.name}` }).click();
    await page.getByRole('dialog', { name: w.name }).getByRole('button', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
    const copy = page.url().split('/').pop()!;
    created.workouts.push(copy);
    expect(copy).not.toBe(w.id);
    expect((await admin.from('workouts').select('name').eq('id', copy).single()).data?.name).toBe(`${w.name} (copy)`);
  });
});
