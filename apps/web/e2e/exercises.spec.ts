import type { Database } from '@caltracker/shared';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

async function signInAsCoach(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('coach@demo.local');
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

// Service-role client: test cleanup only.
function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

test.beforeEach(async ({ page }) => {
  await signInAsCoach(page);
});

test('search "squat" finds Barbell Squat', async ({ page }) => {
  await page.goto('/exercises');
  await page.getByLabel('Search exercises').fill('squat');
  await expect(page.getByRole('option', { name: 'Barbell Squat', exact: true })).toBeVisible();
});

test('pin a YouTube video on a built-in exercise, and reject a bad link', async ({ page }) => {
  const { data } = await admin().from('exercises').select('id, name').eq('name', 'Barbell Squat').single();
  const id = data!.id;
  try {
    await admin().from('exercise_overrides').delete().eq('exercise_id', id);
    await page.goto(`/exercises/${id}`);
    const link = page.getByRole('link', { name: 'Watch form on YouTube' });
    await expect(link).toHaveAttribute(
      'href',
      'https://www.youtube.com/results?search_query=Barbell%20Squat%20form',
    );

    await page.getByLabel('Pinned YouTube video').fill('https://vimeo.com/123');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Paste a YouTube link (youtube.com or youtu.be).' })).toBeVisible();

    await page.getByLabel('Pinned YouTube video').fill('https://youtu.be/dQw4w9WgXcQ');
    await page.getByLabel('Coaching notes').fill('Brace hard.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.reload();
    await expect(page.locator('iframe[src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Watch form on YouTube' })).toHaveCount(0);
  } finally {
    await admin().from('exercise_overrides').delete().eq('exercise_id', id);
  }
});

test('create a custom exercise and see it under My exercises', async ({ page }) => {
  const name = `Sled Push ${Date.now()}`;
  try {
    await page.goto('/exercises/new');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Tracking type').selectOption('distance');
    await page.getByRole('button', { name: 'Create exercise' }).click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.goto('/exercises?source=custom');
    const option = page.getByRole('option', { name, exact: true });
    await expect(option).toBeVisible();
    // A custom exercise offers Edit, which opens the existing form.
    await option.click();
    await page.getByRole('region', { name: 'Exercise preview' }).getByRole('link', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Edit exercise' })).toBeVisible();
    await page.goto('/exercises?source=builtin');
    await expect(page.getByRole('option', { name: 'Barbell Squat', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name, exact: true })).toHaveCount(0);
  } finally {
    await admin().from('exercises').delete().eq('name', name);
  }
});

test('out-of-range and absurd ?page values never show an error page', async ({ page }) => {
  for (const value of ['999', '99999999999999999999999', '-3', 'abc']) {
    const response = await page.goto(`/exercises?page=${value}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
    // The old ?page= is ignored: the list still renders.
    await expect(page.getByRole('option').first()).toBeVisible();
  }
});

test('"bb squat" on the Exercises page finds Barbell Squat first', async ({ page }) => {
  await page.goto('/exercises');
  await page.getByLabel('Search exercises').fill('bb squat');
  await expect(page.getByRole('option').first()).toHaveAccessibleName('Barbell Squat');
  // Built-ins have no Edit; they link to their details instead.
  const preview = page.getByRole('region', { name: 'Exercise preview' });
  await expect(preview.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await expect(preview.getByRole('link', { name: 'Details' })).toBeVisible();
});

test('a star set on the Exercises page shows first in the builder picker', async ({ page }) => {
  const user = (await admin().auth.admin.listUsers({ perPage: 200 })).data.users.find((u) => u.email === 'coach@demo.local');
  await admin().from('exercise_favorites').delete().eq('coach_id', user!.id);
  try {
    await page.goto('/exercises');
    await page.getByLabel('Search exercises').fill('Pullups');
    const star = page.getByRole('button', { name: 'Favourite Pullups' });
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    // Wait for the save before leaving the page.
    await expect.poll(async () => (await admin().from('exercise_favorites').select('exercise_id').eq('coach_id', user!.id)).data?.length).toBe(1);

    await page.goto('/workouts/new');
    await page.getByRole('button', { name: '+ Exercise', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('option').first()).toHaveAccessibleName('Pullups');
  } finally {
    await admin().from('exercise_favorites').delete().eq('coach_id', user!.id);
  }
});
