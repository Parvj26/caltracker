import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { sectionLine, type ChoiceModel, type SectionPlace } from '@/lib/log-page-model';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ExerciseThumb } from './exercise-thumb';

/** Exercise name with its superset label (A1), the client's note, "Last time: …" and the exercise menu. */
export function ExerciseHeader({
  name,
  label,
  note,
  lastTime,
  swapped,
  menuTestID,
  detail,
  thumbTestID,
  nameTestID,
  onMenu,
  onInfo,
}: {
  name: string;
  /** "A1" inside a superset, null for straight sets. */
  label: string | null;
  note: string | null;
  /** "Last time: 135 lb × 8", or null to hide the line. */
  lastTime: string | null;
  swapped: boolean;
  menuTestID: string;
  /** Photos and instructions, once loaded (undefined shows the placeholder). */
  detail: ExerciseDetail | undefined;
  thumbTestID: string;
  nameTestID: string;
  onMenu: () => void;
  /** The name and thumbnail open the exercise info sheet; only ••• opens the menu. */
  onInfo: () => void;
}) {
  const { text, space, radius } = useTheme();
  return (
    <View style={{ gap: space[1] }}>
      <View style={[styles.row, { gap: space[2] }]}>
        {label ? (
          <View style={[styles.letterChip, { borderRadius: radius.pill, paddingHorizontal: space[2] }]}>
            <Text style={text('sectionHeading')}>{label}</Text>
          </View>
        ) : null}
        <ExerciseThumb name={name} detail={detail} testID={thumbTestID} onPress={onInfo} />
        <Pressable
          testID={nameTestID}
          onPress={onInfo}
          accessibilityRole="button"
          accessibilityHint="Opens exercise info"
          style={({ pressed }) => [styles.flex, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={text('sectionHeading')}>{name}</Text>
        </Pressable>
        <Pressable
          testID={menuTestID}
          onPress={onMenu}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`${name} options`}
          style={({ pressed }) => [styles.menu, { borderRadius: radius.pill }, pressed && styles.pressed]}
        >
          <Text style={text('sectionHeading')}>•••</Text>
        </Pressable>
      </View>
      {swapped ? <Text style={text('caption')}>Swapped in for this workout</Text> : null}
      {lastTime ? <Text style={text('caption')}>{lastTime}</Text> : null}
      {note ? <Text style={text('body')}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  letterChip: { backgroundColor: palette.lime },
  flex: { flex: 1 },
  menu: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: palette.surface },
  ink: { color: palette.ink },
  underline: { textDecorationLine: 'underline' },
  switch: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
});

/** "Core (Activation) · 1 of 2" above a page's name; nothing for a page with no section. testID section-line-{p}. */
export function SectionLine({ section, page }: { section: SectionPlace | null; page: number }) {
  const { text } = useTheme();
  if (!section) return null;
  return (
    <Text testID={`section-line-${page}`} style={text('caption')}>
      {sectionLine(section)}
    </Text>
  );
}

/**
 * "Picked from 2 options · Switch" under the name of a picked pick-one page. Switch (testID choice-switch) goes
 * back to the cards; it is gone once the pick is locked (the picked option has a done set). testID picked-line-{p}.
 */
export function PickedLine({ choice, page, onSwitch }: { choice: ChoiceModel | null; page: number; onSwitch: () => void }) {
  const { text, space } = useTheme();
  if (!choice?.pickedLine) return null;
  return (
    <View style={[styles.row, { gap: space[1] }]}>
      <Text testID={`picked-line-${page}`} style={text('caption')}>
        {choice.canSwitch ? `${choice.pickedLine} ·` : choice.pickedLine}
      </Text>
      {choice.canSwitch ? (
        <Pressable
          testID="choice-switch"
          onPress={onSwitch}
          accessibilityRole="button"
          accessibilityLabel="Switch exercise"
          accessibilityHint="Shows the options again"
          style={({ pressed }) => [styles.switch, { paddingHorizontal: space[1] }, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={[text('body'), styles.ink, styles.underline]}>Switch</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
