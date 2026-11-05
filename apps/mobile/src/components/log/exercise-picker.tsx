import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import { TRACKING_TYPE_LABELS, type ExercisePick } from '@caltracker/shared';
import { ErrorText, TextButton, TextField } from '@/components/ui';
import { searchExercises } from '@/lib/log-api';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const SEARCH_DELAY_MS = 250;

/** Search the exercise library (built-in plus the coach's own) and pick one. */
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
  const [results, setResults] = useState<ExercisePick[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const ticket = ++latest.current;
    const t = setTimeout(() => {
      searchExercises(query)
        .then((r) => {
          if (ticket !== latest.current) return;
          setResults(r);
          setError(null);
        })
        .catch(() => {
          if (ticket === latest.current) setError('Couldn’t search exercises. Check your connection and try again.');
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [query, visible]);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults(null);
      setError(null);
    }
  }, [visible]);

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
          {error ? <ErrorText>{error}</ErrorText> : null}
          {results === null && !error ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
          {results?.length === 0 ? <Text style={text('body')}>No exercises match.</Text> : null}
          <FlatList
            data={results ?? []}
            keyExtractor={(e) => e.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: space[2] }}
            renderItem={({ item, index }) => (
              <Pressable
                testID={`exercise-result-${index}`}
                onPress={() => onPick(item)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.result,
                  { borderRadius: radius.input, paddingHorizontal: space[3.5], paddingVertical: space[2.5] },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={text('sectionHeading')}>{item.name}</Text>
                <Text style={text('caption')}>{TRACKING_TYPE_LABELS[item.trackingType]}</Text>
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
  column: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  result: { minHeight: tapTarget.min, justifyContent: 'center', backgroundColor: palette.surface },
  pressed: { backgroundColor: palette.border },
});
