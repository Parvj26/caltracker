// Meal saves and deletes written on the phone, kept until the server has them. The same rules as the message outbox
// (outbox.ts): the phone's copy is the truth until a send succeeds, no signal retries with backoff (5 s, 15 s, 60 s,
// then 300 s), and the queue survives a restart in AsyncStorage (injected, so tests use a map).
//
// Why a repeat is safe: a meal's id is made on the phone. A save inserts, and when the row is already there (an
// earlier try that never heard back) it updates instead; a delete of a meal that is already gone deletes nothing.
// Operations go oldest first, so "save, edit, delete" on the same meal lands in that order.
//
// States: 'sending' retries on its own; 'failed' (the server refused, or a photo would not upload) waits for Retry or
// Discard on the Food screen.
import type { IsoDate, MealMacros, MealPhotoExt } from '@caltracker/shared';
import { OUTBOX_BACKOFF_MS, OutboxSendError, type OutboxPhoto, type SendFailure } from './outbox';
import type { KeyValueStorage } from './log-store';

/** Where a meal's photo lives on the server, and its size. */
export type StoredPhoto = { path: string; thumbPath: string; width: number; height: number };

/** A meal as the phone writes it (the database fills client_id from the session). */
export type MealRecord = {
  id: string;
  workspaceId: string;
  eatenAt: string;
  eatenOn: IsoDate;
  name: string | null;
  note: string;
  macros: MealMacros;
  photo: StoredPhoto | null;
};

/** A photo still on the phone, waiting to be uploaded to `meal.photo`'s paths. */
export type LocalMealPhoto = OutboxPhoto & { ext: MealPhotoExt };

type Base = { opId: string; createdAt: string; state: 'sending' | 'failed'; error?: string | undefined };
export type FoodOp =
  | (Base & { kind: 'save'; meal: MealRecord; localPhoto: LocalMealPhoto | null; dropPaths: string[] })
  | (Base & { kind: 'delete'; mealId: string; dropPaths: string[] });

export const foodQueueKey = (userId: string, workspaceId: string) => `caltracker.foodQueue.${userId}.${workspaceId}`;

export type FoodQueue = {
  load(): Promise<FoodOp[]>;
  items(): FoodOp[];
  enqueue(op: FoodOp): Promise<void>;
  flush(): Promise<void>;
  retry(opId: string): Promise<void>;
  /** Discards a failed operation (it will never be sent). */
  remove(opId: string): Promise<void>;
  stop(): void;
};

export type FoodQueueDeps = {
  storage: KeyValueStorage;
  userId: string;
  workspaceId: string;
  /** Sends one operation. Throws OutboxSendError. Resolves once the server has it. */
  send: (op: FoodOp) => Promise<void>;
  onChange?: (items: FoodOp[]) => void;
  onSent?: (op: FoodOp) => void;
  onRemoved?: (op: FoodOp) => void;
  schedule?: (fn: () => void, ms: number) => () => void;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isOp(e: unknown): e is FoodOp {
  if (!isObj(e) || typeof e.opId !== 'string' || typeof e.createdAt !== 'string') return false;
  if (e.state !== 'sending' && e.state !== 'failed') return false;
  if (!Array.isArray(e.dropPaths)) return false;
  if (e.kind === 'delete') return typeof e.mealId === 'string';
  if (e.kind !== 'save' || !isObj(e.meal)) return false;
  const m = e.meal;
  return typeof m.id === 'string' && typeof m.workspaceId === 'string' && typeof m.eatenAt === 'string' && typeof m.eatenOn === 'string' && isObj(m.macros);
}

export function parseFoodQueue(raw: string | null): FoodOp[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isOp) : [];
  } catch {
    return [];
  }
}

export function createFoodQueue(deps: FoodQueueDeps): FoodQueue {
  const { storage, send } = deps;
  const key = foodQueueKey(deps.userId, deps.workspaceId);
  const schedule =
    deps.schedule ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  let list: FoodOp[] = [];
  let loaded = false;
  let stopped = false;
  let running: Promise<void> | null = null;
  let again = false;
  let failures = 0;
  let cancelTimer: (() => void) | null = null;

  async function persist(next: FoodOp[]): Promise<void> {
    list = next;
    deps.onChange?.(list);
    await storage.setItem(key, JSON.stringify(list));
  }

  async function load(): Promise<FoodOp[]> {
    list = parseFoodQueue(await storage.getItem(key));
    loaded = true;
    deps.onChange?.(list);
    return list;
  }

  function armRetry() {
    cancelTimer?.();
    const ms = OUTBOX_BACKOFF_MS[Math.min(failures, OUTBOX_BACKOFF_MS.length - 1)];
    failures += 1;
    cancelTimer = schedule(() => {
      cancelTimer = null;
      void flush();
    }, ms);
  }

  async function run(): Promise<void> {
    if (!loaded) await load();
    for (;;) {
      if (stopped) return;
      // Strictly in order: a failed operation holds back later ones on the same meal, so an edit never lands
      // before the save it edits. Operations on other meals still go.
      const blocked = new Set(list.filter((o) => o.state === 'failed').map(mealOf));
      const next = list.find((o) => o.state === 'sending' && !blocked.has(mealOf(o)));
      if (!next) {
        failures = 0;
        return;
      }
      try {
        await send(next);
      } catch (e) {
        if (stopped) return;
        const kind: SendFailure = e instanceof OutboxSendError ? e.kind : 'refused';
        if (kind === 'network') {
          armRetry();
          return;
        }
        const message = e instanceof Error ? e.message : "Couldn't save. Please try again.";
        await persist(list.map((o) => (o.opId === next.opId ? { ...o, state: 'failed' as const, error: message } : o)));
        continue;
      }
      if (stopped) return;
      failures = 0;
      cancelTimer?.();
      cancelTimer = null;
      await persist(list.filter((o) => o.opId !== next.opId));
      deps.onSent?.(next);
    }
  }

  function flush(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await run();
        } while (again && !stopped);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    load,
    items: () => list,
    async enqueue(op) {
      if (!loaded) await load();
      if (list.some((o) => o.opId === op.opId)) return;
      await persist([...list, op]);
    },
    flush,
    async retry(opId) {
      if (!loaded) await load();
      const target = list.find((o) => o.opId === opId);
      if (!target || target.state !== 'failed') return;
      await persist(list.map((o) => (o.opId === opId ? { ...o, state: 'sending' as const, error: undefined } : o)));
      await flush();
    },
    async remove(opId) {
      if (!loaded) await load();
      const target = list.find((o) => o.opId === opId);
      if (!target || target.state !== 'failed') return;
      await persist(list.filter((o) => o.opId !== opId));
      deps.onRemoved?.(target);
    },
    stop() {
      stopped = true;
      cancelTimer?.();
      cancelTimer = null;
    },
  };
}

/** The meal an operation is about. */
export const mealOf = (op: FoodOp): string => (op.kind === 'save' ? op.meal.id : op.mealId);
