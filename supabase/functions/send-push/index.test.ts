import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApnsConfig } from './apns.ts';
import { createHandler } from './index.ts';

// Runs against the local Supabase stack (see the plan, Task 8). APNs is never called: fetch is mocked.

const URL_ = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = 'test-push-secret';
const MIN = 60_000;

const admin: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
const PEM = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
const APNS: ApnsConfig = { keyP8: PEM, keyId: 'TESTKEY123', teamId: '88L5M6CC34', topic: 'app.caltracker.client', env: 'production' };

const uid = () => crypto.randomUUID().slice(0, 8);
const hexToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
const workspaceIds: string[] = [];
const userIds: string[] = [];

async function makeUser(label: string, firstName = '') {
  const { data, error } = await admin.auth.admin.createUser({
    email: `push-${label}-${uid()}@test.local`,
    password: 'push-password-123',
    email_confirm: true,
  });
  if (error) throw error;
  userIds.push(data.user.id);
  if (firstName) {
    const p = await admin.from('profiles').update({ first_name: firstName }).eq('id', data.user.id);
    if (p.error) throw p.error;
  }
  return data.user.id;
}

/** A coach (Luis) and a client (Sam). Quiet hours are off unless `prefs` says otherwise, so tests pass at any hour. */
async function makeClient(opts: { zone?: string; prefs?: Record<string, unknown> | null } = {}) {
  const coach = await makeUser('coach', 'Luis');
  const { data, error } = await admin.from('workspaces').insert({ name: `Push ${uid()}` }).select('id').single();
  if (error) throw error;
  const ws = data.id as string;
  workspaceIds.push(ws);
  const client = await makeUser('client', 'Sam');
  const m = await admin.from('workspace_members').insert([
    { workspace_id: ws, user_id: coach, role: 'owner' },
    { workspace_id: ws, user_id: client, role: 'client' },
  ]);
  if (m.error) throw m.error;
  if (opts.zone) {
    const z = await admin.from('profiles').update({ time_zone: opts.zone }).eq('id', client);
    if (z.error) throw z.error;
  }
  if (opts.prefs !== null) {
    const np = await admin.from('notification_prefs').insert({ user_id: client, quiet_enabled: false, ...opts.prefs });
    if (np.error) throw np.error;
  }
  return { ws, coach, client };
}

async function addDevice(userId: string) {
  const token = hexToken();
  const { error } = await admin.from('push_devices').insert({ token, user_id: userId });
  if (error) throw error;
  return token;
}

/** A coach message: the messages trigger queues the push; made due now. */
async function coachMessage(ws: string, coach: string, client: string) {
  const { data: conv, error } = await admin
    .from('conversations')
    .upsert({ workspace_id: ws, client_id: client }, { onConflict: 'workspace_id,client_id' })
    .select('id')
    .single();
  if (error) throw error;
  const msg = await admin.from('messages').insert({ conversation_id: conv.id, workspace_id: ws, sender_id: coach, body: 'secret text' });
  if (msg.error) throw msg.error;
  const due = await admin
    .from('push_outbox')
    .update({ not_before: new Date(Date.now() - 1000).toISOString() })
    .eq('user_id', client)
    .is('sent_at', null);
  if (due.error) throw due.error;
  return conv.id as string;
}

async function outbox(userId: string) {
  const { data, error } = await admin
    .from('push_outbox')
    .select('id, type, group_key, data, sent_at, outcome, attempts, not_before, title, body, claimed_until, last_error')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw error;
  return data;
}

async function devices(userId: string) {
  const { data, error } = await admin.from('push_devices').select('token').eq('user_id', userId);
  if (error) throw error;
  return data.map((d) => d.token as string).sort();
}

type Reply = { status: number; reason?: string };
/** A mock APNs: records calls; answers per token (default 200). */
function mockApns(reply: (token: string) => Reply = () => ({ status: 200 })) {
  const calls: Array<{ token: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const token = url.split('/').pop()!;
    calls.push({
      token,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: JSON.parse(String(init?.body)),
    });
    const r = reply(token);
    return Promise.resolve(new Response(r.reason ? JSON.stringify({ reason: r.reason }) : null, { status: r.status }));
  };
  return { calls, fetch: fetchFn as typeof fetch };
}

type HandlerOpts = {
  fetch?: typeof fetch;
  apns?: ApnsConfig | null;
  now?: () => Date;
  supabaseAdmin?: SupabaseClient;
  budgetMs?: number;
  concurrency?: number;
  finishChunk?: number;
};
const handlerWith = (opts: HandlerOpts = {}) =>
  createHandler({
    supabaseAdmin: opts.supabaseAdmin ?? admin,
    cronSecret: SECRET,
    apns: opts.apns === undefined ? APNS : opts.apns,
    fetch: opts.fetch ?? mockApns().fetch,
    now: opts.now,
    budgetMs: opts.budgetMs,
    concurrency: opts.concurrency,
    finishChunk: opts.finishChunk,
  });

const call = (handler: (req: Request) => Promise<Response>, body: unknown, headers: Record<string, string> = { 'x-push-secret': SECRET }) =>
  handler(new Request('http://localhost/send-push', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

async function cleanup() {
  for (const ws of workspaceIds.splice(0)) await admin.from('workspaces').delete().eq('id', ws);
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

t('401 without the secret', async () => {
  const h = handlerWith();
  assertEquals((await call(h, { job: 'send' }, {})).status, 401);
  assertEquals((await call(h, { job: 'send' }, { 'x-push-secret': 'wrong' })).status, 401);
  const unset = createHandler({ supabaseAdmin: admin, cronSecret: '', apns: APNS });
  assertEquals((await call(unset, { job: 'send' }, { 'x-push-secret': '' })).status, 401, 'an unset secret opens nothing');
});

t('400 for an unknown job', async () => {
  assertEquals((await call(handlerWith(), { job: 'nope' })).status, 400);
});

t('503 for send without APNs config, rows untouched', async () => {
  const { ws, coach, client } = await makeClient();
  await addDevice(client);
  await coachMessage(ws, coach, client);
  const res = await call(handlerWith({ apns: null }), { job: 'send' });
  assertEquals(res.status, 503);
  const [row] = await outbox(client);
  assertEquals(row!.sent_at, null);
  assertEquals(row!.claimed_until, null);
  assertEquals(row!.attempts, 0);
});

t('sends a due row to every device with the badge', async () => {
  const { ws, coach, client } = await makeClient();
  const a = await addDevice(client);
  const b = await addDevice(client);
  await coachMessage(ws, coach, client);
  const apns = mockApns();
  const res = await call(handlerWith({ fetch: apns.fetch }), { job: 'send' });
  assertEquals(res.status, 200);
  const mine = apns.calls.filter((c) => c.token === a || c.token === b);
  assertEquals(mine.map((c) => c.token).sort(), [a, b].sort());
  for (const c of mine) {
    assertEquals(c.body.aps, {
      alert: { title: 'Message from Luis', body: 'Luis sent you a message.' },
      badge: 1,
      sound: 'default',
      'thread-id': 'message',
    });
    assertEquals(c.body.route, '/coach');
    assert(/^[0-9a-f]{32}$/.test(c.headers['apns-collapse-id']!), 'collapse id is 32 hex chars');
    assert(!JSON.stringify(c.body).includes('secret text'), 'no message content');
  }
  const [row] = await outbox(client);
  assert(row!.sent_at);
  assertEquals(row!.outcome, 'sent');
  assertEquals(row!.title, 'Message from Luis');
  assertEquals(row!.body, 'Luis sent you a message.');
  assertEquals(row!.claimed_until, null);
});

t('a 410 token is deleted; the other device still gets it', async () => {
  const { ws, coach, client } = await makeClient();
  const dead = await addDevice(client);
  const live = await addDevice(client);
  await coachMessage(ws, coach, client);
  const apns = mockApns((token) => (token === dead ? { status: 410, reason: 'Unregistered' } : { status: 200 }));
  assertEquals((await call(handlerWith({ fetch: apns.fetch }), { job: 'send' })).status, 200);
  assertEquals(await devices(client), [live]);
  assertEquals((await outbox(client))[0]!.outcome, 'sent');
});

t('only invalid tokens: no_device', async () => {
  const { ws, coach, client } = await makeClient();
  await addDevice(client);
  await coachMessage(ws, coach, client);
  const apns = mockApns(() => ({ status: 400, reason: 'BadDeviceToken' }));
  await call(handlerWith({ fetch: apns.fetch }), { job: 'send' });
  assertEquals(await devices(client), []);
  assertEquals((await outbox(client))[0]!.outcome, 'no_device');
});

t('a 500 is retried later and gives up after 5 attempts', async () => {
  const { ws, coach, client } = await makeClient();
  const token = await addDevice(client);
  await coachMessage(ws, coach, client);
  const apns = mockApns((t) => (t === token ? { status: 500, reason: 'InternalServerError' } : { status: 200 }));
  const h = handlerWith({ fetch: apns.fetch });
  const before = Date.now();
  await call(h, { job: 'send' });
  let [row] = await outbox(client);
  assertEquals(row!.sent_at, null);
  assertEquals(row!.attempts, 1);
  const wait = Date.parse(row!.not_before) - before;
  assert(wait >= MIN - 5000 && wait <= MIN + 30_000, `retries about a minute later (${wait} ms)`);
  assertStringIncludes(row!.last_error!, 'InternalServerError');

  const up = await admin.from('push_outbox').update({ attempts: 4, not_before: new Date(Date.now() - 1000).toISOString() }).eq('id', row!.id);
  if (up.error) throw up.error;
  await call(h, { job: 'send' });
  [row] = await outbox(client);
  assertEquals(row!.outcome, 'failed');
  assertEquals(row!.attempts, 5);
  assertEquals(await devices(client), [token], 'a server error keeps the device');
});

t('quiet hours defer the row to the end of the window', async () => {
  // A window covering the whole day (but 23:59) in the client's zone.
  const { ws, coach, client } = await makeClient({
    zone: 'America/New_York',
    prefs: { quiet_enabled: true, quiet_start: '00:00', quiet_end: '23:59' },
  });
  await addDevice(client);
  await coachMessage(ws, coach, client);
  const apns = mockApns();
  await call(handlerWith({ fetch: apns.fetch }), { job: 'send' });
  const [row] = await outbox(client);
  assertEquals(row!.sent_at, null);
  assertEquals(row!.attempts, 0);
  assert(Date.parse(row!.not_before) > Date.now(), 'waits');
});

t('a switched-off type is not sent', async () => {
  const { ws, coach, client } = await makeClient({ prefs: { disabled: ['message'] } });
  const token = await addDevice(client);
  await coachMessage(ws, coach, client);
  const apns = mockApns();
  await call(handlerWith({ fetch: apns.fetch }), { job: 'send' });
  assertEquals(apns.calls.filter((c) => c.token === token), []);
  assertEquals((await outbox(client))[0]!.outcome, 'disabled');
});

t('logs the APNs environment when a token is rejected', async () => {
  const { ws, coach, client } = await makeClient();
  await addDevice(client);
  await coachMessage(ws, coach, client);
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  try {
    await call(handlerWith({ fetch: mockApns(() => ({ status: 400, reason: 'BadDeviceToken' })).fetch }), { job: 'send' });
  } finally {
    console.warn = warn;
  }
  const line = warnings.find((w) => w.includes('BadDeviceToken'));
  assert(line, 'a warning names the reason');
  assertStringIncludes(line, 'production');
});

t('stops starting sends after the time budget; the rest wait for the next run', async () => {
  const people = [];
  for (let i = 0; i < 3; i++) {
    const p = await makeClient();
    people.push({ ...p, token: await addDevice(p.client) });
    await coachMessage(p.ws, p.coach, p.client);
  }
  const mine = new Set(people.map((p) => p.token));
  // Each APNs call takes 61 s on this clock: after the first send the 60 s budget is spent.
  let clock = Date.now();
  const apns = mockApns();
  const slowFetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (mine.has(String(input).split('/').pop()!)) clock += 61_000;
    return apns.fetch(input, init);
  }) as typeof fetch;
  const res = await call(handlerWith({ fetch: slowFetch, now: () => new Date(clock), budgetMs: 60_000, concurrency: 1 }), { job: 'send' });
  assertEquals(res.status, 200);
  assertEquals(apns.calls.filter((c) => mine.has(c.token)).length, 1, 'only one send started');
  const rows = (await Promise.all(people.map((p) => outbox(p.client)))).flat();
  assertEquals(rows.filter((r) => r.outcome === 'sent').length, 1);
  const waiting = rows.filter((r) => r.sent_at === null);
  assertEquals(waiting.length, 2);
  for (const r of waiting) {
    assertEquals(r.attempts, 0, 'not counted as a failed try');
    assertEquals(r.claimed_until, null, 'released for the next run');
    assert(Date.parse(r.not_before) <= clock + 1000, 'due again at once');
  }
});

t('outcomes are recorded chunk by chunk, so sends before a failure stay recorded', async () => {
  const a = await makeClient();
  const b = await makeClient();
  const tokenA = await addDevice(a.client);
  const tokenB = await addDevice(b.client);
  await coachMessage(a.ws, a.coach, a.client);
  await coachMessage(b.ws, b.coach, b.client);
  // Only our two users' rows are due in this test's batch (other rows may be too; they don't send).
  let finishes = 0;
  const flaky = new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop !== 'rpc') return Reflect.get(target, prop, receiver);
      return (fn: string, args?: Record<string, unknown>) => {
        if (fn === 'finish_push_batch') {
          const ids = ((args?.p_results ?? []) as Array<{ outcome: string }>);
          if (ids.some((r) => r.outcome === 'sent') && ++finishes === 2) {
            return Promise.resolve({ data: null, error: { message: 'connection lost' } });
          }
        }
        return target.rpc(fn, args);
      };
    },
  });
  const apns = mockApns();
  const res = await call(handlerWith({ supabaseAdmin: flaky, fetch: apns.fetch, concurrency: 1, finishChunk: 1 }), { job: 'send' });
  assertEquals(res.status, 500, 'the run reports the failure');
  const sentTokens = apns.calls.filter((c) => c.token === tokenA || c.token === tokenB).map((c) => c.token);
  const first = sentTokens[0] === tokenA ? a : b;
  assertEquals((await outbox(first.client))[0]!.outcome, 'sent', 'the first chunk was recorded before the failure');
});

/** A workout on the client's today in their zone, and a reminder time at the start of their current hour. */
async function reminderSetup(zone: string, prefs: Record<string, unknown> = {}) {
  const { ws, client } = await makeClient({ zone, prefs: null });
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now);
  const p = (type: string) => parts.find((x) => x.type === type)!.value;
  const today = `${p('year')}-${p('month')}-${p('day')}`;
  const w = await admin.from('workouts').insert({ workspace_id: ws, client_id: client, scheduled_on: today, name: 'Upper A' });
  if (w.error) throw w.error;
  const np = await admin.from('notification_prefs').insert({ user_id: client, reminder_time: `${p('hour')}:00`, ...prefs });
  if (np.error) throw np.error;
  return { client, today };
}

t('reminders job enqueues once per day', async () => {
  const { client, today } = await reminderSetup('America/New_York');
  const h = handlerWith();
  const res = await call(h, { job: 'reminders' });
  assertEquals(res.status, 200);
  assert(((await res.json()) as { enqueued: number }).enqueued >= 1);
  await call(h, { job: 'reminders' });
  const rows = (await outbox(client)).filter((r) => r.type === 'daily_reminder');
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.group_key, `daily_reminder:${today}`);
  assertEquals((rows[0]!.data as { workoutName: string }).workoutName, 'Upper A');
});

t('reminders job respects the switch', async () => {
  const { client } = await reminderSetup('America/New_York', { disabled: ['daily_reminder'] });
  await call(handlerWith(), { job: 'reminders' });
  assertEquals((await outbox(client)).filter((r) => r.type === 'daily_reminder'), []);
});
