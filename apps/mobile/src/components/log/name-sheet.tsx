import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextField } from '@/components/ui';
import { SheetHeader } from '@/components/ui/nav-buttons';
import { closeAsking } from '@/lib/use-discard-guard';
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

  const dirty = draft.trim() !== DEFAULT_UNPLANNED_NAME && draft.trim() !== '';
  const close = () => closeAsking(dirty, onClose);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!dirty} onRequestClose={close}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.column, { padding: space[4], gap: space[4] }]}>
          <SheetHeader title="Log a workout" closeTestID="unplanned-cancel" onClose={close} />
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
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
});
