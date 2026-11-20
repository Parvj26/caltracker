// Apple Health import, the parts that need no phone: which HealthKit types feed which metric (and in which unit), the
// on/off state saved on the phone, and how one HealthKit read turns into the readings waiting to be sent. Pure, so it
// is unit tested. The HealthKit calls are in apple-health.ts; the sync run is in apple-health-sync.ts.
import { localDateOf } from '@caltracker/shared';
import type { AppleHealthSample } from './metrics-logic';

/** The metrics Apple Health can bring, in the order the switches show. Muscle mass comes from InBody scans only. */
export const APPLE_HEALTH_METRICS = ['weight_kg', 'body_fat_pct', 'vo2_max', 'resting_hr_bpm', 'waist_cm'] as const;
export type AppleHealthMetric = (typeof APPLE_HEALTH_METRICS)[number];

export type HealthTypeId =
  | 'HKQuantityTypeIdentifierBodyMass'
  | 'HKQuantityTypeIdentifierBodyFatPercentage'
  | 'HKQuantityTypeIdentifierVO2Max'
  | 'HKQuantityTypeIdentifierRestingHeartRate'
  | 'HKQuantityTypeIdentifierWaistCircumference';

/**
 * The HealthKit type for each metric, the unit asked for, and the factor to the stored unit. HealthKit gives
 * percentages as a fraction (0.22 = 22%), so body fat is multiplied by 100.
 */
export const HEALTH_TYPES: Record<AppleHealthMetric, { id: HealthTypeId; unit: string; factor: number }> = {
  weight_kg: { id: 'HKQuantityTypeIdentifierBodyMass', unit: 'kg', factor: 1 },
  body_fat_pct: { id: 'HKQuantityTypeIdentifierBodyFatPercentage', unit: '%', factor: 100 },
  vo2_max: { id: 'HKQuantityTypeIdentifierVO2Max', unit: 'ml/(kg*min)', factor: 1 },
  resting_hr_bpm: { id: 'HKQuantityTypeIdentifierRestingHeartRate', unit: 'count/min', factor: 1 },
  waist_cm: { id: 'HKQuantityTypeIdentifierWaistCircumference', unit: 'cm', factor: 1 },
};

/** A note under a switch ("From Apple Watch"), or null. */
export const APPLE_HEALTH_NOTES: Partial<Record<AppleHealthMetric, string>> = {
  vo2_max: 'From Apple Watch',
  resting_hr_bpm: 'From Apple Watch',
};

export function isAppleHealthMetric(key: string): key is AppleHealthMetric {
  return (APPLE_HEALTH_METRICS as readonly string[]).includes(key);
}

/** How far back the first import reads. */
export const FIRST_SYNC_DAYS = 365;

/** A HealthKit quantity sample, as much of it as the import reads. */
export interface HealthQuantitySample {
  uuid: string;
  quantity: number;
  startDate: Date | string;
}

/** Rounds away float noise (0.2215 * 100 = 22.150000000000002). */
function tidy(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * One HealthKit sample as a reading in stored units (kg, %, mL/kg/min, bpm, cm), dated on the phone's local calendar
 * (`timeZone` only for tests). Null when it cannot be read; range checks happen in appleHealthBatches.
 */
export function toAppleHealthSample(metric: AppleHealthMetric, s: HealthQuantitySample, timeZone?: string): AppleHealthSample | null {
  const at = s.startDate instanceof Date ? s.startDate : new Date(s.startDate);
  if (!s.uuid || !Number.isFinite(s.quantity) || Number.isNaN(at.getTime())) return null;
  return {
    externalId: s.uuid,
    metricKey: metric,
    value: tidy(s.quantity * HEALTH_TYPES[metric].factor),
    measuredOn: localDateOf(at, timeZone),
    measuredAt: at.toISOString(),
  };
}

/** What the phone remembers about the import, per client and coach. Forgotten on Sign out. */
export interface AppleHealthState {
  v: 1;
  /** The client connected Apple Health (and has not turned it off). */
  enabled: boolean;
  /** Which metrics to bring in. */
  types: Record<AppleHealthMetric, boolean>;
  /** Metrics iOS has already been asked about (reading a type before asking would crash). */
  asked: AppleHealthMetric[];
  /** HealthKit's "read up to here" marker per metric, so the next sync brings only changes. */
  anchors: Partial<Record<AppleHealthMetric, string>>;
  /** Readings read from Apple Health but not yet sent (e.g. no signal). */
  pending: AppleHealthSample[];
  /** Apple Health ids deleted in Apple Health, not yet removed here. */
  pendingDeletes: string[];
  /** When a sync last reached the server, ISO. */
  lastSyncAt: string | null;
  /** True once a sync read at least one reading (to tell "no data or not allowed" apart). */
  sawData: boolean;
  /** Server refusals in a row (not lost signal), for backing off. */
  failures: number;
  /** No sending before this time (ISO), after repeated server refusals. */
  retryAfter: string | null;
}

export function defaultAppleHealthState(): AppleHealthState {
  return {
    v: 1,
    enabled: false,
    types: { weight_kg: true, body_fat_pct: true, vo2_max: true, resting_hr_bpm: true, waist_cm: true },
    asked: [],
    anchors: {},
    pending: [],
    pendingDeletes: [],
    lastSyncAt: null,
    sawData: false,
    failures: 0,
    retryAfter: null,
  };
}

/** The saved state, or the default when missing or unreadable. */
export function parseAppleHealthState(raw: string | null): AppleHealthState {
  const base = defaultAppleHealthState();
  if (raw === null) return base;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return base;
  }
  if (typeof v !== 'object' || v === null || (v as { v?: unknown }).v !== 1) return base;
  const x = v as Record<string, unknown>;
  const types = { ...base.types };
  if (typeof x.types === 'object' && x.types !== null) {
    for (const m of APPLE_HEALTH_METRICS) {
      const t = (x.types as Record<string, unknown>)[m];
      if (typeof t === 'boolean') types[m] = t;
    }
  }
  const anchors: AppleHealthState['anchors'] = {};
  if (typeof x.anchors === 'object' && x.anchors !== null) {
    for (const m of APPLE_HEALTH_METRICS) {
      const a = (x.anchors as Record<string, unknown>)[m];
      if (typeof a === 'string' && a.length > 0) anchors[m] = a;
    }
  }
  const pending = Array.isArray(x.pending)
    ? x.pending.filter(
        (p): p is AppleHealthSample =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as AppleHealthSample).externalId === 'string' &&
          isAppleHealthMetric(String((p as AppleHealthSample).metricKey)) &&
          typeof (p as AppleHealthSample).value === 'number' &&
          typeof (p as AppleHealthSample).measuredOn === 'string',
      )
    : [];
  return {
    v: 1,
    enabled: x.enabled === true,
    types,
    asked: Array.isArray(x.asked) ? APPLE_HEALTH_METRICS.filter((m) => (x.asked as unknown[]).includes(m)) : [],
    anchors,
    pending,
    pendingDeletes: Array.isArray(x.pendingDeletes) ? x.pendingDeletes.filter((d): d is string => typeof d === 'string') : [],
    lastSyncAt: typeof x.lastSyncAt === 'string' ? x.lastSyncAt : null,
    sawData: x.sawData === true,
    failures: typeof x.failures === 'number' && Number.isFinite(x.failures) && x.failures > 0 ? Math.floor(x.failures) : 0,
    retryAfter: typeof x.retryAfter === 'string' ? x.retryAfter : null,
  };
}

/** The metrics a sync reads: switched on and already asked about. */
export function metricsToRead(state: AppleHealthState): AppleHealthMetric[] {
  if (!state.enabled) return [];
  return APPLE_HEALTH_METRICS.filter((m) => state.types[m] && state.asked.includes(m));
}

/** The metrics that still need the iOS prompt before they can be read (switched on, never asked). */
export function metricsToAsk(state: AppleHealthState): AppleHealthMetric[] {
  return APPLE_HEALTH_METRICS.filter((m) => state.types[m] && !state.asked.includes(m));
}

/** Connected after the iOS prompt for `asked`. */
export function connect(state: AppleHealthState, types: Record<AppleHealthMetric, boolean>, asked: readonly AppleHealthMetric[]): AppleHealthState {
  return { ...state, enabled: true, types: { ...types }, asked: APPLE_HEALTH_METRICS.filter((m) => state.asked.includes(m) || asked.includes(m)) };
}

/**
 * One metric switched on or off. Off forgets its marker and its waiting readings, so it stops syncing (turning it on
 * again reads the last year afresh; the database updates readings it already has instead of adding them twice).
 */
export function setMetric(state: AppleHealthState, metric: AppleHealthMetric, on: boolean, askedNow = false): AppleHealthState {
  const anchors = { ...state.anchors };
  if (!on) delete anchors[metric];
  return {
    ...state,
    types: { ...state.types, [metric]: on },
    asked: askedNow && !state.asked.includes(metric) ? APPLE_HEALTH_METRICS.filter((m) => state.asked.includes(m) || m === metric) : state.asked,
    anchors,
    pending: on ? state.pending : state.pending.filter((p) => p.metricKey !== metric),
  };
}

/** Turned off: nothing more is read or sent. Which metrics were asked about is kept (iOS remembers it too). */
export function disconnect(state: AppleHealthState): AppleHealthState {
  return { ...defaultAppleHealthState(), types: state.types, asked: state.asked };
}

/** One metric's HealthKit read: new or changed samples, deleted sample ids and the new marker. */
export interface HealthRead {
  metric: AppleHealthMetric;
  samples: readonly HealthQuantitySample[];
  deleted: readonly string[];
  newAnchor: string;
}

/**
 * Adds one read to the waiting readings and moves the marker on. The state is saved with the readings before they are
 * sent, so a dropped connection never loses them. A sample deleted in Apple Health drops any waiting copy and is queued
 * for removal; the same id read again replaces the waiting copy.
 */
export function addRead(state: AppleHealthState, read: HealthRead, timeZone?: string): AppleHealthState {
  if (!state.types[read.metric]) return state;
  const deleted = new Set(read.deleted);
  const byId = new Map(state.pending.filter((p) => !deleted.has(p.externalId)).map((p) => [p.externalId, p]));
  for (const s of read.samples) {
    const sample = toAppleHealthSample(read.metric, s, timeZone);
    if (!sample) continue;
    byId.delete(sample.externalId);
    byId.set(sample.externalId, sample);
  }
  const pendingDeletes = [...new Set([...state.pendingDeletes, ...read.deleted])].filter((id) => !byId.has(id));
  return {
    ...state,
    anchors: read.newAnchor ? { ...state.anchors, [read.metric]: read.newAnchor } : state.anchors,
    pending: [...byId.values()],
    pendingDeletes,
    sawData: state.sawData || read.samples.length > 0,
  };
}

/** After the waiting readings and removals reached the server. */
export function markSent(state: AppleHealthState, now: Date): AppleHealthState {
  return { ...state, pending: [], pendingDeletes: [], lastSyncAt: now.toISOString(), failures: 0, retryAfter: null };
}

/** The earliest sample time the first sync of a metric reads. */
export function firstSyncStart(now: Date): Date {
  return new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000);
}

/** The row's line under "Apple Health": "Off", "Synced just now", "Synced 5 min ago", "Waiting to sync". */
export function appleHealthStatus(state: AppleHealthState, now: Date): string {
  if (!state.enabled) return 'Off';
  if (state.pending.length > 0 || state.pendingDeletes.length > 0) return 'Waiting for a connection to sync';
  if (!state.lastSyncAt) return 'Connected';
  const mins = Math.floor((now.getTime() - Date.parse(state.lastSyncAt)) / 60_000);
  if (!(mins >= 1)) return 'Synced just now';
  if (mins < 60) return `Synced ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** At most one automatic sync this often (opening the app twice in a row reads once). */
export const SYNC_MIN_GAP_MS = 2 * 60_000;

export function shouldAutoSync(state: AppleHealthState, now: Date, lastTry: number | null): boolean {
  if (metricsToRead(state).length === 0) return false;
  return lastTry === null || now.getTime() - lastTry >= SYNC_MIN_GAP_MS;
}

/**
 * HealthKit query options for one metric. The first read (no marker) is limited to the last year; later reads pass only
 * the marker, because a date filter would also hide the deletions HealthKit reports (deleted samples have no date).
 */
export function healthQueryOptions(anchor: string | undefined, now: Date): { limit: number; anchor?: string; filter?: { date: { startDate: Date } } } {
  return anchor ? { limit: 0, anchor } : { limit: 0, filter: { date: { startDate: firstSyncStart(now) } } };
}

/**
 * The iOS prompt for `toAsk`, then the connected state. A failed prompt (an error, or iOS answering false) leaves the
 * import off and throws, so the screen can say so. Nothing to ask (all asked before) connects at once.
 */
export async function connectWith(
  state: AppleHealthState,
  types: Record<AppleHealthMetric, boolean>,
  ask: (metrics: AppleHealthMetric[]) => Promise<boolean>,
): Promise<AppleHealthState> {
  const toAsk = APPLE_HEALTH_METRICS.filter((m) => types[m] && !state.asked.includes(m));
  if (toAsk.length > 0 && !(await ask(toAsk))) throw new Error(ASK_FAILED);
  return connect(state, types, toAsk);
}

/** One switch, asking iOS first when switching on a metric never asked about. A failed prompt leaves it off and throws. */
export async function setMetricWith(
  state: AppleHealthState,
  metric: AppleHealthMetric,
  on: boolean,
  ask: (metrics: AppleHealthMetric[]) => Promise<boolean>,
): Promise<AppleHealthState> {
  const needsAsk = on && !state.asked.includes(metric);
  if (needsAsk && !(await ask([metric]))) throw new Error(ASK_FAILED);
  return setMetric(state, metric, on, needsAsk);
}

export const ASK_FAILED = 'Could not ask iPhone for access to Apple Health. Try again.';

/** Longest wait between tries after repeated server refusals. */
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

/** Wait after `failures` refusals in a row: 2, 4, 8 … minutes, at most 6 hours. */
export function backoffMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, 2 ** Math.max(1, failures) * 60_000);
}

/** The database refused for good: no longer this coach's client, or signed out (42501). Retrying never helps. */
export function isRefusedForGood(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42501';
}

export interface SendDeps {
  /** Whose readings these are. */
  userId: string;
  /** Who is signed in right now (null when signed out). */
  currentUserId: () => Promise<string | null>;
  upsert: (samples: readonly AppleHealthSample[]) => Promise<unknown>;
  remove: (externalIds: readonly string[]) => Promise<unknown>;
  isNetworkFailure: (e: unknown) => boolean;
}

export type SendOutcome = 'nothing' | 'sent' | 'waiting' | 'offline' | 'failed' | 'dropped' | 'signed_out';

/**
 * Sends the waiting readings and removals. Before each request it checks the same person is still signed in, so one
 * account's readings never go up under another. Lost signal keeps them for next time; a server refusal backs off
 * (2 min, 4 min … 6 h); a refusal for good (no longer a client) drops them.
 */
export async function sendPending(state: AppleHealthState, deps: SendDeps, now: Date): Promise<{ state: AppleHealthState; outcome: SendOutcome }> {
  if (state.pending.length === 0 && state.pendingDeletes.length === 0) return { state: markSent(state, now), outcome: 'nothing' };
  if (state.retryAfter && now.getTime() < Date.parse(state.retryAfter)) return { state, outcome: 'waiting' };
  const steps: Array<() => Promise<unknown>> = [];
  if (state.pending.length > 0) steps.push(() => deps.upsert(state.pending));
  if (state.pendingDeletes.length > 0) steps.push(() => deps.remove(state.pendingDeletes));
  for (const step of steps) {
    if ((await deps.currentUserId()) !== deps.userId) return { state, outcome: 'signed_out' };
    try {
      await step();
    } catch (e) {
      if (deps.isNetworkFailure(e)) return { state, outcome: 'offline' };
      if (isRefusedForGood(e)) return { state: { ...state, pending: [], pendingDeletes: [], failures: 0, retryAfter: null }, outcome: 'dropped' };
      const failures = state.failures + 1;
      return { state: { ...state, failures, retryAfter: new Date(now.getTime() + backoffMs(failures)).toISOString() }, outcome: 'failed' };
    }
  }
  return { state: markSent(state, now), outcome: 'sent' };
}
