// The client's food log for every screen: the Food tab and the meal editor. The server is the truth for saved meals;
// the on-device queue (food-queue.ts) is the truth for saves and deletes still on their way, and is applied on top
// (applyFoodOps). The last loaded days and targets are kept on the phone, so the tab opens with no signal.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { addDays, localDateOf, localToday, type CoachMeal, type HistoryMeal, type IsoDate, type MacroTargets, type MealSearchItem } from '@caltracker/shared';
import { fetchCoachMealsCached, fetchMealHistory, fetchMealsOn, fetchTargets, readFoodCache, sendFoodOp } from './food-api';
import { applyFoodOps, buildDeleteOp, buildSaveOp, historyWithOps, logAgainOp, mealDaysOf, type MealDraft, type PhotoChoice, type ShownMeal } from './food-logic';
import { createFoodQueue, type FoodOp, type FoodQueue, type LocalMealPhoto, type MealRecord } from './food-queue';
import { deletePhotoFiles, persistPhoto } from './outbox-files';
import { useSession } from './session';
import { useCoachProfile } from './use-coach-profile';

/** How far back search and "log again" look. */
const HISTORY_DAYS = 90;

type DayState = { meals: MealRecord[]; status: 'loading' | 'ready' | 'offline' };

type FoodState = {
  targets: MacroTargets | null;
  /** Shown meals of a day (server + queue), earliest first. Empty until loaded. */
  mealsOn: (day: IsoDate) => ShownMeal[];
  statusOf: (day: IsoDate) => DayState['status'];
  /** Loads a day (and the targets) from the server; the saved copy shows meanwhile. */
  loadDay: (day: IsoDate) => Promise<void>;
  findMeal: (id: string) => ShownMeal | null;
  save: (before: MealRecord | null, draft: MealDraft, photo: PhotoChoice) => Promise<void>;
  remove: (meal: MealRecord) => Promise<void>;
  retry: (opId: string) => void;
  discard: (opId: string) => void;
  /** Saves and deletes the server refused, waiting for Retry or Discard. */
  failed: FoodOp[];
  /** The last 90 days of meals (server + queue), for search, "log again" and the strip. */
  history: HistoryMeal[];
  /** Days with at least one meal (server or queued). */
  mealDays: ReadonlySet<IsoDate>;
  /** The coach's live shared meals (the saved copy offline). */
  coachMeals: CoachMeal[];
  /** The coach's first name, null until known. */
  coachName: string | null;
  /** Logs a meal like `item` now, in one tap. */
  logAgain: (item: MealSearchItem) => Promise<void>;
  loadCoachMeals: () => Promise<void>;
};

const FoodContext = createContext<FoodState | null>(null);

export function FoodProvider({ children }: { children: ReactNode }) {
  const { session, workspace } = useSession();
  const me = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  return me && workspaceId ? (
    <Loaded key={`${me}:${workspaceId}`} me={me} workspaceId={workspaceId}>
      {children}
    </Loaded>
  ) : (
    <FoodContext.Provider value={null}>{children}</FoodContext.Provider>
  );
}

const sortByTime = (meals: ShownMeal[]) =>
  [...meals].sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function localFiles(op: FoodOp): LocalMealPhoto[] {
  return op.kind === 'save' && op.localPhoto ? [op.localPhoto] : [];
}

function Loaded({ me, workspaceId, children }: { me: string; workspaceId: string; children: ReactNode }) {
  const [days, setDays] = useState<Record<IsoDate, DayState>>({});
  const [targets, setTargets] = useState<MacroTargets | null>(null);
  const [ops, setOps] = useState<FoodOp[]>([]);
  const [history, setHistory] = useState<HistoryMeal[]>([]);
  const [coachMeals, setCoachMeals] = useState<CoachMeal[]>([]);
  const coach = useCoachProfile();
  const coachName = coach ? (coach.name.trim().split(/\s+/)[0] ?? null) : null;
  const boxRef = useRef<FoodQueue | null>(null);
  const loadedDays = useRef(new Set<IsoDate>());

  const refreshDay = useCallback(
    async (day: IsoDate) => {
      try {
        const meals = await fetchMealsOn(me, workspaceId, day);
        setDays((d) => ({ ...d, [day]: { meals, status: 'ready' } }));
      } catch {
        setDays((d) => ({ ...d, [day]: { meals: d[day]?.meals ?? [], status: 'offline' } }));
      }
    },
    [me, workspaceId],
  );

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await fetchMealHistory(me, workspaceId, addDays(localToday(), -(HISTORY_DAYS - 1))));
    } catch {
      // the saved copy stays
    }
  }, [me, workspaceId]);

  const loadCoachMeals = useCallback(async () => {
    try {
      setCoachMeals(await fetchCoachMealsCached(me, workspaceId));
    } catch {
      // offline: the last loaded list stays
    }
  }, [me, workspaceId]);

  useEffect(() => {
    const box = createFoodQueue({
      storage: AsyncStorage,
      userId: me,
      workspaceId,
      send: sendFoodOp,
      onChange: setOps,
      onSent: (op) => {
        deletePhotoFiles(localFiles(op));
        // The saved copy replaces the queued one: read its day again (and the day it moved from, if any).
        for (const day of loadedDays.current) void refreshDay(day);
        void refreshHistory();
      },
      onRemoved: (op) => deletePhotoFiles(localFiles(op)),
    });
    boxRef.current = box;
    void box.load().then(() => box.flush());
    return () => {
      box.stop();
      boxRef.current = null;
    };
  }, [me, workspaceId, refreshDay, refreshHistory]);

  // The saved copy first, so the tab works with no signal.
  useEffect(() => {
    let alive = true;
    void readFoodCache(me, workspaceId).then((c) => {
      if (!alive) return;
      setTargets((t) => t ?? c.targets);
      setHistory((h) => (h.length > 0 ? h : c.history));
      setCoachMeals((m) => (m.length > 0 ? m : c.coachMeals));
      setDays((d) => {
        const next = { ...d };
        for (const [day, meals] of Object.entries(c.days)) if (!next[day]) next[day] = { meals, status: 'loading' };
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [me, workspaceId]);

  // Back in the app: send what is waiting.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void boxRef.current?.flush();
    });
    return () => sub.remove();
  }, []);

  const loadDay = useCallback(
    async (day: IsoDate) => {
      loadedDays.current.add(day);
      void boxRef.current?.flush();
      await Promise.all([
        refreshDay(day),
        fetchTargets(me, workspaceId)
          .then(setTargets)
          .catch(() => undefined),
        refreshHistory(),
        loadCoachMeals(),
      ]);
    },
    [me, workspaceId, refreshDay, refreshHistory, loadCoachMeals],
  );

  const value = useMemo<FoodState>(() => {
    const server = Object.values(days).flatMap((d) => d.meals);
    const shown = applyFoodOps(server, ops);
    const byId = new Map(shown.map((m) => [m.id, m]));
    const shownHistory = historyWithOps(history, ops);
    return {
      history: shownHistory,
      mealDays: mealDaysOf([...shownHistory, ...shown]),
      coachMeals,
      coachName,
      loadCoachMeals,
      async logAgain(item) {
        const box = boxRef.current;
        if (!box) return;
        const now = new Date();
        await box.enqueue(
          logAgainOp(item, { opId: randomUUID(), mealId: randomUUID(), userId: me, workspaceId, now: now.toISOString() }, localDateOf(now), now),
        );
        void box.flush();
      },
      targets,
      mealsOn: (day) => sortByTime(shown.filter((m) => m.eatenOn === day)),
      statusOf: (day) => days[day]?.status ?? 'loading',
      loadDay,
      findMeal: (id) => byId.get(id) ?? null,
      failed: ops.filter((o) => o.state === 'failed'),
      async save(before, draft, photo) {
        const box = boxRef.current;
        if (!box) return;
        // Move a new photo out of the cache so it survives until there is signal.
        let choice = photo;
        if (photo.kind === 'new') {
          try {
            const kept = await persistPhoto(photo.local);
            choice = { ...photo, local: { ...kept, ext: photo.local.ext } };
          } catch {
            // keep the cache copy: better than not saving
          }
        }
        const op = buildSaveOp(before, draft, choice, { opId: randomUUID(), mealId: randomUUID(), userId: me, workspaceId, now: new Date().toISOString() });
        await box.enqueue(op);
        void box.flush();
      },
      async remove(meal) {
        const box = boxRef.current;
        if (!box) return;
        await box.enqueue(buildDeleteOp(meal, randomUUID(), new Date().toISOString()));
        void box.flush();
      },
      retry: (opId) => void boxRef.current?.retry(opId),
      discard: (opId) => void boxRef.current?.remove(opId),
    };
  }, [days, ops, targets, loadDay, me, workspaceId, history, coachMeals, coachName, loadCoachMeals]);

  return <FoodContext.Provider value={value}>{children}</FoodContext.Provider>;
}

/** Null while there is no coach (the Food tab does not exist then). */
export function useFood(): FoodState | null {
  return useContext(FoodContext);
}
