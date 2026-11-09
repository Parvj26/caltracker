import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { tapTarget } from '@caltracker/design-tokens';
import { Button, TextButton } from '@/components/ui';
import { contentMaxWidth, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { UnitsPicker } from '@/components/units-picker';
import { useSaveUnits, useUnits } from '@/lib/use-units';

const GEAR =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z';

/** Today's header: the date, "Hi <name>", and a gear that opens the settings sheet (Sign out). */
export function TodayHeader({
  date,
  greeting,
  workspaceName,
  onSignOut,
}: {
  date: string;
  greeting: string;
  workspaceName: string;
  onSignOut: () => void;
}) {
  const { text, space } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.row, { gap: space[3] }]}>
      <View style={[styles.flex, { gap: space[1] }]}>
        <Text style={text('caption')} testID="today-date">
          {date}
        </Text>
        <Text style={text('screenTitle')} accessibilityRole="header" testID="today-greeting">
          {greeting}
        </Text>
      </View>
      <Pressable
        testID="today-settings"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Settings and sign out"
        style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
      >
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={12} cy={12} r={3} />
          <Path d={GEAR} />
        </Svg>
      </Pressable>
      <SettingsSheet visible={open} workspaceName={workspaceName} onClose={() => setOpen(false)} onSignOut={onSignOut} />
    </View>
  );
}

/** The settings sheet: kg/lb, who coaches you, and sign out. */
function SettingsSheet({
  visible,
  workspaceName,
  onClose,
  onSignOut,
}: {
  visible: boolean;
  workspaceName: string;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const { text, space } = useTheme();
  const units = useUnits();
  const saveUnits = useSaveUnits();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={[styles.column, styles.flex, { padding: space[4], gap: space[4] }]}>
          <View style={styles.row}>
            <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header">
              Settings
            </Text>
            <TextButton title="Close" testID="settings-close" onPress={onClose} />
          </View>
          {units ? <UnitsPicker units={units} onChange={saveUnits} /> : null}
          {workspaceName ? <Text style={text('body')} testID="settings-workspace">{`Coached by ${workspaceName}`}</Text> : null}
          {/* Sign out sits at the very bottom, away from everyday settings. */}
          <View style={styles.flex} />
          <Button
            variant="secondary"
            title="Sign out"
            testID="sign-out"
            onPress={() => {
              onClose();
              onSignOut();
            }}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  gear: {
    width: tapTarget.min,
    height: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  pressed: { opacity: pressedOpacity },
  sheet: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
});
