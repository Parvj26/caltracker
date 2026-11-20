import { Image, Modal, Pressable, StyleSheet } from 'react-native';
import { MenuSheet } from '@/components/ui/menu-sheet';
import { palette } from '@/theme/theme';

export type Choice = { label: string; testID: string; onPress: () => void; destructive?: boolean };

/** A bottom sheet of choices: the app's one menu sheet (see MenuSheet). */
export function ChoiceSheet({ title, choices, onClose }: { title: string | null; choices: Choice[]; onClose: () => void }) {
  return <MenuSheet title={title} items={choices} onClose={onClose} cancelTestID="sheet-cancel" />;
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
  viewer: { flex: 1, backgroundColor: palette.ink, justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
});
