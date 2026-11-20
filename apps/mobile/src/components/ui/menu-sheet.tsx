import { Fragment, useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontFamilyFor } from '@/theme/fonts';
import { palette, pressedOpacity, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useReduceMotion } from './button';

export type MenuSheetItem = {
  label: string;
  testID: string;
  onPress: () => void;
  /** Block, Delete, Remove: red text. The action itself asks to confirm. */
  destructive?: boolean;
};

/** Rows are at least this tall (Patterns board: "full-width rows ≥ 52 pt"). */
export const MENU_ROW_MIN = 52;

/**
 * The one menu for every ⋯ (Patterns board): a rounded sheet from the bottom with full-width rows, destructive rows
 * in red, then a separate Cancel row. Tapping outside or Cancel closes it. The chosen action runs once the sheet has
 * gone, because iOS cannot show another sheet or an alert while one is still closing.
 */
export function MenuSheet({
  title,
  items,
  onClose,
  cancelTestID = 'menu-cancel',
}: {
  /** Null hides the menu; an empty string shows it without a heading. */
  title: string | null;
  items: MenuSheetItem[];
  onClose: () => void;
  cancelTestID?: string;
}) {
  const { text, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  const choose = (action: () => void) => {
    pending.current = action;
    onClose();
    // onDismiss is iOS only.
    if (Platform.OS !== 'ios') runPending();
  };
  const groupRadius = { borderRadius: radius.input + 2 };
  return (
    <Modal
      visible={title !== null}
      transparent
      animationType={reduceMotion ? 'fade' : 'slide'}
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
        <View style={styles.inner}>
          <View style={[styles.group, groupRadius]}>
            {title ? (
              <Text style={[text('caption'), styles.title]} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {items.map((item, i) => (
              <Fragment key={item.testID}>
                {i > 0 || title ? <View style={styles.divider} /> : null}
                <Pressable
                  testID={item.testID}
                  accessibilityRole="button"
                  onPress={() => choose(item.onPress)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <Text style={[text('sectionHeading'), item.destructive && styles.destructive]}>{item.label}</Text>
                </Pressable>
              </Fragment>
            ))}
          </View>
          <Pressable
            testID={cancelTestID}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.group, groupRadius, styles.row, styles.cancel, pressed && styles.pressed]}
          >
            <Text style={[text('sectionHeading'), styles.cancelText]}>Cancel</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.inkMuted },
  sheet: { backgroundColor: palette.surface },
  inner: { padding: space[2], gap: space[2] },
  group: { backgroundColor: palette.bg, overflow: 'hidden' },
  title: { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[2] },
  divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: palette.border },
  row: { minHeight: MENU_ROW_MIN, justifyContent: 'center', paddingHorizontal: space[4], paddingVertical: space[3] },
  cancel: { alignItems: 'center' },
  cancelText: { fontFamily: fontFamilyFor('sans', 800) },
  destructive: { color: palette.danger },
  pressed: { opacity: pressedOpacity },
});
