import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import { METRIC_CATALOGUE } from '@caltracker/shared';
import { AppleHealthConnect } from '@/components/metrics/apple-health-connect';
import { HeartTile, SwitchRow } from '@/components/metrics/parts';
import { Button, ErrorText, Screen, TextButton } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/icons';
import { APPLE_HEALTH_METRICS, APPLE_HEALTH_NOTES, ASK_FAILED, appleHealthStatus } from '@/lib/apple-health-logic';
import { useAppleHealth } from '@/lib/apple-health-sync';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const REMOVE_FAILED = 'Could not remove the imported readings. Check your connection and try again.';

/**
 * Settings › Apple Health: connect (the same explainer as on Metrics), or once connected the sync status, a switch per
 * metric, Sync now and Turn off (optionally removing what was brought in). iOS never says if reading was refused, so
 * "no readings found" points to iPhone Settings.
 */
export default function AppleHealthScreen() {
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const coach = useCoachProfile();
  const coachFirst = coach?.name.split(' ')[0] ?? null;
  const health = useAppleHealth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = health.state;

  function turnOff() {
    Alert.alert('Turn off Apple Health?', 'New readings stop coming in. Readings already brought in stay, unless you remove them too.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off', onPress: () => void off(false) },
      { text: 'Turn off and remove imported readings', style: 'destructive', onPress: () => void off(true) },
    ]);
  }

  async function off(remove: boolean) {
    setError(null);
    try {
      await health.turnOff(remove);
    } catch {
      setError(REMOVE_FAILED);
    }
  }

  function removeImported() {
    Alert.alert('Remove imported readings?', 'This deletes every reading brought in from Apple Health. Nothing in Apple Health changes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove readings',
        style: 'destructive',
        onPress: () => {
          setError(null);
          health.removeImported().catch(() => setError(REMOVE_FAILED));
        },
      },
    ]);
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    try {
      await health.syncNow();
    } finally {
      setBusy(false);
    }
  }

  const noData = state?.enabled && state.lastSyncAt !== null && !state.sawData;

  return (
    <Screen>
      <View style={{ gap: space[4] }}>
        <View style={[styles.row, { gap: space[2] }]}>
          <Pressable
            testID="apple-health-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <ChevronIcon direction="left" />
          </Pressable>
          <Text style={text('screenTitle')} accessibilityRole="header">
            Apple Health
          </Text>
        </View>

        {!health.available ? (
          <Text style={text('body')} testID="apple-health-unavailable">
            Apple Health isn’t available on this device. You can still log your numbers in Progress › Metrics.
          </Text>
        ) : !state ? null : !state.enabled ? (
          <>
            <AppleHealthConnect coachFirstName={coachFirst} initial={state.types} onContinue={async (types) => void (await health.connect(types))} />
            <TextButton testID="apple-health-remove" title="Remove imported readings" onPress={removeImported} />
          </>
        ) : (
          <>
            <View style={[styles.row, { gap: space[3] }]}>
              <HeartTile tint={palette.dangerBg} />
              <View style={styles.flex}>
                <Text style={text('sectionHeading')}>Connected</Text>
                <Text style={text('caption')} testID="apple-health-status">
                  {noData ? 'No readings found yet' : appleHealthStatus(state, new Date())}
                </Text>
              </View>
            </View>
            {noData ? (
              <View style={[styles.note, { borderRadius: radius.card - 2, padding: space[3.5], gap: space[2] }]} testID="apple-health-no-data">
                <Text style={text('body')}>
                  Nothing came in from Apple Health yet. If you didn’t allow access, open iPhone Settings › Health › Data Access & Devices › CalTracker and
                  turn on the numbers you want.
                </Text>
                <TextButton testID="apple-health-settings" title="Open iPhone Settings" onPress={() => void Linking.openSettings()} />
              </View>
            ) : null}
            <View style={styles.list}>
              {APPLE_HEALTH_METRICS.map((m) => (
                <SwitchRow
                  key={m}
                  testID={`health-switch-${m}`}
                  label={METRIC_CATALOGUE[m].label}
                  note={APPLE_HEALTH_NOTES[m]}
                  on={state.types[m]}
                  onToggle={() => {
                    setError(null);
                    health.setMetric(m, !state.types[m]).catch((e: unknown) => setError(e instanceof Error ? e.message : ASK_FAILED));
                  }}
                />
              ))}
              <SwitchRow testID="health-switch-smm_kg" label="Muscle mass" note="Comes from InBody scans only" on={false} disabled onToggle={() => undefined} last />
            </View>
            <Text style={text('caption')}>Only these numbers are read. Nothing is written to Apple Health.</Text>
            {error ? <ErrorText code="metric_delete_failed">{error}</ErrorText> : null}
            <Button variant="secondary" testID="apple-health-sync" title="Sync now" onPress={() => void syncNow()} busy={busy} />
            <TextButton testID="apple-health-off" title="Turn off Apple Health" onPress={turnOff} />
          </>
        )}
        {error && !state?.enabled ? <ErrorText code="metric_delete_failed">{error}</ErrorText> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  back: { width: tapTarget.min, height: tapTarget.min, borderRadius: tapTarget.min / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
  pressed: { opacity: pressedOpacity },
  list: { borderTopWidth: 1, borderTopColor: palette.border },
  note: { backgroundColor: palette.celebrateBg },
});
