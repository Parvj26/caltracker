import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { prefsFromRow, type PushPrefsRow, type ServerPushType } from '@caltracker/shared';
import { apnsConfigFromEnv, createApnsClient, type ApnsConfig, type ApnsResult, type JwtStore } from './apns.ts';
import {
  PUSH_MAX_ATTEMPTS,
  planBatch,
  planReminders,
  retryDelayMs,
  type FinishResult,
  type PlannedSend,
  type ReminderCandidate,
  type SenderRow,
  type UserContext,
} from './plan.ts';

// send-push (docs/superpowers/specs/2026-11-09-client-push-notifications-design.md): sends client push notifications
// straight to APNs. Called only by pg_cron through public.push_dispatch with the x-push-secret header:
//   { job: 'send' }      every minute: claim due push_outbox rows, apply preferences / quiet hours / grouping
//                        (planBatch, pure), send to every device, report back with finish_push_batch.
//   { job: 'reminders' } every 15 minutes: enqueue the daily workout reminder for clients whose time has come.
// verify_jwt is off (supabase/config.toml): the cron job has no user JWT; the shared secret is checked here.
// APNs secrets: APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, APNS_ENV (sandbox | production; TestFlight and
// App Store builds use production, a local Debug build gets sandbox tokens). See docs/runbooks/staging.md.

export interface HandlerDeps {
  /** Service-role client. Lives only in this Edge Function, never in app code. */
  supabaseAdmin: SupabaseClient;
  /** The shared secret the cron job sends. Empty: every call is refused. */
  cronSecret: string;
  /** Null when the APNs secrets are not set: 'send' answers 503 and leaves the rows alone. */
  apns: ApnsConfig | null;
  /** Used for the APNs requests. Tests inject a mock; nothing here ever reaches Apple in tests. */
  fetch?: typeof fetch;
  now?: () => Date;
}

type OutboxRow = {
  id: string;
  user_id: string;
  type: ServerPushType;
  group_key: string;
  data: unknown;
  created_at: string;
  attempts: number;
};
type ContextRow = { user_id: string; prefs: PushPrefsRow | null; time_zone: string; badge: number; tokens: string[] };

/** Devices sent to at once per notification group, and groups at once. */
const GROUP_CONCURRENCY = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (error: string, status: number) => json({ error }, status);

function logFailure(step: string, err: unknown) {
  console.error(`send-push: ${step} failed`, err instanceof Error ? err.message : JSON.stringify(err));
}

/** Compares in time independent of where the strings differ. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i % x.length] ?? 0) ^ (y[i % y.length] ?? 0);
  return diff === 0;
}

/** APNs collapse id (max 64 bytes): the first 32 hex chars of SHA-256 of the group key. */
async function collapseId(groupKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(groupKey)));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The APNs provider token cached in push_sender_state (Apple throttles re-signing). */
function senderStateStore(admin: SupabaseClient): JwtStore {
  return {
    async get() {
      const { data, error } = await admin
        .from('push_sender_state')
        .select('apns_jwt, apns_jwt_issued_at')
        .eq('id', 1)
        .maybeSingle();
      if (error) logFailure('read jwt', error);
      if (!data?.apns_jwt || !data.apns_jwt_issued_at) return null;
      return { jwt: data.apns_jwt as string, issuedAt: new Date(data.apns_jwt_issued_at as string) };
    },
    async put(jwt, issuedAt) {
      const { error } = await admin
        .from('push_sender_state')
        .upsert({ id: 1, apns_jwt: jwt, apns_jwt_issued_at: issuedAt.toISOString() });
      if (error) logFailure('store jwt', error);
    },
  };
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/** One group's outcome from its devices' answers. */
function groupOutcome(send: PlannedSend, answers: ApnsResult[], now: Date): Omit<FinishResult, 'id'> {
  const { title, body } = send.payload;
  if (answers.some((a) => a.kind === 'ok')) return { outcome: 'sent', title, body };
  if (answers.every((a) => a.kind === 'invalid_token')) return { outcome: 'no_device' };
  const reasons = [...new Set(answers.filter((a) => a.kind !== 'ok').map((a) => ('reason' in a ? a.reason : '')))];
  const error = reasons.join('; ');
  const attempt = send.attempts + 1;
  if (answers.some((a) => a.kind === 'retry') && attempt < PUSH_MAX_ATTEMPTS) {
    return { outcome: 'retry', not_before: new Date(now.getTime() + retryDelayMs(attempt)).toISOString(), error };
  }
  return { outcome: 'failed', error };
}

export function createHandler({ supabaseAdmin: admin, cronSecret, apns, fetch: fetchFn = fetch, now = () => new Date() }: HandlerDeps) {
  async function sendJob(cfg: ApnsConfig): Promise<Response> {
    const claimed = await admin.rpc('claim_push_batch', { p_limit: 500 });
    if (claimed.error) {
      logFailure('claim', claimed.error);
      return fail('claim failed', 500);
    }
    const rows: SenderRow[] = ((claimed.data ?? []) as OutboxRow[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      groupKey: r.group_key,
      data: r.data,
      createdAt: r.created_at,
      attempts: r.attempts,
    }));
    if (rows.length === 0) return json({ sent: 0, deferred: 0, skipped: 0, failed: 0, retried: 0 });

    const context = await admin.rpc('push_user_context', { p_user_ids: [...new Set(rows.map((r) => r.userId))] });
    if (context.error) {
      // The claims lapse after 2 minutes and the next run tries again.
      logFailure('context', context.error);
      return fail('context failed', 500);
    }
    const ctx = new Map<string, UserContext>(
      ((context.data ?? []) as ContextRow[]).map((c) => [
        c.user_id,
        { prefs: prefsFromRow(c.prefs), timeZone: c.time_zone, badge: c.badge, tokens: c.tokens ?? [] },
      ]),
    );

    const at = now();
    const { results, sends } = planBatch(rows, ctx, at);
    const client = createApnsClient({ cfg, store: senderStateStore(admin), fetch: fetchFn, now });
    const deadTokens: string[] = [];

    await pool(sends, GROUP_CONCURRENCY, async (send) => {
      const payload = { ...send.payload, collapseId: await collapseId(send.groupKey) };
      const answers = await Promise.all(
        send.tokens.map(async (token): Promise<ApnsResult> => {
          try {
            return await client.send(token, payload);
          } catch (e) {
            return { kind: 'retry', reason: `send failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }),
      );
      answers.forEach((a, i) => {
        if (a.kind !== 'invalid_token') return;
        deadTokens.push(send.tokens[i]!);
        // A Debug build's token is a sandbox token: a production sender gets BadDeviceToken for it.
        console.warn(
          `send-push: APNs (${cfg.env}) rejected device token ${send.tokens[i]!.slice(0, 8)}…: ${a.reason}; removing it`,
        );
      });
      const outcome = groupOutcome(send, answers, at);
      if (outcome.outcome === 'failed' || outcome.outcome === 'retry') {
        console.warn(`send-push: APNs (${cfg.env}) ${send.payload.type} ${outcome.outcome}: ${outcome.error}`);
      }
      for (const id of send.ids) results.push({ id, ...outcome });
    });

    const finished = await admin.rpc('finish_push_batch', { p_results: results, p_dead_tokens: deadTokens });
    if (finished.error) {
      logFailure('finish', finished.error);
      return fail('finish failed', 500);
    }
    const count = (...outcomes: FinishResult['outcome'][]) => results.filter((r) => outcomes.includes(r.outcome)).length;
    return json({
      sent: count('sent'),
      deferred: count('defer'),
      skipped: count('disabled', 'no_device', 'expired'),
      failed: count('failed'),
      retried: count('retry'),
    });
  }

  async function remindersJob(): Promise<Response> {
    const { data, error } = await admin.rpc('push_reminder_candidates');
    if (error) {
      logFailure('reminder candidates', error);
      return fail('candidates failed', 500);
    }
    let enqueued = 0;
    for (const row of planReminders((data ?? []) as ReminderCandidate[], now())) {
      const ins = await admin.from('push_outbox').insert(row);
      if (!ins.error) enqueued++;
      else if (ins.error.code !== '23505') logFailure('enqueue reminder', ins.error); // 23505: already queued today
    }
    return json({ enqueued });
  }

  async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return fail('Method not allowed', 405);
    const secret = req.headers.get('x-push-secret');
    if (!cronSecret || secret === null || !sameSecret(secret, cronSecret)) return fail('Unauthorized', 401);
    let job: unknown;
    try {
      job = ((await req.json()) as { job?: unknown } | null)?.job;
    } catch {
      return fail("Send { job: 'send' | 'reminders' }.", 400);
    }
    if (job === 'reminders') return remindersJob();
    if (job !== 'send') return fail("Send { job: 'send' | 'reminders' }.", 400);
    if (!apns) {
      console.error('send-push: APNs secrets are not set (docs/runbooks/staging.md); nothing sent');
      return fail('APNs is not configured', 503);
    }
    return sendJob(apns);
  }

  return async (req: Request): Promise<Response> => {
    try {
      return await handle(req);
    } catch (err) {
      logFailure('request', err);
      return fail('Something went wrong.', 500);
    }
  };
}

if (import.meta.main) {
  const env = Deno.env;
  Deno.serve(
    createHandler({
      supabaseAdmin: createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      cronSecret: env.get('SEND_PUSH_SECRET') ?? '',
      apns: apnsConfigFromEnv((k) => env.get(k)),
    }),
  );
}
