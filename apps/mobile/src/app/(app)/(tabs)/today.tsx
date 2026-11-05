import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { localToday, type Units } from '@caltracker/shared';
import { FirstTimeWelcome } from '@/components/first-time-welcome';
import { Button, Card, ErrorText, Screen, TextButton } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { formatDayLabel, isFirstTimeClient, type WorkoutSummary } from '@/lib/workouts';
import {
  fetchAnyWorkout,
  fetchMyCoachName,
  fetchMyUnits,
  fetchNextWorkout,
  fetchWorkoutsBetween,
  setMyUnits,
} from '@/lib/workouts-api';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type TodayData =
  | { kind: 'first-time'; coachName: string | null; units: Units }
  | { kind: 'today'; workouts: WorkoutSummary[]; next: WorkoutSummary | null };

async function loadToday(): Promise<TodayData> {
  // "Today" is the phone's own date, never the server's.
  const today = localToday();
  const [workouts, any] = await Promise.all([fetchWorkoutsBetween(today, today), fetchAnyWorkout()]);
  if (workouts.length === 0 && isFirstTimeClient(any)) {
    const [coachName, units] = await Promise.all([fetchMyCoachName(), fetchMyUnits()]);
    return { kind: 'first-time', coachName, units };
  }
  const next = workouts.length === 0 ? await fetchNextWorkout(today) : null;
  return { kind: 'today', workouts, next };
}

export default function Today() {
  const { workspace } = useSession();
  const { text, space } = useTheme();
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Loads can overlap (focus + pull to refresh): only the latest answer is shown.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await loadToday();
      if (ticket !== latest.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (ticket !== latest.current) return;
      setError(e instanceof Error ? e.message : 'Could not load today. Try again.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function changeUnits(units: Units) {
    setData((d) => (d?.kind === 'first-time' ? { ...d, units } : d));
    try {
      await setMyUnits(units);
    } catch (e) {
      void load(); // Put the saved value back on screen.
      throw e;
    }
  }

  return (
    <Screen inTabs refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={{ gap: space[1] }}>
        <Text style={text('caption')}>{`Welcome to ${workspace?.workspaceName ?? ''}`}</Text>
        <Text style={text('screenTitle')} accessibilityRole="header">
          Today
        </Text>
      </View>

      {error ? (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Button variant="secondary" title="Try again" onPress={() => void refresh()} busy={refreshing} />
        </Card>
      ) : null}

      {data === null && !error ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}

      {data?.kind === 'first-time' ? (
        <FirstTimeWelcome
          coachName={data.coachName}
          workspaceName={workspace?.workspaceName ?? ''}
          units={data.units}
          onChangeUnits={changeUnits}
        />
      ) : null}

      {data?.kind === 'today' && data.workouts.length > 0
        ? data.workouts.map((w) => <TodayCard key={w.id} workout={w} />)
        : null}

      {data?.kind === 'today' && data.workouts.length === 0 ? (
        <Card>
          <Text style={text('sectionHeading')}>Rest day — nothing scheduled today.</Text>
          {data.next ? (
            <Text style={text('body')}>{`Next: ${data.next.name} · ${formatDayLabel(data.next.scheduledOn)}`}</Text>
          ) : null}
        </Card>
      ) : null}

      <TextButton testID="sign-out" title="Sign out" onPress={() => void supabase.auth.signOut()} />
    </Screen>
  );
}

function TodayCard({ workout }: { workout: WorkoutSummary }) {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  const count = `${workout.exerciseCount} ${workout.exerciseCount === 1 ? 'exercise' : 'exercises'}`;
  return (
    <Card>
      <View style={{ gap: space[2] }}>
        <Text style={text('screenTitle')}>{workout.name}</Text>
        <Text style={text('body')}>{count}</Text>
        {workout.programName ? (
          <View
            style={[styles.chip, { borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: space[1] }]}
          >
            <Text style={[text('caption'), styles.chipText]} accessibilityLabel={`Program: ${workout.programName}`}>
              {workout.programName}
            </Text>
          </View>
        ) : null}
      </View>
      {/* Phase 2 is view only: logging (the Start button) arrives in phase 3. */}
      <Button
        variant="secondary"
        title="View workout"
        testID={`view-workout-${workout.id}`}
        onPress={() => router.push({ pathname: '/workout/[id]', params: { id: workout.id } })}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  // Text on a pastel tile is always ink, never muted.
  chip: { alignSelf: 'flex-start', backgroundColor: palette.blue },
  chipText: { color: palette.ink },
});
