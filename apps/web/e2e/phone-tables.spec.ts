import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { demoWorkspace, freshClient, unique } from './assign-helpers';
import { seedLog, serviceClient, signInAsCoach } from './helpers';

// Phone fixes, batch 2: Activity as cards, the Food week as one row per day with four bars, the client tabs' arrow,
// and the live view (short "HERE NOW" on phones, Up next on a landscape iPad). Chromium with iPhone sizes and touch
// (the browser can't be chosen per spec). Each CI shard starts from an empty database, so every test seeds its own
// client, log and meals in the demo workspace, and everything is removed afterwards.

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
const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());

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

  test('Activity shows each workout as a card with every detail on screen', async ({ page }) => {
    const client = await newClient('Cara');
    const name = `Card ${unique()}`;
    await seedLog(admin, { workspaceId, clientId: client.id, name, startedAt: ago(120), finishedAt: ago(67) });
    await signInAsCoach(page);
    await page.goto(`/activity?client=${client.id}`);
    // Still a table for screen readers (and the other tests), drawn as cards.
    const table = page.getByRole('table', { name: 'Finished workouts' });
    const row = table.getByRole('row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    for (const text of [client.name, name, '53 min', '3 sets']) await expectOnScreen(row.getByText(text, { exact: true }));
    await expectOnScreen(row.getByText(/lifted$/));
    await expectOnScreen(row.locator('time'));
    const box = (await row.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(SE.width);
    await expectNoSidewaysScroll(page);
  });

  test('the Food week is one row per day with calories, protein, carbs and fat against the targets', async ({ page }) => {
    const client = await newClient('Fern');
    const noon = new Date();
    noon.setHours(12, 15, 0, 0);
    const meal = await admin.from('meals').insert({
      workspace_id: workspaceId, client_id: client.id, eaten_at: noon.toISOString(), eaten_on: today(), name: 'Lunch',
      calories: 650, protein_g: 42, carbs_g: 80, fat_g: 20,
    });
    if (meal.error) throw meal.error;
    const targets = await admin.from('nutrition_targets').insert({ workspace_id: workspaceId, client_id: client.id, calories: 2000, protein_g: 150, carbs_g: 250, fat_g: 70 });
    if (targets.error) throw targets.error;
    await signInAsCoach(page);
    await page.goto(`/clients/${client.id}/food`);

    await expect(page.getByTestId('food-week')).toBeHidden();
    const day = page.getByTestId(`food-phone-day-${today()}`);
    await expect(day).toBeVisible();
    await expect(day).toContainText('Today');
    await expect(day).toContainText('1 meal');
    for (const [label, amount] of [['Calories', '650 / 2,000'], ['Protein', '42 / 150'], ['Carbs', '80 / 250'], ['Fat', '20 / 70']] as const) {
      await expectOnScreen(day.getByText(label, { exact: true }));
      await expectOnScreen(day.getByText(amount));
    }
    // Seven days, each with its name on one line.
    await expect(page.getByTestId('food-week-phone').getByRole('listitem')).toHaveCount(7);
    const head = (await day.locator('p').first().boundingBox())!;
    expect(head.height).toBeLessThan(30);
    await expectNoSidewaysScroll(page);
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
    // The Up next column is only for a landscape iPad.
    await expect(page.getByRole('complementary', { name: 'Up next' })).toBeHidden();
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
