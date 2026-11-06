import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReduceMotion } from '@/components/ui';
import { palette, pressedOpacity, stickerTheme } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export type Choice = { label: string; testID: string; onPress: () => void; destructive?: boolean };

/** A bottom sheet of choices (works the same on iOS and Android, unlike Alert's 3-button limit on Android). */
export function ChoiceSheet({ title, choices, onClose }: { title: string | null; choices: Choice[]; onClose: () => void }) {
  const { text, space, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={title !== null} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { padding: space[6], gap: space[2], borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
        {title ? (
          <Text style={text('sectionHeading')} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {choices.map((c) => (
          <Pressable
            key={c.testID}
            testID={c.testID}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              // Let the sheet finish closing first: iOS won't show an alert over a closing sheet.
              setTimeout(c.onPress, 350);
            }}
            style={({ pressed }) => [styles.row, { paddingVertical: space[3] }, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[text('body'), c.destructive && styles.destructive]}>{c.label}</Text>
          </Pressable>
        ))}
        <Pressable
          testID="sheet-cancel"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.row, { paddingVertical: space[3] }, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={text('sectionHeading')}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** A photo full size, on tap. */
export function PhotoViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  return (
    <Modal visible={url !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewer} onPress={onClose} accessibilityLabel="Close photo" testID="photo-viewer">
        {url ? <Image source={{ uri: url }} style={styles.full} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: palette.ink, opacity: stickerTheme.scrimOpacity },
  sheet: { backgroundColor: palette.bg },
  row: { minHeight: 44, justifyContent: 'center' },
  destructive: { color: palette.magentaDeep },
  viewer: { flex: 1, backgroundColor: palette.ink, justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
});
