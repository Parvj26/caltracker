import { devices, expect, test, type Page } from '@playwright/test';
import { demoWorkspace } from './assign-helpers';
import { serviceClient, setRow, signInAsCoach } from './helpers';

// The workout builder on an iPhone (phone audit P4, approved mockup B): each exercise folds to one line, one open at a
// time; ⋯ moves, swaps and deletes; + Exercise and Save sit in a bar at the top; − / + change reps and weight.
// iPhone 13 sizes and touch, on Chromium like the rest of the suite (the browser can't be chosen per spec).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
test.use(iphone);

const admin = serviceClient();
const EXERCISES = [
  'Barbell Squat',
  'Barbell Deadlift',
  'Dumbbell Romanian Deadlift',
  'Dumbbell Walking Lunge',
  'Kettlebell Upright Row',
  'Hip Thrust Machine',
  'Cable Crossover',
  'Dumbbell Bicep Curl',
];
const created: string[] = [];

test.afterAll(async () => {
  if (created.length) await admin.from('workouts').delete().in('id', created);
});

/** A library workout with the 8 exercises above, each 3 sets of 8 at 20 kg with 1:30 rest. */
async function seedWorkout(name: string): Promise<string> {
  const workspaceId = await demoWorkspace(admin);
  const w = await admin.from('workouts').insert({ workspace_id: workspaceId, name }).select('id').single();
  if (w.error) throw w.error;
  created.push(w.data.id);
  for (const [position, exName] of EXERCISES.entries()) {
    const blk = await admin
      .from('workout_blocks')
      .insert({ workout_id: w.data.id, workspace_id: workspaceId, position, kind: 'straight' })
      .select('id')
      .single();
    if (blk.error) throw blk.error;
    const ex = await admin.from('exercises').select('id').eq('name', exName).is('workspace_id', null).limit(1).single();
    if (ex.error) throw ex.error;
    const we = await admin
      .from('workout_exercises')
      .insert({ block_id: blk.data.id, workout_id: w.data.id, workspace_id: workspaceId, position: 0, exercise_id: ex.data.id })
      .select('id')
      .single();
    if (we.error) throw we.error;
    const sets = await admin.from('workout_sets').insert(
      [0, 1, 2].map((p) => ({
        workout_exercise_id: we.data.id,
        workout_id: w.data.id,
        workspace_id: workspaceId,
        position: p,
        target_reps_min: 8,
        target_reps_max: 8,
        target_weight_kg: 20,
        rest_seconds: 90,
      })),
    );
    if (sets.error) throw sets.error;
  }
  return w.data.id;
}

/** The fold line of one exercise ("Barbell Squat: 3 × 8 @ 20 kg · rest 1:30"). */
const fold = (page: Page, exercise: string) => page.getByRole('button', { name: new RegExp(`^${exercise}: `) });

async function openSeeded(page: Page): Promise<string> {
  const id = await seedWorkout(`Phone builder ${Date.now()}${Math.floor(Math.random() * 1000)}`);
  await signInAsCoach(page);
  await page.goto(`/workouts/${id}`);
  await expect(fold(page, EXERCISES[0]!)).toBeVisible();
  return id;
}

async function saveAndWait(page: Page) {
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
}

async function savedOrder(id: string): Promise<string[]> {
  const { data, error } = await admin
    .from('workout_blocks')
    .select('position, workout_exercises(exercises(name))')
    .eq('workout_id', id)
    .order('position');
  if (error) throw error;
  return data.map((b) => (b.workout_exercises as unknown as { exercises: { name: string } }[])[0]!.exercises.name);
}

async function savedSets(id: string, exercise: string) {
  const { data, error } = await admin
    .from('workout_sets')
    .select('position, target_reps_max, target_weight_kg, workout_exercises!inner(exercises!inner(name))')
    .eq('workout_id', id)
    .eq('workout_exercises.exercises.name', exercise)
    .order('position');
  if (error) throw error;
  return data.map((s) => ({ reps: s.target_reps_max, kg: Number(s.target_weight_kg) }));
}

test('an 8-exercise workout opens folded, one line each, and fits in under 2.5 screens', async ({ page }) => {
  await openSeeded(page);
  for (const ex of EXERCISES) {
    await expect(fold(page, ex)).toHaveAttribute('aria-expanded', 'false');
    await expect(fold(page, ex)).toContainText('3 × 8 @ 20 kg · rest 1:30');
  }
  // Nothing of a folded exercise's sets is on the page.
  await expect(page.getByRole('group', { name: `${EXERCISES[0]} set 1` })).toHaveCount(0);
  const { height, screen } = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, screen: window.innerHeight }));
  expect(height / screen).toBeLessThan(2.5);
  // No sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // The header: Assign is the one button; Duplicate and Delete wait behind ⋯.
  await expect(page.getByRole('button', { name: 'Duplicate workout' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete workout' })).toBeHidden();
  await page.getByRole('button', { name: /^More for Phone builder/ }).click();
  await expect(page.getByRole('button', { name: 'Duplicate workout' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete workout' })).toBeVisible();
});

test('editing exercise 8 opens only it, and the top bar keeps Save in reach', async ({ page }) => {
  const id = await openSeeded(page);
  const last = EXERCISES[7]!;
  await fold(page, EXERCISES[0]!).click();
  await expect(fold(page, EXERCISES[0]!)).toHaveAttribute('aria-expanded', 'true');
  await fold(page, last).click();
  // One open at a time.
  await expect(fold(page, last)).toHaveAttribute('aria-expanded', 'true');
  await expect(fold(page, EXERCISES[0]!)).toHaveAttribute('aria-expanded', 'false');

  const weight = setRow(page, last, 'set 2').getByLabel('Weight (kg)');
  await weight.fill('22.5');
  await expect(weight).toHaveCSS('font-size', '16px');
  // The save bar is stuck at the top of the screen, not under the keyboard.
  const save = page.getByRole('button', { name: 'Save workout' });
  const box = (await save.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeLessThan(120);
  await expect(page.getByRole('button', { name: '+ Exercise', exact: true })).toBeInViewport();
  await saveAndWait(page);
  expect(await savedSets(id, last)).toEqual([
    { reps: 8, kg: 20 },
    { reps: 8, kg: 22.5 },
    { reps: 8, kg: 20 },
  ]);
  // The fold line follows the change.
  await expect(fold(page, last)).toContainText('3 × 8 @ 20–22.5 kg');
});

test('⋯ Move to top puts exercise 8 first in one tap, and Move to… picks a place', async ({ page }) => {
  const id = await openSeeded(page);
  const last = EXERCISES[7]!;
  await page.getByRole('button', { name: `More for ${last}` }).click();
  const menu = page.getByRole('menu', { name: `More for ${last}` });
  for (const item of ['Move to top', 'Move to…', 'Swap exercise', 'Notes', 'Delete exercise']) {
    await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await menu.getByRole('menuitem', { name: 'Move to top' }).click();
  const folds = page.locator('[aria-controls][aria-expanded]').filter({ hasText: '3 × 8' });
  await expect(folds.first()).toHaveAccessibleName(new RegExp(`^${last}: `));

  // Move to…: put Barbell Squat (now second) in the last place.
  await page.getByRole('button', { name: `More for ${EXERCISES[0]}` }).click();
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  const dialog = page.getByRole('dialog', { name: `Move ${EXERCISES[0]} to…` });
  await dialog.getByRole('button', { name: EXERCISES[6]!, exact: true }).click();
  await expect(dialog).toBeHidden();

  await saveAndWait(page);
  expect(await savedOrder(id)).toEqual([last, ...EXERCISES.slice(1, 7), EXERCISES[0]]);
});

test('− and + change reps and weight, and typing still works', async ({ page }) => {
  const id = await openSeeded(page);
  const ex = EXERCISES[0]!;
  await fold(page, ex).click();
  const row = setRow(page, ex, 'set 1');
  const plus = row.getByRole('button', { name: 'More reps' });
  for (const b of [plus, row.getByRole('button', { name: 'Less weight' }), row.getByRole('button', { name: 'Remove set 1' })]) {
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect((await row.getByRole('button', { name: 'Remove set 1' }).boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await plus.click();
  await plus.click();
  await expect(row.getByLabel('Reps', { exact: true })).toHaveValue('10');
  await row.getByRole('button', { name: 'Less weight' }).click();
  await expect(row.getByLabel('Weight (kg)')).toHaveValue('17.5');
  await expect(row.getByLabel('Reps', { exact: true })).toHaveAttribute('inputmode', 'numeric');
  await expect(row.getByLabel('Weight (kg)')).toHaveAttribute('inputmode', 'decimal');
  await setRow(page, ex, 'set 2').getByLabel('Reps', { exact: true }).fill('6');
  await saveAndWait(page);
  expect(await savedSets(id, ex)).toEqual([
    { reps: 10, kg: 17.5 },
    { reps: 6, kg: 20 },
    { reps: 8, kg: 20 },
  ]);
});

test.describe('iPhone SE (375 pt)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('a set box fits "102.5", a tap selects its number, and the fold line names the empty sets', async ({ page }) => {
    await openSeeded(page);
    const ex = EXERCISES[0]!;
    await fold(page, ex).click();
    const row = setRow(page, ex, 'set 1');
    const weight = row.getByLabel('Weight (kg)');
    const reps = row.getByLabel('Reps', { exact: true });
    await weight.fill('102.5');
    const clipped = (l: typeof weight) => l.evaluate((el: HTMLInputElement) => el.scrollWidth > el.clientWidth);
    expect(await clipped(weight)).toBe(false);
    // The "reps" placeholder fits too.
    await reps.fill('');
    expect(await clipped(reps)).toBe(false);
    await reps.fill('10');
    await reps.blur();

    // Tapping a filled box selects it, so typing replaces the number (10 → 6, not 106).
    await reps.click();
    await page.keyboard.type('6');
    await expect(reps).toHaveValue('6');

    // Sets 2 and 3 emptied: the fold line counts only the filled one.
    for (const n of [2, 3]) {
      await setRow(page, ex, `set ${n}`).getByLabel('Weight (kg)').fill('');
      await setRow(page, ex, `set ${n}`).getByLabel('Reps', { exact: true }).fill('');
    }
    await expect(fold(page, ex)).toHaveAccessibleName(`${ex}: 1 × 6 @ 102.5 kg + 2 empty sets · rest 1:30`);
  });

  test('a new exercise scrolls into view, and the name error goes once a name is typed', async ({ page }) => {
    await openSeeded(page);
    const name = page.getByLabel('Workout name');
    await expect(name).toHaveAttribute('autocomplete', 'off');
    await expect(name).toHaveAttribute('spellcheck', 'false');
    await name.fill('');
    await page.getByRole('button', { name: 'Save workout' }).click();
    await expect(page.getByText('Enter a name.')).toBeVisible();
    await name.fill('Leg day');
    await expect(page.getByText('Enter a name.')).toBeHidden();

    await page.getByRole('button', { name: '+ Exercise', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add exercises' });
    const option = dialog.getByRole('option').first();
    const picked = (await option.getAttribute('aria-label'))!;
    await option.click();
    await dialog.getByRole('button', { name: 'Add 1 exercise' }).click();
    await expect(dialog).toBeHidden();
    // The 9th exercise, added at the end and opened, is on screen (the page doesn't jump to the top).
    const added = page.getByRole('button', { name: new RegExp(`^${picked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `) }).last();
    await expect(added).toHaveAttribute('aria-expanded', 'true');
    await expect(added).toBeInViewport();
  });
});
