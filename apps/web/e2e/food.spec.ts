import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';

// The client page's Food tab: the coach sets daily targets, sees the week's totals against them and each meal with
// its photo, and "Reply about this meal" opens Messages with the reply started. Each test seeds its own client.
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

const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());

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

/** A meal eaten today at local noon (the browser and this runner share a clock and time zone). */
async function seedMeal(clientId: string, o: { name: string | null; calories?: number; protein?: number; note?: string; photo?: boolean }) {
  const id = randomUUID();
  const noon = new Date();
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
    eaten_on: today(),
    name: o.name,
    note: o.note ?? '',
    calories: o.calories ?? null,
    protein_g: o.protein ?? null,
    ...photo,
  });
  if (r.error) throw r.error;
}

test('the coach sets targets and sees the day against them', async ({ page }) => {
  const client = await newClient();
  await seedMeal(client.id, { name: 'Lunch', calories: 650, protein: 42 });
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}`);
  await page.getByRole('navigation', { name: 'Client sections' }).getByRole('link', { name: 'Food' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/food$`));
  await expect(page.getByText('No targets yet. Set them above to see each day against them.')).toBeVisible();

  const todayRow = page.getByTestId(`food-day-${today()}`);
  await expect(todayRow).toContainText('650');
  await expect(todayRow).toContainText('42');

  await page.getByLabel('Calories (kcal)').fill('2000');
  await page.getByLabel('Protein (g)').fill('150');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByLabel('Calories (kcal)')).toHaveValue('2000');
  await expect(page.getByLabel('Carbs (g)')).toHaveValue('');
  await expect(todayRow).toContainText('650 / 2,000');
  await expect(todayRow).toContainText('42 / 150');

  const row = await admin.from('nutrition_targets').select('calories, protein_g, carbs_g').eq('client_id', client.id).single();
  expect(row.data).toEqual({ calories: 2000, protein_g: 150, carbs_g: null });
});

test('a bad target is refused with a message', async ({ page }) => {
  const client = await newClient();
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/food`);
  await page.getByLabel('Fat (g)').fill('5000');
  await page.getByRole('button', { name: 'Save targets' }).click();
  await expect(page.getByText('Fat can be at most 1,000 g.')).toBeVisible();
});

test('meals show with their photos, and "Reply about this meal" starts a message', async ({ page }) => {
  const client = await newClient();
  await seedMeal(client.id, { name: 'Lunch', calories: 650, protein: 42, note: 'Chicken and rice', photo: true });
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/food`);
  const meal = page.getByTestId('coach-meal');
  await expect(meal).toContainText('Lunch');
  await expect(meal).toContainText('12:15 pm');
  await expect(meal).toContainText('650 kcal · P 42 g');
  await expect(meal).toContainText('Chicken and rice');
  await expect(meal.getByRole('img', { name: 'Lunch photo' })).toBeVisible();

  await meal.getByRole('link', { name: 'Reply about this meal' }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/${client.id}\\?about=`));
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('About your Lunch today (12:15 pm): ');
  // The bare start says nothing yet: Send waits for the coach's own words.
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Message', exact: true }).pressSequentially('looks great');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('an empty week says so, and the next week stops at this week', async ({ page }) => {
  const client = await newClient();
  await signInAsCoach(page);
  await page.goto(`/clients/${client.id}/food`);
  await expect(page.getByTestId('food-empty')).toHaveText('Fay hasn’t logged any meals this week.');
  await expect(page.getByTestId('food-next-week')).toHaveCount(0);
  await page.getByTestId('food-prev-week').click();
  await expect(page).toHaveURL(/\?week=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId('food-next-week')).toBeVisible();
});
