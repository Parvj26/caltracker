// The Apple Health import: the on/off state saved on the phone (per client and coach, under the Progress prefix so
// Sign out forgets it), a sync that reads what changed since the last one and sends it, and the hooks the screens use.
// One step at a time (a sync and a switch never overlap), and every reading is saved on the phone before it is sent,
// so no signal only delays it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  addRead,
  connect,
  defaultAppleHealthState,
  disconnect,
  markSent,
  metricsToRead,
  parseAppleHealthState,
  setMetric,
  shouldAutoSync,
  type AppleHealthMetric,
  type AppleHealthState,
} from './apple-health-logic';
import { appleHealthAvailable, askAppleHealth, readAppleHealth } from './apple-health';
import { progressCachePrefix } from './device-cache-keys';
import { deleteMyAppleHealthMetrics, syncAppleHealthMetrics } from './metrics-api';
import { useSession } from './session';
import { supabase } from './supabase';

const stateKey = (userId: string, workspaceId: string) => `${progressCachePrefix(userId)}appleHealth.${workspaceId}`;

type Ids = { userId: string; workspaceId: string };
type Listener = (ids: Ids, state: AppleHealthState, dataChanged: boolean) => void;

const listeners = new Set<Listener>();
const lastTry = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();

/** Runs `step` after any step already running. */
function serial<T>(step: () => Promise<T>): Promise<T> {
  const run = queue.then(step, step);
  queue = run.catch(() => undefined);
  return run;
}

async function load(ids: Ids): Promise<AppleHealthState> {
  try {
    return parseAppleHealthState(await AsyncStorage.getItem(stateKey(ids.userId, ids.workspaceId)));
  } catch {
    return defaultAppleHealthState();
  }
}

async function save(ids: Ids, state: AppleHealthState, dataChanged = false): Promise<void> {
  // A sync still running when the client signs out must not write the state back after Sign out cleared it.
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== ids.userId) return;
  await AsyncStorage.setItem(stateKey(ids.userId, ids.workspaceId), JSON.stringify(state)).catch(() => undefined);
  for (const l of listeners) l(ids, state, dataChanged);
}

/** Sends what is waiting. Returns the state after, and whether anything reached the server. Never throws. */
async function send(ids: Ids, state: AppleHealthState): Promise<{ state: AppleHealthState; sent: boolean }> {
  try {
    if (state.pending.length > 0) await syncAppleHealthMetrics(ids.workspaceId, state.pending);
    if (state.pendingDeletes.length > 0) await deleteMyAppleHealthMetrics(ids.workspaceId, state.pendingDeletes);
    const sent = state.pending.length > 0 || state.pendingDeletes.length > 0;
    return { state: markSent(state, new Date()), sent };
  } catch {
    return { state, sent: false };
  }
}

/** Reads what changed in Apple Health and sends it. Quietly does nothing when off, not allowed, or offline. */
export function syncAppleHealth(ids: Ids): Promise<AppleHealthState> {
  return serial(async () => {
    lastTry.set(`${ids.userId}:${ids.workspaceId}`, Date.now());
    let state = await load(ids);
    const metrics = metricsToRead(state);
    if (metrics.length === 0) return state;
    for (const metric of metrics) {
      try {
        state = addRead(state, await readAppleHealth(metric, state.anchors[metric]));
      } catch (e) {
        console.warn(`[apple health] read ${metric}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await save(ids, state);
    const after = await send(ids, state);
    await save(ids, after.state, after.sent);
    return after.state;
  });
}

/** Connect: asks iOS (only for the switched-on metrics not asked before), saves the choice and syncs. From a tap only. */
export async function connectAppleHealth(ids: Ids, types: Record<AppleHealthMetric, boolean>): Promise<AppleHealthState> {
  await serial(async () => {
    const state = await load(ids);
    const toAsk = (Object.keys(types) as AppleHealthMetric[]).filter((m) => types[m] && !state.asked.includes(m));
    const asked = toAsk.length > 0 && (await askAppleHealth(toAsk)) ? toAsk : [];
    await save(ids, connect(state, types, asked));
  });
  return syncAppleHealth(ids);
}

/** One metric's switch. Switching one on that iOS was never asked about shows the prompt (this runs from the tap). */
export async function setAppleHealthMetric(ids: Ids, metric: AppleHealthMetric, on: boolean): Promise<AppleHealthState> {
  const next = await serial(async () => {
    const state = await load(ids);
    const askedNow = on && !state.asked.includes(metric) ? await askAppleHealth([metric]) : false;
    const s = setMetric(state, metric, on, askedNow);
    await save(ids, s);
    return s;
  });
  return on ? syncAppleHealth(ids) : next;
}

/**
 * Turns the import off (nothing more is read). With `removeImported`, also deletes every reading brought in from Apple
 * Health with this coach; that part throws when it fails (the import is off either way).
 */
export function turnOffAppleHealth(ids: Ids, removeImported: boolean): Promise<AppleHealthState> {
  return serial(async () => {
    const off = disconnect(await load(ids));
    await save(ids, off);
    if (removeImported) {
      await deleteMyAppleHealthMetrics(ids.workspaceId);
      await save(ids, off, true);
    }
    return off;
  });
}

/** Deletes every imported reading (e.g. when an earlier removal failed). */
export function removeImportedAppleHealth(ids: Ids): Promise<void> {
  return serial(async () => {
    await deleteMyAppleHealthMetrics(ids.workspaceId);
    const state = await load(ids);
    await save(ids, state, true);
  });
}

/** Called after a sync or removal changed Metrics, so a screen showing them reloads. */
export function useAppleHealthDataChanged(onChange: () => void): void {
  useEffect(() => {
    const l: Listener = (_ids, _s, changed) => {
      if (changed) onChange();
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [onChange]);
}

function useIds(): Ids | null {
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  return userId && workspaceId ? { userId, workspaceId } : null;
}

/** The import's state for the signed-in client and coach, and its actions. `available` is false where HealthKit is not. */
export function useAppleHealth() {
  const ids = useIds();
  const userId = ids?.userId ?? null;
  const workspaceId = ids?.workspaceId ?? null;
  const [available] = useState(appleHealthAvailable);
  const [state, setState] = useState<AppleHealthState | null>(null);
  useEffect(() => {
    if (!userId || !workspaceId) return;
    let live = true;
    void load({ userId, workspaceId }).then((s) => live && setState(s));
    const l: Listener = (who, s) => {
      if (who.userId === userId && who.workspaceId === workspaceId) setState(s);
    };
    listeners.add(l);
    return () => {
      live = false;
      listeners.delete(l);
    };
  }, [userId, workspaceId]);
  const withIds = useCallback(
    <A extends unknown[], R>(fn: (ids: Ids, ...a: A) => Promise<R>) =>
      (...a: A): Promise<R> => {
        if (!userId || !workspaceId) return Promise.reject(new Error('You are signed out. Sign in again.'));
        return fn({ userId, workspaceId }, ...a);
      },
    [userId, workspaceId],
  );
  return {
    available,
    state,
    connect: withIds(connectAppleHealth),
    setMetric: withIds(setAppleHealthMetric),
    turnOff: withIds(turnOffAppleHealth),
    removeImported: withIds(removeImportedAppleHealth),
    syncNow: withIds(syncAppleHealth),
  };
}

/** Syncs when the app opens and each time it comes back to the front, while connected. Mounted once, signed in. */
export function useAppleHealthAutoSync(): void {
  const ids = useIds();
  const userId = ids?.userId ?? null;
  const workspaceId = ids?.workspaceId ?? null;
  useEffect(() => {
    if (!userId || !workspaceId || !appleHealthAvailable()) return;
    const run = () => {
      void load({ userId, workspaceId }).then((s) => {
        if (shouldAutoSync(s, new Date(), lastTry.get(`${userId}:${workspaceId}`) ?? null)) void syncAppleHealth({ userId, workspaceId });
      });
    };
    run();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    return () => sub.remove();
  }, [userId, workspaceId]);
}
