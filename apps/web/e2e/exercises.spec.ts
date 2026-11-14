import type { Database } from '@caltracker/shared';
import { createClient } from '@supabase/supabase-js';
import { devices, expect, test, type Page } from '@playwright/test';
import { signInAsCoach } from './helpers';

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

// Phones (approved redesign, row 5): search, one row of chips, a list that scrolls with the page, and each exercise on
// its own page. Uses only exercises in the CI fixture and saves nothing.
test.describe('on an iPhone', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
  test.use({ ...iphone13 });

  const list = (page: Page) => page.getByRole('list', { name: 'Exercises' });

  test('the whole page scrolls, with the search box staying on top, and no row looks selected', async ({ page }) => {
    await page.goto('/exercises');
    await expect(list(page).getByRole('link').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'New custom exercise' })).toHaveText('+ New', { useInnerText: true });
    // No list box with its own scroll: the document is taller than the screen and scrolling it moves the list.
    const { scrollHeight, innerHeight } = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight }));
    expect(scrollHeight).toBeGreaterThan(innerHeight);
    const firstTop = (await list(page).boundingBox())!.y;
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    expect((await list(page).boundingBox())!.y).toBeLessThan(firstTop - 300);
    await expect(page.getByRole('searchbox', { name: 'Search exercises' })).toBeInViewport();
    // The laptop's "first row highlighted" preview isn't here.
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Exercise preview' })).toHaveCount(0);
  });

  test('a tap on an exercise opens its own page, and ‹ Exercises comes back', async ({ page }) => {
    await page.goto('/exercises');
    await page.getByRole('searchbox', { name: 'Search exercises' }).fill('bb squat');
    const row = list(page).getByRole('link', { name: 'Barbell Squat', exact: true });
    await expect(list(page).getByRole('link').first()).toHaveAccessibleName('Barbell Squat');
    await row.click();
    await expect(page).toHaveURL(/\/exercises\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Barbell Squat', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Muscles' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Favourite Barbell Squat' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to exercises' }).click();
    await expect(page).toHaveURL(/\/exercises\?q=bb/);
    // The search is kept, so the coach is back where they were.
    await expect(page.getByRole('searchbox', { name: 'Search exercises' })).toHaveValue('bb squat');
    await expect(list(page).getByRole('link').first()).toHaveAccessibleName('Barbell Squat');
  });

  test('tracking type and equipment sit in the Filters sheet', async ({ page }) => {
    await page.goto('/exercises');
    await expect(list(page).getByRole('link', { name: 'Barbell Squat', exact: true })).toBeVisible();
    // Only the muscles are on the page; tracking type is behind Filters.
    await expect(page.getByRole('button', { name: 'Legs', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Time', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /^Filters/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('group', { name: 'Equipment' })).toBeVisible();
    const time = sheet.getByRole('group', { name: 'Tracking type' }).getByRole('button', { name: 'Time', exact: true });
    await time.click();
    await expect(time).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/tracking=time/);
    const show = sheet.getByRole('button', { name: /^Show \d+ exercises?$/ });
    // Stuck to the bottom of the sheet: reachable without scrolling inside it.
    await expect(show).toBeInViewport({ ratio: 1 });
    await show.click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: /^Filters/ })).toHaveText(/1/);
    await expect(list(page).getByRole('link', { name: 'Barbell Squat', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /^Filters/ }).click();
    await sheet.getByRole('button', { name: 'Clear' }).click();
    await expect(time).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(list(page).getByRole('link', { name: 'Barbell Squat', exact: true })).toBeVisible();
  });
});
