import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, dailyTotals, dayStrip, frequentMeals, kcalCard, localToday, shortDayLabel, type IsoDate } from '@caltracker/shared';
import { DayStrip } from '@/components/food/day-strip';
import { font, foodText } from '@/components/food/food-type';
import { CameraIcon, PencilIcon } from '@/components/food/icons';
import { KcalCard } from '@/components/food/kcal-card';
import { LogAgainChips } from '@/components/food/log-again-chips';
import { MealCard } from '@/components/food/meal-card';
import { ErrorText, Screen, TextButton } from '@/components/ui';
import { mealPhotoUrls } from '@/lib/food-api';
import { MAX_WEEKS_BACK, msUntilMidnight } from '@/lib/food-logic';
import { PhotoError } from '@/lib/compress-photo';
import { photoParams, pickMealPhoto } from '@/lib/pick-meal-photo';
import { useFood } from '@/lib/use-food';
import { palette, pressedOpacity, radius, space, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';


/**
 * Food: a 7-day strip, the day's kcal card against the coach's targets, Snap a photo / Type it in, "Log again in one
 * tap", and the day's meals. Works with no signal: meals are queued on the phone and saved when back online.
 */
export default function FoodScreen() {
  const { text } = useTheme();
  const router = useRouter();
  const food = useFood();
  const [today, setToday] = useState(() => localToday());
  const [day, setDay] = useState(today);
  const [weeksBack, setWeeksBack] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const loadDay = food?.loadDay;
  // Today moves on at midnight, on coming back to the app and on returning to the tab; a person looking at today
  // follows it to the new day, one looking at an earlier day stays there.
  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);
  const rollOver = useCallback(() => {
    const now = localToday();
    const prev = todayRef.current;
    if (now === prev) return;
    todayRef.current = now;
    setToday(now);
    setDay((d) => (d === prev ? now : d));
  }, []);
  useFocusEffect(rollOver);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state === 'active' && rollOver());
    return () => sub.remove();
  }, [rollOver]);
  useEffect(() => {
    const t = setTimeout(rollOver, msUntilMidnight());
    return () => clearTimeout(t);
  }, [today, rollOver]);
  useFocusEffect(
    useCallback(() => {
      void loadDay?.(day);
    }, [loadDay, day]),
  );

  const meals = useMemo(() => food?.mealsOn(day) ?? [], [food, day]);
  const totals = useMemo(() => dailyTotals(meals.map((m) => m.macros)), [meals]);
  const strip = useMemo(() => dayStrip(today, food?.mealDays ?? new Set<IsoDate>(), weeksBack), [today, food?.mealDays, weeksBack]);
  const again = useMemo(() => frequentMeals(food?.history ?? [], today), [food?.history, today]);

  // Links for the stored photos not yet linked.
  const missing = meals.flatMap((m) => (m.photo && !m.localPhoto && !urls[m.photo.thumbPath] ? [m.photo.thumbPath] : []));
  const missingKey = missing.join('|');
  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    void mealPhotoUrls(missingKey.split('|')).then((u) => alive && setUrls((prev) => ({ ...prev, ...u })));
    return () => {
      alive = false;
    };
  }, [missingKey]);

  async function snap() {
    setError(null);
    setBusy(true);
    try {
      const picked = await pickMealPhoto('camera');
      if (picked) router.push({ pathname: '/food/meal', params: { day, ...photoParams(picked) } });
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : "Couldn't prepare that photo. Please try another.");
    } finally {
      setBusy(false);
    }
  }

  if (!food) return null;
  const status = food.statusOf(day);
  const first = strip[0]?.day ?? today;
  const last = strip[strip.length - 1]?.day ?? today;
  const weekTitle = weeksBack === 0 ? 'Last 7 days' : `${shortDayLabel(first, today)} – ${shortDayLabel(last, today)}`;

  function pageWeek(by: 1 | -1) {
    const next = Math.min(MAX_WEEKS_BACK, Math.max(0, weeksBack + by));
    setWeeksBack(next);
    // Show the newest day of the week paged to.
    setDay(addDays(today, -7 * next));
  }

  return (
    <Screen
      inTabs
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void food.loadDay(day).finally(() => setRefreshing(false));
      }}
    >
      <Text style={[foodText.title, styles.titlePad]} accessibilityRole="header">
        Food
      </Text>

      <DayStrip
        days={strip}
        selected={day}
        title={weekTitle}
        onPick={setDay}
        onOlder={() => pageWeek(1)}
        onNewer={weeksBack > 0 ? () => pageWeek(-1) : null}
        canGoOlder={weeksBack < MAX_WEEKS_BACK}
      />
      {status === 'offline' ? <Text style={text('caption')}>Showing your saved meals. They update when you’re online.</Text> : null}

      <KcalCard card={kcalCard(totals, food.targets, day, today)} coachName={food.coachName} />

      <View style={styles.bigRow}>
        <BigButton
          title="Snap a photo"
          testID="food-snap"
          ink
          disabled={busy}
          icon={<CameraIcon color={white} />}
          onPress={() => void snap()}
        />
        <BigButton
          title="Type it in"
          testID="food-type-it"
          icon={<PencilIcon />}
          onPress={() => router.push({ pathname: '/food/meal', params: { day } })}
        />
      </View>
      {error ? <ErrorText testID="food-error">{error}</ErrorText> : null}

      <LogAgainChips
        items={again}
        onPick={(item) => {
          setWeeksBack(0);
          setDay(today);
          void food.logAgain(item);
        }}
      />

      {food.failed.map((op) => (
        <View key={op.opId} style={styles.failedBox} testID="food-failed">
          <Text style={text('body')}>
            {op.kind === 'save' ? `${op.meal.name ?? 'A meal'} didn’t save.` : 'A meal couldn’t be deleted.'} {op.error ?? ''}
          </Text>
          <View style={styles.actions}>
            <TextButton title="Retry" testID="food-retry" onPress={() => food.retry(op.opId)} />
            <TextButton title="Discard" testID="food-discard" onPress={() => food.discard(op.opId)} />
          </View>
        </View>
      ))}

      <Text style={[foodText.heading, styles.titlePad]} accessibilityRole="header" testID="food-day">
        {day === today ? 'Today’s meals' : `Meals on ${shortDayLabel(day, today)}`}
      </Text>
      {meals.length === 0 ? (
        <Text style={[text('body'), styles.titlePad]} testID="food-empty">
          {status === 'loading' ? 'Loading…' : day === today ? 'No meals yet today.' : 'No meals logged this day.'}
        </Text>
      ) : (
        meals.map((m) => (
          <MealCard key={m.id} meal={m} urls={urls} onPress={() => router.push({ pathname: '/food/meal', params: { id: m.id, day: m.eatenOn } })} />
        ))
      )}
    </Screen>
  );
}

function BigButton({
  title,
  icon,
  onPress,
  ink = false,
  disabled = false,
  testID,
}: {
  title: string;
  icon: ReactNode;
  onPress: () => void;
  ink?: boolean;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [styles.big, ink ? styles.bigInk : styles.bigPink, (pressed || disabled) && { opacity: pressedOpacity }]}
    >
      {icon}
      <Text style={[font(800, 16), ink && { color: white }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titlePad: { paddingHorizontal: 4 },
  bigRow: { flexDirection: 'row', gap: 10 },
  big: {
    flex: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: palette.ink,
  },
  bigInk: { backgroundColor: palette.ink },
  bigPink: { backgroundColor: palette.drop },
  failedBox: { gap: space[2], padding: space[3], borderRadius: radius.input, backgroundColor: palette.drop },
  actions: { flexDirection: 'row', gap: space[4] },
});
