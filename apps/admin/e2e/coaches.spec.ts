import { expect, test } from '@playwright/test';
import { auditActions, createUser, lit, seedClient, seedCoach, signInAdmin, sql, tag } from './helpers';

// Add coach and Delete coach (owner only). They go through the admin-coach Edge Function (functions:serve).

test('owner adds a coach and the row appears', async ({ page }) => {
  const t = tag();
  const email = `new-coach-${t}@e2e.local`;
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInAdmin(page, owner);
  await page.goto('/coaches');

  const add = page.getByRole('region', { name: 'Add a coach' });
  await add.getByLabel('First name').fill('Sam');
  await add.getByLabel('Last name').fill(`Rivera${t}`);
  await add.getByLabel('Email').fill(email);
  await add.getByLabel('Workspace name').fill(`Sam Fit ${t}`);
  await add.getByRole('button', { name: 'Add coach' }).click();
  await expect(page.getByRole('status')).toContainText(`Sam Rivera${t} added`);

  const row = page.getByRole('row', { name: new RegExp(`Sam Rivera${t}`) });
  await expect(row).toContainText(`Sam Fit ${t}`);
  await expect(row).toContainText('0 · No plan yet');
  expect(auditActions({ adminId: owner.id })).toEqual(['add_coach']);
  expect(sql(`select count(*) from public.workspace_members m join auth.users u on u.id = m.user_id
              where lower(u.email) = lower(${lit(email)}) and m.role = 'owner'`)).toBe('1');

  // The same email again is refused with a clear message.
  await add.getByLabel('First name').fill('Sam');
  await add.getByLabel('Email').fill(email);
  await add.getByLabel('Workspace name').fill(`Second ${t}`);
  await add.getByRole('button', { name: 'Add coach' }).click();
  await expect(add.getByRole('alert')).toContainText('That email already belongs to a coach or staff member.');
});

test('support sees no Add coach or Delete coach controls', async ({ page }) => {
  const t = tag();
  await seedCoach('Luis', `Bueno${t}`, `Support View ${t}`);
  const support = await createUser({ role: 'support', enrolled: true });
  await signInAdmin(page, support);
  await page.goto('/coaches');
  await expect(page.getByRole('row', { name: new RegExp(`Luis Bueno${t}`) })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Add a coach' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete coach' })).toHaveCount(0);
});

test('delete coach needs the exact workspace name, then the row is gone and the audit log shows it', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Delete Me ${t}`);
  const client = await seedClient(coach.workspaceId, 'Kay', `K${t}`);
  sql(`insert into public.programs (workspace_id, name, created_by) values (${lit(coach.workspaceId)}, 'Strength', ${lit(coach.id)})`);
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInAdmin(page, owner);
  await page.goto('/coaches');

  const row = page.getByRole('row', { name: new RegExp(`Luis Bueno${t}`) });
  await row.getByRole('button', { name: 'Delete coach' }).click();
  const dialog = page.getByRole('dialog', { name: `Delete Delete Me ${t}?` });
  await expect(dialog).toContainText(`Luis Bueno${t}’s coach account`);
  await expect(dialog).toContainText('1 program, 0 workouts, 0 shared meals, their custom exercises');
  await expect(dialog).toContainText('1 client keeps their account.');

  const confirm = dialog.getByLabel(`Type Delete Me ${t} to confirm`);
  const del = dialog.getByRole('button', { name: 'Delete coach' });
  await expect(del).toBeDisabled();
  await confirm.fill(`delete me ${t}`);
  await expect(del).toBeDisabled();
  await confirm.fill(`Delete Me ${t}`);
  await expect(del).toBeEnabled();
  await del.click();

  await expect(page.getByRole('status')).toContainText(`Delete Me ${t} deleted · 1 client emailed`);
  await expect(page.getByRole('row', { name: new RegExp(`Luis Bueno${t}`) })).toHaveCount(0);
  expect(sql(`select count(*) from public.workspaces where id = ${lit(coach.workspaceId)}`)).toBe('0');
  expect(sql(`select count(*) from auth.users where id = ${lit(coach.id)}`)).toBe('0');
  // The client keeps their account and is now a client with no coach.
  expect(sql(`select count(*) from auth.users where id = ${lit(client.id)}`)).toBe('1');
  expect(auditActions({ adminId: owner.id })).toEqual(['delete_coach']);

  await page.goto('/clients');
  await expect(page.getByRole('region', { name: 'No coach' }).getByRole('link', { name: `Kay K${t}` })).toBeVisible();

  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Audit log' }).click();
  const audit = page.getByRole('row', { name: /Deleted a coach/ }).first();
  await expect(audit).toContainText(`Luis Bueno${t}`);
  await expect(audit).toContainText(`Delete Me ${t}`);
});
