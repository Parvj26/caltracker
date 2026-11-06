import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextButton, TextField } from '@/components/ui';
import { contentMaxWidth, palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const NAME_MAX = 100;
export const DEFAULT_UNPLANNED_NAME = 'Workout';

/** Names an unplanned workout before it starts ("Workout" unless the client types something else). */
export function NameSheet({
  visible,
  busy,
  onStart,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  onStart: (name: string) => void;
  onClose: () => void;
}) {
  const { text, space } = useTheme();
  const [draft, setDraft] = useState(DEFAULT_UNPLANNED_NAME);
  useEffect(() => {
    if (visible) setDraft(DEFAULT_UNPLANNED_NAME);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.column, { padding: space[4], gap: space[4] }]}>
          <Text style={text('screenTitle')} accessibilityRole="header">
            Log a workout
          </Text>
          <Text style={text('body')}>A blank workout: add the exercises as you go.</Text>
          <TextField
            label="Workout name"
            testID="unplanned-name"
            value={draft}
            onChangeText={setDraft}
            maxLength={NAME_MAX}
            autoFocus
            selectTextOnFocus
            returnKeyType="go"
            onSubmitEditing={() => onStart(draft.trim() || DEFAULT_UNPLANNED_NAME)}
          />
          <Button
            testID="unplanned-start"
            title="Start workout"
            busy={busy}
            onPress={() => onStart(draft.trim() || DEFAULT_UNPLANNED_NAME)}
          />
          <TextButton testID="unplanned-cancel" title="Cancel" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
});
