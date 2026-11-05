import { assert, assertEquals } from '@std/assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHandler } from './index.ts';

const URL_ = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PASSWORD = 'new-password-123';
const DAY = 24 * 60 * 60 * 1000;

const admin: SupabaseClient = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const handler = createHandler({ supabaseAdmin: admin });

const uid = () => crypto.randomUUID().slice(0, 8);
const workspaceIds: string[] = [];
const emails: string[] = [];

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
const email = (label: string) => {
  const e = `${label}-${uid()}@test.local`;
  emails.push(e);
  return e;
};

async function makeUser(address: string, opts: { confirmed?: boolean; password?: string } = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email: address,
    password: opts.password ?? 'old-password-123',
    email_confirm: opts.confirmed ?? true,
    user_metadata: { first_name: 'Old', last_name: 'Name' },
  });
  if (error) throw error;
  return data.user.id;
}
async function makeWorkspace(name: string) {
  const ownerId = await makeUser(email('coach'));
  const { data, error } = await admin.from('workspaces').insert({ name }).select('id').single();
  if (error) throw error;
  workspaceIds.push(data.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: data.id, user_id: ownerId, role: 'owner' });
  if (m.error) throw m.error;
  return { ws: data.id as string, ownerId };
}
async function makeInvite(
  ws: string,
  createdBy: string,
  to: string,
  opts: { expiredDaysAgo?: number; acceptedBy?: string } = {},
) {
  const token = newToken();
  const now = Date.now();
  const sentAt = opts.expiredDaysAgo ? new Date(now - (14 + opts.expiredDaysAgo) * DAY) : new Date(now);
  const { data, error } = await admin
    .from('client_invites')
    .insert({
      workspace_id: ws,
      email: to,
      first_name: 'Coach',
      last_name: 'Typed',
      token_hash: await sha256Hex(token),
      sent_at: sentAt.toISOString(),
      expires_at: new Date(sentAt.getTime() + 14 * DAY).toISOString(),
      created_by: createdBy,
      ...(opts.acceptedBy ? { accepted_at: new Date().toISOString(), accepted_by: opts.acceptedBy } : {}),
    })
    .select('id')
    .single();
  if (error) throw error;
  return { token, inviteId: data.id as string };
}

function call(body: unknown, method = 'POST') {
  return handler(
    new Request('http://localhost/accept-invite', {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    }),
  );
}
const join = (token: string, extra: Record<string, unknown> = {}) =>
  call({ token, password: PASSWORD, firstName: 'Sam', lastName: 'Lee', ...extra });

async function findUser(address: string) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === address);
}
async function canSignIn(address: string, password: string) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: address, password });
  return !error;
}
async function membership(userId: string) {
  const { data, error } = await admin.from('workspace_members').select('workspace_id, role').eq('user_id', userId);
  if (error) throw error;
  return data;
}

async function cleanup() {
  // Workspaces first: their invites reference users (accepted_by) without cascade.
  for (const ws of workspaceIds.splice(0)) await admin.from('workspaces').delete().eq('id', ws);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const doomed = new Set(emails.splice(0));
  for (const u of data?.users ?? []) if (u.email && doomed.has(u.email)) await admin.auth.admin.deleteUser(u.id);
}

function t(name: string, fn: () => Promise<void>) {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      try {
        await fn();
      } finally {
        await cleanup();
      }
    },
  });
}

t('a new email: creates a confirmed account with the edited names, links the coach, marks the invite used', async () => {
  const { ws, ownerId } = await makeWorkspace('Join A');
  const to = email('new');
  const { token, inviteId } = await makeInvite(ws, ownerId, to);

  const res = await join(token, { firstName: ' Samantha ', lastName: ' Lee-Smith ' });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, email: to });

  const user = await findUser(to);
  assert(user?.email_confirmed_at, 'the account is already confirmed: no confirmation email');
  assert(await canSignIn(to, PASSWORD), 'the chosen password signs in');
  const { data: profile } = await admin.from('profiles').select('first_name, last_name').eq('id', user.id).single();
  assertEquals(profile, { first_name: 'Samantha', last_name: 'Lee-Smith' });
  assertEquals(await membership(user.id), [{ workspace_id: ws, role: 'client' }]);
  const { data: invite } = await admin.from('client_invites').select('accepted_by, first_name').eq('id', inviteId).single();
  assertEquals(invite, { accepted_by: user.id, first_name: 'Coach' }, "the invite keeps the coach's original name");
});

t('the same link a second time reports used', async () => {
  const { ws, ownerId } = await makeWorkspace('Join B');
  const { token } = await makeInvite(ws, ownerId, email('twice'));
  assertEquals((await (await join(token)).json()).ok, true);
  assertEquals(await (await join(token)).json(), { ok: false, reason: 'used' });
});

t('an email with a confirmed account: account_exists, and its password is not touched', async () => {
  const { ws, ownerId } = await makeWorkspace('Join C');
  const to = email('existing');
  const userId = await makeUser(to, { password: 'kept-password-1' });
  const { token, inviteId } = await makeInvite(ws, ownerId, to);

  assertEquals(await (await join(token)).json(), { ok: false, reason: 'account_exists' });
  assert(await canSignIn(to, 'kept-password-1'));
  assertEquals(await membership(userId), []);
  const { data } = await admin.from('client_invites').select('accepted_at').eq('id', inviteId).single();
  assertEquals(data?.accepted_at, null, 'the invite stays open, so signing in still links the coach');
});

t('an unconfirmed account with that email: password replaced, confirmed and linked', async () => {
  const { ws, ownerId } = await makeWorkspace('Join D');
  const to = email('unconfirmed');
  const userId = await makeUser(to, { confirmed: false, password: 'squatter-pass-1' });
  const { token } = await makeInvite(ws, ownerId, to);

  assertEquals(await (await join(token)).json(), { ok: true, email: to });
  assert(await canSignIn(to, PASSWORD), 'the new password works');
  assert(!(await canSignIn(to, 'squatter-pass-1')), 'the old password no longer works');
  assert((await findUser(to))?.email_confirmed_at);
  const { data: profile } = await admin.from('profiles').select('first_name, last_name').eq('id', userId).single();
  assertEquals(profile, { first_name: 'Sam', last_name: 'Lee' });
  assertEquals(await membership(userId), [{ workspace_id: ws, role: 'client' }]);
});

t("a coach's email: coach_account, and the coach's password is not touched", async () => {
  const { ws, ownerId } = await makeWorkspace('Join E');
  const other = await makeWorkspace('Join E2');
  const { data: coach } = await admin.auth.admin.getUserById(other.ownerId);
  const coachEmail = coach.user!.email!;
  const { token } = await makeInvite(ws, ownerId, coachEmail);
  assertEquals(await (await join(token)).json(), { ok: false, reason: 'coach_account' });
  assert(await canSignIn(coachEmail, 'old-password-123'));
});

t('expired, unknown and malformed tokens', async () => {
  const { ws, ownerId } = await makeWorkspace('Join F');
  const to = email('expired');
  const { token } = await makeInvite(ws, ownerId, to, { expiredDaysAgo: 1 });
  assertEquals(await (await join(token)).json(), { ok: false, reason: 'expired' });
  assertEquals(await findUser(to), undefined, 'no account is created for an expired invite');
  assertEquals(await (await join(newToken())).json(), { ok: false, reason: 'not_found' });
  const bad = await join('short');
  assertEquals(bad.status, 400);
  assertEquals(await bad.json(), { ok: false, reason: 'invalid_request' });
});

t('two taps on Join at once: exactly one succeeds and one account exists', async () => {
  const { ws, ownerId } = await makeWorkspace('Join G');
  const to = email('race');
  const { token } = await makeInvite(ws, ownerId, to);
  const results = await Promise.all([join(token), join(token), join(token)].map(async (r) => (await r).json()));
  assertEquals(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  // The other taps get the friendly "sign in instead", not an error.
  assertEquals(results.filter((r) => !r.ok), [
    { ok: false, reason: 'account_exists' },
    { ok: false, reason: 'account_exists' },
  ]);
  const user = await findUser(to);
  assert(user);
  assertEquals(await membership(user.id), [{ workspace_id: ws, role: 'client' }]);
});

t('rejects a short password, a blank first name, bad JSON and other methods', async () => {
  const { ws, ownerId } = await makeWorkspace('Join H');
  const to = email('invalid');
  const { token } = await makeInvite(ws, ownerId, to);
  for (const extra of [{ password: '1234567' }, { password: 'x'.repeat(73) }, { firstName: '  ' }, { lastName: 'x'.repeat(101) }]) {
    const res = await join(token, extra);
    assertEquals(res.status, 400, JSON.stringify(extra));
    assertEquals(await res.json(), { ok: false, reason: 'invalid_request' });
  }
  assertEquals((await call('{not json')).status, 400);
  assertEquals((await call(null, 'GET')).status, 405);
  assertEquals(await findUser(to), undefined, 'nothing was created');
});
