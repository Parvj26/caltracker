import { useMemo, useState } from 'react';
import { Modal, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import { formatWeight, strengthPickerSections, type StrengthExerciseLite, type Units } from '@caltracker/shared';
import { TextButton, TextField } from '@/components/ui';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * The searchable exercise list for the Strength screen: recently trained first, then every exercise grouped by its
 * primary muscle, each with its best estimated max.
 */
export function StrengthPicker({
  visible,
  exercises,
  selectedId,
  units,
  onPick,
  onClose,
}: {
  visible: boolean;
  exercises: readonly StrengthExerciseLite[];
  selectedId: string | null;
  units: Units;
  onPick: (exerciseId: string) => void;
  onClose: () => void;
}) {
  const { text, space, radius } = useTheme();
  const [query, setQuery] = useState('');
  const sections = useMemo(
    () => strengthPickerSections(exercises, query).map((s) => ({ title: s.title, data: s.items })),
    [exercises, query],
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.head, { padding: space[4], gap: space[3] }]}>
          <View style={styles.row}>
            <Text style={[text('screenTitle'), styles.grow]} accessibilityRole="header">
              Choose an exercise
            </Text>
            <TextButton title="Close" testID="strength-picker-close" onPress={onClose} />
          </View>
          <TextField label="Search" testID="strength-picker-search" value={query} onChangeText={setQuery} placeholder="Exercise name" autoCorrect={false} returnKeyType="search" />
        </View>
        <SectionList
          testID="strength-picker-list"
          sections={sections}
          keyExtractor={(item, i) => `${item.exerciseId}-${i}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space[4], paddingBottom: space[6] }}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={<Text style={[text('body'), { paddingTop: space[3] }]}>No exercise matches that.</Text>}
          renderSectionHeader={({ section }) => (
            <Text style={[text('sectionHeading'), { paddingTop: space[4], paddingBottom: space[1] }]} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => {
            const on = item.exerciseId === selectedId;
            const best = item.bestKg > 0 ? `best ${formatWeight(item.bestKg, units)}` : '';
            return (
              <Pressable
                testID={`strength-pick-${item.name}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${item.name}${best ? `, ${best} estimated max` : ''}`}
                onPress={() => {
                  onPick(item.exerciseId);
                  setQuery('');
                }}
                style={({ pressed }) => [
                  styles.item,
                  { borderRadius: radius.input, paddingHorizontal: space[3], gap: space[2] },
                  on && styles.itemOn,
                  pressed && { opacity: pressedOpacity },
                ]}
              >
                <Text style={[text('sectionHeading'), styles.grow]}>{item.name}</Text>
                <Text style={text('caption')}>{best}</Text>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  grow: { flex: 1 },
  head: { borderBottomWidth: 1, borderBottomColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'center' },
  item: { minHeight: tapTarget.min + 4, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: palette.border },
  itemOn: { backgroundColor: palette.lime },
});
