import { randomUUID } from 'node:crypto';
import { devices, expect, test } from '@playwright/test';
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
  await expect(loggedRow).toContainText('Logged 1 time');
  await expect(page.getByTestId('coach-meal-row').filter({ hasText: fresh })).toContainText('Not logged yet');
});

test('the coach adds a meal with a photo, edits it and removes it', async ({ page }) => {
  const name = `E2E Turkey chili ${unique()}`.slice(0, 40);
  await signInAsCoach(page);
  await page.goto('/meals');
  await page.getByRole('link', { name: '+ New meal' }).click();
  await expect(page).toHaveURL(/\/meals\/new$/);

  const form = page.getByRole('form', { name: 'New meal' });
  await form.getByLabel('Name').fill(name);
  await form.getByTestId('coach-meal-photo-input').setInputFiles('e2e/fixtures/meal.jpg');
  await expect(form.getByRole('img', { name: 'Meal photo' })).toBeVisible();
  await form.getByLabel('Calories (kcal)').fill('490');
  await form.getByLabel('Protein (g)').fill('45');
  await form.getByLabel('Carbs (g)').fill('38');
  await form.getByLabel('Fat (g)').fill('14');
  await form.getByLabel('Ingredients').fill('500 g turkey mince\n1 tin beans');
  await form.getByLabel('How to make it').fill('Brown the mince, add the rest, simmer 20 minutes.');
  await form.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/meals\/[0-9a-f-]{36}$/);
  const row = page.getByTestId('coach-meal-row').filter({ hasText: name });
  await expect(row).toContainText('490 kcal · 45 P · 38 C · 14 F');
  await expect(row).toContainText('Not logged yet');
  await expect(row.getByRole('img', { name: `${name} photo` })).toBeVisible();
  const saved = await admin.from('coach_meals').select('id, photo_path, photo_width').eq('name', name).single();
  expect(saved.data?.photo_path).toMatch(new RegExp(`^${workspaceId}/${saved.data?.id}-[0-9a-f-]{36}\\.(webp|jpg)$`));
  expect(saved.data?.photo_width).toBe(80);

  // Edit.
  const edit = page.getByRole('form', { name: 'Edit meal' });
  await edit.getByLabel('Calories (kcal)').fill('500');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit.getByRole('status')).toHaveText('Saved');
  await expect(row).toContainText('500 kcal · 45 P · 38 C · 14 F');

  // A name that's too long is refused with a message.
  await edit.getByLabel('Name').fill('x'.repeat(41));
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit.getByText('Keep the name to 40 characters.')).toBeVisible();
  await edit.getByLabel('Name').fill(name);

  // Remove.
  await edit.getByRole('button', { name: 'Remove meal' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText("Remove this meal? Clients won't see it any more. Meals they already logged stay.");
  await dialog.getByRole('button', { name: 'Remove meal' }).click();
  await expect(page).toHaveURL(/\/meals$/);
  await expect(page.getByTestId('coach-meal-row').filter({ hasText: name })).toHaveCount(0);
  const gone = await admin.from('coach_meals').select('deleted_at').eq('name', name).single();
  expect(gone.data?.deleted_at).not.toBeNull();
});

test('Cancel leaves the meal form, asking "Discard changes?" only after typing', async ({ page }) => {
  await signInAsCoach(page);
  await page.goto('/meals/new');
  const form = page.getByRole('form', { name: 'New meal' });
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/meals$/);

  await page.goto('/meals/new');
  await form.getByLabel('Name').fill(`E2E Unsaved ${unique()}`);
  await form.getByRole('button', { name: 'Cancel' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Discard changes?');
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/meals\/new$/);
  await expect(form.getByLabel('Name')).not.toHaveValue('');

  await form.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/\/meals$/);
});

test('the meals search finds a meal despite a typo and keeps the text in the address', async ({ page }) => {
  const tag = unique();
  const wanted = `E2E Lentil soup ${tag}`;
  const other = `E2E Banana bread ${tag}`;
  await seedCoachMeal(wanted, 320);
  await seedCoachMeal(other, 410);
  await signInAsCoach(page);
  await page.goto('/meals');
  const rows = page.getByTestId('coach-meal-row');
  await expect(rows.filter({ hasText: other })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search meals' }).fill(`lentl ${tag}`);
  await expect(rows.filter({ hasText: wanted })).toBeVisible();
  await expect(rows.filter({ hasText: other })).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]q=lentl/);
  // The text is kept when a meal opens beside the list.
  await rows.filter({ hasText: wanted }).click();
  await expect(page.getByRole('form', { name: 'Edit meal' }).getByLabel('Name')).toHaveValue(wanted);
  await expect(page.getByRole('searchbox', { name: 'Search meals' })).toHaveValue(`lentl ${tag}`);
  await expect(rows.filter({ hasText: other })).toHaveCount(0);
});

// Phones (approved redesign, row 4 option A): the list is its own screen and a meal opens full screen.
test.describe('on an iPhone', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iphone13 } = devices['iPhone 13'];
  test.use({ ...iphone13 });

  test('a tap on a meal opens the full-screen editor; Back returns to the list; ⋯ removes it', async ({ page }) => {
    test.slow();
    const name = `E2E Phone wrap ${unique()}`.slice(0, 40);
    const id = await seedCoachMeal(name, 520);
    await signInAsCoach(page);
    await page.goto('/meals');
    const row = page.getByTestId('coach-meal-row').filter({ hasText: name });
    // No photo: the meal's first letter stands in, and the hint panel of the laptop layout is gone.
    await expect(row).toContainText('Not logged yet');
    await expect(page.getByText('Pick a meal to edit it, or add a new one.')).toBeHidden();
    await row.click();

    await expect(page).toHaveURL(new RegExp(`/meals/${id}$`));
    const form = page.getByRole('form', { name: 'Edit meal' });
    await expect(form.getByLabel('Name')).toHaveValue(name);
    // Full screen: the list and the page title are gone, the editor's own bar is at the top.
    await expect(page.getByRole('list', { name: 'Shared meals' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Meals', level: 1 })).toBeHidden();
    await expect(form.getByRole('link', { name: 'Back to meals' })).toBeInViewport();
    await expect(form.getByRole('button', { name: 'Save' })).toBeInViewport({ ratio: 1 });
    await expect(form.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
    // Remove lives in the ⋯ menu on a phone.
    await expect(form.getByRole('button', { name: 'Remove meal' })).toBeHidden();

    // Saving keeps "Saved" on screen after the page refreshes with the saved meal.
    await form.getByLabel('Calories (kcal)').fill('530');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('status')).toHaveText('Saved');
    // In the Save bar stuck to the bottom, so it shows without scrolling.
    await expect(form.getByRole('status')).toBeInViewport();
    await expect.poll(async () => (await admin.from('coach_meals').select('calories').eq('id', id).single()).data?.calories).toBe(530);
    await expect(form.getByRole('status')).toHaveText('Saved');

    await form.getByRole('link', { name: 'Back to meals' }).click();
    await expect(page).toHaveURL(/\/meals$/);
    await expect(row).toContainText('530 kcal');
    await expect(page.getByRole('heading', { name: 'Meals', level: 1 })).toBeVisible();

    // The phone's Back gesture works too: open again, go back.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/meals/${id}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/meals$/);
    await expect(row).toBeVisible();

    await row.click();
    await form.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menu', { name: 'Meal actions' }).getByRole('menuitem', { name: 'Remove meal' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Remove this meal?');
    await dialog.getByRole('button', { name: 'Remove meal' }).click();
    await expect(page).toHaveURL(/\/meals$/);
    await expect(page.getByTestId('coach-meal-row').filter({ hasText: name })).toHaveCount(0);
  });

  test('+ New meal opens an empty full-screen form, and Back leaves it', async ({ page }) => {
    await signInAsCoach(page);
    await page.goto('/meals');
    await page.getByRole('link', { name: '+ New meal' }).click();
    await expect(page).toHaveURL(/\/meals\/new$/);
    const form = page.getByRole('form', { name: 'New meal' });
    await expect(form.getByLabel('Name')).toHaveValue('');
    await expect(form.getByLabel('Name')).toBeInViewport();
    await expect(form.getByRole('button', { name: 'Save meal' })).toBeInViewport({ ratio: 1 });
    await expect(form.getByRole('button', { name: 'More' })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Shared meals' })).toBeHidden();

    // Back with something typed asks first, like Cancel.
    await form.getByLabel('Name').fill(`E2E Unsaved ${unique()}`);
    await form.getByRole('link', { name: 'Back to meals' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Discard changes?');
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/meals$/);
    await expect(page.getByRole('heading', { name: 'Meals', level: 1 })).toBeVisible();
  });
});
