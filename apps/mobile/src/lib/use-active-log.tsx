// The client's one active workout, for every screen: Today's Start/Resume/Done ✓, the logging screen, and the note about a workout finished automatically.
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
//   * single active logger: when the server says the coach logs the active workout (a save answered
//     loggedByOther), the sync has adopted the coach's copy; heldByOther is then true, every edit here is refused
//     and the reminder is cancelled until refreshFromServer finds the phone holds it again (hand back, reclaim) or
//     the coach finished it
//   * while the coach holds it, pullCoachCopy() takes each newer coach save (fetched, never sent back) so the phone
//     can show the coach's sets live, read only
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  completeSetWith,
  completedSetCount,
  discardLog,
  finishLog,
  reopenLog,
  toggleSet,
  type SetValues,
  type WorkoutDoc,
  type WorkoutLogDoc,
} from '@caltracker/shared';
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
import { cancelReminder, ensurePermission, initNotifications, onReminderTapped, scheduleReminder } from './log-notifications';
import { adoptCoachCopy } from './coach-watch';
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
  /**
   * Done: completes the set with these numbers (only actuals still empty are filled), decided from the stored doc.
   * Returns the stored log when this call completed the set, else null. Re-schedules the reminder like tick.
   */
  done: (setId: string, values: SetValues) => Promise<WorkoutLogDoc | null>;
  /**
   * An edit that ticks sets (Mark all, or a tick that picks a pick-one option first). True when it ticked at
   * least one more set; re-schedules the reminder like tick.
   */
  markDone: (fn: (log: WorkoutLogDoc) => WorkoutLogDoc) => Promise<boolean>;
  /** True when finished (the shared rules refuse a log with no ticked set). */
  finish: () => Promise<boolean>;
  discard: () => Promise<void>;
  /**
   * "Add missed sets": puts this finished log back in progress (shared reopenLog: auto-finished, within 24 h) and
   * returns it. Throws an Error whose message is for the client (REOPEN_OFFLINE, REOPEN_REFUSED, ...).
   */
  reopen: (logId: string) => Promise<WorkoutLogDoc>;
  /** The server says the coach logs the active workout: it is read only here (see coach-logging.ts). */
  heldByOther: boolean;
  /**
   * Sends the active log once and takes the server's copy where it wins: after the coach took it over, handed it
   * back or finished it, or after the client reclaimed it.
   */
  refreshFromServer: () => Promise<void>;
  /**
   * While the coach holds the active workout: fetches the server's copy and takes it when newer (marked synced, so
   * it is never sent back). Sends nothing. Calls that arrive while one runs are folded into one more fetch.
   * False when the server couldn't be reached (offline): the caller retries.
   */
  pullCoachCopy: () => Promise<boolean>;
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
  // What the screens were last shown, so a change made by the sync can be told apart (logChange).
  const shown = useRef<WorkoutLogDoc | null>(null);
  // The id of the active log the coach holds, per the server's last answer (single active logger).
  const heldRef = useRef<string | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [log, setLogState] = useState<WorkoutLogDoc | null>(null);
  const [pending, setPending] = useState<WorkoutLogDoc[]>([]);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [banner, setBanner] = useState<string | null>(null);
  const [finished, setFinished] = useState<FinishedNote | null>(null);
  const [finishedLog, setFinishedLog] = useState<WorkoutLogDoc | null>(null);
  const setLog = useCallback((next: WorkoutLogDoc | null) => {
    shown.current = next;
    setLogState(next);
  }, []);

  const clearNotifications = useCallback(() => {
    cancelReminder();
  }, []);

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
    heldRef.current = null;
    setHeldId(null);
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
      onHeldByOther: (doc) => {
        if (!mine()) return;
        heldRef.current = doc.id;
        setHeldId(doc.id);
        // The coach logs it now: no "Still training?" reminder or rest alarm for the client.
        clearNotifications();
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
      // Signed out or another user: this user's reminder must not fire.
      cancelReminder();
      if (current.current === me) current.current = null;
      starting.current = null;
    };
  }, [userId, checkStale, setLog, ended, clearNotifications]);

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
        // The coach held this workout last time we asked: ask again first, so a workout the coach has finished
        // (or handed back) is not resumed from the phone's old copy.
        if (stored?.log.status === 'in_progress' && stored.log.id === heldRef.current) {
          heldRef.current = null;
          await within(me.sync.recheck(), REMOTE_CHECK_MS);
          if (current.current === me) setHeldId(heldRef.current);
          stored = await me.store.load();
        }
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
      // Refused while the coach logs this workout (single active logger).
      const s = await applyLiveEdit(me.store, (l) => (l.id === heldRef.current ? l : fn(l)));
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

  const markDone = useCallback(
    async (fn: (l: WorkoutLogDoc) => WorkoutLogDoc): Promise<boolean> => {
      const result = { more: false };
      await op((l) => {
        const next = fn(l);
        result.more = completedSetCount(next) > completedSetCount(l);
        return next;
      });
      const l = current.current ? (await current.current.store.load())?.log : null;
      if (result.more && l?.status === 'in_progress') scheduleReminder(l.name, l.id);
      return result.more;
    },
    [op],
  );

  const done = useCallback(
    async (setId: string, values: SetValues): Promise<WorkoutLogDoc | null> => {
      const result = { completed: false };
      await op((l) => {
        const next = completeSetWith(l, setId, values, nowIso());
        result.completed = next !== l;
        return next;
      });
      const l = current.current ? (await current.current.store.load())?.log : null;
      if (!result.completed || !l) return null;
      if (l.status === 'in_progress') scheduleReminder(l.name, l.id);
      return l;
    },
    [op],
  );

  const end = useCallback(
    async (fn: (l: WorkoutLogDoc) => WorkoutLogDoc, status: 'completed' | 'discarded') => {
      const me = current.current;
      if (!me) return false;
      const s = await applyEdit(me.store, (l) => (l.id === heldRef.current ? l : fn(l)));
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

  const finish = useCallback(() => end((l) => finishLog(l, nowIso()), 'completed'), [end]);
  const discard = useCallback(async () => {
    await end((l) => discardLog(l, nowIso()), 'discarded');
  }, [end]);
  const start = useCallback((w: WorkoutDoc) => begin(w), [begin]);
  const startEmpty = useCallback((name: string) => begin(name), [begin]);
  const dismissBanner = useCallback(() => setBanner(null), []);
  const refreshFromServer = useCallback(async () => {
    const me = current.current;
    if (!me) return;
    // Cleared first; the sync's onHeldByOther sets it again when the coach still holds it.
    heldRef.current = null;
    try {
      await me.sync.recheck();
    } finally {
      if (current.current === me) {
        setHeldId(heldRef.current);
        await me.reload();
      }
    }
  }, []);
  // One fetch at a time; a coach typing fast triggers many row changes, so later calls wait for one more round.
  const pulling = useRef<Promise<boolean> | null>(null);
  const pullAgain = useRef(false);
  const pullCoachCopy = useCallback((): Promise<boolean> => {
    if (pulling.current) {
      pullAgain.current = true;
      return pulling.current;
    }
    const round = async (): Promise<boolean> => {
      do {
        pullAgain.current = false;
        const me = current.current;
        const id = heldRef.current;
        if (!me || !id) return true; // nothing held: nothing to catch up on
        const server = await fetchLog(id).catch(() => undefined);
        if (server === undefined) return false; // offline or the server failed: retried by the caller
        if (!server || current.current !== me) return true;
        const r = { changed: false };
        await me.store.update((s) => {
          const next = adoptCoachCopy(s, server, heldRef.current);
          r.changed = next !== s;
          return next;
        });
        if (r.changed && current.current === me) await me.reload();
      } while (pullAgain.current);
      return true;
    };
    const p = round()
      .catch(() => false)
      .finally(() => {
        pulling.current = null;
      });
    pulling.current = p;
    return p;
  }, []);
  const heldByOther = log !== null && heldId === log.id;
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
      done,
      markDone,
      finish,
      discard,
      finishedLog,
      reopen,
      heldByOther,
      refreshFromServer,
      pullCoachCopy,
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
      done,
      markDone,
      finish,
      discard,
      finishedLog,
      reopen,
      heldByOther,
      refreshFromServer,
      pullCoachCopy,
    ],
  );
  return <ActiveLogContext.Provider value={value}>{children}</ActiveLogContext.Provider>;
}

export function useActiveLog(): ActiveLog {
  const ctx = useContext(ActiveLogContext);
  if (!ctx) throw new Error('useActiveLog must be used inside ActiveLogProvider');
  return ctx;
}
