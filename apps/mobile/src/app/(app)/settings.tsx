import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { Units } from '@caltracker/shared';
import { BackCircle, SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { Button, ErrorText, Screen } from '@/components/ui';
import { appleHealthStatus } from '@/lib/apple-health-logic';
import { useAppleHealth } from '@/lib/apple-health-sync';
import { coachFirstName } from '@/lib/coach-tab';
import { HELP_LEGAL_ROWS } from '@/lib/help-legal';
import { NOTIFICATION_GROUPS, groupState, groupTitle, notificationsPaused } from '@/lib/notification-settings-logic';
import { appRelease, openHelpLegal } from '@/lib/open-help-legal';
import { useSession } from '@/lib/session';
import { SIGN_OUT_QUESTION, accountInitials, accountLine } from '@/lib/settings-logic';
import { signOutAndForget } from '@/lib/sign-out';
import { fetchFullName, readCachedFullName } from '@/lib/today-api';
import { useCachedLoad } from '@/lib/use-cached-load';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { usePush } from '@/lib/use-push';
import { useSaveUnits, useUnits } from '@/lib/use-units';
import type { ShownError } from '@/lib/error-shown';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * Settings (approved Settings board, 2026-11-19), a screen of its own so Back from Notifications, Apple Health or
 * Privacy comes back here (one step). The account (name, email, coach), then ACCOUNT (kg/lb, Privacy & delete
 * account), CONNECTIONS (Apple Health), NOTIFICATIONS (three groups, "Paused" with a way to iPhone Settings while iOS
 * has them off), HELP (help, terms & privacy, version) and Sign out, which asks first. Delete account lives under
 * Privacy, away from Sign out.
 */
export default function SettingsScreen() {
  const { text, space } = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const email = session?.user.email ?? null;
  const coach = coachFirstName(useCoachProfile()?.name) ?? null;
  const name = useCachedLoad(
    userId,
    () => (userId ? readCachedFullName(userId) : Promise.resolve(null)),
    () => (userId ? fetchFullName(userId) : Promise.resolve(null)),
    0,
  ).data;
  const { prefs, permission, requestPermission } = usePush();
  const paused = notificationsPaused(permission);
  const health = useAppleHealth();

  const confirmSignOut = () =>
    Alert.alert(SIGN_OUT_QUESTION, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOutAndForget() },
    ]);

  const openLegal = () =>
    Alert.alert('Terms & privacy policy', undefined, [
      ...HELP_LEGAL_ROWS.filter((r) => r.key !== 'help').map((r) => ({ text: r.label, onPress: () => void openHelpLegal(r) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  const help = HELP_LEGAL_ROWS.find((r) => r.key === 'help');

  return (
    <Screen>
      <View style={{ gap: space[2.5] }}>
        <View style={styles.start}>
          <BackCircle testID="settings-close" label="Back to Today" fallback="/today" />
        </View>
        <Text style={text('screenTitle')} accessibilityRole="header">
          Settings
        </Text>
      </View>

      <View style={[styles.account, { gap: space[3] }]} testID="settings-account" accessible accessibilityLabel={[name, accountLine(email, coach)].filter(Boolean).join(', ')}>
        <View style={styles.avatar}>
          <Text style={text('sectionHeading')} maxFontSizeMultiplier={1.4}>
            {accountInitials(name, email)}
          </Text>
        </View>
        <View style={styles.flex}>
          {name ? (
            <Text style={[text('sectionHeading'), styles.name]} testID="settings-name">
              {name}
            </Text>
          ) : null}
          <Text style={[text('body'), styles.muted]} testID="settings-workspace">
            {accountLine(email, coach)}
          </Text>
        </View>
      </View>

      <SettingsGroup title="Account">
        <SettingsRow testID="settings-units" label="Units" accessory={<UnitsSwitch />} />
        <SettingsRow testID="settings-privacy-delete" label="Privacy & delete account" onPress={() => router.push('/privacy')} />
      </SettingsGroup>

      {health.available && health.state ? (
        <SettingsGroup title="Connections">
          <SettingsRow
            testID="settings-apple-health"
            label="Apple Health"
            value={health.state.enabled ? appleHealthStatus(health.state, new Date()) : 'Connect'}
            onPress={() => router.push('/apple-health')}
          />
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={paused ? 'Notifications · off in iPhone Settings' : 'Notifications'} testID="settings-notifications-group">
        {paused ? (
          <SettingsRow
            testID="settings-notifications-open"
            label={permission === 'undetermined' ? 'Turn on notifications' : 'Turn on in iPhone Settings'}
            value={permission === 'undetermined' ? 'Turn on' : 'Open'}
            onPress={() => {
              if (permission === 'undetermined') void requestPermission();
              else void Linking.openSettings();
            }}
          />
        ) : null}
        {NOTIFICATION_GROUPS.map((g, i) => (
          <SettingsRow
            key={g}
            // The first group keeps the old row's id, so flows that open Notifications still find it.
            testID={i === 0 ? 'settings-notifications' : `settings-notifications-${g}`}
            label={groupTitle(g, coach)}
            value={groupState(prefs, permission, g)}
            dimmed={paused}
            onPress={() => router.push('/notifications')}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="Help">
        {help ? <SettingsRow testID="settings-help" label="Help & contact" onPress={() => void openHelpLegal(help)} /> : null}
        <SettingsRow testID="settings-legal" label="Terms & privacy policy" onPress={openLegal} />
        <SettingsRow testID="settings-version" label="Version" value={appRelease()} />
      </SettingsGroup>

      <View style={{ paddingTop: space[2] }}>
        <Button variant="secondary" title="Sign out" testID="sign-out" onPress={confirmSignOut} />
      </View>
    </Screen>
  );
}

/** kg / lb on the Units row: saves as soon as one is tapped. Selected = white pill with an ink border (UI rules §2.3). */
function UnitsSwitch() {
  const { text, space, radius } = useTheme();
  const units = useUnits();
  const save = useSaveUnits();
  const [error, setError] = useState<ShownError | null>(null);
  if (!units) return null;
  const pick = async (next: Units) => {
    if (next === units) return;
    setError(null);
    try {
      await save(next);
    } catch {
      setError({ code: 'units_save_failed' });
    }
  };
  return (
    <View style={{ gap: space[1], alignItems: 'flex-end' }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Weight units" style={[styles.segments, { borderRadius: radius.pill, padding: 3 }]}>
        {(['kg', 'lb'] as const).map((u) => {
          const on = u === units;
          return (
            <Pressable
              key={u}
              testID={`units-${u}`}
              onPress={() => void pick(u)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
              style={({ pressed }) => [styles.segment, { borderRadius: radius.pill, paddingHorizontal: space[4] }, on && styles.segmentOn, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={text('sectionHeading')}>{u}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
    </View>
  );
}

const AVATAR = 52;

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start' },
  flex: { flex: 1 },
  account: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: palette.drop, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18 },
  muted: { color: palette.inkMuted },
  segments: { flexDirection: 'row', backgroundColor: palette.surface },
  segment: { minHeight: tapTarget.min, minWidth: tapTarget.min + 12, alignItems: 'center', justifyContent: 'center', borderWidth: borderWidth.secondaryButton, borderColor: 'transparent' },
  segmentOn: { backgroundColor: white, borderColor: palette.ink },
});
