import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import {
  EQUIPMENT_CHIPS,
  MUSCLE_CHIPS,
  TRACKING_TYPE_LABELS,
  buildExerciseIndex,
  searchExercises,
  type ExerciseIndexRow,
  type ExercisePick,
  type SearchFilters,
} from '@caltracker/shared';
import { ExerciseThumb } from '@/components/log/exercise-thumb';
import { ErrorText, TextButton, TextField } from '@/components/ui';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { loadExerciseIndexCached, loadRecentExerciseIds } from '@/lib/exercise-index-api';
import type { LoadedExerciseIndex } from '@/lib/exercise-index';
import { contentMaxWidth, palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const NO_FILTERS: SearchFilters = { muscles: [], equipment: [], customOnly: false };
const NO_FAVOURITES: ReadonlySet<string> = new Set();
const MAX_SHOWN = 50;

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/** The thumbnail wants an exercise detail; a library row has the photo, muscles and equipment already. */
const detailOf = (r: ExerciseIndexRow): ExerciseDetail => ({
  id: r.id,
  name: r.name,
  imagePaths: r.imagePath ? [r.imagePath] : [],
  primaryMuscles: r.primaryMuscles,
  secondaryMuscles: r.secondaryMuscles,
  equipment: r.equipment,
  instructions: [],
  videoUrl: null,
});

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  return (
    <Pressable
      testID={`chip-${label}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} filter`}
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        { borderRadius: radius.input, paddingHorizontal: space[3] },
        active && { backgroundColor: palette.ink },
      ]}
    >
      <Text style={[text('caption'), active && { color: palette.bg }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Search the exercise library (built-in plus the coach's own) and pick one. The library is kept on the phone, so
 * this works offline; shorthand like "db incline" finds "Dumbbell Incline Bench Press". With nothing typed it
 * lists the client's recent exercises first.
 */
export function ExercisePicker({
  title,
  visible,
  onPick,
  onClose,
}: {
  title: string;
  visible: boolean;
  onPick: (ex: ExercisePick) => void;
  onClose: () => void;
}) {
  const { text, space, radius } = useTheme();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS);
  const [data, setData] = useState<LoadedExerciseIndex | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setFilters(NO_FILTERS);
      setError(null);
      return;
    }
    let stale = false;
    setError(null);
    loadExerciseIndexCached((next) => {
      if (!stale) setData(next);
    })
      .then((d) => {
        if (!stale) setData(d);
      })
      .catch(() => {
        if (!stale) setError('Couldn’t load exercises. Check your connection and try again.');
      });
    loadRecentExerciseIds()
      .then((ids) => {
        if (!stale) setRecent(ids);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [visible]);

  const index = useMemo(() => (data ? buildExerciseIndex(data.rows) : null), [data]);
  const boosts = useMemo(() => ({ favourites: NO_FAVOURITES, recent }), [recent]);
  const hits = useMemo(
    () => (index ? searchExercises(index, query, filters, boosts).slice(0, MAX_SHOWN) : []),
    [index, query, filters, boosts],
  );
  const recentSet = useMemo(() => new Set(recent), [recent]);
  const loading = index === null && !error;
  const pick = (r: ExerciseIndexRow) => onPick({ id: r.id, name: r.name, trackingType: r.trackingType });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.fill, styles.column, { padding: space[4], gap: space[3] }]}>
          <View style={styles.headerRow}>
            <Text style={[text('screenTitle'), styles.fill]} accessibilityRole="header">
              {title}
            </Text>
            <TextButton testID="picker-close" title="Cancel" onPress={onClose} />
          </View>
          <TextField
            label="Search exercises"
            testID="exercise-search"
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            placeholder="Squat, push-up, row…"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.chipRow}
            contentContainerStyle={{ gap: space[2], alignItems: 'center' }}
            accessibilityLabel="Filters"
          >
            {MUSCLE_CHIPS.map((m) => (
              <Chip
                key={m}
                label={m}
                active={filters.muscles.includes(m)}
                onPress={() => setFilters((f) => ({ ...f, muscles: toggle(f.muscles, m) }))}
              />
            ))}
            {EQUIPMENT_CHIPS.map((q) => (
              <Chip
                key={q}
                label={q}
                active={filters.equipment.includes(q)}
                onPress={() => setFilters((f) => ({ ...f, equipment: toggle(f.equipment, q) }))}
              />
            ))}
          </ScrollView>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {data?.refreshFailed ? <Text style={text('caption')}>Using saved library</Text> : null}
          {loading ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
          {index && hits.length === 0 ? <Text style={text('body')}>No exercises match.</Text> : null}
          <FlatList
            data={hits}
            keyExtractor={(h) => h.row.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: space[2] }}
            renderItem={({ item, index: i }) => (
              <Pressable
                testID={`exercise-result-${i}`}
                onPress={() => pick(item.row)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.result,
                  { borderRadius: radius.input, paddingHorizontal: space[3.5], paddingVertical: space[2.5], gap: space[3] },
                  pressed && styles.pressed,
                ]}
              >
                <ExerciseThumb
                  name={item.row.name}
                  detail={detailOf(item.row)}
                  testID={`exercise-result-thumb-${i}`}
                  onPress={() => pick(item.row)}
                />
                <View style={styles.fill0}>
                  <Text style={text('sectionHeading')}>{item.row.name}</Text>
                  <Text style={text('caption')}>
                    {TRACKING_TYPE_LABELS[item.row.trackingType]}
                    {query.trim() === '' && recentSet.has(item.row.id) ? ' · Recent' : ''}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  fill0: { flex: 1 },
  chipRow: { flexGrow: 0, minHeight: tapTarget.min },
  chip: { minHeight: tapTarget.min, justifyContent: 'center', backgroundColor: palette.surface },
  result: { minHeight: tapTarget.min, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface },
  pressed: { backgroundColor: palette.border },
});
