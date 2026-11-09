import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { DEFAULT_PUSH_PREFS, withType, type PushPrefs } from '@caltracker/shared';
import { ChevronIcon } from '@/components/settings/icons';
import { TimeOptionsSheet } from '@/components/settings/time-options-sheet';
import { Button, ErrorText, Screen } from '@/components/ui';
import { clockLabel, prefsEditable, prefsNote, settingsSections, type SettingsRow, type TimeField } from '@/lib/notification-settings-logic';
import { usePush } from '@/lib/use-push';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const TIME_TITLES: Record<TimeField, string> = {
  reminderTime: 'Reminder time',
  quietStart: 'Quiet hours from',
  quietEnd: 'Quiet hours to',
};

/**
 * Settings -> Notifications: a switch per notification type, the daily reminder time and quiet hours (approved
 * Notifications board). When iOS has notifications off for the app, a banner says so and opens iPhone Settings (or
 * asks, the first time). Changes save at once and are put back if saving fails.
 */
export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const { permission, requestPermission, prefs, prefsSource, updatePrefs } = usePush();
  const editable = prefsEditable(prefsSource);
  const note = prefsNote(prefsSource);
  const [editing, setEditing] = useState<TimeField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = prefs ?? DEFAULT_PUSH_PREFS;

  const save = (next: PushPrefs) => {
    setError(null);
    updatePrefs(next).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Couldn’t save. Try again.'));
  };

  const toggle = (row: SettingsRow) => {
    if (row.kind === 'switch') save(withType(current, row.type, !row.on));
    else if (row.kind === 'quiet') save({ ...current, quietEnabled: !row.on });
  };

  return (
    <Screen>
      <View style={[styles.row, { gap: space[2] }]}>
        <Pressable
          testID="notifications-settings-back"
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <ChevronIcon direction="left" />
        </Pressable>
        <Text style={text('screenTitle')} accessibilityRole="header">
          Notifications
        </Text>
      </View>

      {permission !== null && permission !== 'granted' ? (
        <View
          testID="notifications-off-banner"
          style={[styles.banner, { borderRadius: radius.button, padding: space[4], gap: space[2] }]}
        >
          <Text style={text('sectionHeading')}>Notifications are off for CalTracker on this iPhone.</Text>
          <View style={styles.start}>
            <Button
              variant="secondary"
              testID="notifications-open-settings"
              title={permission === 'undetermined' ? 'Turn on notifications' : 'Open iPhone Settings'}
              onPress={() => {
                if (permission === 'undetermined') void requestPermission();
                else void Linking.openSettings();
              }}
            />
          </View>
        </View>
      ) : null}

      {error ? <ErrorText testID="notifications-error">{error}</ErrorText> : null}
      {note ? (
        <Text style={text('caption')} testID="notifications-prefs-note">
          {note}
        </Text>
      ) : null}

      {settingsSections(current).map((section) => (
        <View key={section.title} style={{ gap: space[1] }}>
          <Text style={[text('caption'), styles.groupTitle, { paddingHorizontal: space[1] }]} accessibilityRole="header">
            {section.title}
          </Text>
          <View style={[styles.group, { borderRadius: radius.card }]}>
            {section.rows.map((row, i) => (
              <SettingsRowView
                key={row.kind === 'switch' ? row.type : row.kind === 'time' ? row.field : 'quiet'}
                row={row}
                last={i === section.rows.length - 1}
                disabled={!editable}
                onToggle={() => toggle(row)}
                onTime={(field) => setEditing(field)}
              />
            ))}
          </View>
        </View>
      ))}

      <Text style={[text('caption'), { paddingHorizontal: space[1] }]}>
        During quiet hours, notifications wait until the morning. Lock-screen alerts say who and what, never the message itself.
      </Text>

      <TimeOptionsSheet
        title={editing ? TIME_TITLES[editing] : ''}
        value={editing ? current[editing] : null}
        visible={editing !== null}
        onClose={() => setEditing(null)}
        onPick={(time) => {
          if (editing) save({ ...current, [editing]: time });
          setEditing(null);
        }}
      />
    </Screen>
  );
}

function SettingsRowView({
  row,
  last,
  disabled,
  onToggle,
  onTime,
}: {
  row: SettingsRow;
  last: boolean;
  disabled: boolean;
  onToggle: () => void;
  onTime: (field: TimeField) => void;
}) {
  const { text, space } = useTheme();
  const label = (
    <View style={[styles.flex, { gap: 2 }]}>
      <Text style={text('sectionHeading')}>{row.label}</Text>
      {row.hint ? <Text style={text('caption')}>{row.hint}</Text> : null}
    </View>
  );
  const frame = [styles.item, { gap: space[3], paddingHorizontal: space[4] }, !last && styles.divider];
  if (row.kind === 'time') {
    return (
      <Pressable
        testID={`notif-time-${row.field}`}
        accessibilityRole="button"
        accessibilityLabel={`${row.label}, ${clockLabel(row.value)}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onTime(row.field)}
        style={({ pressed }) => [...frame, (pressed || disabled) && styles.pressed]}
      >
        {label}
        <Text style={text('sectionHeading')}>{clockLabel(row.value)}</Text>
        <ChevronIcon size={16} />
      </Pressable>
    );
  }
  return (
    <Pressable
      testID={row.kind === 'switch' ? `notif-switch-${row.type}` : 'notif-switch-quiet'}
      accessibilityRole="switch"
      accessibilityLabel={row.label}
      accessibilityState={{ checked: row.on, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [...frame, (pressed || disabled) && styles.pressed]}
    >
      {label}
      <View style={[styles.track, row.on ? styles.trackOn : styles.trackOff]}>
        <View style={styles.knob} />
      </View>
    </Pressable>
  );
}

const TRACK_W = 52;
const TRACK_H = 32;
const KNOB = 22;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  start: { alignSelf: 'flex-start' },
  back: {
    width: tapTarget.min,
    height: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  pressed: { opacity: pressedOpacity },
  banner: { backgroundColor: palette.celebrateBg, borderWidth: borderWidth.card, borderColor: palette.ink },
  groupTitle: { textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { borderWidth: borderWidth.card, borderColor: palette.ink, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: 6 },
  divider: { borderBottomWidth: 1, borderBottomColor: palette.border },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  trackOn: { backgroundColor: palette.lime, alignItems: 'flex-end' },
  trackOff: { backgroundColor: palette.surface, alignItems: 'flex-start' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: palette.ink },
});
