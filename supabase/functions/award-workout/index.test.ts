import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AwardResult, Rng } from '@caltracker/shared';
import { createHandler } from './index.ts';

const URL_ = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PASSWORD = 'award-password-123';
const SECRET = 'test-award-secret';
const MIN = 60 * 1000;

const admin: SupabaseClient = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const handlerWith = (rng: Rng = () => 0.5) => createHandler({ supabaseAdmin: admin, cronSecret: SECRET, rng });

const uid = () => crypto.randomUUID().slice(0, 8);
const workspaceIds: string[] = [];
const userIds: string[] = [];

async function makeUser(label: string) {
  const email = `award-${label}-${uid()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  userIds.push(data.user.id);
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: signInError } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  return { id: data.user.id, token: session.session!.access_token, client: c };
}

async function makeWorkspace() {
  const coach = await makeUser('coach');
  const { data, error } = await admin.from('workspaces').insert({ name: `Award ${uid()}` }).select('id').single();
  if (error) throw error;
  workspaceIds.push(data.id);
  const m = await admin.from('workspace_members').insert({ workspace_id: data.id, user_id: coach.id, role: 'owner' });
  if (m.error) throw m.error;
  const { data: ex, error: exError } = await admin
    .from('exercises')
    .insert({ workspace_id: data.id, source: 'custom', name: `Bench ${uid()}`, tracking_type: 'weight_reps' })
    .select('id')
    .single();
  if (exError) throw exError;
  return { ws: data.id as string, coach, exerciseId: ex.id as string };
}

async function addClient(ws: string) {
  const c = await makeUser('client');
  const { error } = await admin.from('workspace_members').insert({ workspace_id: ws, user_id: c.id, role: 'client' });
  if (error) throw error;
  return c;
}

/** A log of one exercise with these sets (all done), finished `minutesAgo` minutes ago unless in progress. */
async function makeLog(
  ws: string,
  clientId: string,
  exerciseId: string,
  sets: Array<{ w: number; r: number }>,
  opts: { status?: 'completed' | 'in_progress'; minutesAgo?: number } = {},
) {
  const status = opts.status ?? 'completed';
  const finished = new Date(Date.now() - (opts.minutesAgo ?? 10) * MIN).toISOString();
  const { data: log, error } = await admin
    .from('workout_logs')
    .insert({
      workspace_id: ws,
      client_id: clientId,
      name: 'Push day',
      status,
      started_at: new Date(Date.parse(finished) - 60 * MIN).toISOString(),
      finished_at: status === 'completed' ? finished : null,
      last_activity_at: finished,
      logged_by: clientId,
    })
    .select('id')
    .single();
  if (error) throw error;
  const { data: block, error: bErr } = await admin
    .from('log_blocks')
    .insert({ log_id: log.id, position: 0, kind: 'straight' })
    .select('id')
    .single();
  if (bErr) throw bErr;
  const { data: le, error: eErr } = await admin
    .from('log_exercises')
    .insert({ block_id: block.id, position: 0, exercise_id: exerciseId })
    .select('id')
    .single();
  if (eErr) throw eErr;
  const { data: setRows, error: sErr } = await admin
    .from('log_sets')
    .insert(
      sets.map((s, i) => ({
        log_exercise_id: le.id,
        position: i,
        set_type: 'normal',
        actual_reps: s.r,
        actual_weight_kg: s.w,
        completed_at: finished,
      })),
    )
    .select('id');
  if (sErr) throw sErr;
  return { logId: log.id as string, setIds: setRows.map((r) => r.id as string) };
}

const five = (w: number, r = 10) => Array.from({ length: 5 }, () => ({ w, r }));

function call(handler: ReturnType<typeof createHandler>, body: unknown, headers: Record<string, string> = {}) {
  return handler(
    new Request('http://localhost/award-workout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}
const asUser = (token: string) => ({ authorization: `Bearer ${token}` });

async function awardRows(logId: string) {
  const { data, error } = await admin.from('awards').select('log_id, client_id, workspace_id, result').eq('log_id', logId);
  if (error) throw error;
  return data;
}
async function stickers(clientId: string) {
  const { data, error } = await admin
    .from('sticker_awards')
    .select('sticker_key, count, shiny, first_earned_at, last_earned_at, first_log_id')
    .eq('client_id', clientId)
    .order('sticker_key');
  if (error) throw error;
  return data;
}
async function records(clientId: string) {
  const { data, error } = await admin
    .from('personal_records')
    .select('kind, value_kg, reps, log_id')
    .eq('client_id', clientId)
    .neq('kind', 'reps_at_weight')
    .order('kind');
  if (error) throw error;
  return data.map((r) => ({ ...r, value_kg: Number(r.value_kg) }));
}

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

t('a caller with no valid JWT or secret gets 401', async () => {
  const { ws, exerciseId } = await makeWorkspace();
  const client = await addClient(ws);
  const { logId } = await makeLog(ws, client.id, exerciseId, five(60));
  const handler = handlerWith();
  assertEquals((await call(handler, { logId })).status, 401);
  assertEquals((await call(handler, { logId }, { authorization: `Bearer ${ANON}` })).status, 401, 'the anon key is no user');
  assertEquals((await call(handler, { logId }, { authorization: 'Bearer not-a-jwt' })).status, 401);
  assertEquals((await call(handler, { logId }, { 'x-award-secret': 'wrong' })).status, 401);
  const noSecret = createHandler({ supabaseAdmin: admin, cronSecret: '' });
  assertEquals((await call(noSecret, { logId }, { 'x-award-secret': '' })).status, 401, 'an unset secret opens nothing');
  assertEquals(await awardRows(logId), []);
});

t("another client's log gets 403, and so does the coach outside a recompute", async () => {
  const { ws, coach, exerciseId } = await makeWorkspace();
  const owner = await addClient(ws);
  const other = await addClient(ws);
  const { logId } = await makeLog(ws, owner.id, exerciseId, five(60));
  const handler = handlerWith();
  assertEquals((await call(handler, { logId }, asUser(other.token))).status, 403);
  assertEquals((await call(handler, { logId }, asUser(coach.token))).status, 403);
  assertEquals((await call(handler, { logId, recompute: true }, asUser(other.token))).status, 403);
  assertEquals(await awardRows(logId), []);
});

t('an in-progress log gets 409; a bad body 400; an unknown log 404', async () => {
  const { ws, exerciseId } = await makeWorkspace();
  const client = await addClient(ws);
  const { logId } = await makeLog(ws, client.id, exerciseId, five(60), { status: 'in_progress' });
  const handler = handlerWith();
  assertEquals((await call(handler, { logId }, asUser(client.token))).status, 409);
  assertEquals((await call(handler, { logId: 'nope' }, asUser(client.token))).status, 400);
  assertEquals((await call(handler, { logId: crypto.randomUUID() }, asUser(client.token))).status, 404);
  assertEquals(await awardRows(logId), []);
});

t('the same log twice gives one award and an identical response', async () => {
  const { ws, exerciseId } = await makeWorkspace();
  const client = await addClient(ws);
  const { logId } = await makeLog(ws, client.id, exerciseId, five(60)); // 3,000 kg: a rhino
  const first = await call(handlerWith(() => 0.5), { logId }, asUser(client.token));
  assertEquals(first.status, 200);
  const a = (await first.json()) as AwardResult;
  assertEquals(a.ladder, { key: 'rhino', multiple: 3000 / 2300, isNew: true, count: 1, shiny: false });
  assertEquals(a.milestone, 1);
  assertEquals(a.landmarks, ['chichen-itza']);
  assertEquals(a.prs, [], 'the first log of an exercise is a baseline');

  // A second call, even one whose rolls would all hit, returns the stored result.
  const second = await call(handlerWith(() => 0), { logId }, asUser(client.token));
  assertEquals(second.status, 200);
  assertEquals(await second.json(), a);

  const rows = await awardRows(logId);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.client_id, client.id);
  assertEquals(rows[0]!.workspace_id, ws);
  const owned = await stickers(client.id);
  assertEquals(owned.map((s) => [s.sticker_key, s.count]), [['chichen-itza', 1], ['rhino', 1]]);
  const { data: stats } = await admin.from('client_stats').select('workouts, streak, journey_week').eq('client_id', client.id).single();
  assertEquals(stats, { workouts: 1, streak: 1, journey_week: 1 });
});

t('the catch-up secret can award; two concurrent calls give one award row and the same response', async () => {
  const { ws, exerciseId } = await makeWorkspace();
  const client = await addClient(ws);
  const { logId } = await makeLog(ws, client.id, exerciseId, five(60));
  // Different rolls on each side: if both wrote, the responses or the sticker counts would differ.
  const [p, c] = await Promise.all([
    call(handlerWith(() => 0), { logId }, asUser(client.token)),
    call(handlerWith(() => 0.999), { logId }, { 'x-award-secret': SECRET }),
  ]);
  assertEquals([p.status, c.status], [200, 200]);
  assertEquals(await p.json(), await c.json());
  assertEquals((await awardRows(logId)).length, 1);
  const owned = await stickers(client.id);
  assert(owned.every((s) => s.count === 1), 'every sticker granted once');
});

t('injected rolls are deterministic: 0 hits shiny and a drop, 0.5 hits neither', async () => {
  const { ws, exerciseId } = await makeWorkspace();
  const lucky = await addClient(ws);
  const plain = await addClient(ws);
  const l1 = await makeLog(ws, lucky.id, exerciseId, five(60));
  const l2 = await makeLog(ws, plain.id, exerciseId, five(60));
  const a = (await (await call(handlerWith(() => 0), { logId: l1.logId }, asUser(lucky.token))).json()) as AwardResult;
  assertEquals(a.ladder?.shiny, true);
  assertEquals(a.drop, 'pink-river-dolphin');
  const b = (await (await call(handlerWith(() => 0.5), { logId: l2.logId }, asUser(plain.token))).json()) as AwardResult;
  assertEquals(b.ladder?.shiny, false);
  assertEquals(b.drop, null);
  const owned = await stickers(lucky.id);
  assertEquals(owned.find((s) => s.sticker_key === 'rhino')?.shiny, true);
  assert(owned.some((s) => s.sticker_key === 'pink-river-dolphin'));
});

t('a recompute after a coach correction lowers the PR and leaves the stickers alone', async () => {
  const { ws, coach, exerciseId } = await makeWorkspace();
  const client = await addClient(ws);
  const base = await makeLog(ws, client.id, exerciseId, five(100, 5), { minutesAgo: 60 });
  const big = await makeLog(ws, client.id, exerciseId, five(120, 5), { minutesAgo: 10 });
  const handler = handlerWith(() => 0.5);
  assertEquals((await call(handler, { logId: base.logId }, asUser(client.token))).status, 200);
  const before = (await (await call(handler, { logId: big.logId }, asUser(client.token))).json()) as AwardResult;
  assertEquals(before.prs.map((p) => p.kind).sort(), ['e1rm', 'heaviest']);
  assertEquals((await records(client.id)).find((r) => r.kind === 'heaviest'), {
    kind: 'heaviest',
    value_kg: 120,
    reps: 5,
    log_id: big.logId,
  });
  const stickersBefore = await stickers(client.id);
  const { data: statsBefore } = await admin.from('client_stats').select('pr_count, lifetime_volume_kg').eq('client_id', client.id).single();
  assertEquals(statsBefore, { pr_count: 2, lifetime_volume_kg: 5500 });

  // The coach fixes a typo: it was 70 kg, not 120.
  const { error } = await coach.client.rpc('correct_workout_log', {
    p_log_id: big.logId,
    p_sets: big.setIds.map((id) => ({ id, actualWeightKg: 70 })),
  });
  if (error) throw error;
  const res = await call(handler, { logId: big.logId, recompute: true }, asUser(coach.token));
  assertEquals(res.status, 200);
  const after = (await res.json()) as AwardResult;

  assertEquals(after.prs, [], 'the corrected log no longer sets a best');
  assertEquals(after.ladder, before.ladder, 'the sticker shown stays');
  assertEquals(after.drop, before.drop);
  assertEquals((await records(client.id)).find((r) => r.kind === 'heaviest'), {
    kind: 'heaviest',
    value_kg: 100,
    reps: 5,
    log_id: base.logId,
  });
  assertEquals(await stickers(client.id), stickersBefore, 'sticker_awards unchanged');
  const { data: statsAfter } = await admin.from('client_stats').select('pr_count, lifetime_volume_kg').eq('client_id', client.id).single();
  assertEquals(statsAfter, { pr_count: 0, lifetime_volume_kg: 4250 });
  const rows = await awardRows(big.logId);
  assertEquals(rows.length, 1);
  assertEquals((rows[0]!.result as AwardResult).prs, []);
  assertNotEquals(rows[0]!.result, before);
});
