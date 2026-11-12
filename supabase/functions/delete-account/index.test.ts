import { assert, assertEquals } from '@std/assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Mailer } from '../send-invite/mailer.ts';
import { purgeStorage } from '../_shared/purge-storage.ts';
import type { PosthogEraser } from './posthog.ts';
import { COACH_ACCOUNT_MESSAGE, createHandler, type HandlerDeps } from './index.ts';

// Runs against the local stack (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from `supabase status`).
const URL_ = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PASSWORD = 'delete-me-123';

const admin: SupabaseClient = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const uid = () => crypto.randomUUID().slice(0, 8);
const workspaceIds: string[] = [];
const userIds: string[] = [];

type Sent = Parameters<Mailer['send']>[0];
function fakeMailer(fail = false) {
  const sent: Sent[] = [];
  const mailer: Mailer = {
    send(msg) {
      sent.push(msg);
      return fail ? Promise.reject(new Error('Resend down')) : Promise.resolve();
    },
  };
  return { mailer, sent };
}
function fakePosthog() {
  const erased: string[] = [];
  const posthog: PosthogEraser = {
    erase(id) {
      erased.push(id);
      return Promise.resolve('deleted');
    },
  };
  return { posthog, erased };
}

function handlerWith(overrides: Partial<HandlerDeps> = {}) {
  const m = fakeMailer();
  const p = fakePosthog();
  const handler = createHandler({
    supabaseAdmin: admin,
    supabaseUrl: URL_,
    anonKey: ANON,
    mailer: m.mailer,
    posthog: p.posthog,
    ...overrides,
  });
  return { handler, sent: m.sent, erased: p.erased };
}

async function makeUser(label: string, first: string, last: string) {
  const email = `${label}-${uid()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: first, last_name: last },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  return { id: data.user.id, email };
}
async function jwtFor(email: string) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return data.session.access_token;
}

/** A coach with a workspace, and a client with rows and files in several buckets (some uploaded by the coach). */
async function seed() {
  const coach = await makeUser('da-coach', 'Luis', 'Bueno');
  const { data: ws, error } = await admin.from('workspaces').insert({ name: `DA ${uid()}` }).select('id').single();
  if (error) throw error;
  workspaceIds.push(ws.id);
  const client = await makeUser('da-client', 'Sam', 'Lee');
  const m = await admin.from('workspace_members').insert([
    { workspace_id: ws.id, user_id: coach.id, role: 'owner' },
    { workspace_id: ws.id, user_id: client.id, role: 'client' },
  ]);
  if (m.error) throw m.error;
  const conv = await admin.from('conversations').insert({ workspace_id: ws.id, client_id: client.id }).select('id').single();
  if (conv.error) throw conv.error;
  const msg = await admin.from('messages').insert([
    { conversation_id: conv.data.id, workspace_id: ws.id, sender_id: coach.id, body: 'Hi Sam' },
    { conversation_id: conv.data.id, workspace_id: ws.id, sender_id: client.id, body: 'Hi Luis' },
  ]);
  if (msg.error) throw msg.error;
  // eaten_on must be within a day of eaten_at (now), so use today's UTC date rather than a fixed one.
  const today = new Date().toISOString().slice(0, 10);
  const meal = await admin.from('meals').insert({ workspace_id: ws.id, client_id: client.id, eaten_on: today, calories: 500 });
  if (meal.error) throw meal.error;

  const files = [
    { bucket: 'avatars', path: `${client.id}/avatar.webp`, type: 'image/webp' },
    { bucket: 'meal-photos', path: `${ws.id}/${client.id}/${crypto.randomUUID()}.webp`, type: 'image/webp' },
    { bucket: 'message-images', path: `${ws.id}/${conv.data.id}/${crypto.randomUUID()}.webp`, type: 'image/webp' },
    { bucket: 'scan-attachments', path: `${ws.id}/${client.id}/${crypto.randomUUID()}.pdf`, type: 'application/pdf' },
  ];
  for (const f of files) {
    const { error: upErr } = await admin.storage
      .from(f.bucket)
      .upload(f.path, new Blob([new Uint8Array([1, 2, 3])], { type: f.type }), { contentType: f.type });
    if (upErr) throw new Error(`${f.bucket}: ${upErr.message}`);
  }
  // The coach's own avatar must survive.
  const coachAvatar = `${coach.id}/avatar.webp`;
  const up = await admin.storage
    .from('avatars')
    .upload(coachAvatar, new Blob([new Uint8Array([1])], { type: 'image/webp' }), { contentType: 'image/webp' });
  if (up.error) throw up.error;
  return { coach, client, ws: ws.id as string, files, coachAvatar };
}

async function fileExists(bucket: string, path: string) {
  const folder = path.split('/').slice(0, -1).join('/');
  const name = path.split('/').pop()!;
  const { data, error } = await admin.storage.from(bucket).list(folder, { search: name });
  if (error) throw error;
  return (data ?? []).some((o) => o.name === name);
}
async function userExists(id: string) {
  const { data } = await admin.auth.admin.getUserById(id);
  return Boolean(data?.user);
}
const post = (token?: string) =>
  new Request('http://localhost/delete-account', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

async function cleanup() {
  for (const id of userIds.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {});
  if (workspaceIds.length) await admin.from('workspaces').delete().in('id', workspaceIds.splice(0));
}

Deno.test('delete-account: refuses anything but POST', async () => {
  const { handler } = handlerWith();
  const res = await handler(new Request('http://localhost/delete-account', { method: 'GET' }));
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test('delete-account: 401 without a JWT or with a bad one', async () => {
  const { handler } = handlerWith();
  const a = await handler(post());
  assertEquals(a.status, 401);
  await a.body?.cancel();
  const b = await handler(post('not-a-jwt'));
  assertEquals(b.status, 401);
  await b.body?.cancel();
});

Deno.test('delete-account: a client erases everything, the coach is told, a second call still succeeds', async () => {
  try {
    const s = await seed();
    const token = await jwtFor(s.client.email);
    const { handler, sent, erased } = handlerWith();

    const res = await handler(post(token));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { deleted: true });

    assertEquals(await userExists(s.client.id), false, 'the auth account is gone');
    for (const f of s.files) assertEquals(await fileExists(f.bucket, f.path), false, `${f.bucket} file is gone`);
    assertEquals(await fileExists('avatars', s.coachAvatar), true, 'the coach avatar stays');
    for (const [table, col] of [
      ['profiles', 'id'],
      ['workspace_members', 'user_id'],
      ['conversations', 'client_id'],
      ['messages', 'sender_id'],
      ['meals', 'client_id'],
    ] as const) {
      const { count } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(col, s.client.id);
      assertEquals(count, 0, `no ${table} rows left`);
    }
    const { count: coachMembers } = await admin
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', s.coach.id);
    assertEquals(coachMembers, 1, 'the coach keeps their workspace');

    assertEquals(sent.length, 1, 'one email to the coach');
    assertEquals(sent[0].to, s.coach.email);
    assertEquals(sent[0].subject, 'Sam Lee deleted their CalTracker account');
    assert(sent[0].text.includes('Hi Luis,'));
    assertEquals(erased, [s.client.id], 'PostHog is asked to forget the person');

    // Tapped twice, or the answer was lost: the same JWT still reports success, and nothing is sent again.
    const again = await handler(post(token));
    assertEquals(again.status, 200);
    assertEquals(await again.json(), { deleted: true });
    assertEquals(sent.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test('delete-account: a coach is refused and nothing changes', async () => {
  try {
    const s = await seed();
    const token = await jwtFor(s.coach.email);
    const { handler, sent } = handlerWith();
    const res = await handler(post(token));
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: 'coach_account', message: COACH_ACCOUNT_MESSAGE });
    assert(COACH_ACCOUNT_MESSAGE.includes('support@caltracker.app'));
    assertEquals(await userExists(s.coach.id), true);
    assertEquals(await fileExists('avatars', s.coachAvatar), true);
    assertEquals(sent.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test('delete-account: a storage failure keeps the account; the retry finishes the job', async () => {
  try {
    const s = await seed();
    const token = await jwtFor(s.client.email);
    let failNext = true;
    const { handler, sent } = handlerWith({
      purgeStorage: (a, objects) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('storage down'));
        }
        return purgeStorage(a, objects);
      },
    });
    const first = await handler(post(token));
    assertEquals(first.status, 500);
    assertEquals(await first.json(), { error: 'retry' });
    assertEquals(await userExists(s.client.id), true, 'the account is kept so the retry can finish');
    assertEquals(sent.length, 0, 'no email until the data is gone');

    const retry = await handler(post(token));
    assertEquals(retry.status, 200);
    await retry.body?.cancel();
    assertEquals(await userExists(s.client.id), false);
    for (const f of s.files) assertEquals(await fileExists(f.bucket, f.path), false);
    assertEquals(sent.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test('delete-account: a failed coach email or PostHog call does not fail the deletion', async () => {
  try {
    const s = await seed();
    const token = await jwtFor(s.client.email);
    const failing = fakeMailer(true);
    const { handler } = handlerWith({
      mailer: failing.mailer,
      posthog: { erase: () => Promise.reject(new Error('PostHog down')) },
    });
    const res = await handler(post(token));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { deleted: true });
    assertEquals(failing.sent.length, 1, 'the email was attempted');
    assertEquals(await userExists(s.client.id), false);
  } finally {
    await cleanup();
  }
});

Deno.test('delete-account: without PostHog configured it is skipped', async () => {
  try {
    const s = await seed();
    const token = await jwtFor(s.client.email);
    const { handler } = handlerWith({ posthog: null });
    const res = await handler(post(token));
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assertEquals(await userExists(s.client.id), false);
  } finally {
    await cleanup();
  }
});

Deno.test('delete-account: a coach upload that races in during the delete is swept up afterwards', async () => {
  try {
    const s = await seed();
    const token = await jwtFor(s.client.email);
    const late = `${s.ws}/${s.client.id}/${crypto.randomUUID()}.pdf`;
    let calls = 0;
    const { handler } = handlerWith({
      purgeStorage: async (a, objects) => {
        calls++;
        const out = await purgeStorage(a, objects);
        if (calls === 1) {
          // The coach uploads an InBody PDF into the client's folder just after the first sweep.
          const up = await admin.storage
            .from('scan-attachments')
            .upload(late, new Blob([new Uint8Array([1])], { type: 'application/pdf' }), { contentType: 'application/pdf' });
          if (up.error) throw up.error;
        }
        return out;
      },
    });
    const res = await handler(post(token));
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assertEquals(calls, 2, 'a second sweep runs after the account is deleted');
    assertEquals(await fileExists('scan-attachments', late), false, 'the late upload is gone');
  } finally {
    await cleanup();
  }
});

Deno.test('delete-account: a failed second sweep is logged, never a failed deletion', async () => {
  try {
    const s = await seed();
    const token = await jwtFor(s.client.email);
    let calls = 0;
    const { handler, sent } = handlerWith({
      purgeStorage: (a, objects) => (++calls === 1 ? purgeStorage(a, objects) : Promise.reject(new Error('storage down'))),
    });
    const res = await handler(post(token));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { deleted: true });
    assertEquals(calls, 2);
    assertEquals(await userExists(s.client.id), false);
    assertEquals(sent.length, 1, 'the coach is still told');
  } finally {
    await cleanup();
  }
});
