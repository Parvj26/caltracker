import { expect, test, type Page } from '@playwright/test';
import { createProgram, createWorkout, programCell, serviceClient, setRow, signInAsCoach } from './helpers';

// Program builder: a new workout from a day's "+", the summary card on a placed workout, and editing it in the sheet
// (everywhere or just this day).
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { workouts: string[]; programs: string[] } = { workouts: [], programs: [] };

// PROGRAM_SHOTS_DIR=/some/dir saves screenshots of the add dialog, the summary card and the save question, at iPad width.
const SHOTS = process.env.PROGRAM_SHOTS_DIR;
if (SHOTS) test.use({ viewport: { width: 1024, height: 1366 } });
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/program-${name}.png` });
};

test.afterAll(async () => {
  if (created.programs.length) await admin.from('programs').delete().in('name', created.programs);
  for (const name of created.workouts) await admin.from('workouts').delete().like('name', `${name}%`).is('client_id', null);
});

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
const chip = (page: Page, week: number, day: number, name: string) =>
  programCell(page, week, day).getByRole('button', { name, exact: true });

/** Sets up a program of one week with `workout` on the given days of week 1. */
async function programWith(page: Page, days: number[]) {
  const workout = `Upper ${unique()}`;
  const program = `Iron ${unique()}`;
  created.workouts.push(workout);
  created.programs.push(program);
  await signInAsCoach(page);
  await createWorkout(page, workout);
  await createProgram(page, program, 1, days.map((day) => ({ week: 1, day, workoutName: workout })));
  return { workout, program };
}

async function openEditor(page: Page, day: number, workout: string) {
  await chip(page, 1, day, workout).click();
  const summary = page.getByRole('dialog', { name: workout, exact: true });
  await summary.getByRole('button', { name: 'Edit workout' }).click();
  const sheet = page.getByRole('dialog', { name: `Edit ${workout}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('a new workout made from a day lands on that day and in Workouts', async ({ page }) => {
  const program = `Iron ${unique()}`;
  const workout = `Lower ${unique()}`;
  created.programs.push(program);
  created.workouts.push(workout);
  await signInAsCoach(page);
  await createProgram(page, program, 1, []);

  await page.getByRole('button', { name: 'Add a workout to week 1, day 2', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add a workout to Week 1, Day 2' });
  await expect(add.getByText('Build it here. It’s also saved to Workouts.')).toBeVisible();
  await shot(page, 'add-dialog');
  await add.getByRole('button', { name: /New workout/ }).click();

  const sheet = page.getByRole('dialog', { name: 'New workout' });
  await expect(sheet.getByText(`${program} · Week 1, Day 2`)).toBeVisible();
  await sheet.getByLabel('Workout name').fill(workout);
  await sheet.getByRole('button', { name: '+ Exercise', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add exercises' });
  await picker.getByLabel('Search exercises').fill('Barbell Squat');
  await picker.getByRole('option', { name: 'Barbell Squat', exact: true }).click();
  await picker.getByRole('button', { name: 'Add 1 exercise', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(sheet).toBeVisible();
  await setRow(page, 'Barbell Squat', 'set 1').getByLabel('Reps', { exact: true }).fill('5');
  await sheet.getByRole('button', { name: 'Save and add to day' }).click();

  await expect(sheet).toBeHidden();
  await expect(chip(page, 1, 2, workout)).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(chip(page, 1, 2, workout)).toBeVisible();
  await page.goto('/workouts');
  await expect(page.getByRole('link', { name: workout }).first()).toBeVisible();
});

test('tapping a placed workout shows its summary', async ({ page }) => {
  const { workout } = await programWith(page, [1, 3]);
  await admin.from('workouts').update({ notes: 'Heavy, low volume.' }).eq('name', workout).is('client_id', null);
  await page.reload();

  await chip(page, 1, 3, workout).click();
  const summary = page.getByRole('dialog', { name: workout, exact: true });
  await expect(summary.getByText('WEEK 1 · DAY 3')).toBeVisible();
  await expect(summary.getByText('1 exercise · used on 2 days in this program')).toBeVisible();
  await expect(summary.getByText('Heavy, low volume.')).toBeVisible();
  const row = summary.getByRole('list', { name: 'Exercises' }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Barbell Squat');
  await expect(row).toContainText(/3 sets · 8 reps · 60 (kg|lb)/);
  await expect(summary.getByRole('button', { name: 'Move to…' })).toBeVisible();
  await expect(summary.getByRole('button', { name: 'Remove from day' })).toBeVisible();
  await shot(page, 'summary');

  await page.keyboard.press('Escape');
  await expect(summary).toBeHidden();
  await chip(page, 1, 3, workout).click();
  await summary.getByRole('button', { name: 'Close' }).click();
  await expect(summary).toBeHidden();

  // Remove from day still removes it.
  await chip(page, 1, 3, workout).click();
  await summary.getByRole('button', { name: 'Remove from day' }).click();
  await expect(chip(page, 1, 3, workout)).toHaveCount(0);
  await expect(chip(page, 1, 1, workout)).toBeVisible();
});

test('Edit, Update everywhere: every day gets the change', async ({ page }) => {
  const { workout, program } = await programWith(page, [1, 3]);
  const sheet = await openEditor(page, 1, workout);
  await sheet.getByLabel('Workout name').fill(`${workout} v2`);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();

  const ask = page.getByRole('dialog', { name: `Save changes to “${workout}”?` });
  await expect(ask.getByText(`You opened it from Week 1, Day 1. “${workout}” is used on 2 days in ${program}.`)).toBeVisible();
  await shot(page, 'save-choice');
  await ask.getByRole('button', { name: /Update everywhere/ }).click();

  await expect(sheet).toBeHidden();
  await expect(chip(page, 1, 1, `${workout} v2`)).toBeVisible();
  await expect(chip(page, 1, 3, `${workout} v2`)).toBeVisible();
  await page.reload();
  await expect(chip(page, 1, 1, `${workout} v2`)).toBeVisible();
  await expect(chip(page, 1, 3, `${workout} v2`)).toBeVisible();
});

test('Edit, Just this day: only that day changes, the other keeps the old version', async ({ page }) => {
  const { workout } = await programWith(page, [1, 3]);
  const sheet = await openEditor(page, 3, workout);
  for (const n of [1, 2, 3]) await setRow(page, 'Barbell Squat', `set ${n}`).getByLabel(/^Weight/).fill('80');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  const ask = page.getByRole('dialog', { name: `Save changes to “${workout}”?` });
  await expect(ask.getByText(`Saves a copy called “${workout} (Week 1, Wed)” on this day only.`, { exact: false })).toBeVisible();
  await ask.getByRole('button', { name: /Just Week 1, Day 3/ }).click();

  await expect(sheet).toBeHidden();
  await expect(chip(page, 1, 3, `${workout} (Week 1, Wed)`)).toBeVisible();
  await expect(chip(page, 1, 1, workout)).toBeVisible();
  await page.reload();
  await chip(page, 1, 3, `${workout} (Week 1, Wed)`).click();
  await expect(page.getByRole('dialog', { name: `${workout} (Week 1, Wed)`, exact: true }).getByText(/3 sets · 8 reps · 80 (kg|lb)/)).toBeVisible();
  await page.keyboard.press('Escape');
  await chip(page, 1, 1, workout).click();
  await expect(page.getByRole('dialog', { name: workout, exact: true }).getByText(/3 sets · 8 reps · 60 (kg|lb)/)).toBeVisible();
});

test('a workout used on only this day saves without a question', async ({ page }) => {
  const { workout } = await programWith(page, [2]);
  const sheet = await openEditor(page, 2, workout);
  await sheet.getByLabel('Workout name').fill(`${workout} solo`);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('dialog', { name: /Save changes/ })).toHaveCount(0);
  await expect(chip(page, 1, 2, `${workout} solo`)).toBeVisible();
});

test('closing with unsaved changes asks first', async ({ page }) => {
  const { workout } = await programWith(page, [4]);
  const sheet = await openEditor(page, 4, workout);
  // Nothing changed yet: it just closes.
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toBeHidden();

  await openEditor(page, 4, workout);
  await sheet.getByLabel('Workout name').fill(`${workout} changed`);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard your changes?' });
  await discard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(discard).toBeHidden();
  await expect(sheet.getByLabel('Workout name')).toHaveValue(`${workout} changed`);

  await page.keyboard.press('Escape');
  await discard.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(chip(page, 1, 4, workout)).toBeVisible();
});
