import { expect, test, type Page } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';

// Exercise picker, layout A (phase: exercise search Task 3). Uses only exercises in the 20-exercise CI fixture,
// plus a custom exercise seeded here.

const admin = serviceClient();

// Every test here starts by clearing the shared demo coach's favourites, and the star tests need them to stay put
// until they finish. Run this file's tests one after another on one worker, so one test's clean-up can't wipe a star
// another test just set. All favourite tests live in this file for the same reason.
test.describe.configure({ mode: 'default' });

async function openPicker(page: Page, button = '+ Exercise') {
  await page.goto('/workouts/new');
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('option').first()).toBeVisible();
  return dialog;
}

async function demoCoachId(): Promise<string | undefined> {
  const coach = await admin.auth.admin.listUsers({ perPage: 200 });
  return coach.data.users.find((u) => u.email === 'coach@demo.local')?.id;
}

test.beforeEach(async ({ page }) => {
  await signInAsCoach(page);
  const id = await demoCoachId();
  if (id) await admin.from('exercise_favorites').delete().eq('coach_id', id);
});

test.afterAll(async () => {
  const id = await demoCoachId();
  if (id) await admin.from('exercise_favorites').delete().eq('coach_id', id);
});

test('"db curl" finds Dumbbell Bicep Curl, the preview shows photos, and Add to workout adds it', async ({ page }) => {
  const dialog = await openPicker(page);
  await dialog.getByLabel('Search exercises').fill('db curl');
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName('Dumbbell Bicep Curl');

  const preview = dialog.getByRole('region', { name: 'Exercise preview' });
  await expect(preview.getByRole('heading', { name: 'Dumbbell Bicep Curl' })).toBeVisible();
  await expect(preview.getByText(/^biceps$/i)).toBeVisible();
  await expect(preview.getByRole('img')).toHaveCount(2);

  await preview.getByRole('button', { name: 'Add to workout' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Dumbbell Bicep Curl' })).toBeVisible();
});

test('keyboard: Down moves the highlight, Enter adds', async ({ page }) => {
  const dialog = await openPicker(page);
  const search = dialog.getByLabel('Search exercises');
  await search.fill('squat');
  await search.press('ArrowDown');
  const second = dialog.getByRole('option').nth(1);
  await expect(second).toHaveAttribute('aria-selected', 'true');
  const name = (await second.getAttribute('aria-label'))!;
  await search.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name })).toBeVisible();
});

test('a starred exercise is the first row of an empty search', async ({ page }) => {
  let dialog = await openPicker(page);
  await dialog.getByLabel('Search exercises').fill('Plank');
  await dialog.getByRole('button', { name: 'Favourite Plank' }).click();
  await expect(dialog.getByRole('button', { name: 'Favourite Plank' })).toHaveAttribute('aria-pressed', 'true');
  // The star shows at once, before the save reaches the server. Reloading the page now could cancel that save, so
  // wait until the favourite is really stored.
  const coachId = await demoCoachId();
  await expect
    .poll(async () => (await admin.from('exercise_favorites').select('exercise_id').eq('coach_id', coachId ?? '')).data?.length ?? 0)
    .toBe(1);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  dialog = await openPicker(page);
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName('Plank');
});

test('a star set on the Exercises page shows first in the builder picker', async ({ page }) => {
  await page.goto('/exercises');
  await page.getByLabel('Search exercises').fill('Pullups');
  const star = page.getByRole('button', { name: 'Favourite Pullups' });
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  // Wait for the save before leaving the page.
  const coachId = await demoCoachId();
  await expect
    .poll(async () => (await admin.from('exercise_favorites').select('exercise_id').eq('coach_id', coachId ?? '')).data?.length ?? 0)
    .toBe(1);

  const dialog = await openPicker(page);
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName('Pullups');
});

test('muscle and equipment chips narrow a search', async ({ page }) => {
  const dialog = await openPicker(page);
  await dialog.getByLabel('Search exercises').fill('squat');
  const option = (name: string) => dialog.getByRole('option', { name, exact: true });
  await expect(option('Barbell Squat')).toBeVisible();
  await expect(option('Bodyweight Squat')).toBeVisible();

  await dialog.getByRole('button', { name: 'Legs', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Legs', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Barbell', exact: true }).click();
  await expect(option('Barbell Squat')).toBeVisible();
  await expect(option('Bodyweight Squat')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Dumbbell', exact: true }).click();
  // Same group: Barbell OR Dumbbell, so the barbell squat stays.
  await expect(option('Barbell Squat')).toBeVisible();
  // Different groups AND: Chest (alone, with Legs off) and Barbell leave no squat.
  await dialog.getByRole('button', { name: 'Legs', exact: true }).click();
  await dialog.getByRole('button', { name: 'Chest', exact: true }).click();
  await expect(option('Barbell Squat')).toHaveCount(0);
});

test('a search with no match shows the empty state and clears filters', async ({ page }) => {
  const dialog = await openPicker(page);
  await dialog.getByRole('button', { name: 'Chest', exact: true }).click();
  await dialog.getByLabel('Search exercises').fill('zzzz');
  await expect(dialog.getByText('No exercises match "zzzz"')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Create a custom exercise' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear filters' }).click();
  await expect(dialog.getByRole('button', { name: 'Chest', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByText('No exercises match "zzzz"')).toBeVisible();
});

test('superset: one pick keeps Add disabled, two add both', async ({ page }) => {
  const dialog = await openPicker(page, '+ Superset / circuit');
  const search = dialog.getByLabel('Search exercises');
  await search.fill('Pushups');
  await dialog.getByRole('option', { name: 'Pushups', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Pick at least 2 exercises', exact: true })).toBeDisabled();
  await search.fill('Pullups');
  await dialog.getByRole('option', { name: 'Pullups', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add 2 exercises' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Superset / circuit · 3 rounds')).toBeVisible();
});

test('open picker with a query, a filter and the preview (screenshot)', async ({ page }) => {
  const dialog = await openPicker(page);
  await dialog.getByLabel('Search exercises').fill('squat');
  await dialog.getByRole('button', { name: 'Legs', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Exercise preview' }).getByRole('img').first()).toBeVisible();
  // Every photo on screen must have loaded (a broken or still-loading image would show in the picture).
  await page.waitForFunction(() =>
    [...document.querySelectorAll('dialog img')]
      .filter((img) => img.getBoundingClientRect().top < window.innerHeight)
      .every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
  );
  await page.screenshot({
    path: test.info().outputPath('exercise-picker.png'),
  });
});
