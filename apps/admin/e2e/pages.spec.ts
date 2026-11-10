import { expect, test } from '@playwright/test';
import { auditActions, createUser, seedClient, seedCoach, seedExpiredInvite, signInAdmin, sql, lit, tag } from './helpers';

test('search finds a client with a typo', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Search Coaching ${t}`);
  const client = await seedClient(coach.workspaceId, 'Vaishali', `K${t}`);
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInAdmin(page, owner);

  // "Vaishaly" is one letter off.
  await page.getByLabel('Search anyone').fill(`Vaishaly K${t}`);
  const result = page.getByRole('link', { name: new RegExp(`Vaishali K${t}`) });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: `Vaishali K${t}` })).toBeVisible();
});

test('open client page shows health', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Health Coaching ${t}`);
  const client = await seedClient(coach.workspaceId, 'Parv', `J${t}`);
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInAdmin(page, owner);

  await page.goto(`/clients/${client.id}`);
  await expect(page.getByRole('heading', { level: 1, name: `Parv J${t}` })).toBeVisible();
  await expect(page.getByText(`Client of Luis Bueno${t}`)).toBeVisible();
  const health = page.getByRole('region', { name: 'Account health' });
  await expect(health.getByText('Email confirmed')).toContainText('Yes');
  await expect(health.getByText('Notifications:')).toContainText('Off');
  await expect(health.getByText('App: not installed')).toBeVisible();
  const fix = page.getByRole('region', { name: 'Fix it' });
  for (const name of ['Send password reset', 'Move to another coach…', 'Send test notification']) {
    await expect(fix.getByRole('button', { name })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Recent errors' })).toContainText('None in the last 7 days.');
  // No PostHog key locally: the timeline still renders, with a note.
  await expect(page.getByRole('region', { name: 'Timeline' })).toContainText('Tracking timeline unavailable');
  await expect(page.getByRole('link', { name: 'View as Parv (read-only)' })).toBeVisible();
});

test('resend invite from Needs attention writes an audit row', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Invite Coaching ${t}`);
  const email = `invitee-${t}@e2e.local`;
  const inviteId = seedExpiredInvite(coach, email, 'Newbie', `N${t}`);
  const support = await createUser({ role: 'support', enrolled: true });
  await signInAdmin(page, support);

  const row = page.getByRole('row', { name: new RegExp(`Newbie N${t}`) });
  await expect(row.getByText('Invite expired')).toBeVisible();
  await row.getByRole('button', { name: 'Resend invite' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resend invite?' });
  await expect(dialog).toContainText(email);
  await dialog.getByRole('button', { name: 'Resend invite' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invite sent' })).toBeVisible();

  expect(auditActions({ adminId: support.id })).toEqual(['resend_invite']);
  // A fresh 24 h invite replaced the expired one.
  expect(sql(`select expires_at > now() from public.client_invites where id = ${lit(inviteId)}`)).toBe('t');

  // And it is in the audit log.
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('row', { name: /Resent an invite/ }).first()).toBeVisible();
});

test('fix it actions confirm and write audit rows', async ({ page }) => {
  const t = tag();
  const from = await seedCoach('Luis', `Bueno${t}`, `From Coaching ${t}`);
  const to = await seedCoach('Maya', `Patel${t}`, `To Coaching ${t}`);
  const client = await seedClient(from.workspaceId, 'Sam', `S${t}`);
  const support = await createUser({ role: 'support', enrolled: true });
  await signInAdmin(page, support);
  await page.goto(`/clients/${client.id}`);
  const fix = page.getByRole('region', { name: 'Fix it' });

  await fix.getByRole('button', { name: 'Send test notification' }).click();
  await page.getByRole('dialog', { name: 'Send a test notification?' }).getByRole('button', { name: 'Send' }).click();
  await expect(fix.getByRole('status')).toContainText('Test notification queued');
  // A second one within a minute is refused, with the database's reason.
  await fix.getByRole('button', { name: 'Send test notification' }).click();
  await page.getByRole('dialog', { name: 'Send a test notification?' }).getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('dialog', { name: 'Send a test notification?' }).getByRole('alert')).toContainText(
    'Test notification already sent, wait a minute',
  );
  await page.getByRole('dialog', { name: 'Send a test notification?' }).getByRole('button', { name: 'Cancel' }).click();

  await fix.getByRole('button', { name: 'Send password reset' }).click();
  await page.getByRole('dialog', { name: 'Send a password reset?' }).getByRole('button', { name: 'Send' }).click();
  await expect(fix.getByRole('status')).toContainText('Password reset email sent');

  await fix.getByRole('button', { name: 'Move to another coach…' }).click();
  const move = page.getByRole('dialog', { name: 'Move to another coach?' });
  await move.getByLabel('New coach').selectOption({ label: `Maya Patel${t} · To Coaching ${t}` });
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(fix.getByRole('status')).toContainText(`Removed from From Coaching ${t} and invited to To Coaching ${t}`);

  expect(auditActions({ adminId: support.id })).toEqual(['resend_invite', 'remove_client', 'password_reset', 'send_test_push']);
  expect(sql(`select count(*) from public.client_invites where workspace_id = ${lit(to.workspaceId)} and lower(email) = lower(${lit(client.email)})`)).toBe('1');

  // Now a removed client: Restore puts them back in touch with their old coach.
  await page.reload();
  await expect(page.getByText(`Removed from From Coaching ${t}`)).toBeVisible();
  await fix.getByRole('button', { name: 'Restore to From Coaching' + ` ${t}` }).click();
  await page.getByRole('dialog', { name: 'Restore this client?' }).getByRole('button', { name: 'Send invite' }).click();
  await expect(fix.getByRole('status')).toContainText('Invite sent');
});

test('owner adds a support admin', async ({ page }) => {
  const owner = await createUser({ role: 'owner', enrolled: true });
  const newcomer = await createUser({ firstName: 'Sunny', lastName: 'Support' });
  await signInAdmin(page, owner);
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Admins' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Admins' })).toBeVisible();

  await page.getByLabel('Email').fill(newcomer.email);
  await page.getByLabel('Role').selectOption('support');
  await page.getByRole('button', { name: 'Add admin' }).click();
  await page.getByRole('dialog', { name: 'Add this admin?' }).getByRole('button', { name: 'Add admin' }).click();
  const row = page.getByRole('row', { name: new RegExp(newcomer.email) });
  await expect(row).toContainText('Support');
  expect(auditActions({ adminId: owner.id })).toEqual(['set_admin']);

  // An email with no account is explained.
  await page.getByLabel('Email').fill('nobody-here@e2e.local');
  await page.getByRole('button', { name: 'Add admin' }).click();
  await page.getByRole('dialog', { name: 'Add this admin?' }).getByRole('button', { name: 'Add admin' }).click();
  await expect(page.getByRole('dialog', { name: 'Add this admin?' }).getByRole('alert')).toContainText('No account with that email');
  await page.getByRole('dialog', { name: 'Add this admin?' }).getByRole('button', { name: 'Cancel' }).click();

  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog', { name: 'Remove this admin?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('row', { name: new RegExp(newcomer.email) })).toHaveCount(0);
});

test('readonly sees masked emails and no Fix it buttons', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Readonly Coaching ${t}`);
  const client = await seedClient(coach.workspaceId, 'Rita', `R${t}`);
  seedExpiredInvite(coach, `ro-${t}@e2e.local`, 'Rowan', `I${t}`);
  const readonly = await createUser({ role: 'readonly', enrolled: true });
  await signInAdmin(page, readonly);

  // No row actions on Overview, only Open links.
  const row = page.getByRole('row', { name: new RegExp(`Rowan I${t}`) });
  await expect(row.getByText('Invite expired')).toBeVisible();
  await expect(row.getByRole('button')).toHaveCount(0);

  await page.goto(`/clients/${client.id}`);
  await expect(page.getByRole('heading', { level: 1, name: `Rita R${t}` })).toBeVisible();
  await expect(page.getByText(`${client.email.slice(0, 2)}…@e2e.local`)).toBeVisible();
  await expect(page.getByText(client.email)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Fix it' })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /View as/ })).toHaveCount(0);

  // The Clients list and the invite log mask too.
  await page.goto('/clients');
  await expect(page.getByText(client.email)).toHaveCount(0);
  await page.goto('/logs?tab=invites');
  await expect(page.getByText(`ro…@e2e.local`).first()).toBeVisible();
  await expect(page.getByText(`ro-${t}@e2e.local`)).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button', { name: /Resend|Cancel/ })).toHaveCount(0);

  // Audit log needs support.
  await page.goto('/audit');
  await expect(page).toHaveURL(/\/not-authorised$/);
});

test('coaches table and coach page', async ({ page }) => {
  const t = tag();
  const coach = await seedCoach('Luis', `Bueno${t}`, `Table Coaching ${t}`);
  await seedClient(coach.workspaceId, 'Parv', `J${t}`);
  const owner = await createUser({ role: 'owner', enrolled: true });
  await signInAdmin(page, owner);
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Coaches' }).click();
  const row = page.getByRole('row', { name: new RegExp(`Luis Bueno${t}`) });
  await expect(row).toContainText(`Table Coaching ${t}`);
  await expect(row).toContainText('1 · No plan yet');
  await expect(row).toContainText('Inactive');
  await row.getByRole('link', { name: `Luis Bueno${t}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Luis Bueno${t}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `Parv J${t}` })).toBeVisible();
  await expect(page.getByText('MEALS SHARED')).toBeVisible();
});
