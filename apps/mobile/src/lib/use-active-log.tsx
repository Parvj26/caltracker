// The client's one active workout, for every screen: Today's Start/Resume, the logging screen, and the note
// about a workout finished automatically.
//
// The log store (log-store.ts) is the truth; React state here is only a mirror of it:
//   * every change goes through applyEdit(store, op), built from the stored doc, then sync.push()
//   * a new log is written with store.save({ log, lastSyncedRevision: 0 }), then pushed
//   * when the sync adopts the server's doc, or finishes uploading, the store is read again
//   * on open and on return to the app: finish a forgotten workout (shared rules), then flushNow()
//   * a new signed-in user gets a new store and sync; the old sync is stopped
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { discardLog, finishLog, shouldAutoFinish, type WorkoutDoc, type WorkoutLogDoc } from '@caltracker/shared';
import { foregroundCheck, startOrResume, within } from './active-log-logic';
import { fetchInProgressLog, fetchLog, saveLog } from './log-api';
import {
  cancelReminder,
  cancelRestEnd,
  ensurePermission,
  initNotifications,
  onReminderTapped,
} from './log-notifications';
import { applyEdit, createLogStore, type LogStore } from './log-store';
import { createLogSync, type LogSync, type SyncStatus } from './log-sync';
import { useSession } from './session';

/** Shown when a finished workout still has to upload and the phone has no signal to send it. */
export const START_BLOCKED =
  'Your last workout hasn’t uploaded yet. Connect to the internet, then start this one.';

/** Wait for the server this long at most before starting without its answer. */
const REMOTE_CHECK_MS = 4000;
const UPLOAD_BEFORE_START_MS = 8000;

export type ActiveLog = {
  /** The stored log: in progress, or finished and still uploading. Null when there is none. */
  log: WorkoutLogDoc | null;
  /** False until the phone's copy has been read. */
  ready: boolean;
  syncStatus: SyncStatus;
  /** One-time note after a forgotten workout was finished automatically. */
  banner: string | null;
  dismissBanner: () => void;
  /** Resumes the workout in progress (whichever it is), or starts this one. Never creates a second. */
  start: (workout: WorkoutDoc) => Promise<WorkoutLogDoc>;
  /** Same, for an unplanned workout with this name. */
  startEmpty: (name: string) => Promise<WorkoutLogDoc>;
  /** The workout in progress, read from the phone, or null. */
  resume: () => Promise<WorkoutLogDoc | null>;
  /** One edit with an op from @caltracker/shared. */
  op: (fn: (log: WorkoutLogDoc) => WorkoutLogDoc) => Promise<void>;
  /** True when finished (the shared rules refuse a log with no ticked set). */
  finish: () => Promise<boolean>;
  discard: () => Promise<void>;
};

type Instance = { store: LogStore; sync: LogSync; reload: () => Promise<void> };

const ActiveLogContext = createContext<ActiveLog | null>(null);

const nowIso = () => new Date().toISOString();

export function ActiveLogProvider({ children }: { children: ReactNode }) {
  const userId = useSession().session?.user.id ?? null;
  const current = useRef<Instance | null>(null);
  const starting = useRef<Promise<WorkoutLogDoc> | null>(null);
  const [log, setLog] = useState<WorkoutLogDoc | null>(null);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    initNotifications();
    return onReminderTapped((id) => router.push({ pathname: '/log/[id]', params: { id } }));
  }, []);

  useEffect(() => {
    setLog(null);
    setReady(false);
    setSyncStatus('synced');
    setBanner(null);
    if (!userId) return;

    const store = createLogStore(AsyncStorage, userId);
    const mine = () => current.current === me;
    const reload = async () => {
      const s = await store.load();
      if (mine()) setLog(s?.log ?? null);
    };
    const sync = createLogSync({
      save: saveLog,
      fetchLog,
      store,
      // Read the store again rather than using the doc passed in: an edit may already be queued behind it.
      onAdopt: () => void reload(),
      onStatus: (s) => {
        if (!mine()) return;
        setSyncStatus(s);
        if (s === 'synced') void reload();
      },
    });
    const me: Instance = { store, sync, reload };
    current.current = me;

    const wake = async () => {
      const note: { banner: string | null } = { banner: null };
      const s = await applyEdit(store, (l) => {
        const checked = foregroundCheck(l, Date.now());
        if (!checked) return l;
        note.banner = checked.banner;
        return checked.log;
      });
      if (!mine()) return;
      if (note.banner) setBanner(note.banner);
      if (s && s.log.status !== 'in_progress') {
        cancelReminder();
        cancelRestEnd();
      }
      setLog(s?.log ?? null);
      setReady(true);
      await sync.flushNow();
      await reload(); // a finished log that has uploaded is gone from the store now
    };
    void wake();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void wake();
    });

    return () => {
      sub.remove();
      sync.stop();
      if (current.current === me) current.current = null;
      starting.current = null;
    };
  }, [userId]);

  const begin = useCallback((from: WorkoutDoc | string): Promise<WorkoutLogDoc> => {
    const me = current.current;
    if (!me) return Promise.reject(new Error('You are signed out. Sign in again.'));
    // Start tapped twice: the second tap gets the first tap's answer.
    if (starting.current) return starting.current;

    const run = async (): Promise<WorkoutLogDoc> => {
      let stored = await me.store.load();
      // A finished workout still waiting to upload would be overwritten by a new one: send it first.
      if (stored && stored.log.status !== 'in_progress' && stored.log.revision > stored.lastSyncedRevision) {
        await within(me.sync.flushNow(), UPLOAD_BEFORE_START_MS);
        stored = await me.store.load();
        if (stored && stored.log.status !== 'in_progress' && stored.log.revision > stored.lastSyncedRevision) {
          throw new Error(START_BLOCKED);
        }
      }
      let existing = stored?.log.status === 'in_progress' ? stored.log : null;
      if (!existing) {
        // Another phone (or a reinstall) may have a workout in progress: resume it rather than start a second.
        const remote = await within(fetchInProgressLog(), REMOTE_CHECK_MS);
        if (remote && !shouldAutoFinish(remote, Date.now())) {
          await me.store.save({ log: remote, lastSyncedRevision: remote.revision });
          existing = remote;
        }
      }
      const next = startOrResume(existing, from, randomUUID, nowIso());
      if (next !== existing) {
        await me.store.save({ log: next, lastSyncedRevision: 0 });
        me.sync.push();
        void ensurePermission(); // asked once, the first time a workout starts
      }
      if (current.current === me) setLog(next);
      return next;
    };

    const p = run();
    starting.current = p;
    const clear = () => {
      if (starting.current === p) starting.current = null;
    };
    p.then(clear, clear);
    return p;
  }, []);

  const resume = useCallback(async () => {
    const me = current.current;
    if (!me) return null;
    const s = await me.store.load();
    return s?.log.status === 'in_progress' ? s.log : null;
  }, []);

  const op = useCallback(async (fn: (l: WorkoutLogDoc) => WorkoutLogDoc) => {
    const me = current.current;
    if (!me) return;
    const s = await applyEdit(me.store, fn);
    if (current.current !== me || !s) return;
    setLog(s.log);
    me.sync.push();
  }, []);

  const end = useCallback(async (fn: (l: WorkoutLogDoc) => WorkoutLogDoc, status: 'completed' | 'discarded') => {
    const me = current.current;
    if (!me) return false;
    const s = await applyEdit(me.store, fn);
    if (current.current !== me || !s || s.log.status !== status) return false;
    setLog(s.log);
    cancelReminder();
    cancelRestEnd();
    void me.sync.flushNow().then(me.reload);
    return true;
  }, []);

  const finish = useCallback(() => end((l) => finishLog(l, nowIso()), 'completed'), [end]);
  const discard = useCallback(async () => {
    await end((l) => discardLog(l, nowIso()), 'discarded');
  }, [end]);
  const start = useCallback((w: WorkoutDoc) => begin(w), [begin]);
  const startEmpty = useCallback((name: string) => begin(name), [begin]);
  const dismissBanner = useCallback(() => setBanner(null), []);

  const value = useMemo<ActiveLog>(
    () => ({ log, ready, syncStatus, banner, dismissBanner, start, startEmpty, resume, op, finish, discard }),
    [log, ready, syncStatus, banner, dismissBanner, start, startEmpty, resume, op, finish, discard],
  );
  return <ActiveLogContext.Provider value={value}>{children}</ActiveLogContext.Provider>;
}

export function useActiveLog(): ActiveLog {
  const ctx = useContext(ActiveLogContext);
  if (!ctx) throw new Error('useActiveLog must be used inside ActiveLogProvider');
  return ctx;
}
