import { expect, test, type Page } from '@playwright/test';
import { demoWorkspace, freshClient, seedLibraryWorkout, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// The one SearchBox (UI rules §6): results as you type with the shared smart search (typos forgiven), a clear ×,
// the text kept in ?q= so a reload or Back brings the same results, and "No <things> match “x”" with Clear search.

const admin = serviceClient();
const created = { workouts: [] as string[], users: [] as string[] };
test.afterAll(async () => {
  if (created.workouts.length) await admin.from('workouts').delete().in('id', created.workouts);
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('Workouts: type with a typo, clear with ×, and the address keeps the search', async ({ page }) => {
  const tag = unique();
  const name = `Mobility ${tag}`;
  created.workouts.push(await seedLibraryWorkout(admin, await demoWorkspace(admin), name));
  await signInAsCoach(page);
  await page.goto('/workouts');
  // No separate Search button any more.
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
  const box = page.getByRole('searchbox', { name: 'Search workouts' });
  await expect(box).toHaveAttribute('enterkeyhint', 'search');
  await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);

  await box.fill(`mobilty ${tag}`);
  const list = page.getByRole('table', { name: 'Workouts' });
  await expect(list.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`[?&]q=mobilty(\\+|%20)${tag}`));

  // A reload (or Back to the page) shows the same search and results.
  await page.reload();
  await expect(box).toHaveValue(`mobilty ${tag}`);
  await expect(list.locator('tbody tr')).toHaveCount(1);

  // Nothing found: one line naming the search, with Clear search.
  await box.fill(`zzzz ${tag}`);
  await expect(page.getByText(`No workouts match “zzzz ${tag}”`)).toBeVisible();
  await page.getByTestId('search-empty').getByRole('button', { name: 'Clear search' }).click();
  await expect(box).toHaveValue('');
  await expect(page).not.toHaveURL(/[?&]q=/);

  // The × empties the box, keeps focus in it, and drops ?q=.
  await box.fill(name);
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await expect(page).toHaveURL(/[?&]q=/);
  const clear = page.getByLabel('Clear search');
  const size = await clear.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(44);
  expect(size?.height).toBeGreaterThanOrEqual(44);
  await clear.click();
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  await expect(page).not.toHaveURL(/[?&]q=/);
});

test('Clients: a typo finds the client, and Back from another page brings the search back', async ({ page }) => {
  const last = `Zephyr${unique()}`;
  created.users.push(await freshClient(admin, await demoWorkspace(admin), 'Maya', last));
  await signInAsCoach(page);
  await page.goto('/clients');
  const box = page.getByRole('searchbox', { name: 'Search clients' });
  await box.fill(`mya ${last}`);
  const table = page.getByRole('list', { name: 'Clients', exact: true });
  await expect(table.getByText(`Maya ${last}`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]q=mya(\\+|%20)${last}`, 'i'));

  // An in-app link and Back: Next may bring the page from its client cache, and the box must still show the search.
  await table.getByText(`Maya ${last}`).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  await page.goBack();
  await expect(page).toHaveURL(/\/clients\?/);
  await expect(box).toHaveValue(`mya ${last}`);
  await expect(table.getByText(`Maya ${last}`)).toBeVisible();
  await expect(table.getByRole('listitem')).toHaveCount(1);
});

test('Workouts: open a workout from a search, then Back keeps the search', async ({ page }) => {
  const tag = unique();
  const name = `Backcheck ${tag}`;
  created.workouts.push(await seedLibraryWorkout(admin, await demoWorkspace(admin), name));
  await signInAsCoach(page);
  await page.goto('/workouts');
  const box = page.getByRole('searchbox', { name: 'Search workouts' });
  await box.fill(`bakcheck ${tag}`);
  const list = page.getByRole('table', { name: 'Workouts' });
  await list.getByRole('link', { name, exact: true }).click();
  await page.waitForURL(/\/workouts\/[0-9a-f-]{36}/);
  await page.goBack();
  await expect(box).toHaveValue(`bakcheck ${tag}`);
  await expect(list.locator('tbody tr')).toHaveCount(1);
});

test('Exercises on a phone: the Filters and Favourites pills keep their size and pressed look', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsCoach(page);
  await page.goto('/exercises');
  const filters = page.getByRole('button', { name: /^Filters/ });
  const favourites = page.getByRole('button', { name: /Favourites/ });
  for (const pill of [filters, favourites]) {
    const box = await pill.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const before = await favourites.evaluate((el) => getComputedStyle(el).backgroundColor);
  await favourites.click();
  await expect(favourites).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => favourites.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
  // One row of pills, side by side (not stacked).
  const a = await filters.boundingBox();
  const b = await favourites.boundingBox();
  expect(Math.abs((a?.y ?? 0) - (b?.y ?? 1))).toBeLessThan(4);
});

test('Messages: the inbox search forgives a typo ("mya" finds Maya)', async ({ page }) => {
  const last = `Quill${unique()}`;
  created.users.push(await freshClient(admin, await demoWorkspace(admin), 'Maya', last));
  await signInAsCoach(page);
  await page.goto('/messages');
  const box = page.getByRole('searchbox', { name: 'Search clients' });
  await box.fill(`mya ${last}`);
  const list = page.getByRole('list', { name: 'Conversations' });
  await expect(list.getByRole('link', { name: `Maya ${last}` })).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await box.fill(`zzzz ${last}`);
  await expect(page.getByText(`No clients match “zzzz ${last}”`)).toBeVisible();
});

for (const [width, height] of [
  [375, 667],
  [390, 844],
  [820, 1180],
  [1180, 820],
  [1440, 900],
] as const) {
  test(`search pages have no sideways scroll at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signInAsCoach(page);
    for (const path of ['/workouts', '/programs', '/clients', '/meals', '/messages']) {
      await page.goto(path);
      // Meals shows its box only once there's a meal to search.
      if (path !== '/meals') await expect(page.getByRole('searchbox').first()).toBeVisible();
      else await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      expect(await noHorizontalScroll(page), `${path} at ${width}`).toBe(true);
    }
  });
}
