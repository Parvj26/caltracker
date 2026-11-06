import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  awardContext,
  awardedStickers,
  computeAward,
  logRowToDoc,
  safeTimeZone,
  type AwardResult,
  type LogTreeRow,
  type Rng,
} from '@caltracker/shared';

// award-workout (docs/superpowers/specs/2026-11-05-stickers-prs-streaks-design.md): the only writer of stickers,
// personal bests and streak stats. Idempotent per log: the first award is stored in `awards` and every later call
// returns it unchanged.
//
// Callers:
//   - the phone, with the client's JWT, after its completed log is saved: { logId }
//   - the catch-up cron job (pg_net), with the x-award-secret header: { logId }
//   - a coach correction (web, Task 7): { logId, recompute: true }. That rewrites the log's PRs, the client's
//     bests and stats from the logs, and never touches stickers or rolls again.
// A reopened and re-finished log (its revision changed since the award) is recomputed the same way on the next
// plain call. A recompute of a log with no award yet is a full award (the client was always due it).
// A client the coach has removed gets nothing: 403 with hint 'not_a_client', as save_workout_log answers.
// Everything is per workspace: award_inputs hands over only the log's workspace's logs and stickers, so a client
// who joins a new coach starts fresh there.
//
// verify_jwt is off for this function (supabase/config.toml) because the cron job has no user JWT; a user caller's
// token is checked here with auth.getUser instead.

export interface HandlerDeps {
  /** Service-role client. Lives only in this Edge Function, never in app code. */
  supabaseAdmin: SupabaseClient;
  /** The shared secret the catch-up job sends. Empty or missing: secret calls are refused. */
  cronSecret?: string;
  /** Random source in [0, 1) for the rolls. Defaults to the platform CSPRNG; tests inject a fixed one. */
  rng?: Rng;
  /** The current time, for the streak stored in client_stats. Tests may fix it. */
  now?: () => Date;
}

type Owned = { key: string; count: number; shiny: boolean };
type Inputs = {
  log: { id: string; client_id: string; workspace_id: string; status: string; revision: number; is_client: boolean };
  time_zone: string | null;
  award: AwardResult | null;
  award_revision: number | null;
  history_version: string;
  owned: Owned[];
  owned_total: number;
  logs: LogTreeRow[];
};
type Applied = { status: 'existing' | 'awarded' | 'recomputed'; result: AwardResult } | { status: 'conflict' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 3;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (error: string, status: number) => json({ error }, status);
const NOT_A_CLIENT = 'not_a_client';
const notAClient = () => json({ error: 'You are no longer a client of this coach.', hint: NOT_A_CLIENT }, 403);
const serverError = () => fail('Something went wrong. Please try again.', 500);

function logFailure(step: string, err: unknown) {
  console.error(`award-workout: ${step} failed`, err instanceof Error ? err.message : JSON.stringify(err));
}

/** A uniform [0, 1) from 32 random bits of the platform CSPRNG. */
export const cryptoRng: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/** Compares in time independent of where the strings differ. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i % x.length] ?? 0) ^ (y[i % y.length] ?? 0);
  return diff === 0;
}

export function createHandler({ supabaseAdmin: admin, cronSecret, rng = cryptoRng, now = () => new Date() }: HandlerDeps) {
  /** The caller: 'cron' for the secret, a user id for a valid JWT, or null. */
  async function caller(req: Request): Promise<'cron' | { userId: string } | null> {
    const secret = req.headers.get('x-award-secret');
    if (secret !== null) return cronSecret && sameSecret(secret, cronSecret) ? 'cron' : null;
    const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return null;
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : { userId: data.user.id };
  }

  async function isCoachOf(userId: string, workspaceId: string): Promise<boolean> {
    const { data, error } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .in('role', ['owner', 'staff'])
      .maybeSingle();
    if (error) logFailure('coach check', error);
    return Boolean(data);
  }

  async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return fail('Method not allowed', 405);

    const who = await caller(req);
    if (!who) return fail('Sign in to collect awards.', 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail('Send { logId }.', 400);
    }
    const { logId, recompute } = (body ?? {}) as { logId?: unknown; recompute?: unknown };
    if (typeof logId !== 'string' || !UUID.test(logId) || (recompute !== undefined && typeof recompute !== 'boolean')) {
      return fail('Send { logId }.', 400);
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { data, error } = await admin.rpc('award_inputs', { p_log_id: logId });
      if (error) {
        logFailure('load', error);
        return serverError();
      }
      const inputs = data as Inputs | null;
      if (!inputs) return fail('Workout not found.', 404);

      if (who !== 'cron' && inputs.log.client_id !== who.userId) {
        // Only the client earns from their own workout; their coach may ask for a recompute after a correction.
        if (!(recompute === true && (await isCoachOf(who.userId, inputs.log.workspace_id)))) {
          return fail('This workout belongs to someone else.', 403);
        }
      }
      if (!inputs.log.is_client) return notAClient();
      if (inputs.log.status !== 'completed') return fail('Finish the workout first.', 409);
      // Already awarded for this version of the log: the same answer every time.
      if (inputs.award && recompute !== true && inputs.award_revision === inputs.log.revision) {
        return json(inputs.award);
      }

      const ctx = awardContext(inputs.logs.map(logRowToDoc), logId, safeTimeZone(inputs.time_zone), now().toISOString());
      const owned = new Map(inputs.owned.map((o) => [o.key, { count: o.count, shiny: o.shiny }]));
      const award = computeAward({ ...ctx, owned, rng });

      const { data: applied, error: applyError } = await admin.rpc('apply_award', {
        p_log_id: logId,
        p_result: {
          mode: recompute === true ? 'recompute' : 'award',
          history_version: inputs.history_version,
          owned_total: inputs.owned_total,
          award,
          stickers: awardedStickers(award),
          records: ctx.records.map((r) => ({
            exercise_id: r.exerciseId,
            kind: r.kind,
            value_kg: r.valueKg,
            reps: r.reps,
            log_id: r.logId,
            achieved_at: r.achievedAt,
          })),
          stats: {
            workouts: ctx.current.workouts,
            streak: ctx.current.streak,
            streak_week: ctx.currentStreakWeek,
            best_streak: ctx.current.bestStreak,
            journey_week: ctx.current.streak,
            pr_count: ctx.current.prCount,
            lifetime_volume_kg: ctx.current.lifetimeVolumeKg,
          },
        },
      });
      if (applyError) {
        // The log was reopened or deleted between the load and the write.
        if (applyError.code === '23514') return fail('Finish the workout first.', 409);
        if (applyError.code === 'P0002') return fail('Workout not found.', 404);
        if (applyError.code === '42501') return notAClient();
        logFailure('apply', applyError);
        return serverError();
      }
      const outcome = applied as Applied;
      if (outcome.status !== 'conflict') return json(outcome.result);
      // The client's logs or stickers changed meanwhile (a save, a correction, another workout's award): read
      // them again and work the award out again.
    }
    logFailure('apply', new Error(`history kept changing after ${MAX_ATTEMPTS} attempts for ${logId}`));
    return fail('Something went wrong. Please try again.', 503);
  }

  return async (req: Request): Promise<Response> => {
    try {
      return await handle(req);
    } catch (err) {
      logFailure('award', err);
      return serverError();
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
      cronSecret: env.get('AWARD_WORKOUT_SECRET') ?? '',
    }),
  );
}
