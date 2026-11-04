import { assert, assertEquals } from '@std/assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHandler } from './index.ts';
import type { Mailer } from './mailer.ts';

const URL_ = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PASSWORD = 'test-password-123';
const DAY = 24 * 60 * 60 * 1000;

const admin: SupabaseClient = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Sent {
  to: string;
  subject: string;
  html: string;
  text: string;
}
function fakeMailer(failFor: string[] = []) {
  const sent: Sent[] = [];
  const mailer: Mailer = {
    send(msg) {
      if (failFor.includes(msg.to))
        return Promise.reject(new Error('smtp down'));
      sent.push(msg);
      return Promise.resolve();
    },
  };
  return { mailer, sent };
}

const uid = () => crypto.randomUUID().slice(0, 8);
const userIds: string[] = [];
const workspaceIds: string[] = [];

async function makeUser(label: string, fullName: string) {
  const email = `${label}-${uid()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  return { id: data.user.id, email };
}
async function makeWorkspace(ownerId: string, name: string) {
  const { data, error } = await admin
    .from('workspaces')
    .insert({ name })
    .select('id')
    .single();
  if (error) throw error;
  workspaceIds.push(data.id);
  const m = await admin
    .from('workspace_members')
    .insert({ workspace_id: data.id, user_id: ownerId, role: 'owner' });
  if (m.error) throw m.error;
  return data.id as string;
}
async function addClient(ws: string, userId: string) {
  const { error } = await admin
    .from('workspace_members')
    .insert({ workspace_id: ws, user_id: userId, role: 'client' });
  if (error) throw error;
}
async function jwtFor(email: string) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) throw error;
  return data.session.access_token;
}

async function setup() {
  const coachA = await makeUser('coacha', 'Demo Coach');
  const coachB = await makeUser('coachb', 'Other Coach');
  const wsA = await makeWorkspace(coachA.id, 'Workspace A');
  const wsB = await makeWorkspace(coachB.id, 'Workspace B');
  const jwt = await jwtFor(coachA.email);
  return { coachA, coachB, wsA, wsB, jwt };
}

function call(
  handler: (r: Request) => Promise<Response>,
  body: unknown,
  jwt?: string,
) {
  return handler(
    new Request('http://localhost/send-invite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
function handlerWith(mailer: Mailer) {
  return createHandler({
    mailer,
    supabaseAdmin: admin,
    supabaseUrl: URL_,
    anonKey: ANON,
    publicSiteUrl: 'http://site.test',
  });
}
async function openInvites(ws: string) {
  const { data, error } = await admin
    .from('client_invites')
    .select('*')
    .eq('workspace_id', ws)
    .is('accepted_at', null);
  if (error) throw error;
  return data;
}

async function cleanup() {
  for (const ws of workspaceIds.splice(0))
    await admin.from('workspaces').delete().eq('id', ws);
  for (const id of userIds.splice(0)) await admin.auth.admin.deleteUser(id);
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

t('new invite is sent, stored with 14-day expiry and emailed', async () => {
  const { wsA, jwt } = await setup();
  const { mailer, sent } = fakeMailer();
  const res = await call(
    handlerWith(mailer),
    {
      workspaceId: wsA,
      invites: [{ email: 'New@X.com', fullName: 'New' }],
    },
    jwt,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.results, [{ email: 'new@x.com', status: 'sent' }]);
  const rows = await openInvites(wsA);
  assertEquals(rows.length, 1);
  const diff = new Date(rows[0].expires_at).getTime() - Date.now();
  assert(Math.abs(diff - 14 * DAY) < 60_000, `expiry off: ${diff}`);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].subject, 'Demo Coach invited you to CalTracker');
  assert(sent[0].text.includes('/invite/'));
  const token = sent[0].text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
  const { data } = await admin.rpc('get_invite_preview', { token });
  assertEquals(data[0].status, 'valid');
  assertEquals(data[0].workspace_name, 'Workspace A');
});

t('same email again is resent with a new token', async () => {
  const { wsA, jwt } = await setup();
  const { mailer, sent } = fakeMailer();
  const h = handlerWith(mailer);
  const req = {
    workspaceId: wsA,
    invites: [{ email: 'again@x.com', fullName: 'Again' }],
  };
  await call(h, req, jwt);
  const before = (await openInvites(wsA))[0];
  const res = await call(h, req, jwt);
  assertEquals((await res.json()).results[0].status, 'resent');
  const rows = await openInvites(wsA);
  assertEquals(rows.length, 1);
  assert(rows[0].token_hash !== before.token_hash);
  assert(new Date(rows[0].expires_at) >= new Date(before.expires_at));
  assertEquals(sent.length, 2);
});

t('coach of A cannot invite into workspace B (403)', async () => {
  const { wsB, jwt } = await setup();
  const { mailer, sent } = fakeMailer();
  const res = await call(
    handlerWith(mailer),
    {
      workspaceId: wsB,
      invites: [{ email: 'x@x.com', fullName: 'X' }],
    },
    jwt,
  );
  assertEquals(res.status, 403);
  await res.body?.cancel();
  assertEquals((await openInvites(wsB)).length, 0);
  assertEquals(sent.length, 0);
});

t('missing Authorization header is 401', async () => {
  const { wsA } = await setup();
  const res = await call(handlerWith(fakeMailer().mailer), {
    workspaceId: wsA,
    invites: [{ email: 'x@x.com', fullName: 'X' }],
  });
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

t('empty invites list is 400', async () => {
  const { wsA, jwt } = await setup();
  const res = await call(
    handlerWith(fakeMailer().mailer),
    { workspaceId: wsA, invites: [] },
    jwt,
  );
  assertEquals(res.status, 400);
  await res.body?.cancel();
});

t('existing client of this workspace is already_member, no email', async () => {
  const { wsA, jwt } = await setup();
  const c = await makeUser('client', 'Client');
  await addClient(wsA, c.id);
  const { mailer, sent } = fakeMailer();
  const res = await call(
    handlerWith(mailer),
    {
      workspaceId: wsA,
      invites: [{ email: c.email, fullName: 'C' }],
    },
    jwt,
  );
  assertEquals((await res.json()).results[0].status, 'already_member');
  assertEquals(sent.length, 0);
  assertEquals((await openInvites(wsA)).length, 0);
});

t(
  'client of another coach: invite created, email sent, warning status',
  async () => {
    const { wsA, wsB, jwt } = await setup();
    const c = await makeUser('client', 'Client');
    await addClient(wsB, c.id);
    const { mailer, sent } = fakeMailer();
    const res = await call(
      handlerWith(mailer),
      {
        workspaceId: wsA,
        invites: [{ email: c.email, fullName: 'C' }],
      },
      jwt,
    );
    const r = (await res.json()).results[0];
    assertEquals(r.status, 'with_another_coach');
    assertEquals(
      r.message,
      "This person already trains with another coach on CalTracker. They'll need to leave that coach first.",
    );
    assertEquals((await openInvites(wsA)).length, 1);
    assertEquals(sent.length, 1);
  },
);

t('email of a coach is is_coach, no row, no email', async () => {
  const { coachB, wsA, jwt } = await setup();
  const { mailer, sent } = fakeMailer();
  const res = await call(
    handlerWith(mailer),
    {
      workspaceId: wsA,
      invites: [{ email: coachB.email, fullName: 'B' }],
    },
    jwt,
  );
  assertEquals((await res.json()).results[0].status, 'is_coach');
  assertEquals((await openInvites(wsA)).length, 0);
  assertEquals(sent.length, 0);
});

t('one send failure does not abort the other rows', async () => {
  const { wsA, jwt } = await setup();
  const { mailer, sent } = fakeMailer(['bad@x.com']);
  const res = await call(
    handlerWith(mailer),
    {
      workspaceId: wsA,
      invites: [
        { email: 'bad@x.com', fullName: 'Bad' },
        { email: 'good@x.com', fullName: 'Good' },
      ],
    },
    jwt,
  );
  assertEquals(res.status, 200);
  const results = (await res.json()).results;
  assertEquals(
    results.map((r: { status: string }) => r.status),
    ['error', 'sent'],
  );
  assertEquals((await openInvites(wsA)).length, 2);
  assertEquals(sent.length, 1);
});

t('refuses to send when RESEND_API_KEY is set but PUBLIC_SITE_URL is not', async () => {
  const { wsA, jwt } = await setup();
  const { mailer, sent } = fakeMailer();
  const handler = createHandler({
    mailer,
    supabaseAdmin: admin,
    supabaseUrl: URL_,
    anonKey: ANON,
    publicSiteUrl: undefined,
    usesResend: true,
  });
  const res = await call(
    handler,
    { workspaceId: wsA, invites: [{ email: 'x@x.com', fullName: 'X' }] },
    jwt,
  );
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'Server misconfigured' });
  assertEquals(sent.length, 0);
  assertEquals((await openInvites(wsA)).length, 0);
});

t('strips trailing slashes from PUBLIC_SITE_URL in the invite link', async () => {
  const { wsA, jwt } = await setup();
  const { mailer, sent } = fakeMailer();
  const handler = createHandler({
    mailer,
    supabaseAdmin: admin,
    supabaseUrl: URL_,
    anonKey: ANON,
    publicSiteUrl: 'http://site.test//',
  });
  const res = await call(
    handler,
    { workspaceId: wsA, invites: [{ email: 'x@x.com', fullName: 'X' }] },
    jwt,
  );
  assertEquals(res.status, 200);
  const link = /http:\/\/site\.test[^\s"<]*/.exec(sent[0]!.text)?.[0];
  assertEquals(link?.startsWith('http://site.test/invite/'), true);
});

t('paces sends by sendIntervalMs', async () => {
  const { wsA, jwt } = await setup();
  const times: number[] = [];
  const mailer: Mailer = {
    send() {
      times.push(Date.now());
      return Promise.resolve();
    },
  };
  const handler = createHandler({
    mailer,
    supabaseAdmin: admin,
    supabaseUrl: URL_,
    anonKey: ANON,
    publicSiteUrl: 'http://site.test',
    sendIntervalMs: 200,
  });
  await call(
    handler,
    {
      workspaceId: wsA,
      invites: [
        { email: 'p1@x.com', fullName: 'P1' },
        { email: 'p2@x.com', fullName: 'P2' },
        { email: 'p3@x.com', fullName: 'P3' },
      ],
    },
    jwt,
  );
  assertEquals(times.length, 3);
  assertEquals(times[1]! - times[0]! >= 190, true);
  assertEquals(times[2]! - times[1]! >= 190, true);
});
