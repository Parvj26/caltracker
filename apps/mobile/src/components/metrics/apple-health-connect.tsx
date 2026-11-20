import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { METRIC_CATALOGUE } from '@caltracker/shared';
import { Button, ErrorText } from '@/components/ui';
import { APPLE_HEALTH_METRICS, APPLE_HEALTH_NOTES, defaultAppleHealthState, type AppleHealthMetric } from '@/lib/apple-health-logic';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { HeartTile, SwitchRow } from './parts';

/**
 * "Bring in your numbers from Apple Health" (approved Connect Apple Health board): what it does, a switch per metric
 * (muscle mass comes from InBody scans only), the privacy line, and Continue, which shows the iOS prompt for only the
 * switched-on metrics. Nothing is asked before Continue is tapped.
 */
export function AppleHealthConnect({
  coachFirstName,
  initial,
  onContinue,
}: {
  coachFirstName: string | null;
  initial?: Record<AppleHealthMetric, boolean>;
  onContinue: (types: Record<AppleHealthMetric, boolean>) => Promise<void>;
}) {
  const { text, space } = useTheme();
  const [types, setTypes] = useState(initial ?? defaultAppleHealthState().types);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const none = APPLE_HEALTH_METRICS.every((m) => !types[m]);

  async function go() {
    if (busy || none) return;
    setBusy(true);
    setFailed(false);
    try {
      await onContinue(types);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space[4] }}>
      <View style={{ gap: space[2.5] }}>
        <HeartTile size={56} tint={palette.dangerBg} />
        <Text style={text('screenTitle')} accessibilityRole="header">
          Bring in your numbers from Apple Health
        </Text>
        <Text style={text('body')}>
          {`New readings from your scale, watch or other apps show up in Metrics on their own. ${coachFirstName ?? 'Your coach'} sees them too.`}
        </Text>
      </View>
      <View style={styles.list}>
        {APPLE_HEALTH_METRICS.map((m) => (
          <SwitchRow
            key={m}
            testID={`health-switch-${m}`}
            label={METRIC_CATALOGUE[m].label}
            note={APPLE_HEALTH_NOTES[m]}
            on={types[m]}
            onToggle={() => setTypes((t) => ({ ...t, [m]: !t[m] }))}
          />
        ))}
        <SwitchRow testID="health-switch-smm_kg" label="Muscle mass" note="Comes from InBody scans only" on={false} disabled onToggle={() => undefined} last />
      </View>
      <Text style={text('caption')}>
        Only these numbers are read. Nothing is written to Apple Health. You can turn this off any time in Settings or in iPhone Settings › Health.
      </Text>
      {failed ? <ErrorText code="save_failed">Could not connect Apple Health. Try again.</ErrorText> : null}
      <View style={{ gap: space[2] }}>
        <Button testID="health-continue" title={none ? 'Pick at least one' : 'Continue'} onPress={() => void go()} busy={busy} disabled={none} />
        <Text style={[text('caption'), styles.centre]}>Next, iPhone asks you to allow access.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderTopWidth: 1, borderTopColor: palette.border },
  centre: { textAlign: 'center' },
});
