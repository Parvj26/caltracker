import { expect, test } from '@playwright/test';
import { createUser, lit, signInAdmin, sql } from './helpers';

// Runs in its own project after every other test (playwright.config.ts): it needs to be the only owner for a moment.
test('with one owner, their row has no Remove link and they cannot demote themself', async ({ page }) => {
  const owner = await createUser({ role: 'owner', enrolled: true });
  const others = sql(`select user_id from public.admin_users where role = 'owner' and user_id <> ${lit(owner.id)}`)
    .split('\n')
    .filter(Boolean);
  if (others.length > 0) {
    sql(`update public.admin_users set role = 'support' where user_id in (${others.map(lit).join(', ')})`);
  }
  try {
    await signInAdmin(page, owner);
    await page.goto('/admins');
    const row = page.getByRole('row', { name: new RegExp(owner.email) });
    await expect(row).toContainText('Last owner');
    await expect(row.getByRole('button', { name: 'Remove' })).toHaveCount(0);

    // Their own email with a lower role would leave no owner.
    await page.getByLabel('Email').fill(owner.email.toUpperCase());
    await page.getByLabel('Role').selectOption('support');
    await expect(page.getByRole('button', { name: 'Add admin' })).toBeDisabled();
    await expect(page.getByText('Add another owner first.')).toBeVisible();
    await page.getByLabel('Role').selectOption('owner');
    await expect(page.getByRole('button', { name: 'Add admin' })).toBeEnabled();
  } finally {
    if (others.length > 0) {
      sql(`update public.admin_users set role = 'owner' where user_id in (${others.map(lit).join(', ')})`);
    }
  }
});
