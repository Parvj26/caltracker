import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
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
});
