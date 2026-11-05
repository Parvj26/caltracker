import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextButton, TextField } from '@/components/ui';
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
  const { text, space } = useTheme();
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial, exerciseName]);

  return (
    <Modal visible={exerciseName !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.column, { padding: space[4], gap: space[4] }]}>
          <Text style={text('screenTitle')} accessibilityRole="header">
            {`Note · ${exerciseName ?? ''}`}
          </Text>
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
          <TextButton testID="note-cancel" title="Cancel" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
});
