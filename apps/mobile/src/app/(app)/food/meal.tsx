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
  foodDayLabel,
  kcalHint,
  localToday,
  mealProblems,
  parseMacroInput,
  photoDisplaySize,
  type MacroKey,
  type MealMacros,
} from '@caltracker/shared';
import { SharpPhoto } from '@/components/photo/sharp-photo';
import { Button, ErrorText, Screen, TextButton, TextField } from '@/components/ui';
import { PhotoError } from '@/lib/compress-photo';
import { defaultMinutes, minutesOf, savedTime, stepMinutes, timeLabel, type PhotoChoice } from '@/lib/food-logic';
import { mealPhotoUrls } from '@/lib/food-api';
import { photoUri } from '@/lib/outbox-files';
import { photoFromParams, pickMealPhoto, type PickedMealPhoto } from '@/lib/pick-meal-photo';
import { useFood } from '@/lib/use-food';
import { palette, pressedOpacity, radius, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';

const PREVIEW = 220;
const UNIT: Record<MacroKey, string> = { calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g' };
const toText = (n: number | null) => (n === null ? '' : String(n));

/**
 * Log or edit a meal: a photo (optional), a name (chips or free text), the time, the macros (any of them) and a note.
 * Saving queues the meal on the phone and returns to Food at once; it is sent when there is signal.
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
  const [macroText, setMacroText] = useState<Record<MacroKey, string>>(() => ({
    calories: toText(before?.macros.calories ?? null),
    protein: toText(before?.macros.protein ?? null),
    carbs: toText(before?.macros.carbs ?? null),
    fat: toText(before?.macros.fat ?? null),
  }));
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
      .save(before, { ...savedTime({ isNew: !before, touched: timeTouched, day, minutes, openedOn: today }), name, note, macros: parsed.macros }, choice)
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

  return (
    <Screen>
      <View style={styles.row}>
        <TextButton title="Cancel" testID="meal-cancel" onPress={() => router.back()} />
      </View>
      <Text style={text('screenTitle')} accessibilityRole="header">
        {before ? 'Edit meal' : 'Log a meal'}
      </Text>
      <Text style={text('caption')}>{foodDayLabel(day, today)}</Text>

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
            <TextButton title="Change photo" testID="meal-change-photo" onPress={() => void addPhoto('library')} />
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
        <View style={styles.actions}>
          <TextButton title="Take photo" testID="meal-take-photo" onPress={() => void addPhoto('camera')} />
          <TextButton title="Choose photo" testID="meal-choose-photo" onPress={() => void addPhoto('library')} />
        </View>
      )}

      <View style={{ gap: space[2] }}>
        <Text style={text('sectionHeading')}>Name</Text>
        <View style={styles.chips}>
          {MEAL_NAME_PRESETS.map((p) => {
            const selected = name.trim() === p;
            return (
              <Pressable
                key={p}
                onPress={() => setName(selected ? '' : p)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`meal-name-${p}`}
                style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && { opacity: pressedOpacity }]}
              >
                <Text style={text('caption')}>{p}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextField label="Or type a name" testID="meal-name" value={name} onChangeText={setName} maxLength={MEAL_NAME_MAX} placeholder="Optional" />
      </View>

      <View style={{ gap: space[2] }}>
        <Text style={text('sectionHeading')}>Time</Text>
        <View style={styles.timeRow}>
          <Stepper glyph="−" label="15 minutes earlier" testID="meal-time-earlier" onPress={() => {
              setTimeTouched(true);
              setMinutes((m) => stepMinutes(m, -1));
            }} />
          <Text style={[text('sectionHeading'), styles.time]} testID="meal-time" accessibilityLiveRegion="polite">
            {timeLabel(minutes)}
          </Text>
          <Stepper glyph="+" label="15 minutes later" testID="meal-time-later" onPress={() => {
              setTimeTouched(true);
              setMinutes((m) => stepMinutes(m, 1));
            }} />
        </View>
      </View>

      <View style={{ gap: space[3] }}>
        <Text style={text('sectionHeading')}>Macros (optional)</Text>
        {MACRO_KEYS.map((k) => (
          <TextField
            key={k}
            label={`${MACRO_NAMES[k]} (${UNIT[k]})`}
            testID={`meal-${k}`}
            value={macroText[k]}
            onChangeText={(v) => setMacroText((t) => ({ ...t, [k]: v }))}
            keyboardType="decimal-pad"
            placeholder="—"
          />
        ))}
        {hint ? (
          <Text style={text('caption')} testID="meal-kcal-hint">
            {hint}
          </Text>
        ) : null}
      </View>

      <TextField label="Note" testID="meal-note" value={note} onChangeText={setNote} maxLength={MEAL_NOTE_MAX} multiline placeholder="Optional" />

      {problems.map((p) => (
        <ErrorText key={p} testID="meal-problem">
          {p}
        </ErrorText>
      ))}

      <Button title="Save meal" testID="meal-save" busy={busy} onPress={save} />
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
  row: { flexDirection: 'row' },
  photoBlock: { alignItems: 'center', gap: space[2] },
  actions: { flexDirection: 'row', gap: space[4], justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    borderWidth: 2,
    borderColor: palette.ink,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: palette.bg,
  },
  chipOn: { backgroundColor: palette.lime },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  time: { minWidth: 96, textAlign: 'center' },
  stepper: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
});
