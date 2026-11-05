import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { expect, test, type Page } from '@playwright/test';

// Remove client, Past clients and Cancel invite (docs/superpowers/specs/2026-11-04-remove-client-design.md).

// Service-role client: used ONLY here, to build fixtures. Never in app code.
function serviceClient(): SupabaseClient<Database> {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const out = execSync('supabase status -o env', { encoding: 'utf8' });
    const get = (name: string) => out.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))?.[1];
    url = get('API_URL');
    key = get('SERVICE_ROLE_KEY');
  }
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or run local Supabase.');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const admin = serviceClient();
const unique = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;
const userIds: string[] = [];
let workspaceId: string;
let coachId: string;

test.beforeAll(async () => {
  const { data: ws, error } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (error) throw error;
  workspaceId = ws.id;
  const { data: users, error: uErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (uErr) throw uErr;
  coachId = users.users.find((u) => u.email === 'coach@demo.local')!.id;
});

test.afterAll(async () => {
  for (const id of userIds) {
    await admin.from('client_invites').delete().eq('accepted_by', id);
    await admin.auth.admin.deleteUser(id);
  }
});

/** A client of Demo Coaching who joined through an invite (so the dashboard knows their email). */
async function makeClient(firstName: string, lastName: string) {
  const email = `rm-${unique()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'client-password-123',
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: data.user.id, role: 'client' });
  if (m.error) throw m.error;
  const i = await admin.from('client_invites').insert({
    workspace_id: workspaceId,
    email,
    first_name: firstName,
    last_name: lastName,
    token_hash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    created_by: coachId,
    accepted_at: new Date().toISOString(),
    accepted_by: data.user.id,
  });
  if (i.error) throw i.error;
  return { email, id: data.user.id, name: `${firstName} ${lastName}` };
}

async function makePendingInvite() {
  const token = randomBytes(32).toString('base64url');
  const email = `cancel-${unique()}@example.com`;
  const { error } = await admin.from('client_invites').insert({
    workspace_id: workspaceId,
    email,
    first_name: 'Cancel',
    last_name: 'Me',
    token_hash: createHash('sha256').update(token).digest('hex'),
    created_by: coachId,
  });
  if (error) throw error;
  return { email, token };
}

async function signInAsCoach(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('coach@demo.local');
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/clients$/);
}

test('remove a client: confirm, they move to Past clients, then re-invite them', async ({ page }) => {
  const client = await makeClient('Remy', 'Removable');
  await signInAsCoach(page);
  const clients = page.getByRole('table', { name: 'Clients' });
  const row = clients.getByRole('row').filter({ hasText: client.email });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: `Remove ${client.name}` }).click();
  const dialog = page.getByRole('dialog', { name: `Remove ${client.name}?` });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(
      "They'll lose access to your workouts, messages and community. Their history stays under Past clients, and re-inviting them brings everything back.",
    ),
  ).toBeVisible();
  // Cancel keeps them.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: `Remove ${client.name}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(clients.getByRole('row').filter({ hasText: client.email })).toHaveCount(0);
  await expect(page.locator('#clients-heading')).toBeFocused();

  // Past clients is folded under its heading.
  const toggle = page.getByRole('heading', { name: /Past clients \(\d+\)/ }).getByRole('button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const past = page.getByRole('table', { name: 'Past clients' }).getByRole('row').filter({ hasText: client.email });
  await expect(past).toBeVisible();
  await expect(past.getByText(client.name)).toBeVisible();
  await expect(past.getByText(/^Removed /)).toBeVisible();

  // The membership is gone in the database, and the record kept.
  const { data: member } = await admin.from('workspace_members').select('user_id').eq('user_id', client.id);
  expect(member).toEqual([]);

  // Re-invite sends a fresh invite (it shows under Pending invites until they accept).
  await past.getByRole('button', { name: `Re-invite ${client.name}` }).click();
  await expect(past.getByText('Invite sent')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Pending invites' }).getByRole('row').filter({ hasText: client.email })).toBeVisible();
});

test('cancel an invite: confirm, it disappears, and its link stops working', async ({ page }) => {
  const invite = await makePendingInvite();
  await signInAsCoach(page);
  const pending = page.getByRole('table', { name: 'Pending invites' });
  const row = pending.getByRole('row').filter({ hasText: invite.email });
  await row.getByRole('button', { name: `Cancel invite to ${invite.email}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel this invite?' });
  await expect(dialog.getByText(`Cancel the invite to ${invite.email}? The link in their email will stop working.`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel invite' }).click();
  await expect(pending.getByRole('row').filter({ hasText: invite.email })).toHaveCount(0);
  // Focus lands on the section heading, not lost on the page.
  await expect(page.getByRole('heading', { name: 'Pending invites' })).toBeFocused();

  await page.goto(`/invite/${invite.token}`);
  await expect(page.getByText("This invite link isn't valid.")).toBeVisible();
});

test('cancelling an invite that was accepted meanwhile says so instead of pretending', async ({ page }) => {
  const invite = await makePendingInvite();
  await signInAsCoach(page);
  const row = page.getByRole('table', { name: 'Pending invites' }).getByRole('row').filter({ hasText: invite.email });
  await row.getByRole('button', { name: `Cancel invite to ${invite.email}` }).click();
  // The client accepts while the coach is reading the dialog.
  const { error } = await admin
    .from('client_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: coachId })
    .eq('email', invite.email);
  if (error) throw error;
  const dialog = page.getByRole('dialog', { name: 'Cancel this invite?' });
  await dialog.getByRole('button', { name: 'Cancel invite' }).click();
  await expect(dialog.getByText('This invite was already used or cancelled. If they joined, remove them from Clients instead.')).toBeVisible();
  await admin.from('client_invites').delete().eq('email', invite.email);
});
