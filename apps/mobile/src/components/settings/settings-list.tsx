import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ChevronIcon } from './icons';

/**
 * Settings' plain lists (approved Settings board, 2026-11-19): a small uppercase group title, then rows with dividers,
 * the whole row tappable, a grey value and a chevron on the right.
 */
export function SettingsGroup({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const { text, space } = useTheme();
  return (
    <View testID={testID}>
      <Text style={[text('caption'), styles.groupTitle, { paddingHorizontal: space[1], paddingBottom: space[1] }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

export function SettingsRow({
  label,
  value,
  onPress,
  testID,
  danger = false,
  accessory,
  dimmed = false,
}: {
  label: string;
  value?: string | null;
  /** Without it the row is plain text (the version). */
  onPress?: () => void;
  testID: string;
  danger?: boolean;
  /** Shown instead of the value and chevron (the kg / lb switch). */
  accessory?: ReactNode;
  dimmed?: boolean;
}) {
  const { text, space } = useTheme();
  const body = (
    <>
      <Text style={[text('sectionHeading'), styles.label, danger && styles.danger, dimmed && styles.dim]}>{label}</Text>
      {accessory ?? (
        <>
          {value ? (
            <Text style={[text('body'), styles.value, dimmed && styles.dim]} testID={`${testID}-value`}>
              {value}
            </Text>
          ) : null}
          {onPress ? <ChevronIcon size={16} /> : null}
        </>
      )}
    </>
  );
  const frame = [styles.row, { gap: space[3], paddingHorizontal: space[1] }];
  if (!onPress) {
    return (
      <View style={frame} testID={testID} accessible={!accessory} accessibilityLabel={value ? `${label}, ${value}` : label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [...frame, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/** The grey circle ‹ that goes back exactly one step (the Patterns board), or to `fallback` when there is nothing behind. */
export function BackCircle({ label, fallback, testID }: { label: string; fallback: Href; testID: string }) {
  // The app's one back control (grey circle ‹), so Settings pages look like every other page.
  return <BackButton testID={testID} accessibilityLabel={label} fallback={fallback} />;
}

import { BackButton } from '@/components/ui/nav-buttons';

const styles = StyleSheet.create({
  groupTitle: { textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { borderTopWidth: 1, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 54, borderBottomWidth: 1, borderBottomColor: palette.border },
  label: { flex: 1, fontSize: 16 },
  value: { color: palette.inkMuted },
  danger: { color: palette.danger },
  dim: { opacity: 0.55 },
  pressed: { opacity: pressedOpacity },
});
