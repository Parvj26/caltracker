import { useRef } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextButton, type ButtonVariant } from '@/components/ui';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export type MenuItem = { title: string; testID: string; onPress: () => void; variant?: ButtonVariant };

/**
 * A sheet of choices from the bottom of the screen. Tapping outside or Cancel closes it. The chosen action runs
 * once the sheet has gone, because iOS cannot show another sheet or an alert while one is still closing.
 */
export function ActionMenu({
  title,
  items,
  onClose,
}: {
  /** Null hides the menu. */
  title: string | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  const { text, space, radius } = useTheme();
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const run = pending.current;
    pending.current = null;
    run?.();
  };
  const choose = (action: () => void) => {
    pending.current = action;
    onClose();
    if (Platform.OS !== 'ios') runPending(); // onDismiss is iOS only
  };
  return (
    <Modal
      visible={title !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
        <View style={{ gap: space[3], padding: space[4.5] }}>
          {title ? (
            <Text style={text('sectionHeading')} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {items.map((item) => (
            <Button
              key={item.testID}
              testID={item.testID}
              title={item.title}
              variant={item.variant ?? 'secondary'}
              onPress={() => choose(item.onPress)}
            />
          ))}
          <TextButton testID="menu-cancel" title="Cancel" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.inkMuted },
  sheet: { backgroundColor: palette.bg },
});
