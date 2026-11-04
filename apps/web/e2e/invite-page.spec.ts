import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { expect, test } from '@playwright/test';

// Service-role client: used ONLY here, to build invite fixtures. Never in app code.
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
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 86_400_000;
const created: string[] = [];

let workspaceId: string;
let coachId: string;
let clientId: string;

test.beforeAll(async () => {
  const { data: ws, error } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (error) throw error;
  workspaceId = ws.id;
  const { data: users, error: uErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (uErr) throw uErr;
  coachId = users.users.find((u) => u.email === 'coach@demo.local')!.id;
  clientId = users.users.find((u) => u.email === 'client@demo.local')!.id;
});

test.afterAll(async () => {
  if (created.length) await admin.from('client_invites').delete().in('id', created);
});

type Opts = { sentAgoDays?: number; expiresInDays?: number; accepted?: boolean };

async function makeInvite(opts: Opts = {}) {
  const token = randomBytes(32).toString('base64url');
  const email = `invitee-${Date.now()}${Math.floor(Math.random() * 100000)}@example.com`;
  const now = Date.now();
  const sentAt = new Date(now - (opts.sentAgoDays ?? 0) * DAY);
  const expiresAt = new Date(now + (opts.expiresInDays ?? 14) * DAY);
  const { data, error } = await admin
    .from('client_invites')
    .insert({
      workspace_id: workspaceId,
      email,
      full_name: 'Invitee Person',
      token_hash: sha256(token),
      sent_at: sentAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      created_by: coachId,
      ...(opts.accepted ? { accepted_at: new Date().toISOString(), accepted_by: clientId } : {}),
    })
    .select('id')
    .single();
  if (error) throw error;
  created.push(data.id);
  return { token, email, id: data.id };
}

test('valid invite shows workspace, email and Coming soon store buttons, signed out', async ({ page }) => {
  const { token, email } = await makeInvite();
  await page.goto(`/invite/${token}`);
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`)); // not redirected to /sign-in
  await expect(page.getByRole('heading', { name: 'Demo Coaching invited you to CalTracker' })).toBeVisible();
  await expect(page.getByText('Download the CalTracker app and sign up with')).toBeVisible();
  await expect(page.locator('strong', { hasText: email })).toBeVisible();
  await expect(page.getByText('Coming soon')).toHaveCount(2);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('expired invite', async ({ page }) => {
  const { token } = await makeInvite({ sentAgoDays: 15, expiresInDays: -1 });
  await page.goto(`/invite/${token}`);
  await expect(page.getByText('This invite has expired. Ask your coach to send a new one.')).toBeVisible();
});

test('accepted invite', async ({ page }) => {
  const { token } = await makeInvite({ accepted: true });
  await page.goto(`/invite/${token}`);
  await expect(
    page.getByText('This invite has already been used. Open the CalTracker app and sign in.'),
  ).toBeVisible();
});

test('unknown and malformed tokens show not-found copy', async ({ page }) => {
  const copy = "This invite link isn't valid. Check the link in your email or ask your coach to send a new one.";
  await page.goto(`/invite/${randomBytes(32).toString('base64url')}`);
  await expect(page.getByText(copy)).toBeVisible();
  await page.goto('/invite/short');
  await expect(page.getByText(copy)).toBeVisible();
});

test('after a resend the old token shows not-found and the new token is valid', async ({ page }) => {
  const { token: oldToken, id } = await makeInvite();
  const newToken = randomBytes(32).toString('base64url');
  // A resend replaces the stored hash.
  const { error } = await admin.from('client_invites').update({ token_hash: sha256(newToken) }).eq('id', id);
  if (error) throw error;
  await page.goto(`/invite/${oldToken}`);
  await expect(page.getByText("This invite link isn't valid.")).toBeVisible();
  await page.goto(`/invite/${newToken}`);
  await expect(page.getByRole('heading', { name: /invited you to CalTracker/ })).toBeVisible();
});
