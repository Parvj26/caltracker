// The client's one active workout, for every screen: Today's Start/Resume/Done ✓, the logging screen and its
// rest timer, and the note about a workout finished automatically.
//
// The log store (log-store.ts) is the truth; React state here is only a mirror of it:
//   * every change goes through applyEdit(store, op), built from the stored doc, then sync.push()
//   * a new log is written with store.save({ log, lastSyncedRevision: 0 }), then pushed
//   * when the sync adopts the server's doc, or finishes uploading, the store is read again, and a log that
//     stopped being in progress meanwhile gets the same housekeeping as a finish here (logChange)
//   * on open and on return to the app: finish a forgotten workout (shared rules), then flushNow()
//   * whenever the coach link changes, sync.recheck(): a client the coach removed gets a final refusal, and
//     the log leaves the phone with a one-time note, instead of being retried (and resumed) forever
//   * Start never waits on the network for a finished workout: one still uploading moves to the store's
//     pending list (store.park()) and the sync sends it first
//   * a new signed-in user gets a new store and sync; the old sync is stopped and its notifications cancelled
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { discardLog, finishLog, reopenLog, toggleSet, type WorkoutDoc, type WorkoutLogDoc } from '@caltracker/shared';
import {
  finishedFrom,
  foregroundCheck,
  goneNote,
  unavailableNote,
  keepEnded,
  keepFinished,
  logChange,
  rejectedNote,
  reopenFrom,
  startOrResume,
  within,
  type FinishedNote,
} from './active-log-logic';
import { fetchInProgressLog, fetchLog, saveLog } from './log-api';
import {
  cancelReminder,
  cancelRestEnd,
  ensurePermission,
  initNotifications,
  onReminderTapped,
  scheduleReminder,
  scheduleRestEnd,
} from './log-notifications';
import { applyEdit, applyLiveEdit, createLogStore, type LogStore, type StoredLog } from './log-store';
import { createLogSync, type LogSync, type SyncStatus } from './log-sync';
import { useSession } from './session';

/** "Add missed sets" needs the server's copy once the finished log has uploaded. */
export const REOPEN_OFFLINE = 'Couldn’t open this workout again. Check your connection and try again.';
/** The server, or the 24 h limit on "Add missed sets", said no. */
export const REOPEN_REFUSED = 'This workout can’t be changed any more.';
/** Another finished workout still waiting to upload holds the phone's one slot. */
export const REOPEN_WAITING = 'Your last workout hasn’t uploaded yet. Connect to the internet, then try again.';
export const finishOtherFirst = (name: string) => `Finish or discard ${name} first.`;

/** Wait for the server this long at most before starting without its answer. */
const REMOTE_CHECK_MS = 4000;
const UPLOAD_BEFORE_START_MS = 8000;
/** The rest can never be adjusted to end sooner than this from now. */
const MIN_REST_LEFT_MS = 1000;

/** The rest countdown of the workout in progress. Kept here so it survives leaving the logging screen. */
export type Rest = { logId: string; endsAt: number };

export type ActiveLog = {
  /** The stored log: in progress, or finished and still uploading. Null when there is none. */
  log: WorkoutLogDoc | null;
  /** Earlier finished workouts still waiting to upload (moved aside when a new one started), oldest first. */
  pending: WorkoutLogDoc[];
  /** False until the phone's copy has been read. */
  ready: boolean;
  syncStatus: SyncStatus;
  /**
   * One-time note: a forgotten workout was finished automatically, the coach removed the client so a workout
   * wasn't saved, or the server's copy replaced sets ticked on the phone.
   */
  banner: string | null;
  dismissBanner: () => void;
  /** The planned workout last finished here, until Today's list from the server includes it. */
  finished: FinishedNote | null;
  forgetFinished: () => void;
  /**
   * The last log finished (or finished automatically) on this phone, kept in memory for its summary, so the
   * summary shows right after Finish with no signal. Replaced by a newer completed copy from the server, and
   * forgotten if the server's copy is no longer completed.
   */
  finishedLog: WorkoutLogDoc | null;
  /** Resumes the workout in progress (whichever it is), or starts this one. Never creates a second. */
  start: (workout: WorkoutDoc) => Promise<WorkoutLogDoc>;
  /** Same, for an unplanned workout with this name. */
  startEmpty: (name: string) => Promise<WorkoutLogDoc>;
  /** The workout in progress, read from the phone, or null. */
  resume: () => Promise<WorkoutLogDoc | null>;
  /** One edit with an op from @caltracker/shared. Refused once the stored log is no longer in progress. */
  op: (fn: (log: WorkoutLogDoc) => WorkoutLogDoc) => Promise<void>;
  /**
   * Ticks or unticks a set, decided from the stored doc. Returns the new state (true = ticked) or null when the
   * set is gone. A tick also re-schedules the "Still training?" reminder.
   */
  tick: (setId: string) => Promise<boolean | null>;
  /** True when finished (the shared rules refuse a log with no ticked set). */
  finish: () => Promise<boolean>;
  discard: () => Promise<void>;
  /**
   * "Add missed sets": puts this finished log back in progress (shared reopenLog: auto-finished, within 24 h) and
   * returns it. Throws an Error whose message is for the client (REOPEN_OFFLINE, REOPEN_REFUSED, ...).
   */
  reopen: (logId: string) => Promise<WorkoutLogDoc>;
  rest: Rest | null;
  startRest: (logId: string, seconds: number) => void;
  adjustRest: (deltaSeconds: number) => void;
  /** Stops the countdown and its notification. */
  skipRest: () => void;
  /** The countdown reached zero (its notification has fired). */
  endRest: () => void;
};

type Instance = { store: LogStore; sync: LogSync; reload: () => Promise<void> };

const ActiveLogContext = createContext<ActiveLog | null>(null);

const nowIso = () => new Date().toISOString();
const unsynced = (s: StoredLog | null): boolean =>
  s !== null && s.log.status !== 'in_progress' && s.log.revision > s.lastSyncedRevision;

export function ActiveLogProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.session?.user.id ?? null;
  const workspaceId = session.workspace?.workspaceId ?? null;
  // The coach's business name for the "no longer with" note, remembered past the moment the link is gone.
  const coachName = useRef<string | null>(null);
  coachName.current = session.removedFromWorkspace ?? session.workspace?.workspaceName ?? coachName.current;
  const current = useRef<Instance | null>(null);
  const starting = useRef<Promise<WorkoutLogDoc> | null>(null);
  const restRef = useRef<Rest | null>(null);
  // What the screens were last shown, so a change made by the sync can be told apart (logChange).
  const shown = useRef<WorkoutLogDoc | null>(null);
  const [log, setLogState] = useState<WorkoutLogDoc | null>(null);
  const [pending, setPending] = useState<WorkoutLogDoc[]>([]);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [banner, setBanner] = useState<string | null>(null);
  const [finished, setFinished] = useState<FinishedNote | null>(null);
  const [finishedLog, setFinishedLog] = useState<WorkoutLogDoc | null>(null);
  const [rest, setRestState] = useState<Rest | null>(null);

  const setRest = useCallback((next: Rest | null) => {
    restRef.current = next;
    setRestState(next);
  }, []);
  const setLog = useCallback((next: WorkoutLogDoc | null) => {
    shown.current = next;
    setLogState(next);
  }, []);

  const clearNotifications = useCallback(() => {
    cancelReminder();
    cancelRestEnd();
    setRest(null);
  }, [setRest]);

  /** A log just stopped being in progress: forget its timers and remember a finished planned one for Today. */
  const ended = useCallback(
    (l: WorkoutLogDoc) => {
      clearNotifications();
      const note = finishedFrom(l);
      if (note) setFinished(note);
      if (l.status === 'completed') setFinishedLog(l);
    },
    [clearNotifications],
  );

  useEffect(() => {
    initNotifications();
    return onReminderTapped((id) => router.push({ pathname: '/log/[id]', params: { id } }));
  }, []);

  /** Finishes a forgotten workout in the store (shared rules), showing the note. Returns the stored log. */
  const checkStale = useCallback(
    async (store: LogStore): Promise<StoredLog | null> => {
      const note: { banner: string | null; changed: boolean } = { banner: null, changed: false };
      const s = await applyEdit(store, (l) => {
        const checked = foregroundCheck(l, Date.now());
        if (!checked) return l;
        note.banner = checked.banner;
        note.changed = true;
        return checked.log;
      });
      if (note.banner) setBanner(note.banner);
      if (note.changed && s) ended(s.log);
      return s;
    },
    [ended],
  );

  useEffect(() => {
    setLog(null);
    setPending([]);
    setReady(false);
    setSyncStatus('synced');
    setBanner(null);
    setFinished(null);
    setFinishedLog(null);
    setRest(null);
    if (!userId) return;

    const store = createLogStore(AsyncStorage, userId);
    const mine = () => current.current === me;
    // A newer copy of a log (adopted from the server, or reopened) may undo a finish remembered for Done ✓ and
    // the summary: e.g. the finish upload was refused because another phone had discarded it.
    const replaced = (doc: WorkoutLogDoc | null) => {
      setFinished((f) => keepFinished(f, doc));
      setFinishedLog((e) => keepEnded(e, doc));
    };
    /** Housekeeping when the log changed behind the screen's back (see logChange). */
    const changedTo = (next: WorkoutLogDoc | null) => {
      const change = logChange(shown.current, next);
      if (change.banner) setBanner(change.banner);
      if (change.ended) ended(change.ended);
      else if (change.clearTimers) clearNotifications();
    };
    const reload = async () => {
      const [s, waiting] = await Promise.all([store.load(), store.loadPending()]);
      if (!mine()) return;
      const next = s?.log ?? null;
      // The sync may have adopted a finished server copy, or dropped the log (removed client).
      changedTo(next);
      setLog(next);
      setPending(waiting.map((p) => p.log));
      replaced(next);
    };
    const sync = createLogSync({
      save: saveLog,
      fetchLog,
      store,
      // Read the store again rather than using the doc passed in: an edit may already be queued behind it.
      onAdopt: (doc) => {
        if (mine()) replaced(doc);
        void reload();
      },
      onStatus: (s) => {
        if (!mine()) return;
        setSyncStatus(s);
        if (s === 'synced') void reload();
      },
      onRejected: (local) => {
        if (mine()) setBanner(rejectedNote(local.name));
      },
      onGone: () => {
        if (!mine()) return;
        setBanner(goneNote(coachName.current));
        void reload();
      },
      onUnavailable: (local) => {
        if (!mine()) return;
        setBanner(unavailableNote(local.name));
        void reload();
      },
      onAutoFinish: (doc) => {
        if (!mine()) return;
        changedTo(doc);
        setLog(doc);
      },
    });
    const me: Instance = { store, sync, reload };
    current.current = me;

    const wake = async () => {
      const s = await checkStale(store);
      if (!mine()) return;
      setLog(s?.log ?? null);
      setPending((await store.loadPending()).map((p) => p.log));
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
      // Signed out or another user: this user's reminder and rest alarm must not fire.
      cancelReminder();
      cancelRestEnd();
      if (current.current === me) current.current = null;
      starting.current = null;
    };
  }, [userId, checkStale, setRest, setLog, ended, clearNotifications]);

  // The coach link changed (removed, or another coach): send the log once to learn whether it can still be saved.
  const sessionLoading = session.loading;
  useEffect(() => {
    if (sessionLoading || !userId) return;
    void current.current?.sync.recheck();
  }, [sessionLoading, userId, workspaceId]);

  const begin = useCallback(
    (from: WorkoutDoc | string): Promise<WorkoutLogDoc> => {
      const me = current.current;
      if (!me) return Promise.reject(new Error('You are signed out. Sign in again.'));
      // Start tapped twice: the second tap gets the first tap's answer.
      if (starting.current) return starting.current;

      const run = async (): Promise<WorkoutLogDoc> => {
        let stored = await checkStale(me.store);
        // A finished workout still waiting to upload: try once, then move it aside (the sync keeps sending it)
        // so the new one can start with no signal. A discard the server never saw is simply dropped.
        const freeSlot = async () => {
          if (!unsynced(stored)) return;
          await within(me.sync.flushNow(), UPLOAD_BEFORE_START_MS);
          stored = await me.store.park();
          if (current.current === me) setPending((await me.store.loadPending()).map((p) => p.log));
        };
        await freeSlot();
        if (stored === null || (stored.log.status !== 'in_progress' && !unsynced(stored))) {
          // Nothing on this phone. Another phone (or a reinstall) may have a workout in progress on the server:
          // resume it, or finish it first when it was forgotten, so there is never a second one. A log moved
          // aside above may still be in progress there until its finish uploads: that one is not resumed.
          const waiting = new Set((await me.store.loadPending()).map((p) => p.log.id));
          const found = await within(fetchInProgressLog(), REMOTE_CHECK_MS);
          const remote = found && !waiting.has(found.id) ? found : null;
          if (remote) {
            const checked = foregroundCheck(remote, Date.now());
            stored = { log: checked ? checked.log : remote, lastSyncedRevision: remote.revision };
            await me.store.save(stored);
            if (checked) {
              if (checked.banner) setBanner(checked.banner);
              ended(checked.log);
              me.sync.push();
            }
          }
        }
        await freeSlot(); // the server's forgotten workout, just finished here, must upload too
        const existing = stored?.log.status === 'in_progress' ? stored.log : null;
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
    },
    [checkStale, ended, setLog],
  );

  const resume = useCallback(async () => {
    const me = current.current;
    if (!me) return null;
    const s = await me.store.load();
    return s?.log.status === 'in_progress' ? s.log : null;
  }, []);

  const op = useCallback(
    async (fn: (l: WorkoutLogDoc) => WorkoutLogDoc) => {
      const me = current.current;
      if (!me) return;
      const s = await applyLiveEdit(me.store, fn);
      if (current.current !== me || !s) return;
      setLog(s.log);
      me.sync.push();
    },
    [setLog],
  );

  const tick = useCallback(
    async (setId: string): Promise<boolean | null> => {
      const result: { completed: boolean | null } = { completed: null };
      await op((l) => {
        const r = toggleSet(l, setId, nowIso());
        result.completed = r.completed;
        return r.log;
      });
      const l = current.current ? (await current.current.store.load())?.log : null;
      if (result.completed && l?.status === 'in_progress') scheduleReminder(l.name, l.id);
      return result.completed;
    },
    [op],
  );

  const end = useCallback(
    async (fn: (l: WorkoutLogDoc) => WorkoutLogDoc, status: 'completed' | 'discarded') => {
      const me = current.current;
      if (!me) return false;
      const s = await applyEdit(me.store, fn);
      if (current.current !== me || !s || s.log.status !== status) return false;
      setLog(s.log);
      ended(s.log);
      void me.sync.flushNow().then(me.reload);
      return true;
    },
    [ended, setLog],
  );

  const reopen = useCallback(async (logId: string): Promise<WorkoutLogDoc> => {
    const me = current.current;
    if (!me) throw new Error('You are signed out. Sign in again.');
    const blocked = (s: { log: WorkoutLogDoc } | null) =>
      new Error(s?.log.status === 'in_progress' ? finishOtherFirst(s.log.name) : REOPEN_WAITING);

    const stored = await me.store.load();
    const from = reopenFrom(stored, logId, await me.store.loadPending());
    if (from.kind === 'blocked') throw blocked(stored);
    if (from.kind === 'fetch') {
      // The finished log has uploaded and left the phone: start again from the server's copy, which holds the
      // revision the reopened doc must go above.
      const server = await within(fetchLog(logId), REMOTE_CHECK_MS);
      if (!server) throw new Error(REOPEN_OFFLINE);
      const other = await within(fetchInProgressLog(), REMOTE_CHECK_MS);
      if (other && other.id !== logId) throw new Error(finishOtherFirst(other.name));
      const waiting = await me.store.loadPending();
      const placed = await me.store.update((s) =>
        reopenFrom(s, logId, waiting).kind === 'fetch' ? { log: server, lastSyncedRevision: server.revision } : s,
      );
      if (placed?.log.id !== logId) throw blocked(placed);
    }
    const s = await applyEdit(me.store, (l) => (l.id === logId ? reopenLog(l, nowIso()) : l));
    if (!s || s.log.id !== logId || s.log.status !== 'in_progress') throw new Error(REOPEN_REFUSED);
    if (current.current === me) {
      setLog(s.log);
      setFinished((f) => keepFinished(f, s.log));
      setFinishedLog((e) => keepEnded(e, s.log));
    }
    me.sync.push();
    scheduleReminder(s.log.name, s.log.id);
    return s.log;
  }, [setLog]);

  const startRest = useCallback(
    (logId: string, seconds: number) => {
      setRest({ logId, endsAt: Date.now() + seconds * 1000 });
      scheduleRestEnd(seconds);
    },
    [setRest],
  );

  const adjustRest = useCallback(
    (deltaSeconds: number) => {
      const cur = restRef.current;
      if (!cur) return;
      const now = Date.now();
      const endsAt = Math.max(now + MIN_REST_LEFT_MS, cur.endsAt + deltaSeconds * 1000);
      setRest({ ...cur, endsAt });
      scheduleRestEnd((endsAt - now) / 1000);
    },
    [setRest],
  );

  const skipRest = useCallback(() => {
    cancelRestEnd();
    setRest(null);
  }, [setRest]);
  const endRest = useCallback(() => setRest(null), [setRest]);

  const finish = useCallback(() => end((l) => finishLog(l, nowIso()), 'completed'), [end]);
  const discard = useCallback(async () => {
    await end((l) => discardLog(l, nowIso()), 'discarded');
  }, [end]);
  const start = useCallback((w: WorkoutDoc) => begin(w), [begin]);
  const startEmpty = useCallback((name: string) => begin(name), [begin]);
  const dismissBanner = useCallback(() => setBanner(null), []);
  const forgetFinished = useCallback(() => setFinished(null), []);

  const value = useMemo<ActiveLog>(
    () => ({
      log,
      pending,
      ready,
      syncStatus,
      banner,
      dismissBanner,
      finished,
      forgetFinished,
      start,
      startEmpty,
      resume,
      op,
      tick,
      finish,
      discard,
      finishedLog,
      reopen,
      rest,
      startRest,
      adjustRest,
      skipRest,
      endRest,
    }),
    [
      log,
      pending,
      ready,
      syncStatus,
      banner,
      dismissBanner,
      finished,
      forgetFinished,
      start,
      startEmpty,
      resume,
      op,
      tick,
      finish,
      discard,
      finishedLog,
      reopen,
      rest,
      startRest,
      adjustRest,
      skipRest,
      endRest,
    ],
  );
  return <ActiveLogContext.Provider value={value}>{children}</ActiveLogContext.Provider>;
}

export function useActiveLog(): ActiveLog {
  const ctx = useContext(ActiveLogContext);
  if (!ctx) throw new Error('useActiveLog must be used inside ActiveLogProvider');
  return ctx;
}
