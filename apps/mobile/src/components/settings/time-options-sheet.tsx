import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import { TextButton } from '@/components/ui';
import { clockLabel, timeOptions } from '@/lib/notification-settings-logic';
import { contentMaxWidth, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const OPTIONS = timeOptions();
const ROW_HEIGHT = 56;

/** A list of times in 30-minute steps (no native picker needed). Opens scrolled to the current choice. */
export function TimeOptionsSheet({
  title,
  value,
  visible,
  onPick,
  onClose,
}: {
  title: string;
  value: string | null;
  visible: boolean;
  onPick: (time: string) => void;
  onClose: () => void;
}) {
  const { text, space } = useTheme();
  const selected = value ? value.slice(0, 5) : null;
  const index = Math.max(0, selected ? OPTIONS.indexOf(selected) : 0);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={[styles.column, styles.flex]}>
          <View style={[styles.header, { padding: space[4] }]}>
            <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header">
              {title}
            </Text>
            <TextButton title="Close" testID="time-options-close" onPress={onClose} />
          </View>
          <FlatList
            data={OPTIONS}
            keyExtractor={(t) => t}
            initialScrollIndex={Math.max(0, index - 3)}
            getItemLayout={(_, i) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * i, index: i })}
            renderItem={({ item }) => {
              const on = item === selected;
              return (
                <Pressable
                  testID={`time-option-${item}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [styles.option, { paddingHorizontal: space[4] }, pressed && styles.pressed]}
                >
                  <Text style={[text(on ? 'sectionHeading' : 'body'), styles.flex]}>{clockLabel(item)}</Text>
                  {on ? <Text style={text('sectionHeading')}>✓</Text> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: tapTarget.min },
  option: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  pressed: { opacity: pressedOpacity },
});
