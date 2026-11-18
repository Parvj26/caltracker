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
  const table = page.getByRole('table', { name: 'Clients' });
  await expect(table.getByText(`Maya ${last}`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]q=mya(\\+|%20)${last}`, 'i'));

  await page.goto('/workouts');
  await page.goBack();
  await expect(box).toHaveValue(`mya ${last}`);
  await expect(table.getByText(`Maya ${last}`)).toBeVisible();
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
