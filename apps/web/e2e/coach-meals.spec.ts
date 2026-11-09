import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';

// The coach website's Meals: meals shared with every client, with how often clients logged each one. Each test
// seeds its own meals (unique names) and removes them afterwards.
const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const created: { meals: string[]; users: string[] } = { meals: [], users: [] };
let workspaceId: string;

test.beforeAll(async () => {
  const ws = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (ws.error) throw ws.error;
  workspaceId = ws.data.id;
});

test.afterAll(async () => {
  // Deleting a client removes their meals; then the coach meals can go.
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
  if (created.meals.length) await admin.from('coach_meals').delete().in('id', created.meals);
  const left = await admin.from('coach_meals').select('id, photo_path, photo_thumb_path').like('name', 'E2E %');
  const files = (left.data ?? []).flatMap((m) => [m.photo_path, m.photo_thumb_path].filter((p): p is string => p !== null));
  if (files.length) await admin.storage.from('coach-meal-photos').remove(files);
  await admin.from('coach_meals').delete().like('name', 'E2E %');
});

async function seedCoachMeal(name: string, kcal: number): Promise<string> {
  const id = randomUUID();
  const r = await admin.from('coach_meals').insert({ id, workspace_id: workspaceId, name, calories: kcal, protein_g: 35, carbs_g: 52, fat_g: 11 });
  if (r.error) throw r.error;
  created.meals.push(id);
  return id;
}

async function seedLoggedBy(coachMealId: string) {
  const u = await admin.auth.admin.createUser({
    email: `coach-meals-${unique()}@example.com`,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: 'Mia', last_name: `Meals${unique()}` },
  });
  if (u.error) throw u.error;
  created.users.push(u.data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  const meal = await admin.from('meals').insert({
    workspace_id: workspaceId,
    client_id: u.data.user.id,
    eaten_on: new Intl.DateTimeFormat('en-CA').format(new Date()),
    name: 'Logged',
    calories: 450,
    coach_meal_id: coachMealId,
  });
  if (meal.error) throw meal.error;
}

test('the Meals page lists shared meals with how often they were logged', async ({ page }) => {
  const logged = `E2E Oats ${unique()}`;
  const fresh = `E2E Chili ${unique()}`;
  const loggedId = await seedCoachMeal(logged, 450);
  await seedCoachMeal(fresh, 490);
  await seedLoggedBy(loggedId);

  await signInAsCoach(page);
  await page.goto('/home');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Meals' }).click();
  await expect(page).toHaveURL(/\/meals$/);
  await expect(page.getByRole('heading', { name: 'Meals', level: 1 })).toBeVisible();
  await expect(page.getByText('Shared with all your clients. They can log any of these in one tap.')).toBeVisible();

  const loggedRow = page.getByTestId('coach-meal-row').filter({ hasText: logged });
  await expect(loggedRow).toContainText('450 kcal · 35 P · 52 C · 11 F');
  await expect(loggedRow).toContainText('logged 1×');
  await expect(page.getByTestId('coach-meal-row').filter({ hasText: fresh })).toContainText('not yet');
});
