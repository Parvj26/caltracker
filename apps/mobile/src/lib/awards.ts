// The phone's side of the sticker award (docs/superpowers/specs/2026-11-05-stickers-prs-streaks-design.md):
// asks the award-workout Edge Function what a finished workout earned, keeps the answers it could not show in
// a small per-user queue ("Surprise!" on the next app open), and keeps the profile's time zone current.
// The rules and the words are in awards-logic.ts and @caltracker/shared; the function is the only writer.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import type { AwardResult, LadderAward } from '@caltracker/shared';
import { within } from './active-log-logic';
import {
  classifyAwardFailure,
  createRevealQueue,
  expired,
  ladderAwardsFrom,
  ladderCacheKey,
  parseLadderCache,
  withLocalPick,
  withServerAwards,
  type LadderCache,
  type PendingReveal,
} from './awards-logic';
import { supabase } from './supabase';

/** The reveal waits this long for the server before moving on (the award is queued instead). */
export const AWARD_WAIT_MS = 4000;
/** A finished log that is still uploading is asked again for this long, then left to the queue. */
const UPLOAD_GRACE_MS = 30_000;
const RETRY_EVERY_MS = 800;

type Call = { kind: 'ok'; result: AwardResult } | { kind: 'none' } | { kind: 'retry' } | { kind: 'later' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const queueFor = (userId: string) => createRevealQueue(AsyncStorage, userId);

/** One call to award-workout with the signed-in user's JWT. Never throws. */
async function callAward(logId: string): Promise<Call> {
  try {
    const res = await supabase.functions.invoke<AwardResult>('award-workout', { body: { logId } });
    // functions-js types the error as any.
    const error: unknown = res.error;
    if (!error && res.data) return { kind: 'ok', result: res.data };
    if (error instanceof FunctionsFetchError) return { kind: 'later' };
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      const body: unknown = await res.json().catch(() => null);
      const hint = typeof body === 'object' && body !== null ? (body as { hint?: unknown }).hint : null;
      return { kind: classifyAwardFailure(res.status, typeof hint === 'string' ? hint : null) };
    }
    return { kind: 'later' };
  } catch {
    return { kind: 'later' };
  }
}

/** Asks until the server has the finished log (it may still be uploading), up to the grace period. */
async function callWithRetry(logId: string): Promise<Call> {
  const stop = Date.now() + UPLOAD_GRACE_MS;
  for (;;) {
    const r = await callAward(logId);
    if (r.kind !== 'retry') return r;
    if (Date.now() + RETRY_EVERY_MS > stop) return { kind: 'later' };
    await sleep(RETRY_EVERY_MS);
  }
}

/**
 * What the finished workout earned, or null when there is nothing to show now: the client was removed
 * ('not_a_client', nothing is queued), or the server did not answer within AWARD_WAIT_MS (the award is queued and
 * shows as "Surprise!" on the next app open, with the answer saved into the queue when it does arrive).
 * `abandoned` tells whether the reveal screen was left before the answer came: then the answer is queued too.
 * Calling again for a log already awarded returns the stored award (the function is idempotent per log).
 */
export async function requestAward(
  logId: string,
  userId: string,
  volumeKg: number,
  abandoned: () => boolean = () => false,
): Promise<AwardResult | null> {
  const queue = queueFor(userId);
  const run = callWithRetry(logId);
  const entry = (result: AwardResult | null): PendingReveal => ({ logId, at: new Date().toISOString(), volumeKg, result });

  const first = await within(run, AWARD_WAIT_MS);
  if (first?.kind === 'ok') {
    // The reveal was left before the answer came: nobody saw it, so it waits for the next app open.
    if (abandoned()) await queue.add(entry(first.result));
    return first.result;
  }
  if (first?.kind === 'none') return null;

  // Too slow, or offline: remember it, and keep what the server says if it says it later.
  if (first === null || first.kind === 'later') await queue.add(entry(null));
  void run.then(async (late) => {
    if (late.kind === 'ok') await queue.add(entry(late.result));
    else if (late.kind === 'none') await queue.remove(logId);
  });
  return null;
}

/**
 * Awards waiting to be shown: asks the server for the ones it hasn't answered yet and returns those it has.
 * Entries that are too old are dropped; an entry whose log still hasn't reached the server stays queued.
 */
export async function collectPending(userId: string): Promise<PendingReveal[]> {
  const queue = queueFor(userId);
  const ready: PendingReveal[] = [];
  for (const e of await queue.list()) {
    if (e.result) {
      ready.push(e);
      continue;
    }
    const r = await callAward(e.logId);
    if (r.kind === 'ok') {
      const done = { ...e, result: r.result };
      await queue.add(done);
      ready.push(done);
    } else if (r.kind === 'none' || expired(e, Date.now())) {
      await queue.remove(e.logId);
    }
  }
  return ready;
}

/** The awards waiting to be shown as "Surprise!" (see collectPending). */
export async function pendingReveals(userId: string): Promise<AwardResult[]> {
  return (await collectPending(userId)).flatMap((e) => (e.result ? [e.result] : []));
}

export const pendingQueue = queueFor;

/** The device's time zone (IANA), or UTC when it can't be read. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Keeps profiles.time_zone equal to the phone's, so the server counts a Sunday-night workout in the client's own
 * week. Only writes when it differs. Best effort: failing (no signal) just means the next sign-in tries again.
 */
export async function syncTimeZone(userId: string): Promise<void> {
  try {
    const zone = deviceTimeZone();
    const { data, error } = await supabase.from('profiles').select('time_zone').eq('id', userId).maybeSingle();
    if (error || !data || data.time_zone === zone) return;
    await supabase.from('profiles').update({ time_zone: zone }).eq('id', userId);
  } catch {
    // retried at the next sign-in
  }
}

/** How long the reveal waits for the client's ladder history before using the copy on the phone. */
export const LADDER_HISTORY_WAIT_MS = 1500;

async function readLadderCache(key: string): Promise<LadderCache> {
  try {
    return parseLadderCache(await AsyncStorage.getItem(key));
  } catch {
    return parseLadderCache(null);
  }
}

async function writeLadderCache(key: string, cache: LadderCache): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // the copy on the phone is a convenience
  }
}

/** The ladder animal of each of the client's awards with this coach, with its log's finish time. Throws offline. */
async function fetchLadderAwards(userId: string, workspaceId: string): Promise<LadderAward[]> {
  const { data, error } = await supabase
    .from('awards')
    .select('log_id, ladder_key:result->ladder->>key, workout_logs!inner(finished_at)')
    .eq('client_id', userId)
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(`awards: ${error.message}`);
  return data.flatMap((row) => {
    const finishedAt = row.workout_logs?.finished_at;
    return typeof row.ladder_key === 'string' && finishedAt ? [{ logId: row.log_id, finishedAt, key: row.ladder_key }] : [];
  });
}

/**
 * The client's ladder awards for the reveal's preview, so it picks the same animal as the server: read from the
 * server (waiting up to LADDER_HISTORY_WAIT_MS) and saved, else the copy on the phone, plus this phone's own
 * previews the server hasn't awarded yet. Never throws.
 */
export async function loadLadderAwards(userId: string, workspaceId: string): Promise<LadderAward[]> {
  const key = ladderCacheKey(userId, workspaceId);
  // A slow answer still refreshes the copy for next time.
  const refreshed = fetchLadderAwards(userId, workspaceId).then(async (server) => {
    const cache = withServerAwards(await readLadderCache(key), server);
    await writeLadderCache(key, cache);
    return cache;
  });
  const cache = (await within(refreshed, LADDER_HISTORY_WAIT_MS)) ?? (await readLadderCache(key));
  return ladderAwardsFrom(cache, Date.now());
}

/** Remembers the animal shown for a finished log until the server's list includes it. Never throws. */
export async function rememberLadderPick(userId: string, workspaceId: string, pick: LadderAward): Promise<void> {
  const key = ladderCacheKey(userId, workspaceId);
  await writeLadderCache(key, withLocalPick(await readLadderCache(key), pick));
}

/** The award stored for a finished log (the summary's sticker row), or null: not awarded yet, or offline. */
export async function fetchAward(logId: string): Promise<AwardResult | null> {
  try {
    const { data, error } = await supabase.from('awards').select('result').eq('log_id', logId).maybeSingle();
    return error || !data ? null : (data.result as unknown as AwardResult);
  } catch {
    return null;
  }
}
