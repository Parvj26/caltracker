import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LineChart } from '@/components/charts/line-chart';
import { BodyProgress } from '@/components/progress/body-progress';
import { Card, Screen } from '@/components/ui';
import { fetchStrength, readCachedStrength } from '@/lib/strength-api';
import { chartModel, type StrengthData } from '@/lib/strength-logic';
import { useSession } from '@/lib/session';
import { zooHref } from '@/lib/zoo-href';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** Progress: each lift's estimated one-rep max over time, then body scans and the client's own weight log. */
export default function ProgressScreen() {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const units = useUnits();
  const [data, setData] = useState<StrengthData | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const cached = await readCachedStrength(userId);
    if (cached) setData((d) => d ?? cached);
    try {
      setData(await fetchStrength(userId));
      setOffline(false);
    } catch {
      setOffline(true);
      setData((d) => d ?? { exercises: [] });
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const exercise = data?.exercises.find((e) => e.exerciseId === chosen) ?? data?.exercises[0] ?? null;
  const model = useMemo(() => (exercise ? chartModel(exercise, units ?? 'lb') : null), [exercise, units]);
  const readout = model ? (model.points[Math.min(picked ?? model.points.length - 1, model.points.length - 1)]?.label ?? '') : '';

  return (
    <Screen
      inTabs
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        setRefreshKey((k) => k + 1);
        void load().finally(() => setRefreshing(false));
      }}
    >
      <Text style={text('screenTitle')} accessibilityRole="header">
        Progress
      </Text>
      {offline ? <Text style={text('caption')}>Showing your saved progress. It updates when you’re online.</Text> : null}

      <Pressable
        onPress={() => router.push(zooHref())}
        accessibilityRole="button"
        accessibilityLabel="Zoo book"
        accessibilityHint="Opens your sticker book: your streak, animals and rare finds"
        testID="progress-zoo"
        style={({ pressed }) => [
          { backgroundColor: palette.celebrateBg, borderRadius: radius.card, padding: space[4.5], gap: space[1] },
          pressed && { opacity: pressedOpacity },
        ]}
      >
        <Text style={text('sectionHeading')}>Zoo book ›</Text>
        <Text style={text('caption')}>Your streak, animals, rare finds and surprise drops.</Text>
      </Pressable>

      <Card>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          Strength
        </Text>
        {data && !exercise ? (
          <Text style={text('caption')} testID="progress-empty">
            Log a workout with weights and your lifts will be charted here.
          </Text>
        ) : null}
        {exercise && model ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {data!.exercises.map((e) => {
                const selected = e.exerciseId === exercise.exerciseId;
                return (
                  <Pressable
                    key={e.exerciseId}
                    onPress={() => {
                      setChosen(e.exerciseId);
                      setPicked(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`progress-exercise-${e.name}`}
                    style={{
                      borderWidth: 2,
                      borderColor: palette.ink,
                      borderRadius: radius.pill,
                      backgroundColor: selected ? palette.lime : palette.bg,
                      paddingHorizontal: space[3],
                      paddingVertical: space[2],
                      minHeight: 44,
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={text('caption')}>{e.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <LineChart
              key={exercise.exerciseId}
              testID="strength-chart"
              points={model.points}
              title={`${exercise.name}, estimated one-rep max over time`}
              yLabel={model.yLabel}
              xLabel={model.xLabel}
              onPick={setPicked}
            />
            <Text style={text('sectionHeading')} accessibilityLiveRegion="polite" testID="strength-readout">
              {readout}
            </Text>
            <Text style={text('caption')} testID="strength-summary">
              {model.summary}
            </Text>
          </>
        ) : null}
      </Card>

      <BodyProgress refreshKey={refreshKey} />
    </Screen>
  );
}
