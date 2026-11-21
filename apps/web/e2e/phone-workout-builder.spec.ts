import { devices, expect, test, type Page } from '@playwright/test';
import { demoWorkspace } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// The workout builder on an iPhone (Luis's builder changes, approved iPhone mockups): one row per exercise with a link
// icon between two (the superset switch); a tap opens the exercise on its own screen (sets as cards with − / +,
// Measurements as chips, + Set and Done at the bottom). The name is the title at the top; More, + Exercise and (only
// while there are unsaved changes) Save sit in the bottom bar.
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

/** The list row of one exercise ("Barbell Squat: 3 × 8 @ 20 kg · rest 1:30"). */
const row = (page: Page, exercise: string) => page.getByRole('button', { name: new RegExp(`^${exercise}: `) });

/** The full-screen editor of one exercise. */
const editor = (page: Page, exercise: string) => page.getByRole('dialog', { name: exercise, exact: true });

async function openSeeded(page: Page): Promise<string> {
  const id = await seedWorkout(`Phone builder ${Date.now()}${Math.floor(Math.random() * 1000)}`);
  await signInAsCoach(page);
  await page.goto(`/workouts/${id}`);
  await expect(row(page, EXERCISES[0]!)).toBeVisible();
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

async function savedKinds(id: string): Promise<string[]> {
  const { data, error } = await admin.from('workout_blocks').select('kind').eq('workout_id', id).order('position');
  if (error) throw error;
  return data.map((b) => b.kind);
}

test('an 8-exercise workout is one row each, with link icons, the first on screen, and More / + Exercise (+ Save when changed) at the bottom', async ({ page }) => {
  await openSeeded(page);
  // The first exercise is on the first screen, above the bottom bar (B#2).
  const firstBox = (await row(page, EXERCISES[0]!).boundingBox())!;
  const barTop = (await page.getByRole('button', { name: 'More', exact: true }).boundingBox())!.y;
  expect(firstBox.y + firstBox.height).toBeLessThan(barTop);
  // The name shows once, as the editable title; nothing to save yet, so no Save button.
  await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save workout' })).toHaveCount(0);
  for (const ex of EXERCISES) await expect(row(page, ex)).toContainText('3 × 8 @ 20 kg · rest 1:30');
  await expect(page.getByRole('button', { name: `Superset ${EXERCISES[0]} with ${EXERCISES[1]}` })).toHaveAttribute('aria-pressed', 'false');
  // No set boxes in the list, and no sideways scrolling.
  await expect(page.getByRole('group', { name: `${EXERCISES[0]} set 1` })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // A change brings Save into the bottom bar, in thumb reach while the list scrolls.
  const title = page.getByLabel('Workout name');
  await title.fill(`${await title.inputValue()} `);
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  for (const name of ['More', '+ Exercise', 'Save workout']) {
    const b = page.getByRole('button', { name, exact: true });
    await expect(b).toBeInViewport();
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // The builder has its own bottom bar, so the app's tab bar steps aside.
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeHidden();
});

test('a row opens its exercise: − / + edit a set, + Set copies it, ↑ goes to the one before, and Save keeps it', async ({ page }) => {
  const id = await openSeeded(page);
  const last = EXERCISES[7]!;
  await row(page, last).click();
  const ed = editor(page, last);
  await expect(ed.getByText('Exercise 8 of 8')).toBeVisible();
  const set2 = ed.getByRole('group', { name: `${last} set 2`, exact: true });
  // − / + show for the box being typed in (in the × spot), and never take focus from it.
  await set2.getByLabel('Weight (kg)').click();
  await set2.getByRole('button', { name: 'More weight' }).click();
  await expect(set2.getByLabel('Weight (kg)')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(set2.getByLabel('Weight (kg)')).toHaveValue('22.5');
  // 16 px or more, so Safari doesn't zoom in.
  expect(parseFloat(await set2.getByLabel('Weight (kg)').evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await ed.getByRole('button', { name: `Add a set to ${last}` }).click();
  await expect(ed.getByRole('group', { name: `${last} set 4`, exact: true }).getByLabel('Weight (kg)')).toHaveValue('20');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await ed.getByRole('button', { name: 'Previous exercise' }).click();
  await expect(editor(page, EXERCISES[6]!).getByText('Exercise 7 of 8')).toBeVisible();
  await editor(page, EXERCISES[6]!).getByRole('button', { name: 'Done' }).click();
  await expect(row(page, last)).toContainText('4 × 8 @ 20–22.5 kg');
  await saveAndWait(page);
  expect(await savedSets(id, last)).toEqual([
    { reps: 8, kg: 20 },
    { reps: 8, kg: 22.5 },
    { reps: 8, kg: 20 },
    { reps: 8, kg: 20 },
  ]);
});

test('the Rest chip off hides the rest boxes and saves no rest; it reads back off after a reload', async ({ page }) => {
  const id = await openSeeded(page);
  const ex = EXERCISES[0]!;
  await row(page, ex).click();
  const ed = editor(page, ex);
  await expect(ed.getByRole('group', { name: `${ex} set 1`, exact: true }).getByLabel('Rest (m:ss)')).toBeVisible();
  await ed.getByRole('button', { name: `Rest for ${ex}` }).click();
  await expect(ed.getByRole('button', { name: `Rest for ${ex}` })).toHaveAttribute('aria-pressed', 'false');
  await expect(ed.getByLabel('Rest (m:ss)')).toHaveCount(0);
  await expect(ed.getByText(/^Rest is off/)).toBeVisible();
  await ed.getByRole('button', { name: 'Done' }).click();
  await saveAndWait(page);
  expect(await savedRests(id, ex)).toEqual([0, 0, 0]);
  await page.reload();
  await row(page, ex).click();
  await expect(editor(page, ex).getByRole('button', { name: `Rest for ${ex}` })).toHaveAttribute('aria-pressed', 'false');
});

test('the link icon makes two exercises a superset (A1, A2) and unlinks them again', async ({ page }) => {
  const id = await openSeeded(page);
  const link = page.getByRole('button', { name: `Superset ${EXERCISES[0]} with ${EXERCISES[1]}` });
  await link.click();
  await expect(link).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, EXERCISES[0]!)).toContainText('A1');
  await expect(row(page, EXERCISES[1]!)).toContainText('A2');
  await expect(row(page, EXERCISES[2]!)).toContainText('1');
  await saveAndWait(page);
  expect((await savedKinds(id)).slice(0, 2)).toEqual(['superset', 'straight']);
  // The first goes straight on to the second, so it saves no rest.
  expect(await savedRests(id, EXERCISES[0]!)).toEqual([0, 0, 0]);

  await link.click();
  await expect(link).toHaveAttribute('aria-pressed', 'false');
  await saveAndWait(page);
  expect((await savedKinds(id)).slice(0, 2)).toEqual(['straight', 'straight']);
  expect(await savedRests(id, EXERCISES[0]!)).toEqual([90, 90, 90]);
});

test('More: Reorder moves exercise 8 to the top with the arrows, and + Section adds one', async ({ page }) => {
  const id = await openSeeded(page);
  const last = EXERCISES[7]!;
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: /^Reorder/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Reorder exercises' });
  for (let i = 0; i < 7; i++) await dialog.getByRole('button', { name: `Move ${last} up` }).click();
  await expect(dialog.getByRole('button', { name: `Move ${last} up` })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await saveAndWait(page);
  expect(await savedOrder(id)).toEqual([last, ...EXERCISES.slice(0, 7)]);

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: /^\+ Section/ }).click();
  await page.getByRole('group', { name: 'Add a section' }).getByRole('button', { name: 'Main', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Section Main', exact: true })).toBeVisible();
});

test.describe('iPhone SE (375 pt)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('a set box fits "102.5" and a tap selects its number; a new exercise starts with 1 set', async ({ page }) => {
    test.slow();
    await openSeeded(page);
    const ex = EXERCISES[0]!;
    await row(page, ex).click();
    const set1 = editor(page, ex).getByRole('group', { name: `${ex} set 1`, exact: true });
    const weight = set1.getByLabel('Weight (kg)');
    const reps = set1.getByLabel('Reps', { exact: true });
    await weight.fill('102.5');
    expect(await weight.evaluate((el: HTMLInputElement) => el.scrollWidth > el.clientWidth)).toBe(false);
    await reps.fill('10');
    await reps.blur();
    await reps.click();
    await expect.poll(() => reps.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(2);
    await page.keyboard.type('6');
    await expect(reps).toHaveValue('6');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await editor(page, ex).getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: '+ Exercise', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add exercises' });
    await dialog.getByLabel('Search exercises').fill('Pushups');
    await dialog.getByRole('option', { name: 'Pushups', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add 1 exercise' }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, 'Pushups')).toBeInViewport();
    await expect(row(page, 'Pushups')).toContainText('1 set');
  });
});
