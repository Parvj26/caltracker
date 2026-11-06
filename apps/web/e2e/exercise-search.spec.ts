import { expect, test, type Page } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';

// Exercise picker, layout A (phase: exercise search Task 3). Uses only exercises in the 20-exercise CI fixture,
// plus a custom exercise seeded here.

const admin = serviceClient();

async function openPicker(page: Page, button = '+ Exercise') {
  await page.goto('/workouts/new');
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('option').first()).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await signInAsCoach(page);
  const coach = await admin.auth.admin.listUsers({ perPage: 200 });
  const id = coach.data.users.find((u) => u.email === 'coach@demo.local')?.id;
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
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  dialog = await openPicker(page);
  await expect(dialog.getByRole('option').first()).toHaveAccessibleName('Plank');
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
