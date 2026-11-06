import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { Button, useReduceMotion } from '@/components/ui';
import { formatEarned, type AlbumItem } from '@/lib/album-logic';
import { SAVE_MESSAGES, saveCardToPhotos } from '@/lib/save-image';
import { palette, stickerTheme } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { OffScreen, ShareCard } from './share-card';
import { Sticker } from './sticker';

/** The sheet for one sticker: big art, name, fun fact, first earned date, ×N and shiny, plus Save image. */
export function StickerSheet({ item, onClose }: { item: AlbumItem | null; onClose: () => void }) {
  const { text, space, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  const card = useRef<HostInstance>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const close = () => {
    setNote(null);
    onClose();
  };
  const save = async () => {
    setSaving(true);
    setNote(null);
    const r = await saveCardToPhotos(card);
    setNote(SAVE_MESSAGES[r]);
    setSaving(false);
  };

  return (
    <Modal visible={item !== null} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
      {item ? (
        <View style={[styles.sheet, { padding: space[6], gap: space[3], borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]} testID="sticker-sheet">
          <View style={styles.center}>
            <Sticker stickerKey={item.key} size={stickerTheme.sheetSize} shiny={item.shiny} />
          </View>
          <Text style={[text('screenTitle'), styles.centerText]} accessibilityRole="header" testID="sheet-name">
            {item.name}
          </Text>
          <Text style={[text('body'), styles.centerText]} testID="sheet-fact">
            {item.fact}
          </Text>
          <Text style={[text('caption'), styles.centerText]} testID="sheet-meta">
            {[
              item.firstEarnedAt ? `First earned ${formatEarned(item.firstEarnedAt)}` : null,
              `×${item.count}`,
              item.shiny ? '✦ Shiny' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {note ? (
            <Text style={[text('caption'), styles.centerText]} testID="sheet-save-note" accessibilityLiveRegion="polite">
              {note}
            </Text>
          ) : null}
          <Button variant="secondary" title="Save image" testID="sheet-save" busy={saving} onPress={() => void save()} />
          <Button title="Close" testID="sheet-close" onPress={close} />
          <OffScreen>
            <ShareCard
              ref={card}
              stickerKey={item.key}
              shiny={item.shiny}
              line={item.shiny ? `✦ Shiny ${item.name}` : item.name}
              subline={item.firstEarnedAt ? `First earned ${formatEarned(item.firstEarnedAt)}` : null}
            />
          </OffScreen>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: palette.ink, opacity: stickerTheme.scrimOpacity },
  sheet: { backgroundColor: palette.bg },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
});
