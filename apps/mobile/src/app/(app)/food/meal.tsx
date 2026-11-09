import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  IsoDateSchema,
  MACRO_KEYS,
  MACRO_NAMES,
  MEAL_NAME_MAX,
  MEAL_NAME_PRESETS,
  MEAL_NOTE_MAX,
  kcalHint,
  localToday,
  mealProblems,
  mealSearchItems,
  shortDayLabel,
  parseMacroInput,
  photoDisplaySize,
  type MacroKey,
  type MealMacros,
  type MealSearchItem,
} from '@caltracker/shared';
import { FoodInput } from '@/components/food/food-input';
import { font, foodText, inkShadow } from '@/components/food/food-type';
import { CameraIcon } from '@/components/food/icons';
import { MealSearch } from '@/components/food/meal-search';
import { SharpPhoto } from '@/components/photo/sharp-photo';
import { Button, ErrorText, Screen, TextButton } from '@/components/ui';
import { PhotoError } from '@/lib/compress-photo';
import { defaultMinutes, minutesOf, savedTime, stepMinutes, timeLabel, type PhotoChoice } from '@/lib/food-logic';
import { mealPhotoUrls } from '@/lib/food-api';
import { photoUri } from '@/lib/outbox-files';
import { photoFromParams, pickMealPhoto, type PickedMealPhoto } from '@/lib/pick-meal-photo';
import { draftFromParams, presetName } from '@/lib/meal-prefill';
import { useFood } from '@/lib/use-food';
import { palette, pressedOpacity, radius, space, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';

const PREVIEW = 220;
const UNIT: Record<MacroKey, string> = { calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g' };
const toMacroText = (m: MealMacros | null | undefined): Record<MacroKey, string> => ({
  calories: toText(m?.calories ?? null),
  protein: toText(m?.protein ?? null),
  carbs: toText(m?.carbs ?? null),
  fat: toText(m?.fat ?? null),
});
const toText = (n: number | null) => (n === null ? '' : String(n));

/**
 * Log or edit a meal: search your meals and your coach's (new meals only), or fill it in: a name (Breakfast / Lunch /
 * Dinner / Snack fill an empty name), the time, the macros (any of them), an optional photo and a note. Opened from a
 * coach meal (`?coachMealId=`) it starts filled in with that meal. Saving queues the meal on the phone and returns
 * to Food at once; it is sent when there is signal.
 */
export default function MealScreen() {
  const { text } = useTheme();
  const router = useRouter();
  const food = useFood();
  const params = useLocalSearchParams<Record<string, string>>();
  const [today] = useState(() => localToday());
  const before = params.id ? (food?.findMeal(params.id) ?? null) : null;
  const day = before?.eatenOn ?? (IsoDateSchema.safeParse(params.day).success && params.day <= today ? params.day : today);
  // New meals only: editing an old one is a different job.
  const completeMeal = useAnalyticsTask('log_meal', !params.id);

  const [name, setName] = useState(before?.name ?? '');
  const [note, setNote] = useState(before?.note ?? '');
  const [minutes, setMinutes] = useState(() => (before ? minutesOf(before.eatenAt) : defaultMinutes(day, today)));
  // Whether the person moved the time: an untouched new meal is saved at the moment of saving (see savedTime).
  const [timeTouched, setTimeTouched] = useState(false);
  const [macroText, setMacroText] = useState<Record<MacroKey, string>>(() => toMacroText(before?.macros));
  // The coach meal this was logged from (kept even when the copied numbers are changed before saving).
  const [coachMealId, setCoachMealId] = useState<string | null>(before?.coachMealId ?? null);
  const [showTime, setShowTime] = useState(false);
  // Prefill once, when the coach meal list is there (it loads from the phone's copy a moment after opening).
  const [prefilled, setPrefilled] = useState(false);
  const coachMeals = food?.coachMeals;
  useEffect(() => {
    if (before || prefilled || !coachMeals) return;
    const d = draftFromParams(params, coachMeals, today, new Date());
    if (d.name === undefined) return;
    setPrefilled(true);
    setName(d.name);
    setMacroText(toMacroText(d.macros));
    setCoachMealId(d.coachMealId ?? null);
  }, [before, prefilled, coachMeals, params, today]);
  const searchItems = useMemo(
    () => (food ? mealSearchItems(food.history, food.coachMeals, today) : []),
    [food, today],
  );
  const [picked, setPicked] = useState<PickedMealPhoto | null>(() => photoFromParams(params));
  const [removedPhoto, setRemovedPhoto] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [storedUrls, setStoredUrls] = useState<Record<string, string>>({});

  const stored = !removedPhoto && !picked ? (before?.photo ?? null) : null;
  // Links for a stored photo (fetched once per path).
  const storedPath = stored && !before?.localPhoto ? stored.path : null;
  const storedThumb = stored && !before?.localPhoto ? stored.thumbPath : null;
  useEffect(() => {
    if (!storedPath || !storedThumb) return;
    let alive = true;
    void mealPhotoUrls([storedPath, storedThumb]).then((u) => alive && setStoredUrls(u));
    return () => {
      alive = false;
    };
  }, [storedPath, storedThumb]);

  const parsed = useMemo(() => {
    const macros = { calories: null, protein: null, carbs: null, fat: null } as MealMacros;
    const errors: string[] = [];
    for (const k of MACRO_KEYS) {
      const r = parseMacroInput(k, macroText[k]);
      if ('error' in r) errors.push(r.error);
      else macros[k] = r.value;
    }
    return { macros, errors };
  }, [macroText]);
  const hint = kcalHint(parsed.macros);

  function use(item: MealSearchItem) {
    // Fills the name, numbers and coach link; the time and photo stay as they are.
    setName(item.name);
    setMacroText(toMacroText(item.macros));
    setCoachMealId(item.coachMealId);
    setProblems([]);
  }

  if (!food) return null;
  if (params.id && !before) {
    return (
      <Screen>
        <Text style={text('body')}>This meal isn’t here any more.</Text>
        <Button title="Back to Food" onPress={() => router.back()} />
      </Screen>
    );
  }

  const photoShown = picked
    ? { full: photoUri(picked.local.fullUri), thumb: photoUri(picked.local.thumbUri), size: { width: picked.width, height: picked.height } }
    : stored
      ? {
          full: before?.localPhoto ? photoUri(before.localPhoto.fullUri) : storedUrls[stored.path],
          thumb: before?.localPhoto ? photoUri(before.localPhoto.thumbUri) : storedUrls[stored.thumbPath],
          size: { width: stored.width, height: stored.height },
        }
      : null;

  function askPhoto() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => void addPhoto('camera') },
      { text: 'Choose photo', onPress: () => void addPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function addPhoto(source: 'camera' | 'library') {
    setProblems([]);
    setBusy(true);
    try {
      const p = await pickMealPhoto(source);
      if (p) setPicked(p);
    } catch (e) {
      setProblems([e instanceof PhotoError ? e.message : "Couldn't prepare that photo. Please try another."]);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!food) return;
    const hasPhoto = photoShown !== null;
    const all = [...parsed.errors, ...mealProblems({ macros: parsed.macros, hasPhoto, name, note })];
    setProblems(all);
    if (all.length > 0) return;
    const choice: PhotoChoice = picked ? { kind: 'new', local: picked.local, width: picked.width, height: picked.height } : stored ? { kind: 'keep' } : { kind: 'none' };
    setBusy(true);
    completeMeal({ variant: hasPhoto ? 'photo' : 'macros' });
    void food
      .save(before, { ...savedTime({ isNew: !before, touched: timeTouched, day, minutes, openedOn: today }), name, note, macros: parsed.macros, coachMealId }, choice)
      .finally(() => router.back());
  }

  function confirmDelete() {
    if (!food || !before) return;
    Alert.alert('Delete this meal?', 'It will be removed from your food log and your coach’s view.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void food.remove(before).finally(() => router.back());
        },
      },
    ]);
  }

  const timeText = `${day === today ? '' : `${shortDayLabel(day, today)}, `}${timeLabel(minutes).toUpperCase()}`;

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Pressable
            onPress={save}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Save meal"
            accessibilityState={{ disabled: busy, busy }}
            testID="meal-save"
            style={({ pressed }) => [styles.save, inkShadow, (pressed || busy) && { opacity: pressedOpacity }]}
          >
            <Text style={font(800, 17)}>Save meal</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.header}>
        <View style={styles.side}>
          <TextButton title="Cancel" testID="meal-cancel" onPress={() => router.back()} />
        </View>
        <Text style={[font(800, 20), styles.headerTitle]} accessibilityRole="header">
          {before ? 'Edit meal' : 'Log a meal'}
        </Text>
        <View style={styles.side} />
      </View>

      {!before ? (
        <>
          <MealSearch items={searchItems} today={today} coachName={food.coachName} onUse={use} />
          <Text style={[font(700, 13), foodText.muted, styles.center]}>or fill it in</Text>
        </>
      ) : null}

      <View style={styles.group}>
        <Text style={font(800, 14)}>What did you eat?</Text>
        <FoodInput
          testID="meal-name"
          accessibilityLabel="What did you eat?"
          value={name}
          onChangeText={setName}
          maxLength={MEAL_NAME_MAX}
          placeholder="e.g. Chicken and rice"
          style={[font(500, 17), styles.nameInput]}
        />
      </View>

      <View style={styles.group}>
        <Text style={font(800, 14)}>Meal</Text>
        <View style={styles.presets}>
          {MEAL_NAME_PRESETS.map((p) => {
            const selected = name.trim() === p;
            return (
              <Pressable
                key={p}
                onPress={() => setName((n) => presetName(n, p))}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`meal-name-${p}`}
                style={({ pressed }) => [styles.preset, selected && styles.presetOn, pressed && { opacity: pressedOpacity }]}
              >
                <Text style={[font(700, 14), selected && styles.onInk]}>{p}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => setShowTime((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`Time: ${timeText}. Change`}
          testID="meal-time-change"
          style={styles.timeLine}
        >
          <Text style={[font(500, 13), foodText.muted]}>
            Time: <Text testID="meal-time">{timeText}</Text> · <Text style={styles.underline}>Change</Text>
          </Text>
        </Pressable>
        {showTime ? (
          <View style={styles.timeRow}>
            <Stepper glyph="−" label="15 minutes earlier" testID="meal-time-earlier" onPress={() => {
                setTimeTouched(true);
                setMinutes((m) => stepMinutes(m, -1));
              }} />
            <Text style={[font(800, 16), styles.time]} accessibilityLiveRegion="polite">
              {timeLabel(minutes).toUpperCase()}
            </Text>
            <Stepper glyph="+" label="15 minutes later" testID="meal-time-later" onPress={() => {
                setTimeTouched(true);
                setMinutes((m) => stepMinutes(m, 1));
              }} />
          </View>
        ) : null}
      </View>

      <View style={styles.grid}>
        {MACRO_KEYS.map((k) => (
          <View key={k} style={styles.macroBox}>
            <Text style={font(800, 13)}>{`${MACRO_NAMES[k]} (${UNIT[k]})`}</Text>
            <FoodInput
              testID={`meal-${k}`}
              accessibilityLabel={`${MACRO_NAMES[k]} (${UNIT[k]})`}
              value={macroText[k]}
              onChangeText={(v) => setMacroText((t) => ({ ...t, [k]: v }))}
              keyboardType="decimal-pad"
              placeholder="—"
              style={[font(800, 20), styles.macroInput]}
            />
          </View>
        ))}
      </View>
      <Text style={[font(500, 13), foodText.muted, styles.pad]}>Only know some numbers? That's fine, fill in what you have.</Text>
      {hint ? (
        <Text style={[font(700, 13), styles.pad]} testID="meal-kcal-hint">
          {hint}
        </Text>
      ) : null}

      {photoShown ? (
        <View style={styles.photoBlock}>
          <SharpPhoto
            full={photoShown.full}
            thumb={photoShown.thumb}
            size={photoDisplaySize(photoShown.size, { maxWidth: PREVIEW, maxHeight: PREVIEW })}
            radius={radius.input}
            testID="meal-editor-photo"
          />
          <View style={styles.actions}>
            <TextButton title="Change photo" testID="meal-change-photo" onPress={askPhoto} />
            <TextButton
              title="Remove photo"
              testID="meal-remove-photo"
              onPress={() => {
                setPicked(null);
                setRemovedPhoto(true);
              }}
            />
          </View>
        </View>
      ) : (
        <Pressable
          onPress={askPhoto}
          accessibilityRole="button"
          accessibilityLabel="Add a photo (optional)"
          testID="meal-add-photo"
          style={({ pressed }) => [styles.addPhoto, pressed && { opacity: pressedOpacity }]}
        >
          <CameraIcon />
          <Text style={font(700, 15)}>Add a photo (optional)</Text>
        </Pressable>
      )}

      <View style={styles.group}>
        <Text style={font(800, 14)}>Note (optional)</Text>
        <FoodInput
          testID="meal-note"
          accessibilityLabel="Note"
          value={note}
          onChangeText={setNote}
          maxLength={MEAL_NOTE_MAX}
          multiline
          placeholder="Anything your coach should know"
          style={[font(500, 15), styles.noteInput]}
        />
      </View>

      {problems.map((p) => (
        <ErrorText key={p} testID="meal-problem">
          {p}
        </ErrorText>
      ))}

      {before ? <TextButton title="Delete meal" testID="meal-delete" onPress={confirmDelete} /> : null}
    </Screen>
  );
}

function Stepper({ glyph, label, onPress, testID }: { glyph: string; label: string; onPress: () => void; testID: string }) {
  const { text } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.stepper, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={text('screenTitle')}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  side: { width: 64 },
  headerTitle: { flex: 1, textAlign: 'center' },
  center: { textAlign: 'center' },
  pad: { paddingHorizontal: 4 },
  group: { gap: 6 },
  nameInput: { minHeight: 52, borderRadius: 14, borderWidth: 2, borderColor: palette.ink, paddingHorizontal: 14, backgroundColor: palette.bg },
  presets: { flexDirection: 'row', gap: 6 },
  preset: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetOn: { backgroundColor: palette.ink, borderWidth: 2 },
  onInk: { color: white },
  timeLine: { minHeight: 32, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  time: { minWidth: 96, textAlign: 'center' },
  stepper: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  macroBox: { flexBasis: '47%', flexGrow: 1, gap: 6, padding: 12, borderRadius: 16, backgroundColor: palette.surface },
  macroInput: { minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: palette.ink, paddingHorizontal: 12, backgroundColor: palette.bg },
  addPhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.ink,
    backgroundColor: palette.bg,
  },
  photoBlock: { alignItems: 'center', gap: space[2] },
  actions: { flexDirection: 'row', gap: space[4], justifyContent: 'center' },
  noteInput: { minHeight: 72, borderRadius: 14, borderWidth: 1.5, borderColor: palette.ink, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: palette.bg, textAlignVertical: 'top' },
  footer: { paddingTop: space[2] },
  save: { minHeight: 56, borderRadius: 18, borderWidth: 2, borderColor: palette.ink, backgroundColor: palette.lime, alignItems: 'center', justifyContent: 'center' },
});
