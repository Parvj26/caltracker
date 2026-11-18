import { expect, test, type Page } from '@playwright/test';
import { pickExercise, setRow, signInAsCoach } from './helpers';

// The wide workout builder (approved "Wide workout builder" mockup): on a 1440 px desktop the exercises are rows on
// the left and the picked one's editor fills the right. Narrower screens keep the cards (the other builder specs run
// at 1280 px). Uses only exercises in the CI fixture.

test.use({ viewport: { width: 1440, height: 900 } });

const list = (page: Page) => page.getByRole('region', { name: 'Exercises', exact: true });
const editor = (page: Page) => page.getByRole('region', { name: 'Selected exercise', exact: true });
const row = (page: Page, exercise: string) => list(page).getByRole('button', { name: new RegExp(`^${exercise}: `) });

test('two panes: pick a row to edit its sets, a new exercise is picked, the Superset switch still works', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/workouts/new');
  await page.getByLabel('Workout name').fill('Wide builder');
  await expect(editor(page)).toContainText('Add an exercise');

  // Each exercise added is picked straight away.
  await pickExercise(page, '+ Exercise', 'Pushups');
  await expect(row(page, 'Pushups')).toHaveAttribute('aria-pressed', 'true');
  await pickExercise(page, '+ Exercise', 'Pullups');
  await expect(row(page, 'Pullups')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'Pushups')).toHaveAttribute('aria-pressed', 'false');
  await expect(setRow(page, 'Pullups', 'set 1')).toBeVisible();
  await expect(setRow(page, 'Pushups', 'set 1')).toBeHidden();
  // The cards layout is not shown alongside.
  await expect(page.getByRole('button', { name: /^Pushups: / })).toHaveCount(1);

  // Picking a row shows its editor on the right; + Set copies its last set there, and its summary follows.
  await row(page, 'Pushups').click();
  await expect(row(page, 'Pushups')).toHaveAttribute('aria-pressed', 'true');
  const pane = editor(page);
  await expect(pane.getByRole('button', { name: 'Swap exercise: Pushups', exact: true })).toBeVisible();
  await expect(pane.getByRole('button', { name: /^Measurements: / })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'More for Pushups', exact: true })).toBeVisible();
  await pane.getByRole('button', { name: 'Add a set to Pushups' }).click();
  await expect(setRow(page, 'Pushups', 'set 2')).toBeVisible();
  await expect(row(page, 'Pushups')).toHaveAttribute('aria-label', /^Pushups: 2 sets/);
  await expect(pane.getByLabel('Each side for Pushups')).toBeVisible();
  await expect(pane.getByLabel('Tempo for Pushups')).toBeVisible();
  await expect(pane.getByPlaceholder('Exercise note (optional)')).toBeVisible();

  // The keyboard picks rows too.
  await row(page, 'Pullups').focus();
  await page.keyboard.press('Enter');
  await expect(row(page, 'Pullups')).toHaveAttribute('aria-pressed', 'true');

  // The Superset switch between the rows joins them; the picked exercise stays picked.
  const link = list(page).getByRole('button', { name: 'Superset Pushups with Pullups' });
  await expect(link).toHaveAttribute('aria-pressed', 'false');
  await link.click();
  await expect(link).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'Pullups')).toHaveAttribute('aria-pressed', 'true');
  await expect(setRow(page, 'Pullups', 'set 1').getByLabel('Rest (m:ss)')).toHaveValue('1:30');
  await row(page, 'Pushups').click();
  // A1 goes straight on to A2: no rest box.
  await expect(setRow(page, 'Pushups', 'set 1').getByLabel('Rest (m:ss)')).toHaveCount(0);

  // Deleting the picked exercise picks its neighbour.
  await link.click();
  await expect(link).toHaveAttribute('aria-pressed', 'false');
  await row(page, 'Pushups').click();
  await pane.getByRole('button', { name: 'More for Pushups', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete exercise' }).click();
  await expect(row(page, 'Pushups')).toHaveCount(0);
  await expect(row(page, 'Pullups')).toHaveAttribute('aria-pressed', 'true');
  await expect(setRow(page, 'Pullups', 'set 1')).toBeVisible();

  // No sideways scrolling, and the rows are big enough to tap.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await row(page, 'Pullups').boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
