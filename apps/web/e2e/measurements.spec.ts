import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace } from './assign-helpers';
import { pickExercise, pickSetType, serviceClient, setRow, signInAsCoach, workoutPageMenu } from './helpers';

// Measurements tab (Weight / Reps / Time per exercise), Each side and Tempo, remembering the coach's last choice,
// and the compact iPhone-width editor. Each test uses its own custom exercise, so the remembered choices it makes
// (exercise_prefs) never reach the other specs, which use the fixture exercises.

const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const workouts: string[] = [];
const exercises: string[] = [];
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  if (workouts.length) await admin.from('workouts').delete().in('name', workouts).is('client_id', null);
  if (exercises.length) {
    await admin.from('exercise_prefs').delete().in('exercise_id', exercises);
    await admin.from('exercises').delete().in('id', exercises);
  }
});

async function customExercise(label: string): Promise<string> {
  const name = `${label} ${unique()}`;
  const { data, error } = await admin
    .from('exercises')
    .insert({ workspace_id: workspaceId, source: 'custom', name, tracking_type: 'weight_reps' })
    .select('id')
    .single();
  if (error) throw error;
  exercises.push(data.id);
  return name;
}

async function newWorkout(page: Page, exercise: string): Promise<string> {
  const name = `Measure ${unique()}`;
  workouts.push(name);
  await page.goto('/workouts/new');
  await page.getByLabel('Workout name').fill(name);
  await pickExercise(page, '+ Exercise', exercise);
  return name;
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Saved')).toBeVisible();
}

const measurements = (page: Page, exercise: string) =>
  page.getByRole('region', { name: exercise }).getByRole('button', { name: /^Measurements: / });

test('the measurements tab adds and removes set columns, and keeps at least one', async ({ page }) => {
  const ex = await customExercise('Lunge');
  await signInAsCoach(page);
  await newWorkout(page, ex);
  const set1 = setRow(page, ex, 'set 1');
  await expect(set1.getByLabel('Reps', { exact: true })).toBeVisible();
  await expect(set1.getByLabel(/^Weight/)).toBeVisible();
  await expect(set1.getByLabel('Duration (m:ss)')).toHaveCount(0);

  // The old "weight and reps" label is gone: the pill says what is measured.
  await expect(page.getByText('weight and reps', { exact: true })).toHaveCount(0);
  await expect(measurements(page, ex)).toHaveText('Weight · Reps · Rest');
  await measurements(page, ex).click();
  const menu = page.getByRole('dialog', { name: `Measurements for ${ex}` });
  await expect(menu.getByText('Pick at least one. The table shows a column for each.')).toBeVisible();
  await expect(menu.getByRole('checkbox')).toHaveCount(4);

  await menu.getByRole('checkbox', { name: 'Time' }).check();
  await expect(set1.getByLabel('Duration (m:ss)')).toBeVisible();
  await expect(measurements(page, ex)).toHaveText('Weight · Reps · Time · Rest');

  await menu.getByRole('checkbox', { name: 'Reps' }).uncheck();
  await expect(set1.getByLabel('Reps', { exact: true })).toHaveCount(0);
  await expect(measurements(page, ex)).toHaveText('Weight · Time · Rest');

  await menu.getByRole('checkbox', { name: 'Weight' }).uncheck();
  // Time is the only one left: it can't be unticked.
  const time = menu.getByRole('checkbox', { name: 'Time' });
  await expect(time).toBeChecked();
  await expect(time).toBeDisabled();
  await expect(set1.getByLabel('Duration (m:ss)')).toBeVisible();
  await expect(set1.getByLabel(/^Weight/)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await set1.getByLabel('Duration (m:ss)').fill('0:45');
  await save(page);
  const id = page.url().split('/').pop()!;
  const row = await admin.from('workout_exercises').select('tracking_type').eq('workout_id', id).single();
  expect(row.data?.tracking_type).toBe('time');
  const sets = await admin.from('workout_sets').select('target_duration_s, target_reps_max').eq('workout_id', id).order('position');
  expect(sets.data?.[0]).toEqual({ target_duration_s: 45, target_reps_max: null });
});

test('Each side and Tempo save and reload; a bad tempo is refused', async ({ page }) => {
  const ex = await customExercise('Split Squat');
  await signInAsCoach(page);
  await newWorkout(page, ex);
  const region = page.getByRole('region', { name: ex });
  const tempo = region.getByLabel(`Tempo for ${ex}`);
  await expect(tempo).toHaveAttribute('placeholder', '0-0-0-0');

  await tempo.fill('3-1-1');
  await tempo.blur();
  await expect(region.getByText('Tempo is four parts like 3-1-1-0, each 0–9 or X (explosive).')).toBeVisible();
  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page.getByText('Check the highlighted fields.')).toBeVisible();

  await tempo.fill('3 - 1 - x - 0');
  await region.getByRole('checkbox', { name: `Each side for ${ex}` }).check();
  await save(page);
  await page.reload();
  const again = page.getByRole('region', { name: ex });
  await expect(again.getByLabel(`Tempo for ${ex}`)).toHaveValue('3-1-X-0');
  await expect(again.getByRole('checkbox', { name: `Each side for ${ex}` })).toBeChecked();
  const id = page.url().split('/').pop()!;
  const row = await admin.from('workout_exercises').select('each_side, tempo').eq('workout_id', id).single();
  expect(row.data).toEqual({ each_side: true, tempo: '3-1-X-0' });
});

test('the next time an exercise is added it starts with the last saved measurements and Each side', async ({ page }) => {
  const ex = await customExercise('Step Up');
  await signInAsCoach(page);
  await newWorkout(page, ex);
  await measurements(page, ex).click();
  await page.getByRole('dialog', { name: `Measurements for ${ex}` }).getByRole('checkbox', { name: 'Time' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: ex }).getByRole('checkbox', { name: `Each side for ${ex}` }).check();
  await page.getByRole('region', { name: ex }).getByLabel(`Tempo for ${ex}`).fill('2-0-2-0');
  await save(page);

  await newWorkout(page, ex);
  const region = page.getByRole('region', { name: ex });
  await expect(measurements(page, ex)).toHaveText('Weight · Reps · Time · Rest');
  await expect(region.getByRole('checkbox', { name: `Each side for ${ex}` })).toBeChecked();
  await expect(setRow(page, ex, 'set 1').getByLabel('Duration (m:ss)')).toBeVisible();
  // Tempo is not remembered.
  await expect(region.getByLabel(`Tempo for ${ex}`)).toHaveValue('');
});

test('the Rest checkbox: off hides the rest boxes and saves no rest, and reads back off; on gives 1:30 back', async ({ page }) => {
  const ex = await customExercise('Plank Row');
  await signInAsCoach(page);
  await newWorkout(page, ex);
  await page.getByRole('button', { name: `Add a set to ${ex}` }).click();
  await expect(setRow(page, ex, 'set 2').getByLabel('Rest (m:ss)')).toHaveValue('1:30');
  await measurements(page, ex).click();
  const menu = page.getByRole('dialog', { name: `Measurements for ${ex}` });
  await expect(menu.getByText("Rest off: no rest column, and no rest on the client's phone after this exercise.")).toBeVisible();
  await menu.getByRole('checkbox', { name: 'Rest' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(measurements(page, ex)).toHaveText('Weight · Reps');
  await expect(page.getByRole('region', { name: ex }).getByLabel('Rest (m:ss)')).toHaveCount(0);
  // + Set copies the last set, with no rest.
  await page.getByRole('button', { name: `Add a set to ${ex}` }).click();
  await expect(setRow(page, ex, 'set 3')).toBeVisible();
  await save(page);
  const id = page.url().split('/').pop()!;
  const rests = await admin.from('workout_sets').select('rest_seconds').eq('workout_id', id).order('position');
  expect(rests.data?.map((r) => r.rest_seconds)).toEqual([0, 0, 0]);

  await page.reload();
  await expect(measurements(page, ex)).toHaveText('Weight · Reps');
  await measurements(page, ex).click();
  await expect(menu.getByRole('checkbox', { name: 'Rest' })).not.toBeChecked();
  await menu.getByRole('checkbox', { name: 'Rest' }).check();
  await page.keyboard.press('Escape');
  for (const n of [1, 2, 3]) await expect(setRow(page, ex, `set ${n}`).getByLabel('Rest (m:ss)')).toHaveValue('1:30');
});

test('at iPhone width an exercise opens on its own screen, with chips for the measured boxes', async ({ page }) => {
  test.slow();
  const ex = await customExercise('Curl');
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsCoach(page);
  await newWorkout(page, ex);
  await page.getByRole('button', { name: new RegExp(`^${ex}: `) }).click();
  const screen = page.getByRole('dialog', { name: ex, exact: true });
  await screen.getByRole('button', { name: `Add a set to ${ex}` }).click();
  const set1 = screen.getByRole('group', { name: `${ex} set 1`, exact: true });
  const set2 = screen.getByRole('group', { name: `${ex} set 2`, exact: true });

  // Set 2 as a drop set: no rest.
  await pickSetType(set2, 'Drop set');
  await expect(set2.getByLabel('Rest (m:ss)')).toHaveCount(0);
  await expect(set1.getByLabel('Rest (m:ss)')).toBeVisible();

  // The boxes follow the chips: Weight · Reps, then with Time added a time box too.
  await expect(set1.getByLabel('Weight (kg)')).toBeVisible();
  await expect(set1.getByLabel('Duration (m:ss)')).toHaveCount(0);
  await screen.getByRole('button', { name: `Time for ${ex}` }).click();
  await expect(screen.getByRole('button', { name: `Time for ${ex}` })).toHaveAttribute('aria-pressed', 'true');
  await set1.getByLabel('Duration (m:ss)').fill('0:45');
  // The last measured chip can't be turned off.
  await screen.getByRole('button', { name: `Weight for ${ex}` }).click();
  await screen.getByRole('button', { name: `Reps for ${ex}` }).click();
  await expect(screen.getByRole('button', { name: `Time for ${ex}` })).toBeDisabled();
  for (const chip of ['Weight', 'Reps', 'Time', 'Rest']) {
    expect((await screen.getByRole('button', { name: `${chip} for ${ex}` }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  await screen.getByRole('button', { name: `More for ${ex}` }).click();
  for (const item of ['Swap exercise', 'Add substitute', 'Move to…', 'Delete exercise']) {
    await expect(screen.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await screen.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${ex}: `) })).toContainText('0:45');
});

test('duplicating a workout copies its measurements but leaves the remembered choices alone', async ({ page }) => {
  const ex = await customExercise('Hip Thrust');
  await signInAsCoach(page);
  const name = await newWorkout(page, ex);
  workouts.push(`${name} (copy)`);
  await measurements(page, ex).click();
  await page.getByRole('dialog', { name: `Measurements for ${ex}` }).getByRole('checkbox', { name: 'Time' }).check();
  await page.keyboard.press('Escape');
  await save(page);
  const exId = exercises[exercises.length - 1]!;
  // Pretend the coach has since chosen otherwise for this exercise.
  const { error } = await admin.from('exercise_prefs').update({ tracking_type: null, each_side: true }).eq('exercise_id', exId);
  if (error) throw error;

  await workoutPageMenu(page, name, 'Duplicate');
  await expect(page.getByRole('heading', { level: 1, name: `${name} (copy)` })).toBeVisible();
  await expect(measurements(page, ex)).toHaveText('Weight · Reps · Time · Rest');
  const prefs = await admin.from('exercise_prefs').select('tracking_type, each_side').eq('exercise_id', exId).single();
  expect(prefs.data).toEqual({ tracking_type: null, each_side: true });
});
