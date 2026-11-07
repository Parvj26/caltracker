import { expect, test } from '@playwright/test';
import { serviceClient, signInAsCoach } from './helpers';
import { browserToday, clickCounter, deleteCoach, demoWorkspace, freshClient, newCoachWithClient, signInAs, unique } from './assign-helpers';

// Home's Assign: every client row has Assign, a plain link to the client's Training calendar (no dialog opens by
// itself there). Before, only Program ending / Nothing planned rows had it, and it opened "Assign a program" (a dead
// end with no programs). Home search lands on Training too.
// Clicks from Home to a client's calendar: before 2 (Open, then the Training tab); now 1 (Assign), from every row.
const admin = serviceClient();
const users: string[] = [];
const coaches: Awaited<ReturnType<typeof newCoachWithClient>>[] = [];
let workspaceId: string;

test.beforeAll(async () => {
  workspaceId = await demoWorkspace(admin);
});

test.afterAll(async () => {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  for (const c of coaches) await deleteCoach(admin, c);
});

test("Assign on a Today's clients row opens the client's Training, with nothing popping up", async ({ page }) => {
  const last = `Quick${unique()}`;
  const clientId = await freshClient(admin, workspaceId, 'Quinn', last);
  users.push(clientId);
  await signInAsCoach(page);
  const today = await browserToday(page);
  const name = `Today ${unique()}`;
  const ins = await admin.from('workouts').insert({ workspace_id: workspaceId, client_id: clientId, scheduled_on: today, name });
  expect(ins.error).toBeNull();

  await page.goto('/home');
  const row = page.locator('#today li').filter({ hasText: `Quinn ${last}` });
  const assign = row.getByRole('link', { name: `Assign to Quinn ${last}`, exact: true });
  await expect(assign).toHaveAttribute('href', `/clients/${clientId}/training`);
  const clicks = clickCounter();
  await clicks.on(assign);
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/training$`));
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(clicks.count).toBe(1);
  await admin.from('workouts').delete().eq('client_id', clientId);
});

test('client search on Home lands on Training', async ({ page }) => {
  const last = `Find${unique()}`;
  const clientId = await freshClient(admin, workspaceId, 'Fay', last);
  users.push(clientId);
  await signInAsCoach(page);
  await page.goto('/home');
  await page.getByRole('combobox', { name: 'Find a client' }).fill(last);
  await page.getByRole('option', { name: new RegExp(`Fay ${last}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/training$`));
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible();
});

test('with no programs, Assign program offers Build a program or a single workout instead of a dead end', async ({ page }) => {
  const coach = await newCoachWithClient(admin, 'NoProg');
  coaches.push(coach);
  await signInAs(page, coach.email);
  await page.getByRole('link', { name: `Assign to ${coach.clientName}` }).first().click();
  await expect(page).toHaveURL(new RegExp(`/clients/${coach.clientId}/training$`));
  await page.getByRole('button', { name: 'Assign program', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign a program' });
  await expect(dialog.getByRole('link', { name: 'Build a program' })).toHaveAttribute('href', '/programs/new');
  await dialog.getByRole('button', { name: 'Add a single workout' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Add a workout' })).toBeVisible();
});
