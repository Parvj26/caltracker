import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, TextButton, useReduceMotion } from '@/components/ui';
import { palette, stickerTheme } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export type LogChoice = 'camera' | 'library' | 'macros';

/** "Log a meal": take a photo, choose one, or type the macros. */
export function LogMealSheet({ visible, onPick, onClose }: { visible: boolean; onPick: (c: LogChoice) => void; onClose: () => void }) {
  const { text, space, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[styles.sheet, { padding: space[6], gap: space[3], borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}
        testID="log-meal-sheet"
      >
        <Text style={text('screenTitle')} accessibilityRole="header">
          Log a meal
        </Text>
        <Button title="Take photo" testID="log-meal-camera" onPress={() => onPick('camera')} />
        <Button title="Choose photo" variant="secondary" testID="log-meal-library" onPress={() => onPick('library')} />
        <Button title="Enter macros" variant="secondary" testID="log-meal-macros" onPress={() => onPick('macros')} />
        <TextButton title="Cancel" testID="log-meal-cancel" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: palette.ink, opacity: stickerTheme.scrimOpacity },
  sheet: { backgroundColor: palette.bg },
});
