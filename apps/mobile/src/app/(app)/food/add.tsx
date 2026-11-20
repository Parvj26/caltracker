import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  IsoDateSchema,
  compactMacroLine,
  formatMacro,
  localToday,
  mealSearchItems,
  mealSearchMeta,
  recentAndFrequentMeals,
  searchMeals,
  type MealSearchItem,
} from '@caltracker/shared';
import { FoodInput } from '@/components/food/food-input';
import { font, foodText } from '@/components/food/food-type';
import { CameraIcon, CloseIcon, SearchIcon } from '@/components/food/icons';
import { MealThumb } from '@/components/food/meal-thumb';
import { UndoToast } from '@/components/food/undo-toast';
import { WhenLine } from '@/components/food/when-picker';
import { ErrorText } from '@/components/ui';
import { coachMealPhotoUrls } from '@/lib/coach-meals-api';
import { PhotoError } from '@/lib/compress-photo';
import type { ShownError } from '@/lib/error-shown';
import { mealPhotoUrls } from '@/lib/food-api';
import { copyItem, copyLabel, mealsToCopy, whenNow, whenParams, type When } from '@/lib/food-logic';
import type { MealRecord } from '@/lib/food-queue';
import { prefillParams } from '@/lib/meal-prefill';
import { photoParams, pickMealPhoto } from '@/lib/pick-meal-photo';
import { useFood } from '@/lib/use-food';
import { contentMaxWidth, palette, pressedOpacity } from '@/theme/theme';

type Undo = { message: string; meals: MealRecord[] };

/**
 * Add a meal (a sheet over Food): when it was eaten ("Lunch · Today, 1:15 PM ▾", the type comes from the time),
 * smart search of the client's and the coach's meals, "Copy yesterday's lunch", New meal, a photo, and Recent &
 * frequent. Tapping a row opens the meal form filled in to check first; its + logs it at once with an Undo bar.
 */
export default function AddMealScreen() {
  const router = useRouter();
  const food = useFood();
  const params = useLocalSearchParams<{ day?: string }>();
  const [today] = useState(() => localToday());
  const startDay = IsoDateSchema.safeParse(params.day).success && params.day && params.day < today ? params.day : null;
  // An untouched time on today follows the clock (a + logs at the moment it is tapped).
  const [picked, setPicked] = useState<When | null>(() => (startDay ? { day: startDay, minutes: 12 * 60 } : null));
  const when = picked ?? whenNow();
  const [query, setQuery] = useState('');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [error, setError] = useState<ShownError | null>(null);
  const [busy, setBusy] = useState(false);
  const [ownUrls, setOwnUrls] = useState<Record<string, string>>({});
  const [coachUrls, setCoachUrls] = useState<Record<string, string>>({});

  const items = useMemo(() => (food ? mealSearchItems(food.history, food.coachMeals, today) : []), [food, today]);
  const recent = useMemo(() => (food ? recentAndFrequentMeals(food.history, food.coachMeals, today) : []), [food, today]);
  const searching = query.trim() !== '';
  const list = useMemo(() => (searching ? searchMeals(items, query) : recent), [searching, items, query, recent]);
  const copies = useMemo(() => (food ? mealsToCopy(food.history, when) : []), [food, when]);

  // Thumbnails for the rows shown (own photos and the coach's live in different buckets).
  const missingOwn = list.flatMap((m) => (m.source === 'own' && m.thumbPath && !ownUrls[m.thumbPath] ? [m.thumbPath] : [])).join('|');
  const missingCoach = list.flatMap((m) => (m.source === 'coach' && m.thumbPath && !coachUrls[m.thumbPath] ? [m.thumbPath] : [])).join('|');
  useEffect(() => {
    if (!missingOwn) return;
    let alive = true;
    void mealPhotoUrls(missingOwn.split('|')).then((u) => alive && setOwnUrls((p) => ({ ...p, ...u })));
    return () => {
      alive = false;
    };
  }, [missingOwn]);
  useEffect(() => {
    if (!missingCoach) return;
    let alive = true;
    void coachMealPhotoUrls(missingCoach.split('|')).then((u) => alive && setCoachUrls((p) => ({ ...p, ...u })));
    return () => {
      alive = false;
    };
  }, [missingCoach]);

  if (!food) return null;
  const coachTag = food.coachName ? `from ${food.coachName}` : 'from your coach';
  const formParams = () => ({ ...whenParams(when), ...(picked ? { whenTouched: '1' } : {}) });

  async function log(chosen: MealSearchItem[], message: string) {
    if (!food) return;
    const meals = await food.logMeals(chosen, picked ?? undefined);
    setUndo({ message, meals });
  }

  function logOne(item: MealSearchItem) {
    const kcal = item.macros.calories;
    void log([item], `Logged ${item.name}${kcal !== null ? ` · ${formatMacro('calories', kcal)}` : ''}`);
  }

  function copy() {
    const n = copies.length;
    const first = copies[0];
    void log(copies.map(copyItem), n === 1 && first?.name ? `Logged ${first.name.trim()}` : `Logged ${n} meals`);
  }

  function undoLast() {
    if (!food || !undo) return;
    for (const m of undo.meals) void food.remove(m);
    setUndo(null);
  }

  function askPhoto() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => void addPhoto('camera') },
      { text: 'Choose photo', onPress: () => void addPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function addPhoto(source: 'camera' | 'library') {
    setError(null);
    setBusy(true);
    try {
      const p = await pickMealPhoto(source);
      if (p) router.push({ pathname: '/food/meal', params: { ...formParams(), ...photoParams(p) } });
    } catch (e) {
      setError(e instanceof PhotoError ? { code: 'photo_unusable', text: e.message } : { code: 'photo_prepare_failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.fill} edges={['left', 'right', 'bottom']}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          <View style={styles.head}>
            <Text style={[font(800, 24), styles.flex]} accessibilityRole="header">
              Add a meal
            </Text>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="add-meal-close"
              style={({ pressed }) => [styles.close, pressed && { opacity: pressedOpacity }]}
            >
              <CloseIcon />
            </Pressable>
          </View>

          <WhenLine when={when} today={today} onChange={setPicked} testID="add-meal-when" />

          <View style={styles.search}>
            <SearchIcon />
            <FoodInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your meals (typos OK)"
              accessibilityLabel="Search your meals"
              testID="meal-search"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              wrapStyle={styles.flex}
              style={[font(500, 16), styles.searchInput]}
            />
          </View>

          <View style={styles.actions}>
            {copies.length > 0 ? (
              <Pill title={copyLabel(when, today)} testID="add-meal-copy" ph="log_meal_copy_yesterday" onPress={copy} />
            ) : null}
            <Pill title="New meal" testID="add-meal-new" ph="log_add_meal" onPress={() => router.push({ pathname: '/food/meal', params: formParams() })} />
            <Pressable
              onPress={askPhoto}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Add a meal from a photo"
              accessibilityState={{ disabled: busy }}
              testID="add-meal-photo"
              ph-label="log_add_meal_photo"
              style={({ pressed }) => [styles.pill, styles.photo, (pressed || busy) && { opacity: pressedOpacity }]}
            >
              <CameraIcon />
            </Pressable>
          </View>
          {error ? <ErrorText testID="add-meal-error" code={error.code}>{error.text}</ErrorText> : null}

          <Text style={[foodText.overline, styles.heading]} accessibilityRole="header">
            {searching ? 'Matches' : 'Recent & frequent'}
          </Text>
        </View>

        <View style={[styles.column, styles.list]}>
          {list.length === 0 ? (
            <Text style={[font(500, 15), foodText.muted, styles.empty]} testID={searching ? 'meal-search-empty' : 'add-meal-none'}>
              {searching ? 'No meals match. Tap New meal to type it in.' : 'Meals you log show up here, ready to log again in one tap.'}
            </Text>
          ) : (
            list.map((m) => {
              const meta = m.source === 'coach' ? [compactMacroLine(m.macros), coachTag].filter(Boolean).join(' · ') : mealSearchMeta(m, today);
              const uri = m.thumbPath ? (m.source === 'coach' ? coachUrls[m.thumbPath] : ownUrls[m.thumbPath]) : undefined;
              return (
                <View key={m.key} style={styles.row}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/food/meal', params: { ...prefillParams(m), ...formParams() } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.name}, ${meta}`}
                    accessibilityHint="Opens it to check or change before saving"
                    testID={`meal-use-${m.name}`}
                    style={({ pressed }) => [styles.rowMain, pressed && { opacity: pressedOpacity }]}
                  >
                    <MealThumb uri={uri} />
                    <View style={styles.flex}>
                      <Text style={font(700, 16)}>{m.name}</Text>
                      <Text style={[font(500, 13), foodText.muted]}>{meta}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => logOne(m)}
                    accessibilityRole="button"
                    accessibilityLabel={`Log ${m.name} now`}
                    testID={`meal-log-${m.name}`}
                    ph-label="log_meal_one_tap"
                    style={({ pressed }) => [styles.plus, pressed && { opacity: pressedOpacity }]}
                  >
                    <Text style={font(800, 22)}>+</Text>
                  </Pressable>
                </View>
              );
            })
          )}
          {list.length > 0 ? (
            <Text style={[font(500, 12), foodText.muted, styles.hint]}>Tap a row to check or change it first; tap + to log it straight away.</Text>
          ) : null}
        </View>
      </ScrollView>
      <View style={[styles.column, styles.toast]} pointerEvents="box-none">
        <UndoToast message={undo?.message ?? null} onUndo={undoLast} onHide={() => setUndo(null)} />
      </View>
    </SafeAreaView>
  );
}

function Pill({ title, onPress, testID, ph }: { title: string; onPress: () => void; testID: string; ph: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} testID={testID} ph-label={ph} style={({ pressed }) => [styles.pill, pressed && { opacity: pressedOpacity }]}>
      <Text style={font(700, 14)}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  scroll: { paddingTop: 16, paddingBottom: 96 },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center', paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  search: {
    marginTop: 6,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surface,
  },
  searchInput: { minHeight: 44 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  pill: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: palette.borderStrong, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 48, paddingHorizontal: 0 },
  heading: { marginTop: 18, marginBottom: 6 },
  list: { paddingHorizontal: 0, borderTopWidth: 1, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, paddingLeft: 16, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: palette.border },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8 },
  plus: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 16 },
  hint: { paddingHorizontal: 16, paddingTop: 8 },
  toast: { position: 'absolute', left: 0, right: 0, bottom: 30 },
});
