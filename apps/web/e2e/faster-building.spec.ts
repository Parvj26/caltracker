import { expect, test, type Page } from '@playwright/test';
import { createProgram, createWorkout, programCell, serviceClient, setRow, signInAsCoach } from './helpers';

// Faster building (spec: docs/superpowers/specs/2026-11-06-coach-faster-building-design.md): several exercises at
// once with a set count, duplicate a workout or program, copy a program week. (Copy set 1 / fill down gave way to
// "+ Set (copies last set)" in the editor redesign: see workout-editor.spec.ts.)
// Uses only exercises in the CI fixture.

const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; programs: string[] } = { workouts: [], programs: [] };

test.afterAll(async () => {
  if (created.programs.length) await admin.from('programs').delete().in('name', created.programs);
  if (created.workouts.length) await admin.from('workouts').delete().in('name', created.workouts).is('client_id', null);
});

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();

test('add three exercises at once with 4 sets each, and save', async ({ page }) => {
  const name = `Fast build ${unique()}`;
  created.workouts.push(name);
  await signInAsCoach(page);
  await page.goto('/workouts/new');
  await page.getByLabel('Workout name').fill(name);

  // One picker, three picks, in this order, with "Sets each" raised to 4.
  await page.getByRole('button', { name: '+ Exercise', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add exercises' });
  const search = picker.getByLabel('Search exercises');
  for (const exercise of ['Pushups', 'Barbell Squat', 'Pullups']) {
    await search.fill(exercise);
    await picker.getByRole('option', { name: exercise, exact: true }).click();
  }
  const sets = picker.getByRole('group', { name: 'Sets each' });
  await expect(sets.getByRole('status')).toHaveText('3');
  await sets.getByRole('button', { name: 'More sets' }).click();
  await expect(sets.getByRole('status')).toHaveText('4');
  await picker.getByRole('button', { name: 'Add 3 exercises', exact: true }).click();
  await expect(picker).toBeHidden();

  // Block titles, top to bottom (each block is a <section> whose <header> holds its title).
  await expect(page.locator('section > header h2')).toHaveText(['Pushups', 'Barbell Squat', 'Pullups']);
  for (const n of [1, 2, 3, 4]) await expect(setRow(page, 'Barbell Squat', `set ${n}`)).toBeVisible();
  await expect(setRow(page, 'Barbell Squat', 'set 5')).toHaveCount(0);

  for (const n of [1, 2, 3, 4]) {
    const row = setRow(page, 'Barbell Squat', `set ${n}`);
    await row.getByLabel('Reps', { exact: true }).fill('5');
    await row.getByLabel('Weight (kg)').fill(n === 3 ? '110' : '100');
  }

  await page.getByRole('button', { name: 'Save workout' }).click();
  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(setRow(page, 'Barbell Squat', 'set 3').getByLabel('Weight (kg)')).toHaveValue('110');
  await expect(setRow(page, 'Barbell Squat', 'set 2').getByLabel('Reps', { exact: true })).toHaveValue('5');
  await expect(setRow(page, 'Pushups', 'set 4')).toBeVisible();
});

test('a superset can start with 4 rounds', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/workouts/new');
  await page.getByRole('button', { name: '+ Superset / circuit', exact: true }).click();
  const picker = page.getByRole('dialog');
  const search = picker.getByLabel('Search exercises');
  for (const exercise of ['Pushups', 'Pullups']) {
    await search.fill(exercise);
    await picker.getByRole('option', { name: exercise, exact: true }).click();
  }
  await picker.getByRole('group', { name: 'Rounds' }).getByRole('button', { name: 'More rounds' }).click();
  await picker.getByRole('button', { name: 'Add 2 exercises' }).click();
  await expect(page.getByText('Superset / circuit · 4 rounds')).toBeVisible();
});

test('duplicate a workout from its page and from the list', async ({ page }) => {
  const name = `Dup ${unique()}`;
  created.workouts.push(name, `${name} (copy)`);
  await signInAsCoach(page);
  await createWorkout(page, name);
  const original = page.url();

  await page.getByRole('button', { name: 'Duplicate workout' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${name} (copy)` })).toBeVisible();
  expect(page.url()).not.toBe(original);
  await expect(setRow(page, 'Barbell Squat', 'set 3').getByLabel('Reps', { exact: true })).toHaveValue('8');

  // From the list, the copy of the copy gets its own " (copy)".
  created.workouts.push(`${name} (copy) (copy)`);
  await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
  await page.getByRole('button', { name: `Duplicate ${name} (copy)`, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${name} (copy) (copy)` })).toBeVisible();
  await page.goto(`/workouts?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('table', { name: 'Workouts' }).getByRole('link')).toHaveCount(3);
});

test('duplicate a program, then copy and repeat a week', async ({ page }) => {
  const workout = `Week copy ${unique()}`;
  const program = `Copy weeks ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program, `${program} (copy)`);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  await createProgram(page, program, 3, [
    { week: 1, day: 1, workoutName: workout },
    { week: 1, day: 4, workoutName: workout },
    { week: 2, day: 3, workoutName: workout },
  ]);
  const chip = (week: number, day: number) => programCell(page, week, day).getByRole('button', { name: workout, exact: true });

  // Duplicate from the list: same weeks and workouts, its own page.
  await page.goto('/programs');
  await page.getByRole('button', { name: `Duplicate ${program}`, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${program} (copy)` })).toBeVisible();
  await expect(page.getByText('Copied. Workouts are shared with the original — editing a workout changes both.')).toBeVisible();
  await expect(chip(1, 1)).toBeVisible();
  await expect(chip(1, 4)).toBeVisible();
  await expect(chip(2, 3)).toBeVisible();

  // Copy week 1 to week 2: week 2 already has a workout, so the dialog asks before replacing it.
  await page.getByRole('button', { name: 'Copy week 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy week 1' });
  // A duplicate is a new program, so Live Sync is on.
  await expect(dialog).toContainText('Live Sync is on: clients on this program get this change from today on.');
  await dialog.getByLabel('Copy to').selectOption({ label: 'Week 2' });
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText("Week 2 already has 1 workout. Copying replaces it with week 1's 2 workouts.");
  await dialog.getByRole('button', { name: 'Replace week 2' }).click();
  await expect(dialog).toBeHidden();
  await expect(chip(2, 1)).toBeVisible();
  await expect(chip(2, 4)).toBeVisible();
  await expect(chip(2, 3)).toHaveCount(0);
  await saved(page);

  // Repeat week 1 for every following week: week 3 was empty, but week 2 is not, so it asks again.
  await page.getByRole('button', { name: 'Copy week 1', exact: true }).click();
  await dialog.getByLabel('Copy to').selectOption({ label: 'Weeks 2–3' });
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await dialog.getByRole('button', { name: 'Replace weeks 2 to 3' }).click();
  await expect(chip(3, 1)).toBeVisible();
  await expect(chip(3, 4)).toBeVisible();
  await saved(page);

  await page.reload();
  for (const week of [1, 2, 3]) {
    await expect(chip(week, 1)).toBeVisible();
    await expect(chip(week, 4)).toBeVisible();
  }
  await expect(page.getByRole('table', { name: 'Program weeks' }).getByRole('button', { name: workout, exact: true })).toHaveCount(6);

  // The original program is untouched.
  await page.goto('/programs');
  await page.getByRole('link', { name: program, exact: true }).click();
  await expect(chip(2, 3)).toBeVisible();
  await expect(chip(3, 1)).toHaveCount(0);
});
