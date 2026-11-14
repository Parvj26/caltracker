import { devices, expect, test, type Page } from '@playwright/test';
import { demoWorkspace, freshClient, unique } from './assign-helpers';
import { serviceClient, signInAsCoach } from './helpers';

// The client's Food tab on phones: today first (totals against the targets, then today's meals with small photos),
// the targets in one line with Edit opening the form as a full-screen sheet, then the week as one compact row per day
// (Monday to Sunday, today marked) that expands to that day's meals. Chromium with iPhone sizes and touch. Each CI
// shard starts from an empty database, so every test seeds its own client and meals and removes them afterwards.

const admin = serviceClient();
let workspaceId: string;
const clients: string[] = [];

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  // Deleting the user removes their meals and targets with them.
  for (const id of clients) await admin.auth.admin.deleteUser(id);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
const SE = { width: 375, height: 667 };
const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const today = () => localDay(new Date());

async function newClient(first: string): Promise<string> {
  const id = await freshClient(admin, workspaceId, first, `Food${unique()}`);
  clients.push(id);
  return id;
}

/** A meal at local 12:15 today (the browser and this runner share a clock and time zone). */
async function seedMeal(clientId: string, name: string, macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number }) {
  const noon = new Date();
  noon.setHours(12, 15, 0, 0);
  const r = await admin.from('meals').insert({ workspace_id: workspaceId, client_id: clientId, eaten_at: noon.toISOString(), eaten_on: localDay(noon), name, ...macros });
  if (r.error) throw r.error;
}

async function seedTargets(clientId: string) {
  const r = await admin.from('nutrition_targets').insert({ workspace_id: workspaceId, client_id: clientId, calories: 2000, protein_g: 150, carbs_g: 250, fat_g: 70 });
  if (r.error) throw r.error;
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${innerWidth}px screen`).toBeLessThanOrEqual(innerWidth);
}

test.describe('iPhone SE (375 x 667)', () => {
  test.use({ ...iphone13, viewport: SE });

  test('today comes first: totals against the targets, then the meals, then the targets line', async ({ page }) => {
    test.slow();
    const client = await newClient('Fern');
    await seedMeal(client, 'Lunch', { calories: 650, protein_g: 42, carbs_g: 80, fat_g: 20 });
    await seedTargets(client);
    await signInAsCoach(page);
    await page.goto(`/clients/${client}/food`);

    const totals = page.getByTestId('food-today-totals');
    await expect(totals).toBeInViewport();
    await expect(totals).toContainText('650 / 2,000 kcal');
    await expect(page.getByTestId('food-today-gap')).toHaveText('1,350 left');
    for (const text of ['42 / 150 g', '80 / 250 g', '20 / 70 g']) await expect(totals).toContainText(text);

    const meal = page.getByTestId('food-today').getByTestId('coach-meal');
    await expect(meal).toContainText('Lunch');
    await expect(meal.getByRole('link', { name: 'Message Fern about Lunch' })).toBeVisible();
    await expect(page.getByTestId('food-targets-line')).toHaveText('2,000 kcal · 150 P · 250 C · 70 F');
    // Today's meal is on the first screen, above the targets line and the week.
    const mealBox = (await meal.boundingBox())!;
    expect(mealBox.y + mealBox.height).toBeLessThanOrEqual(SE.height);
    expect(mealBox.y).toBeLessThan((await page.getByTestId('food-targets').boundingBox())!.y);
    await expectNoSidewaysScroll(page);
  });

  test('the week is one compact row per day, Monday to Sunday, and a day expands to its meals', async ({ page }) => {
    test.slow();
    const client = await newClient('Wren');
    await seedMeal(client, 'Lunch', { calories: 650, protein_g: 42, carbs_g: 80, fat_g: 20 });
    await seedTargets(client);
    await signInAsCoach(page);
    await page.goto(`/clients/${client}/food`);

    await expect(page.getByTestId('food-week')).toBeHidden();
    await expect(page.locator('[data-testid^="food-phone-day-"]')).toHaveCount(7);
    const first = await page.locator('[data-testid^="food-phone-day-"]').first().getAttribute('data-testid');
    expect(new Date(`${first!.slice('food-phone-day-'.length)}T12:00:00Z`).getUTCDay(), 'the week starts on Monday').toBe(1);

    // The arrows and the dates sit on one line.
    const prev = (await page.getByRole('link', { name: 'Previous week' }).boundingBox())!;
    const range = (await page.getByTestId('food-week-range').boundingBox())!;
    expect(Math.abs(prev.y + prev.height / 2 - (range.y + range.height / 2))).toBeLessThan(6);

    const day = page.getByTestId(`food-phone-day-${today()}`);
    await expect(day).toContainText('Today');
    await expect(day).toContainText('650 kcal');
    await expect(day).toContainText('1 meal');
    const toggle = day.getByRole('button');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(day.getByTestId('coach-meal')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(day.getByTestId('coach-meal')).toContainText('Lunch');
    await expect(day.getByRole('link', { name: 'Message Wren about Lunch' })).toBeVisible();
    const box = (await toggle.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expectNoSidewaysScroll(page);
  });

  test('Edit opens the targets form as a full-screen sheet that saves', async ({ page }) => {
    test.slow();
    const client = await newClient('Ivy');
    await seedMeal(client, 'Lunch', { calories: 650, protein_g: 42, carbs_g: 80, fat_g: 20 });
    await seedTargets(client);
    await signInAsCoach(page);
    await page.goto(`/clients/${client}/food`);
    await page.getByRole('button', { name: 'Edit targets' }).click();
    const sheet = page.getByRole('dialog', { name: 'Daily targets' });
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBe(SE.width);
    await expect(sheet.getByRole('button', { name: 'Save targets' })).toBeInViewport();
    await sheet.getByLabel('Calories (kcal)').fill('2100');
    await sheet.getByRole('button', { name: 'Save targets' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('food-targets-line')).toHaveText('2,100 kcal · 150 P · 250 C · 70 F');
  });
});

test.describe('iPhone 13 (390 x 664)', () => {
  test.use({ ...iphone13 });

  test('a client who never logged food sees one message, not seven rows of zeros', async ({ page }) => {
    const client = await newClient('Noa');
    await signInAsCoach(page);
    await page.goto(`/clients/${client}/food`);
    await expect(page.getByTestId('food-empty')).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Noa hasn’t logged any meals yet' })).toBeVisible();
    await expect(page.getByText('They’ll appear here.')).toBeVisible();
    await expect(page.locator('[data-testid^="food-phone-day-"]')).toHaveCount(0);
    await expect(page.getByTestId('food-targets-line')).toHaveText('None yet. Noa sees them in the app.');
    await expectNoSidewaysScroll(page);
  });
});
