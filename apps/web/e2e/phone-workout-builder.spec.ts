import { devices, expect, test, type Page } from '@playwright/test';
import { demoWorkspace } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// The workout builder on an iPhone (phone audit P4, approved mockup B): each exercise folds to one line, one open at a
// time; ⋯ moves, swaps and deletes; + Exercise and Save sit in a bar at the top. Inside an open exercise each set is
// one line ("8 × 20 kg · rest 1:30"); a tap opens the set editor sheet (round 2 mockup #3, option A).
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

/** One set's line in an open exercise ("Edit Barbell Squat set 2: 8 × 20 kg, rest 1:30"). */
const setLine = (page: Page, exercise: string, n: number) =>
  page.getByRole('button', { name: new RegExp(`^Edit ${exercise} set ${n}: `) });

/** The set editor sheet, open on any set. */
const sheet = (page: Page) => page.getByRole('dialog', { name: /^Set \d+ of \d+$/ });

/** Opens set n's sheet and checks its heading. */
async function openSet(page: Page, exercise: string, n: number, of = 3) {
  await setLine(page, exercise, n).click();
  await expect(sheet(page).getByRole('heading', { name: `Set ${n} of ${of}` })).toBeVisible();
  return sheet(page);
}

async function done(page: Page) {
  await sheet(page).getByRole('button', { name: 'Done' }).click();
  await expect(sheet(page)).toBeHidden();
}

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
  return data.map((s) => ({ reps: s.target_reps_max, kg: s.target_weight_kg === null ? null : Number(s.target_weight_kg) }));
}

async function savedRests(id: string, exercise: string) {
  const { data, error } = await admin
    .from('workout_sets')
    .select('position, rest_seconds, workout_exercises!inner(exercises!inner(name))')
    .eq('workout_id', id)
    .eq('workout_exercises.exercises.name', exercise)
    .order('position');
  if (error) throw error;
  return data.map((s) => s.rest_seconds);
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

  // One line per set, no inline boxes.
  await expect(setLine(page, last, 1)).toContainText('8 × 20 kg');
  await expect(setLine(page, last, 1)).toContainText('rest 1:30');
  await expect(page.getByRole('group', { name: `${last} set 1` })).toHaveCount(0);
  const weight = (await openSet(page, last, 2)).getByLabel('Weight (kg)');
  await weight.fill('22.5');
  // 16 px or more, so Safari doesn't zoom in.
  expect(parseFloat(await weight.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await done(page);
  await expect(setLine(page, last, 2)).toContainText('8 × 22.5 kg');
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

test('a set line opens the sheet: − / +, a quick chip, ‹ › and Done edit the form, and Save keeps it', async ({ page }) => {
  test.slow();
  const id = await openSeeded(page);
  const ex = EXERCISES[0]!;
  await fold(page, ex).click();
  const s = await openSet(page, ex, 1);
  const plus = s.getByRole('button', { name: 'One more rep' });
  for (const b of [plus, s.getByRole('button', { name: 'Less weight' }), s.getByRole('button', { name: 'Next set' }), s.getByRole('button', { name: '12 reps' })]) {
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // The sheet sits at the bottom of the screen and fits on it.
  const box = (await s.boundingBox())!;
  const screen = page.viewportSize()!;
  expect(Math.abs(box.y + box.height - screen.height)).toBeLessThan(2);
  expect(box.height).toBeLessThanOrEqual(screen.height);

  await plus.click();
  await plus.click();
  await expect(s.getByLabel('Reps', { exact: true })).toHaveValue('10');
  await s.getByRole('button', { name: 'Less weight' }).click();
  await expect(s.getByLabel('Weight (kg)')).toHaveValue('17.5');
  await expect(s.getByLabel('Reps', { exact: true })).toHaveAttribute('inputmode', 'numeric');
  await expect(s.getByLabel('Weight (kg)')).toHaveAttribute('inputmode', 'decimal');
  await expect(s.getByRole('button', { name: 'Previous set' })).toBeDisabled();

  // › to set 2 without closing; a quick chip sets its reps.
  await s.getByRole('button', { name: 'Next set' }).click();
  await expect(s.getByRole('heading', { name: 'Set 2 of 3' })).toBeVisible();
  await s.getByRole('button', { name: '12 reps' }).click();
  await expect(s.getByLabel('Reps', { exact: true })).toHaveValue('12');
  await expect(s.getByRole('button', { name: '12 reps' })).toHaveAttribute('aria-pressed', 'true');
  await s.getByRole('button', { name: 'Rest 2:00' }).click();
  // ‹ back to set 1: its values are still there.
  await s.getByRole('button', { name: 'Previous set' }).click();
  await expect(s.getByRole('heading', { name: 'Set 1 of 3' })).toBeVisible();
  await expect(s.getByLabel('Reps', { exact: true })).toHaveValue('10');
  await done(page);

  // Done: the lines and the fold line show the edits.
  await expect(setLine(page, ex, 1)).toContainText('10 × 17.5 kg');
  await expect(setLine(page, ex, 2)).toContainText('12 × 20 kg');
  await expect(setLine(page, ex, 2)).toContainText('rest 2:00');
  await saveAndWait(page);
  expect(await savedSets(id, ex)).toEqual([
    { reps: 10, kg: 17.5 },
    { reps: 12, kg: 20 },
    { reps: 8, kg: 20 },
  ]);
  expect(await savedRests(id, ex)).toEqual([90, 120, 90]);
});

test('Apply to all copies one set to every set, and a set type shows as a chip', async ({ page }) => {
  test.slow();
  const id = await openSeeded(page);
  const ex = EXERCISES[1]!;
  await fold(page, ex).click();
  const s = await openSet(page, ex, 1);
  await s.getByLabel('Reps', { exact: true }).fill('15');
  await s.getByLabel('Weight (kg)').fill('30');
  await s.getByRole('checkbox', { name: 'Apply to all 3 sets' }).check();
  await done(page);
  for (const n of [1, 2, 3]) await expect(setLine(page, ex, n)).toContainText('15 × 30 kg');

  // Set 1 as a warm-up: a W chip on its line; the others stay normal (no chip).
  await openSet(page, ex, 1);
  await sheet(page).getByRole('button', { name: 'Warm-up' }).click();
  await done(page);
  await expect(setLine(page, ex, 1)).toHaveAccessibleName(`Edit ${ex} set 1: Warm-up, 15 × 30 kg, rest 1:30`);
  await expect(setLine(page, ex, 1)).toContainText('W');
  await expect(setLine(page, ex, 2)).toHaveAccessibleName(`Edit ${ex} set 2: 15 × 30 kg, rest 1:30`);

  await saveAndWait(page);
  expect(await savedSets(id, ex)).toEqual([
    { reps: 15, kg: 30 },
    { reps: 15, kg: 30 },
    { reps: 15, kg: 30 },
  ]);
});

test('on an empty set − / + start from the set before, not from 1 rep or 2.5 kg', async ({ page }) => {
  test.slow();
  await openSeeded(page);
  const ex = EXERCISES[2]!;
  await fold(page, ex).click();
  const s = await openSet(page, ex, 3);
  await s.getByLabel('Reps', { exact: true }).fill('');
  await s.getByLabel('Weight (kg)').fill('');
  await done(page);
  await expect(setLine(page, ex, 3)).toContainText('Not filled yet');

  await openSet(page, ex, 3);
  await expect(s.getByText(`${ex} · from set 2`)).toBeVisible();
  await s.getByRole('button', { name: 'One more rep' }).click();
  await expect(s.getByLabel('Reps', { exact: true })).toHaveValue('8');
  await s.getByRole('button', { name: 'More weight' }).click();
  await expect(s.getByLabel('Weight (kg)')).toHaveValue('20');
  // From there, one step at a time.
  await s.getByRole('button', { name: 'More weight' }).click();
  await expect(s.getByLabel('Weight (kg)')).toHaveValue('22.5');
  await done(page);
  await expect(setLine(page, ex, 3)).toContainText('8 × 22.5 kg');
});

test.describe('iPhone SE (375 pt)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('a set box fits "102.5", a tap selects its number, and the fold line names the empty sets', async ({ page }) => {
    // Seeds an 8-exercise workout, then edits several boxes: close to the 30 s limit.
    test.slow();
    await openSeeded(page);
    const ex = EXERCISES[0]!;
    await fold(page, ex).click();
    const s = await openSet(page, ex, 1);
    const weight = s.getByLabel('Weight (kg)');
    const reps = s.getByLabel('Reps', { exact: true });
    await weight.fill('102.5');
    const clipped = (l: typeof weight) => l.evaluate((el: HTMLInputElement) => el.scrollWidth > el.clientWidth);
    expect(await clipped(weight)).toBe(false);
    await reps.fill('10');
    await reps.blur();

    // Tapping a filled box selects it, so typing replaces the number (10 → 6, not 106).
    await reps.click();
    await page.keyboard.type('6');
    await expect(reps).toHaveValue('6');

    // Sets 2 and 3 emptied: their lines say so, and the fold line counts only the filled one.
    for (const n of [2, 3]) {
      await s.getByRole('button', { name: 'Next set' }).click();
      await expect(s.getByRole('heading', { name: `Set ${n} of 3` })).toBeVisible();
      await s.getByLabel('Weight (kg)').fill('');
      await s.getByLabel('Reps', { exact: true }).fill('');
    }
    await done(page);
    for (const n of [2, 3]) await expect(setLine(page, ex, n)).toContainText('Not filled yet');
    // No sideways scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await expect(fold(page, ex)).toHaveAccessibleName(`${ex}: 1 × 6 @ 102.5 kg + 2 empty sets · rest 1:30`);
  });

  test('a new exercise scrolls into view, and the name error goes once a name is typed', async ({ page }) => {
    // Seeds an 8-exercise workout, then edits several boxes: close to the 30 s limit.
    test.slow();
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
