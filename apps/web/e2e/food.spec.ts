import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';

// The client page's Food tab (desktop): today's totals and meals first, the targets in one line with Edit opening the
// form, then the week's table. "Message about this meal" opens Messages with the reply started. Each test seeds its own
// client. The phone layout is in phone-food.spec.ts.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { users: string[]; files: string[] } = { users: [], files: [] };
let workspaceId: string;

// A 1 x 1 JPEG: enough for the browser to load a photo.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

test.beforeAll(async () => {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  if (created.files.length) await admin.storage.from('meal-photos').remove(created.files);
  // Deleting a client removes their meals and targets with them.
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
});

const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const today = () => localDay(new Date());

async function newClient(): Promise<{ id: string; last: string }> {
  const last = `Food${unique()}`;
  const u = await admin.auth.admin.createUser({
    email: `food-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: 'Fay', last_name: last },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return { id: u.data.user.id, last };
}

/** A meal eaten at local 12:15, today or `daysAgo` days before (the browser and this runner share a clock and zone). */
async function seedMeal(clientId: string, o: { name: string | null; calories?: number; protein?: number; note?: string; photo?: boolean; daysAgo?: number }) {
  const id = randomUUID();
  const noon = new Date();
  noon.setDate(noon.getDate() - (o.daysAgo ?? 0));
  noon.setHours(12, 15, 0, 0);
  let photo: { photo_path: string; photo_thumb_path: string; photo_width: number; photo_height: number } | object = {};
  if (o.photo) {
    const photoId = randomUUID();
    const path = `${workspaceId}/${clientId}/${id}-${photoId}.jpg`;
    const thumbPath = `${workspaceId}/${clientId}/${id}-${photoId}-thumb.jpg`;
    for (const p of [path, thumbPath]) {
      const up = await admin.storage.from('meal-photos').upload(p, JPEG, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      created.files.push(p);
    }
    photo = { photo_path: path, photo_thumb_path: thumbPath, photo_width: 1, photo_height: 1 };
  }
  const r = await admin.from('meals').insert({
    id,
    workspace_id: workspaceId,
    client_id: clientId,
    eaten_at: noon.toISOString(),
    eaten_on: localDay(noon),
    name: o.name,
    note: o.note ?? '',
    calories: o.calories ?? null,
    protein_g: o.protein ?? null,
    ...photo,
  });
  if (r.error) throw r.error;
}

test('the coach sets targets in the sheet and sees today against them', async ({ page }) => {
  test.slow();
  const client = await newClient();
  await seedMeal(client.id, { name: 'Lunch', calories: 650, protein: 42 });
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}`);
  await page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: 'Food' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/food$`));
  await expect(page.getByTestId('food-targets-line')).toHaveText('None yet. Fay sees them in the app.');
  await expect(page.getByText('No targets yet. Set them to see each day against them.')).toBeVisible();

  const totals = page.getByTestId('food-today-totals');
  await expect(totals).toContainText('650 kcal');
  const todayRow = page.getByTestId(`food-day-${today()}`);
  await expect(todayRow).toContainText('650');
  await expect(todayRow).toContainText('42');

  // The form opens in a dialog; nothing to fill on the page itself.
  await expect(page.getByLabel('Calories (kcal)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Set targets' }).click();
  const dialog = page.getByRole('dialog', { name: 'Daily targets' });
  await dialog.getByLabel('Calories (kcal)').fill('2000');
  await dialog.getByLabel('Protein (g)').fill('150');
  await dialog.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('food-targets-line')).toHaveText('2,000 kcal · 150 P');

  await page.reload();
  await expect(page.getByTestId('food-targets-line')).toHaveText('2,000 kcal · 150 P');
  await expect(totals).toContainText('650 / 2,000 kcal');
  await expect(page.getByTestId('food-today-gap')).toHaveText('1,350 left');
  await expect(totals).toContainText('42 / 150 g');
  await expect(todayRow).toContainText('650 / 2,000');
  await expect(todayRow).toContainText('42 / 150');
  await page.getByRole('button', { name: 'Edit targets' }).click();
  await expect(dialog.getByLabel('Calories (kcal)')).toHaveValue('2000');
  await expect(dialog.getByLabel('Carbs (g)')).toHaveValue('');

  const row = await admin.from('nutrition_targets').select('calories, protein_g, carbs_g').eq('client_id', client.id).single();
  expect(row.data).toEqual({ calories: 2000, protein_g: 150, carbs_g: null });
});

test('a bad target is refused with a message, and the sheet stays open', async ({ page }) => {
  const client = await newClient();
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/food`);
  await page.getByRole('button', { name: 'Set targets' }).click();
  const dialog = page.getByRole('dialog', { name: 'Daily targets' });
  await dialog.getByLabel('Fat (g)').fill('5000');
  await dialog.getByRole('button', { name: 'Save targets' }).click();
  await expect(dialog.getByText('Fat can be at most 1,000 g.')).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('today\'s meals show with their photos, and the message link starts a message', async ({ page }) => {
  test.slow();
  const client = await newClient();
  await seedMeal(client.id, { name: 'Lunch', calories: 650, protein: 42, note: 'Chicken and rice', photo: true });
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/food`);
  const meal = page.getByTestId('food-today').getByTestId('coach-meal');
  await expect(meal).toContainText('Lunch');
  await expect(meal).toContainText('12:15 pm · 650 kcal · P 42 g');
  await expect(meal).toContainText('Chicken and rice');

  // The small photo opens the whole photo.
  await meal.getByRole('button', { name: 'See Lunch photo larger' }).click();
  const photo = page.getByRole('dialog', { name: 'Lunch' });
  await expect(photo.getByRole('img', { name: 'Lunch photo' })).toBeVisible();
  await photo.getByRole('button', { name: 'Close' }).last().click();
  await expect(photo).toHaveCount(0);

  await meal.getByRole('link', { name: 'Message Fay about Lunch' }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/${client.id}\\?about=`));
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('About your Lunch today (12:15 pm): ');
  // The bare start says nothing yet: Send waits for the coach's own words.
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Message', exact: true }).pressSequentially('looks great');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('a client who never logged food gets one message instead of a week of zeros', async ({ page }) => {
  const client = await newClient();
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/food`);
  const empty = page.getByTestId('food-empty');
  await expect(empty.getByRole('heading', { name: 'Fay hasn’t logged any meals yet' })).toBeVisible();
  await expect(empty).toContainText('They’ll appear here.');
  await expect(empty.getByRole('link', { name: 'Message Fay' })).toHaveAttribute('href', `/messages/${client.id}`);
  await expect(page.getByTestId('food-week')).toHaveCount(0);
  await expect(page.getByTestId('food-today')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set targets' })).toBeVisible();
});

test('a quiet week shows today empty, and the week arrows stop at this week', async ({ page }) => {
  test.slow();
  const client = await newClient();
  await seedMeal(client.id, { name: 'Old lunch', calories: 500, daysAgo: 7 });
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/food`);
  await expect(page.getByTestId('food-today-empty')).toHaveText('No meals logged yet today.');
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await expect(page.getByTestId('food-next-week')).toHaveCount(0);
  await page.getByRole('link', { name: 'Previous week' }).click();
  await expect(page).toHaveURL(/\?week=\d{4}-\d{2}-\d{2}$/);
  // A past week has no "today" section, just the week and its meals.
  await expect(page.getByTestId('food-today')).toHaveCount(0);
  await expect(page.getByTestId('coach-meal').filter({ hasText: 'Old lunch' })).toBeVisible();
  await expect(page.getByTestId('food-next-week')).toBeVisible();
});
