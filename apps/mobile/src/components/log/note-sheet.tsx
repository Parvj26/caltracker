import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextField } from '@/components/ui';
import { SheetHeader } from '@/components/ui/nav-buttons';
import { closeAsking } from '@/lib/use-discard-guard';
import { contentMaxWidth, palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const NOTE_MAX = 500;

/** Write or clear the client's note on an exercise (up to 500 characters). */
export function NoteSheet({
  exerciseName,
  initial,
  onSave,
  onClose,
}: {
  /** Null hides the sheet. */
  exerciseName: string | null;
  initial: string;
  onSave: (note: string | null) => void;
  onClose: () => void;
}) {
  const { space } = useTheme();
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial, exerciseName]);

  const dirty = draft.trim() !== initial.trim();
  const close = () => closeAsking(dirty, onClose);

  return (
    <Modal visible={exerciseName !== null} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!dirty} onRequestClose={close}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.column, { padding: space[4], gap: space[4] }]}>
          <SheetHeader title={`Note · ${exerciseName ?? ''}`} closeTestID="note-cancel" onClose={close} />
          <TextField
            label="Your note"
            testID="note-input"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={NOTE_MAX}
            autoFocus
            hint={`${draft.length} / ${NOTE_MAX}`}
          />
          <Button
            testID="note-save"
            title="Save note"
            onPress={() => {
              const t = draft.trim();
              onSave(t === '' ? null : t);
            }}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
});
