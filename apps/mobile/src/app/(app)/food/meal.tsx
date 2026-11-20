import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  IsoDateSchema,
  MACRO_KEYS,
  MACRO_NAMES,
  MEAL_NAME_MAX,
  MEAL_NOTE_MAX,
  localToday,
  macroSumHint,
  mealProblems,
  parseMacroInput,
  type MacroKey,
  type MealMacros,
} from '@caltracker/shared';
import { FoodInput } from '@/components/food/food-input';
import { font, foodText } from '@/components/food/food-type';
import { MoreIcon } from '@/components/food/icons';
import { WhenLine } from '@/components/food/when-picker';
import { Button, ErrorText, Screen } from '@/components/ui';
import { MenuSheet } from '@/components/ui/menu-sheet';
import { CloseButton } from '@/components/ui/nav-buttons';
import { useDiscardGuard } from '@/lib/use-discard-guard';
import { PhotoError } from '@/lib/compress-photo';
import { defaultMinutes, minutesOf, savedTime, whenFromParams, type PhotoChoice, type When } from '@/lib/food-logic';
import { mealPhotoUrls } from '@/lib/food-api';
import { photoUri } from '@/lib/outbox-files';
import { photoFromParams, pickMealPhoto, type PickedMealPhoto } from '@/lib/pick-meal-photo';
import { draftFromParams } from '@/lib/meal-prefill';
import { useFood } from '@/lib/use-food';
import { palette, pressedOpacity, radius, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';

const UNIT: Record<MacroKey, string> = { calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g' };
const toMacroText = (m: MealMacros | null | undefined): Record<MacroKey, string> => ({
  calories: toText(m?.calories ?? null),
  protein: toText(m?.protein ?? null),
  carbs: toText(m?.carbs ?? null),
  fat: toText(m?.fat ?? null),
});
const toText = (n: number | null) => (n === null ? '' : String(n));

/**
 * New meal / Edit meal: a name, a photo, when it was eaten ("Lunch · Today, 1:15 PM ▾", the type comes from the
 * time), the four numbers (any of them) and a note. Opened from Add a meal (`?day=&minutes=`, maybe a row's
 * numbers or a photo) or from a coach meal (`?coachMealId=`) it starts filled in. × asks before throwing away
 * typing; when editing, ⋯ holds Delete meal. Saving queues the meal on the phone and closes at once.
 */
export default function MealScreen() {
  const { text } = useTheme();
  const router = useRouter();
  const food = useFood();
  const params = useLocalSearchParams<Record<string, string>>();
  const [today] = useState(() => localToday());
  const before = params.id ? (food?.findMeal(params.id) ?? null) : null;
  // New meals only: editing an old one is a different job.
  const completeMeal = useAnalyticsTask('log_meal', !params.id);

  const [initialWhen] = useState<When>(() => {
    if (before) return { day: before.eatenOn, minutes: minutesOf(before.eatenAt) };
    const fromParams = whenFromParams(params, today);
    if (fromParams) return fromParams;
    const day = IsoDateSchema.safeParse(params.day).success && params.day <= today ? params.day : today;
    return { day, minutes: defaultMinutes(day, today) };
  });
  const [when, setWhen] = useState<When>(initialWhen);
  // Whether the time was picked: an untouched new meal on today is saved at the moment of saving (see savedTime).
  const [timeTouched, setTimeTouched] = useState(params.whenTouched === '1');
  const [name, setName] = useState(before?.name ?? '');
  const [note, setNote] = useState(before?.note ?? '');
  const [macroText, setMacroText] = useState<Record<MacroKey, string>>(() => toMacroText(before?.macros));
  // The coach meal this was logged from (kept even when the copied numbers are changed before saving).
  const [coachMealId, setCoachMealId] = useState<string | null>(before?.coachMealId ?? null);
  // What the form started with, so × only asks when something was changed.
  const [start, setStart] = useState(() => JSON.stringify({ name: before?.name ?? '', note: before?.note ?? '', macros: toMacroText(before?.macros) }));
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
    setStart(JSON.stringify({ name: d.name, note: '', macros: toMacroText(d.macros) }));
  }, [before, prefilled, coachMeals, params, today]);
  const [picked, setPicked] = useState<PickedMealPhoto | null>(() => photoFromParams(params));
  const [removedPhoto, setRemovedPhoto] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [storedUrls, setStoredUrls] = useState<Record<string, string>>({});

  const stored = !removedPhoto && !picked ? (before?.photo ?? null) : null;
  const storedThumb = stored && !before?.localPhoto ? stored.thumbPath : null;
  useEffect(() => {
    if (!storedThumb) return;
    let alive = true;
    void mealPhotoUrls([storedThumb]).then((u) => alive && setStoredUrls(u));
    return () => {
      alive = false;
    };
  }, [storedThumb]);

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
  const hint = macroSumHint(parsed.macros);
  const photoChanged = removedPhoto || (picked !== null && !photoFromParams(params));
  const dirty =
    JSON.stringify({ name, note, macros: macroText }) !== start ||
    photoChanged ||
    (timeTouched && (when.day !== initialWhen.day || when.minutes !== initialWhen.minutes));
  // ×, swipe-down and Back ask "Discard changes?" while something was changed.
  const guard = useDiscardGuard(dirty);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!food) return null;
  if (params.id && !before) {
    return (
      <Screen>
        <Text style={text('body')}>This meal isn’t here any more.</Text>
        <Button title="Back to Food" onPress={() => router.back()} />
      </Screen>
    );
  }

  const thumb = picked
    ? photoUri(picked.local.thumbUri)
    : stored
      ? before?.localPhoto
        ? photoUri(before.localPhoto.thumbUri)
        : storedUrls[stored.thumbPath]
      : undefined;
  const hasPhoto = picked !== null || stored !== null;

  function askPhoto() {
    const options: Parameters<typeof Alert.alert>[2] = [
      { text: 'Take photo', onPress: () => void addPhoto('camera') },
      { text: 'Choose photo', onPress: () => void addPhoto('library') },
    ];
    if (hasPhoto) {
      options.push({
        text: 'Remove photo',
        style: 'destructive',
        onPress: () => {
          setPicked(null);
          setRemovedPhoto(true);
        },
      });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(hasPhoto ? 'Meal photo' : 'Add a photo', undefined, options);
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

  // Back to where Add a meal or a coach meal was opened from; an edit goes back one step.
  const leave = () => (params.coachMealId ? router.dismissTo('/food') : params.minutes && !before ? router.dismissAll() : router.back());


  function save() {
    if (!food) return;
    const all = [...parsed.errors, ...mealProblems({ macros: parsed.macros, hasPhoto, name, note })];
    setProblems(all);
    if (all.length > 0) return;
    const choice: PhotoChoice = picked ? { kind: 'new', local: picked.local, width: picked.width, height: picked.height } : stored ? { kind: 'keep' } : { kind: 'none' };
    setBusy(true);
    completeMeal({ variant: hasPhoto ? 'photo' : 'macros' });
    void food
      .save(before, { ...savedTime({ isNew: !before, touched: timeTouched, day: when.day, minutes: when.minutes, openedOn: today }), name, note, macros: parsed.macros, coachMealId }, choice)
      .finally(() => guard.leave(leave));
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
          void food.remove(before).finally(() => guard.leave(() => router.back()));
        },
      },
    ]);
  }


  return (
    <Screen
      inSheet
      footer={
        <View style={styles.footer}>
          <Pressable
            onPress={save}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Save meal"
            accessibilityState={{ disabled: busy, busy }}
            testID="meal-save"
            ph-label="log_meal_save"
            style={({ pressed }) => [styles.save, (pressed || busy) && { opacity: pressedOpacity }]}
          >
            <Text style={[font(800, 17), styles.onInk]}>{busy ? 'Saving…' : 'Save meal'}</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.header}>
        <Text style={[font(800, 24), styles.flex]} accessibilityRole="header">
          {before ? 'Edit meal' : 'New meal'}
        </Text>
        {before ? (
          <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="More" testID="meal-more" style={({ pressed }) => [styles.round, pressed && { opacity: pressedOpacity }]}>
            <MoreIcon />
          </Pressable>
        ) : null}
        <CloseButton testID="meal-cancel" onPress={() => router.back()} />
      </View>
      <MenuSheet
        title={menuOpen ? '' : null}
        items={[{ label: 'Delete meal', testID: 'meal-delete', destructive: true, onPress: confirmDelete }]}
        onClose={() => setMenuOpen(false)}
      />

      <View style={styles.field}>
        <Text style={font(700, 15)}>Name</Text>
        <FoodInput
          testID="meal-name"
          accessibilityLabel="Name"
          value={name}
          onChangeText={setName}
          maxLength={MEAL_NAME_MAX}
          placeholder="e.g. Chicken and rice"
          style={[font(500, 17), styles.input]}
        />
      </View>

      <View style={styles.photoRow}>
        <Pressable
          onPress={askPhoto}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={hasPhoto ? 'Change or remove the photo' : 'Add a photo (optional)'}
          testID={hasPhoto ? 'meal-change-photo' : 'meal-add-photo'}
          style={({ pressed }) => [styles.photoSlot, hasPhoto && styles.photoSlotFull, pressed && { opacity: pressedOpacity }]}
        >
          {hasPhoto ? (
            thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors testID="meal-editor-photo" /> : null
          ) : (
            <Text style={[font(700, 13), foodText.muted, styles.center]}>+ Photo</Text>
          )}
        </Pressable>
        <View style={styles.flex}>
          <WhenLine
            when={when}
            today={today}
            testID="meal-time"
            onChange={(w) => {
              setTimeTouched(true);
              setWhen(w);
            }}
          />
        </View>
      </View>

      <View style={styles.grid}>
        {MACRO_KEYS.map((k) => (
          <View key={k} style={[styles.field, styles.cell]}>
            <Text style={font(700, 15)}>{MACRO_NAMES[k]}</Text>
            <View style={[styles.input, styles.unitBox]}>
              <FoodInput
                testID={`meal-${k}`}
                accessibilityLabel={`${MACRO_NAMES[k]} in ${UNIT[k] === 'g' ? 'grams' : 'kcal'}`}
                value={macroText[k]}
                onChangeText={(v) => {
                  setMacroText((t) => ({ ...t, [k]: v }));
                  if (problems.length > 0) setProblems([]);
                }}
                keyboardType="decimal-pad"
                placeholder="—"
                wrapStyle={styles.flex}
                style={[font(800, 18), styles.number]}
              />
              <Text style={[font(700, 14), foodText.muted]}>{UNIT[k]}</Text>
            </View>
          </View>
        ))}
      </View>
      {/* Under the numbers it is (almost always) about: "Add a photo or at least one of …". */}
      {problems.map((p) => (
        <ErrorText key={p} testID="meal-problem" code="meal_details_invalid">
          {p}
        </ErrorText>
      ))}
      {hint ? (
        <Text style={font(500, 14)} testID="meal-kcal-hint">
          {hint}
        </Text>
      ) : null}
      <Text style={[font(500, 13), foodText.muted]}>Fill in what you know</Text>

      <View style={styles.field}>
        <Text style={font(700, 15)}>{`Note for ${food?.coachName ?? 'your coach'} (optional)`}</Text>
        <FoodInput
          testID="meal-note"
          accessibilityLabel="Note"
          value={note}
          onChangeText={setNote}
          maxLength={MEAL_NOTE_MAX}
          multiline
          style={[font(500, 16), styles.input, styles.note]}
        />
      </View>

    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 6 },
  // Flat fields: one grey box with a visible edge, no box around it.
  input: { minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: palette.borderStrong, backgroundColor: palette.surface, paddingHorizontal: 14 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoSlot: {
    width: 72,
    height: 72,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoSlotFull: { borderStyle: 'solid', backgroundColor: palette.surface },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexBasis: '47%', flexGrow: 1 },
  unitBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  number: { minHeight: 46 },
  note: { minHeight: 80, paddingVertical: 12, textAlignVertical: 'top' },
  footer: { paddingTop: 8 },
  save: { minHeight: 52, borderRadius: radius.pill, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  onInk: { color: white },
});
