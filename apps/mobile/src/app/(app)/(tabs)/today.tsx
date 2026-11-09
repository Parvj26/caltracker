import { useSurpriseReveal } from '@/lib/use-surprise';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { countExercises, localToday, type IsoDate, type WorkoutDoc } from '@caltracker/shared';
import { NameSheet } from '@/components/log/name-sheet';
import { ResumeBanner } from '@/components/log/resume-banner';
import { CoachIntroCard, NextSteps, StickerTeaser } from '@/components/today/new-client';
import { PushCard } from '@/components/today/push-card';
import { CoachMessageCard, CommunityPeek, FoodCard, RestCard, WeekAndSticker, WorkoutCard } from '@/components/today/today-cards';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { TodayHeader } from '@/components/today/today-header';
import { Button, Card, ErrorText, Screen, TextButton } from '@/components/ui';
import { finishedIsLoaded, within, workoutStatuses } from '@/lib/active-log-logic';
import {
  cacheTodayDetail,
  cacheTodayLogs,
  fetchLogsForDays,
  readCachedDetail,
  readCachedToday,
  readCachedTodayLogs,
  type CachedDetail,
  type LogForDay,
} from '@/lib/log-api';
import { useSession } from '@/lib/session';
import { signOutAndForget } from '@/lib/sign-out';
import { fetchFirstName, readCachedFirstName } from '@/lib/today-api';
import { greeting, headerDate, welcome } from '@/lib/today-logic';
import { useActiveLog } from '@/lib/use-active-log';
import { useCachedLoad } from '@/lib/use-cached-load';
import { useUnits } from '@/lib/use-units';
import { isFirstTimeClient, type WorkoutSummary } from '@/lib/workouts';
import {
  fetchAnyWorkout,
  fetchMyCoachName,
  fetchNextWorkout,
  fetchWorkoutDetail,
  fetchWorkoutsBetween,
  LOAD_FAILED,
} from '@/lib/workouts-api';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** Whole plans of today's workouts by id, for the card's time and muscle groups. */
type Plans = Record<string, WorkoutDoc>;

/** How long Start waits for the server before using the copy saved on the phone. */
const DETAIL_WAIT_MS = 5000;
const START_FAILED = 'Couldn’t open this workout. Check your connection and try again.';

type TodayData =
  | { kind: 'first-time'; coachName: string | null }
  | {
      kind: 'today';
      workouts: WorkoutSummary[];
      next: WorkoutSummary | null;
      logs: LogForDay[];
      offline: boolean;
      /** The saved copies offline; online the plans arrive later (`plansLater`), so Today never waits on them. */
      plans: Plans;
      plansLater: Promise<Plans> | null;
    };

const plansOf = (details: readonly CachedDetail[]): Plans => Object.fromEntries(details.map((d) => [d.doc.id, d.doc]));

const summaryOf = (d: CachedDetail): WorkoutSummary => ({
  id: d.doc.id,
  name: d.doc.name,
  scheduledOn: d.scheduledOn,
  exerciseCount: countExercises(d.doc.blocks.map((b) => ({ kind: b.kind, exercises: b.exercises.length }))),
  programName: null,
});

/**
 * Reads today's whole workouts and saves them on the phone, so Start works with poor signal later. Best effort: the
 * plans read (for the card's time and muscles), or the copy saved earlier when the read fails.
 */
async function cacheToday(today: IsoDate, workouts: WorkoutSummary[]): Promise<Plans> {
  try {
    const details = (await Promise.all(workouts.map((w) => fetchWorkoutDetail(w.id)))).filter((d): d is CachedDetail => d !== null);
    await cacheTodayDetail(today, details);
    return plansOf(details);
  } catch {
    // the previous copy stays; Start fetches the workout itself when there is signal
    return plansOf(await readCachedToday(today).catch(() => []));
  }
}

async function loadToday(): Promise<TodayData> {
  // "Today" is the phone's own date, never the server's.
  const today = localToday();
  let workouts: WorkoutSummary[];
  let any: WorkoutSummary[];
  try {
    [workouts, any] = await Promise.all([fetchWorkoutsBetween(today, today), fetchAnyWorkout()]);
  } catch (e) {
    // No signal: show today's workouts saved on the phone, if any, so they can still be started.
    const cached = await readCachedToday(today);
    if (cached.length === 0) throw e;
    // Today's logs as last read, so a workout finished earlier today keeps its Done ✓ after a restart.
    const logs = await readCachedTodayLogs(today);
    return { kind: 'today', workouts: cached.map(summaryOf), next: null, logs, offline: true, plans: plansOf(cached), plansLater: null };
  }
  if (workouts.length === 0 && isFirstTimeClient(any)) {
    return { kind: 'first-time', coachName: await fetchMyCoachName() };
  }
  // Read alongside the rest but never waited for: the cards show the exercise count until the plans arrive.
  const plansLater = cacheToday(today, workouts);
  const [next, logs] = await Promise.all([
    workouts.length === 0 ? fetchNextWorkout(today) : Promise.resolve(null),
    // "Done ✓" is a bonus: Today still shows when it can't be read (then the copy saved on the phone is used).
    fetchLogsForDays(today, today).then(
      (l) => {
        void cacheTodayLogs(today, l).catch(() => undefined);
        return l;
      },
      () => readCachedTodayLogs(today),
    ),
  ]);
  return { kind: 'today', workouts, next, logs, offline: false, plans: {}, plansLater };
}

/** The planned workout to start from: the server's copy, or the one saved on the phone without signal. */
async function workoutToStart(id: string): Promise<WorkoutDoc | null> {
  const fresh = await within(fetchWorkoutDetail(id), DETAIL_WAIT_MS);
  if (fresh) return fresh.doc;
  return (await readCachedDetail(localToday(), id))?.doc ?? null;
}

export default function Today() {
  useSurpriseReveal();
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const coach = useCoachProfile();
  const { text, space } = useTheme();
  const router = useRouter();
  const units = useUnits() ?? 'lb';
  const { log: active, pending, banner, dismissBanner, start, startEmpty, finished, forgetFinished, syncStatus } = useActiveLog();
  // Bumped by pull to refresh: each card below reloads itself (they also reload whenever Today comes into view).
  const [refreshKey, setRefreshKey] = useState(0);
  const [today, setToday] = useState<IsoDate>(() => localToday());
  const [naming, setNaming] = useState(false);
  const firstName = useCachedLoad(
    userId,
    () => (userId ? readCachedFirstName(userId) : Promise.resolve(null)),
    () => (userId ? fetchFirstName(userId) : Promise.resolve(null)),
    refreshKey,
  );
  const [data, setData] = useState<TodayData | null>(null);
  // Today's whole plans by workout id, merged in as they arrive (a late answer still fills its card).
  const [plans, setPlans] = useState<Plans>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  // The guard itself is a ref: state only updates on the next render, so two quick taps could both get past it.
  const startingRef = useRef(false);
  // Loads can overlap (focus + pull to refresh): only the latest answer is shown.
  const latest = useRef(0);
  const finishedRef = useRef(finished);
  useEffect(() => {
    finishedRef.current = finished;
  }, [finished]);
  // Set when the logging screen is opened, cleared when Today is back in view: one tap, one screen.
  const navigating = useRef(false);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await loadToday();
      if (next.kind === 'today') {
        setPlans((p) => ({ ...p, ...next.plans }));
        void next.plansLater?.then((later) => setPlans((p) => ({ ...p, ...later })));
      }
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
      // The workout just finished here is now in the server's list: Done ✓ no longer needs the phone's memory.
      if (next.kind === 'today' && finishedIsLoaded(finishedRef.current, next.logs)) forgetFinished();
    } catch {
      if (ticket !== latest.current) return;
      setError(LOAD_FAILED);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      navigating.current = false;
      setToday(localToday()); // The day may have changed since the screen opened.
      void load();
    }, [load]),
  );

  // A finished workout has just uploaded (the phone's copy is cleared then): read Today again so its Done ✓
  // comes from the server. Until then the provider remembers it.
  const lastStatus = useRef(syncStatus);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = syncStatus;
    if (syncStatus === 'synced' && was !== 'synced' && finished) void load();
  }, [syncStatus, finished, load]);

  async function refresh() {
    setRefreshing(true);
    setToday(localToday());
    setRefreshKey((k) => k + 1);
    await load();
    setRefreshing(false);
  }


  const inProgress = active?.status === 'in_progress' ? active : null;
  const statuses = useMemo(
    () => workoutStatuses(data?.kind === 'today' ? data.logs : [], active, finished, pending),
    [data, active, finished, pending],
  );

  const openLog = useCallback(
    (id: string) => {
      if (navigating.current) return;
      navigating.current = true;
      router.push({ pathname: '/log/[id]', params: { id } });
    },
    [router],
  );

  const openSummary = useCallback(
    (id: string) => {
      if (navigating.current) return;
      navigating.current = true;
      router.push({ pathname: '/log/[id]/summary', params: { id } });
    },
    [router],
  );

  async function startWorkout(w: WorkoutSummary) {
    if (startingRef.current) return;
    if (inProgress) {
      // Only one workout at a time: carry on with the one already going.
      if (inProgress.workoutId === w.id) {
        openLog(inProgress.id);
        return;
      }
      Alert.alert(`${inProgress.name} is still going`, 'Finish or discard it before starting another workout.', [
        { text: 'Cancel', style: 'cancel' },
        { text: `Resume ${inProgress.name}`, onPress: () => openLog(inProgress.id) },
      ]);
      return;
    }
    startingRef.current = true;
    setStarting(w.id);
    try {
      const doc = await workoutToStart(w.id);
      if (!doc) {
        Alert.alert(START_FAILED);
        return;
      }
      const log = await start(doc);
      openLog(log.id);
    } catch {
      Alert.alert(START_FAILED);
    } finally {
      startingRef.current = false;
      setStarting(null);
    }
  }

  function logAnyway() {
    if (inProgress) {
      Alert.alert(`${inProgress.name} is still going`, 'Finish or discard it before starting another workout.', [
        { text: 'Cancel', style: 'cancel' },
        { text: `Resume ${inProgress.name}`, onPress: () => openLog(inProgress.id) },
      ]);
      return;
    }
    setNaming(true);
  }

  async function startUnplanned(name: string) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting('unplanned');
    try {
      const log = await startEmpty(name);
      setNaming(false);
      openLog(log.id);
    } catch {
      Alert.alert(START_FAILED);
    } finally {
      startingRef.current = false;
      setStarting(null);
    }
  }

  const firstTime = data?.kind === 'first-time';
  const pushCard = userId ? <PushCard userId={userId} coachName={coach?.name ?? null} firstTime={firstTime} /> : null;

  return (
    <Screen inTabs refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={{ gap: space[3.5] }}>
        <TodayHeader
          date={headerDate(today)}
          greeting={firstTime ? welcome(firstName.data) : greeting(firstName.data)}
          workspaceName={workspace?.workspaceName ?? ''}
          onSignOut={() => void signOutAndForget()}
        />

        {inProgress ? <ResumeBanner name={inProgress.name} onPress={() => openLog(inProgress.id)} /> : null}

        {/* Not while Today is loading. A new client sees it under their coach's card (below). */}
        {data !== null && !firstTime ? pushCard : null}

        {banner ? (
          <Card>
            <Text testID="auto-finish-note" style={text('sectionHeading')}>
              {banner}
            </Text>
            <TextButton testID="auto-finish-ok" title="OK" onPress={dismissBanner} />
          </Card>
        ) : null}

        {error ? (
          <Card>
            <ErrorText>{error}</ErrorText>
            <Button variant="secondary" title="Try again" onPress={() => void refresh()} busy={refreshing} />
          </Card>
        ) : null}

        {data === null && !error ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}

        {data?.kind === 'first-time' ? (
          <>
            <CoachIntroCard coachName={data.coachName} workspaceName={workspace?.workspaceName ?? ''} />
            {pushCard}
            <NextSteps coachName={data.coachName} />
            <StickerTeaser />
          </>
        ) : null}

        {data?.kind === 'today' && data.offline ? (
          <Text style={text('caption')}>No connection. These are today’s workouts saved on your phone.</Text>
        ) : null}

        {/* More than one workout today: one card each, stacked. */}
        {data?.kind === 'today'
          ? data.workouts.map((w) => (
              <WorkoutCard
                key={w.id}
                workout={w}
                doc={plans[w.id] ?? null}
                status={statuses[w.id] ?? null}
                starting={starting === w.id}
                onStart={() => void startWorkout(w)}
                onView={openSummary}
              />
            ))
          : null}

        {data?.kind === 'today' && data.workouts.length === 0 ? <RestCard next={data.next} today={today} onLogAnyway={logAnyway} /> : null}

        {/* The cards below load on their own, at the same time as today's workout, each from the phone's copy first. */}
        {data?.kind === 'today' ? (
          <>
            <FoodCard refreshKey={refreshKey} />
            <CoachMessageCard />
            <WeekAndSticker refreshKey={refreshKey} />
            <CommunityPeek units={units} refreshKey={refreshKey} />
          </>
        ) : null}
      </View>

      <NameSheet
        visible={naming}
        busy={starting === 'unplanned'}
        onStart={(name) => void startUnplanned(name)}
        onClose={() => setNaming(false)}
      />
    </Screen>
  );
}
