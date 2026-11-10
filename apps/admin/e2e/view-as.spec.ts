import { expect, test } from '@playwright/test';
import { auditActions, createUser, lit, seedClient, seedCoach, signInAdmin, sql, tag } from './helpers';

test('view as shows banner and no edit controls', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `View Coaching ${t}`);
  const client = await seedClient(coach.workspaceId, 'Parv', `J${t}`);
  sql(`insert into public.client_goals (workspace_id, client_id, goal) values (${lit(coach.workspaceId)}, ${lit(client.id)}, 'Squat 100 kg')`);
  const support = await createUser({ role: 'support', enrolled: true });
  await signInAdmin(page, support);

  await page.goto(`/clients/${client.id}`);
  await page.getByRole('link', { name: 'View as Parv (read-only)' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}/view-as$`));
  await expect(page.getByText(`Viewing as Parv J${t} · read-only · logged`)).toBeVisible();

  const frame = page.getByRole('region', { name: 'Client app (read-only)' });
  const tabs = frame.getByRole('tab');
  await expect(tabs).toHaveText(['Today', 'Workouts', 'Food', 'Progress']);
  await expect(frame.getByText(`Coach: Luis Bueno${t}`)).toBeVisible();

  for (const name of ['Today', 'Workouts', 'Food', 'Progress']) {
    await frame.getByRole('tab', { name }).click();
    await expect(frame.getByRole('tabpanel', { name })).toBeVisible();
    // One screen at a time.
    await expect(frame.getByRole('tabpanel')).toHaveCount(1);
    // The only buttons in the frame are the tabs; nothing can change data.
    const buttons = frame.getByRole('button');
    await expect(buttons).toHaveCount(0);
    await expect(frame.locator('input, textarea, select, form')).toHaveCount(0);
  }
  await expect(frame.getByRole('tabpanel', { name: 'Progress' })).toContainText('Squat 100 kg');

  await page.getByRole('link', { name: 'Exit' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}$`));
});

test('opening view as writes one audit row', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Audit View ${t}`);
  const client = await seedClient(coach.workspaceId, 'Ana', `A${t}`);
  const support = await createUser({ role: 'support', enrolled: true });
  await signInAdmin(page, support);
  await page.goto(`/clients/${client.id}/view-as`);
  await expect(page.getByText(`Viewing as Ana A${t} · read-only · logged`)).toBeVisible();
  // Switching tabs reads nothing new, so it logs nothing new.
  await page.getByRole('tab', { name: 'Food' }).click();
  await page.getByRole('tab', { name: 'Progress' }).click();
  expect(auditActions({ adminId: support.id, targetId: client.id })).toEqual(['view_as_snapshot']);
});

test('view as a removed client', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Removed View ${t}`);
  const client = await seedClient(coach.workspaceId, 'Rory', `R${t}`);
  sql(`select private.remove_client_core(${lit(coach.workspaceId)}, ${lit(client.id)}, ${lit(coach.id)})`);
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInAdmin(page, owner);

  await page.goto(`/clients/${client.id}/view-as`);
  await expect(page.getByText(`Viewing as Rory R${t} · read-only · logged`)).toBeVisible();
  const frame = page.getByRole('region', { name: 'Client app (read-only)' });
  await expect(frame.getByText('No coach')).toBeVisible();
  await expect(frame.getByText('Nothing planned today.')).toBeVisible();
  await frame.getByRole('tab', { name: 'Workouts' }).click();
  await expect(frame.getByText('No workouts logged yet.')).toBeVisible();
  await frame.getByRole('tab', { name: 'Food' }).click();
  await expect(frame.getByText('No meals logged today.')).toBeVisible();
  await frame.getByRole('tab', { name: 'Progress' }).click();
  await expect(frame.getByText('No bests yet.')).toBeVisible();
});

test('readonly cannot open view as', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Readonly View ${t}`);
  const client = await seedClient(coach.workspaceId, 'Rae', `R${t}`);
  const readonly = await createUser({ role: 'readonly', enrolled: true });
  await signInAdmin(page, readonly);
  await page.goto(`/clients/${client.id}/view-as`);
  await expect(page).toHaveURL(/\/not-authorised\?reason=role$/);
});
