import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { demoWorkspace, freshClient, unique } from './assign-helpers';
import { seedLog, serviceClient, signInAsCoach } from './helpers';

// Phone fixes, batch 2: Activity as day-grouped rows (round 2: unreviewed dot, comment count, whole row tappable), the client tabs' arrow (the Food tab's phone layout is in phone-food.spec.ts),
// and the live view (short "HERE NOW" and Up next under the current exercise on phones, Up next beside the workout
// on a landscape iPad). Chromium with iPhone sizes and touch (the browser can't be chosen per spec). Each CI shard starts from an empty database, so every test seeds its own
// client and log in the demo workspace, and everything is removed afterwards.

const admin = serviceClient();
let workspaceId: string;
const clients: string[] = [];

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  for (const id of clients) {
    await admin.from('workout_logs').delete().eq('client_id', id);
    // Deleting the user removes their meals and targets with them.
    await admin.auth.admin.deleteUser(id);
  }
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
const SE = { width: 375, height: 667 };
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function newClient(first: string): Promise<{ id: string; name: string }> {
  const last = `Phone${unique()}`;
  const id = await freshClient(admin, workspaceId, first, last);
  clients.push(id);
  return { id, name: `${first} ${last}` };
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThanOrEqual(innerWidth);
}

/** Scrolled to (up and down only, as a finger would), it is fully on the screen: not cut off at a side. */
async function expectOnScreen(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 1 });
}

test.describe('iPhone SE (375 x 667)', () => {
  test.use({ ...iphone13, viewport: SE });

  test('Activity groups workouts by day, marks unreviewed ones, counts comments and opens a log from anywhere on its row', async ({ page }) => {
    test.slow();
    const client = await newClient('Cara');
    const fresh = `Card ${unique()}`;
    const older = `Older ${unique()}`;
    const freshId = await seedLog(admin, { workspaceId, clientId: client.id, name: fresh, startedAt: ago(55), finishedAt: ago(2) });
    const olderId = await seedLog(admin, { workspaceId, clientId: client.id, name: older, startedAt: ago(3 * 1440 + 60), finishedAt: ago(3 * 1440) });
    // The coach has commented on the older one (reviewed); the client commented on both.
    const owner = await admin.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'owner').limit(1).single();
    if (owner.error) throw owner.error;
    const comments = await admin.from('workout_log_comments').insert([
      { log_id: freshId, workspace_id: workspaceId, client_id: client.id, author_id: client.id, body: 'Felt strong' },
      { log_id: olderId, workspace_id: workspaceId, client_id: client.id, author_id: client.id, body: 'Tough one' },
      { log_id: olderId, workspace_id: workspaceId, client_id: client.id, author_id: owner.data.user_id, body: 'Nice work' },
    ]);
    if (comments.error) throw comments.error;

    await signInAsCoach(page);
    await page.goto(`/activity?client=${client.id}`);
    const main = page.getByRole('main');
    // One heading per day: today first, then the older day as "Tue 10 Nov".
    const days = main.getByRole('region');
    await expect(days).toHaveCount(2);
    await expect(days.nth(0).getByRole('heading', { level: 2 })).toHaveText('Today');
    await expect(days.nth(1).getByRole('heading', { level: 2 })).toHaveText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}( \d{4})?$/);

    const freshRow = days.nth(0).getByRole('listitem').filter({ hasText: fresh });
    const olderRow = days.nth(1).getByRole('listitem').filter({ hasText: older });
    // Only the client has commented on the new one: still unreviewed. The coach's comment marks the older one reviewed.
    await expect(freshRow.getByRole('img', { name: 'Not reviewed' })).toBeVisible();
    await expect(freshRow).toContainText('1 comment');
    await expect(olderRow.getByRole('img', { name: 'Not reviewed' })).toHaveCount(0);
    await expect(olderRow).toContainText('2 comments');
    await expect(main.getByText(/^1 to review$/)).toBeVisible();

    // Every detail fits on the screen.
    for (const text of [client.name, fresh]) await expectOnScreen(freshRow.getByText(text, { exact: true }));
    await expectOnScreen(freshRow.getByText(/53 min · 3 sets · .* lifted$/));
    const box = (await freshRow.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(SE.width);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expectNoSidewaysScroll(page);

    // The filter looks like a dropdown.
    await expect(main.getByText('Client:', { exact: true })).toBeVisible();

    // Tapping the client's name (not just the workout name) opens the log.
    await freshRow.getByText(client.name, { exact: true }).tap();
    await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/logs/${freshId}$`));
  });

  test('the client tabs show an arrow while tabs are hidden, and the current tab is in view', async ({ page }) => {
    const client = await newClient('Tess');
    await signInAsCoach(page);
    await page.goto(`/clients/${client.id}`);
    const tabs = page.getByRole('navigation', { name: 'Client sections' });
    const settings = tabs.getByRole('link', { name: 'Settings' });
    await expect(settings).not.toBeInViewport({ ratio: 1 });
    await page.getByTestId('client-tabs-after').click();
    await expect(settings).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('client-tabs-after')).toHaveCount(0);
    await expect(page.getByTestId('client-tabs-before')).toBeVisible();

    await page.goto(`/clients/${client.id}/settings`);
    await expect(settings).toBeInViewport({ ratio: 1 });
    await expectNoSidewaysScroll(page);
  });
});

test('on a wide screen every client tab fits and there are no arrows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const client = await newClient('Wade');
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}`);
  await expect(page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: 'Settings' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('client-tabs-after')).toHaveCount(0);
  await expect(page.getByTestId('client-tabs-before')).toHaveCount(0);
});

/** An in-progress log: a squat (done), then two pick-one groups nobody has chosen from yet. */
async function liveLog(clientId: string) {
  return seedLog(admin, {
    workspaceId, clientId, name: `Live ${unique()}`, status: 'in_progress', startedAt: ago(20),
    blocks: [
      { exercises: ['Barbell Squat'] },
      { choice: true, picked: null, exercises: ['Pushups', 'Plank'] },
      { choice: true, picked: null, exercises: ['Butterfly', 'Hamstring Stretch'] },
    ],
  });
}

test.describe('live view', () => {
  test.use({ hasTouch: true });

  test('on an iPhone the "is here" label is short and on its own line', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const client = await newClient('Maya');
    const logId = await liveLog(client.id);
    await signInAsCoach(page);
    await page.goto(`/clients/${client.id}/logs/${logId}`);
    const pick = page.getByText(/^PICK ONE/).first();
    await expect(pick).toContainText('HERE NOW');
    await expect(pick.getByText('HERE NOW')).toBeVisible();
    await expect(pick.getByText('MAYA IS HERE')).toBeHidden();
    // The label is a single line.
    expect((await pick.getByText('HERE NOW').boundingBox())!.height).toBeLessThan(26);
    // Up next sits under the current exercise, across the screen, with what comes after it.
    const next = page.getByRole('complementary', { name: 'Up next' });
    await expect(next).toHaveCount(1);
    await expectOnScreen(next);
    await expect(next.getByRole('listitem')).toHaveCount(1);
    await expect(next).toContainText('Pick one: Butterfly or Hamstring Stretch');
    await expect(next).toContainText('2 sets to go');
    const here = (await pick.boundingBox())!;
    const card = (await next.boundingBox())!;
    expect(card.y).toBeGreaterThan(here.y);
    expect(card.width).toBeGreaterThan(390 - 48);
    await expectNoSidewaysScroll(page);
  });

  test('on a landscape iPad the empty strip shows what is up next; desktop keeps the long label and no column', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    const client = await newClient('Nina');
    const logId = await liveLog(client.id);
    await signInAsCoach(page);
    await page.goto(`/clients/${client.id}/logs/${logId}`);
    const next = page.getByRole('complementary', { name: 'Up next' });
    await expect(next).toBeVisible();
    await expect(next.getByRole('listitem')).toHaveCount(1);
    await expect(next).toContainText('Pick one: Butterfly or Hamstring Stretch');
    await expect(next).toContainText('2 sets to go');
    const box = (await next.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1180);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(next).toBeHidden();
    await expect(page.getByText('NINA IS HERE')).toBeVisible();
    await expect(page.getByText('HERE NOW')).toBeHidden();
  });
});
