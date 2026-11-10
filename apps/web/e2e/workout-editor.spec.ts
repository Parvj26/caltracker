import { expect, test, type Page } from '@playwright/test';
import { createWorkout, pickSetType, serviceClient, setRow, signInAsCoach } from './helpers';

// The workout editor redesign (coach feedback, approved mockup): tap the name to swap, icon buttons in the header,
// one-letter set types (W / N / F / D), one rep count, × to remove a set, "+ Set (copies last set)", no per-set notes.
// Uses only exercises in the CI fixture.

const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: string[] = [];

test.afterAll(async () => {
  if (created.length) await admin.from('workouts').delete().in('name', created).is('client_id', null);
});

const workoutId = (page: Page) => page.url().split('/').pop()!;

async function savedSets(id: string) {
  const { data, error } = await admin
    .from('workout_sets')
    .select('position, set_type, to_failure, target_reps_min, target_reps_max, target_weight_kg, rest_seconds')
    .eq('workout_id', id)
    .order('position');
  if (error) throw error;
  return data;
}

test('tapping the exercise name swaps it; the header has icon buttons only', async ({ page }) => {
  const name = `Editor swap ${unique()}`;
  created.push(name);
  await signInAsCoach(page);
  await createWorkout(page, name);

  const squat = page.getByRole('region', { name: 'Barbell Squat' });
  for (const old of ['Swap exercise', '+ Substitute', 'Remove', '↑', '↓', 'Copy set 1 to all sets', 'Fill', '+ Drop']) {
    await expect(squat.getByRole('button', { name: old, exact: true })).toHaveCount(0);
  }
  for (const [label, tip] of [
    ['Add a substitute for Barbell Squat', 'Add substitute'],
    ['Move Barbell Squat up', 'Move up'],
    ['Move Barbell Squat down', 'Move down'],
    ['Remove Barbell Squat', 'Remove exercise'],
  ] as const) {
    const button = squat.getByRole('button', { name: label, exact: true });
    await expect(button).toHaveAttribute('title', tip);
    const box = (await button.boundingBox())!;
    expect(Math.round(box.width)).toBe(48);
    expect(Math.round(box.height)).toBe(48);
  }

  await squat.getByRole('button', { name: 'Swap exercise: Barbell Squat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Swap Barbell Squat' });
  await dialog.getByLabel('Search exercises').fill('Barbell Deadlift');
  await dialog.getByRole('option', { name: 'Barbell Deadlift', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add to workout', exact: true }).click();
  await expect(dialog).toBeHidden();
  const deadlift = page.getByRole('region', { name: 'Barbell Deadlift' });
  await expect(deadlift.getByRole('button', { name: 'Swap exercise: Barbell Deadlift', exact: true })).toBeVisible();
  // The targets carried over (both use weight and reps).
  await expect(setRow(page, 'Barbell Deadlift', 'set 1').getByLabel('Reps', { exact: true })).toHaveValue('8');
});

test('set types, + Set copies the last set, × removes a set, and no per-set notes', async ({ page }) => {
  const name = `Editor sets ${unique()}`;
  created.push(name);
  await signInAsCoach(page);
  await createWorkout(page, name);
  const squat = page.getByRole('region', { name: 'Barbell Squat' });

  // No note box on any set; the exercise note stays at the bottom.
  await expect(squat.getByRole('textbox', { name: 'Note', exact: true })).toHaveCount(0);
  await expect(squat.getByPlaceholder('Note', { exact: true })).toHaveCount(0);
  await expect(squat.getByPlaceholder('Exercise note (optional)')).toBeVisible();

  // The letter opens a menu of all four types, the current one ticked.
  const set2 = setRow(page, 'Barbell Squat', 'set 2');
  await set2.getByRole('button', { name: 'Set type: Normal', exact: true }).click();
  const menu = set2.getByRole('menu');
  await expect(menu.getByRole('menuitemradio')).toHaveText(['WWarm-up', 'NNormal✓', 'FFailure', 'DDrop set']);
  await expect(menu.getByRole('menuitemradio', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: 'Failure', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(set2.getByRole('button', { name: 'Set type: Failure', exact: true })).toBeVisible();
  // An F set with no reps typed shows "max"; the coach may still type a number.
  await set2.getByLabel('Reps', { exact: true }).fill('');
  await expect(set2.getByLabel('Reps', { exact: true })).toHaveAttribute('placeholder', 'max');

  // The first set can't be a drop.
  const set1 = setRow(page, 'Barbell Squat', 'set 1');
  await set1.getByRole('button', { name: 'Set type: Normal' }).click();
  await expect(set1.getByRole('menuitemradio', { name: 'Drop set' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(set1.getByRole('menu')).toBeHidden();

  // Set 3 becomes a drop at less weight: indented, no rest box.
  const set3 = setRow(page, 'Barbell Squat', 'set 3');
  await pickSetType(set3, 'Drop set');
  await set3.getByLabel('Weight (kg)').fill('40');
  await expect(set3.getByLabel(/^Rest/)).toHaveCount(0);
  const indent = async (row: typeof set1) => (await row.boundingBox())!.x;
  expect(await indent(set3)).toBeGreaterThan(await indent(set1));

  // + Set copies the last set: a drop at 40 kg x 8.
  await squat.getByRole('button', { name: 'Add a set to Barbell Squat', exact: true }).click();
  const set4 = setRow(page, 'Barbell Squat', 'set 4');
  await expect(set4.getByRole('button', { name: 'Set type: Drop set' })).toBeVisible();
  await expect(set4.getByLabel('Weight (kg)')).toHaveValue('40');
  await expect(set4.getByLabel('Reps', { exact: true })).toHaveValue('8');

  // × removes one set; the rows renumber.
  await set1.getByRole('button', { name: 'Remove set 1', exact: true }).click();
  await expect(setRow(page, 'Barbell Squat', 'set 4')).toHaveCount(0);
  await expect(setRow(page, 'Barbell Squat', 'set 1').getByRole('button', { name: 'Set type: Failure' })).toBeVisible();

  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('status').filter({ hasText: '✓ Saved' })).toBeVisible();
  const sets = await savedSets(workoutId(page));
  expect(sets.map((s) => [s.set_type, s.to_failure, s.target_reps_max, Number(s.target_weight_kg)])).toEqual([
    ['normal', true, null, 60],
    ['drop', false, 8, 40],
    ['drop', false, 8, 40],
  ]);

  await page.reload();
  await expect(setRow(page, 'Barbell Squat', 'set 1').getByRole('button', { name: 'Set type: Failure' })).toBeVisible();
  await expect(setRow(page, 'Barbell Squat', 'set 3').getByRole('button', { name: 'Set type: Drop set' })).toBeVisible();
});

test('a saved rep range shows and saves as its top number', async ({ page }) => {
  const name = `Editor range ${unique()}`;
  created.push(name);
  await signInAsCoach(page);
  await createWorkout(page, name);
  const id = workoutId(page);
  // A workout saved before the redesign, with 10–12 reps on every set.
  const { error } = await admin.from('workout_sets').update({ target_reps_min: 10, target_reps_max: 12 }).eq('workout_id', id);
  expect(error).toBeNull();

  await page.reload();
  for (const n of [1, 2, 3]) {
    await expect(setRow(page, 'Barbell Squat', `set ${n}`).getByLabel('Reps', { exact: true })).toHaveValue('12');
  }
  await expect(page.getByLabel('Min reps')).toHaveCount(0);
  // Showing a range as one number isn't an unsaved change by itself.
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByRole('status').filter({ hasText: '✓ Saved' })).toBeVisible();
  const sets = await savedSets(id);
  expect(sets.map((s) => [s.target_reps_min, s.target_reps_max])).toEqual([
    [12, 12],
    [12, 12],
    [12, 12],
  ]);
});
