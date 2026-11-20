import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { METRIC_RANGES, METRIC_RANGE_LABELS, formatMetricValue, formatShortDate, localToday, type MetricEntry, type MetricKey, type MetricRange } from '@caltracker/shared';
import { AppleHealthConnect } from '@/components/metrics/apple-health-connect';
import { LogMetricSheet } from '@/components/metrics/log-metric-sheet';
import { HeartTile, LinkRow, Sparkline } from '@/components/metrics/parts';
import { LoadState, OfflineNote, SectionHeader, Segmented } from '@/components/progress/parts';
import { Screen, TextButton } from '@/components/ui';
import { CloseButton } from '@/components/ui/nav-buttons';
import { appleHealthStatus, type AppleHealthMetric } from '@/lib/apple-health-logic';
import { useAppleHealth, useAppleHealthDataChanged } from '@/lib/apple-health-sync';
import { PRINTOUT_FAILED, printoutUrl } from '@/lib/body-api';
import { clientEditKind, earlierEntries, metricRows, metricSourceLabel, type MetricRow } from '@/lib/metrics-view';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useBody, useMetrics, usePullRefresh } from '@/lib/use-progress-data';
import { useSession } from '@/lib/session';
import { useUnits } from '@/lib/use-units';
import { contentMaxWidth, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const HISTORY_SHOWN = 8;

/**
 * Metrics (approved "Client app · Metrics" board): "+ Log", Connect Apple Health (or its status once connected), the
 * range, one row per metric (latest value in the client's units, a trend line, the change over the range and where the
 * latest came from), and the coach's latest InBody scan with its printout. Tapping a row opens its entries, where the
 * client's own can be changed or deleted.
 */
export default function MetricsScreen() {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  const { workspace } = useSession();
  const units = useUnits();
  const coach = useCoachProfile();
  const coachFirst = coach?.name.split(' ')[0] ?? null;
  const pull = usePullRefresh();
  const [savedKey, setSavedKey] = useState(0);
  const reload = useCallback(() => setSavedKey((k) => k + 1), []);
  useAppleHealthDataChanged(reload);
  const metrics = useMetrics(pull.refreshKey + savedKey);
  const body = useBody(pull.refreshKey + savedKey);
  const health = useAppleHealth();
  const [range, setRange] = useState<MetricRange>('3m');
  const [open, setOpen] = useState<MetricKey | null>(null);
  const [sheet, setSheet] = useState<{ key: MetricKey; editing: MetricEntry | null } | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const today = localToday();
  const entries = metrics.data;

  const rows = useMemo(() => (entries && units ? metricRows(entries, range, units, today, coachFirst) : null), [entries, units, range, today, coachFirst]);

  // The coach's newest scan (from the body tables, which hold the printout).
  const lastScan = useMemo(() => body.data?.scans.find((s) => s.source === 'coach' && (s.attachmentPath !== null || Object.keys(s.values).some((k) => k !== 'weight_kg'))) ?? null, [body.data]);

  async function openPrintout(path: string) {
    try {
      await Linking.openURL(await printoutUrl(path));
    } catch {
      Alert.alert(PRINTOUT_FAILED);
    }
  }

  async function connect(types: Record<AppleHealthMetric, boolean>) {
    await health.connect(types);
    setConnectOpen(false);
  }

  const healthOn = health.state?.enabled === true;

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space[3.5] }}>
        <SectionHeader
          title="Metrics"
          right={
            <Pressable
              testID="metric-log-open"
              accessibilityRole="button"
              accessibilityLabel="Log a metric"
              onPress={() => setSheet({ key: 'weight_kg', editing: null })}
              style={({ pressed }) => [styles.create, { borderRadius: radius.pill, paddingHorizontal: space[4.5] }, pressed && styles.pressed]}
            >
              <Text style={text('sectionHeading')}>+ Log</Text>
            </Pressable>
          }
        />

        {health.available && health.state ? (
          healthOn ? (
            <LinkRow
              testID="apple-health-row"
              icon={<HeartTile />}
              title="Apple Health connected"
              sub={health.state.sawData || health.state.lastSyncAt === null ? appleHealthStatus(health.state, new Date()) : 'No readings found yet'}
              onPress={() => router.push('/apple-health')}
            />
          ) : (
            <LinkRow
              testID="apple-health-row"
              icon={<HeartTile />}
              title="Connect Apple Health"
              sub="Fill in weight, body fat, VO2 max and more automatically"
              onPress={() => setConnectOpen(true)}
            />
          )
        ) : null}

        {metrics.status === 'offline' && entries ? <OfflineNote show /> : null}
        <LoadState status={metrics.status} hasData={entries !== null} onRetry={pull.onRefresh} busy={pull.refreshing} />

        {rows ? (
          <>
            <Segmented
              label="Time range"
              testIDPrefix="range"
              options={METRIC_RANGES.map((r) => ({ key: r, label: METRIC_RANGE_LABELS[r] }))}
              value={range}
              onChange={setRange}
            />
            <View style={styles.rows}>
              {rows.map((r) => (
                <MetricRowView
                  key={r.key}
                  row={r}
                  expanded={open === r.key}
                  onToggle={() => (r.latest ? setOpen((k) => (k === r.key ? null : r.key)) : setSheet({ key: r.key, editing: null }))}
                  history={open === r.key && entries ? earlierEntries(entries, r.key, r.latest) : []}
                  onEdit={(e) => setSheet({ key: e.metricKey, editing: e })}
                  coachFirst={coachFirst}
                  today={today}
                />
              ))}
            </View>
          </>
        ) : null}

        {lastScan ? (
          <View style={[styles.row, { gap: space[3], paddingVertical: space[2] }]} testID="last-scan">
            <View style={styles.flex}>
              <Text style={text('sectionHeading')}>Latest InBody scan</Text>
              <Text style={text('caption')}>{`${formatShortDate(lastScan.measuredOn, today)} · added by ${coachFirst ?? 'your coach'}`}</Text>
            </View>
            {lastScan.attachmentPath ? (
              <Pressable
                testID="view-printout"
                accessibilityRole="button"
                accessibilityLabel={`View printout from ${formatShortDate(lastScan.measuredOn, today)}`}
                onPress={() => void openPrintout(lastScan.attachmentPath!)}
                style={({ pressed }) => [styles.outline, { borderRadius: radius.pill, paddingHorizontal: space[4] }, pressed && styles.pressed]}
              >
                <Text style={text('sectionHeading')}>View printout</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <LogMetricSheet
        visible={sheet !== null}
        workspaceId={workspace?.workspaceId ?? null}
        units={units}
        entries={entries ?? []}
        coachFirstName={coachFirst}
        initialKey={sheet?.key ?? 'weight_kg'}
        editing={sheet?.editing ?? null}
        onClose={() => setSheet(null)}
        onSaved={reload}
      />

      <Modal visible={connectOpen} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={() => setConnectOpen(false)}>
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={[styles.column, { padding: space[4], gap: space[2] }]}>
            <View style={styles.end}>
              <CloseButton testID="health-close" onPress={() => setConnectOpen(false)} />
            </View>
            <AppleHealthConnect coachFirstName={coachFirst} initial={health.state?.types} onContinue={connect} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

function MetricRowView({
  row,
  expanded,
  onToggle,
  history,
  onEdit,
  coachFirst,
  today,
}: {
  row: MetricRow;
  expanded: boolean;
  onToggle: () => void;
  history: MetricEntry[];
  onEdit: (e: MetricEntry) => void;
  coachFirst: string | null;
  today: string;
}) {
  const { text, space } = useTheme();
  const units = useUnits();
  const [all, setAll] = useState(false);
  const shown = all ? history : history.slice(0, HISTORY_SHOWN);
  const said = row.latest ? `${row.label}: ${row.value} ${row.unit}, ${row.meta}${row.change ? `, change ${row.change}` : ''}` : `${row.label}: not logged yet. Log it`;
  return (
    <View style={styles.divider}>
      <Pressable
        testID={`metric-row-${row.key}`}
        accessibilityRole="button"
        accessibilityLabel={said}
        accessibilityState={row.latest ? { expanded } : undefined}
        onPress={onToggle}
        style={({ pressed }) => [styles.row, styles.metricRow, { gap: space[3], paddingVertical: space[3.5] }, pressed && styles.pressed]}
      >
        <View style={[styles.flex, { gap: 2 }]}>
          <Text style={[text('sectionHeading'), styles.muted]}>{row.label}</Text>
          {row.latest ? (
            <>
              <View style={[styles.baseline, { gap: space[1] }]}>
                <Text style={text('bigNumber')} testID={`metric-value-${row.key}`}>
                  {row.value}
                </Text>
                <Text style={[text('sectionHeading'), styles.muted]}>{row.unit}</Text>
              </View>
              <Text style={text('caption')} testID={`metric-meta-${row.key}`}>
                {row.meta}
              </Text>
            </>
          ) : (
            <Text style={[text('body'), styles.muted]} testID={`metric-meta-${row.key}`}>
              {row.meta}
            </Text>
          )}
        </View>
        <View style={[styles.right, { gap: space[1] }]}>
          {row.latest ? <Sparkline points={row.points} /> : null}
          <Text style={text('sectionHeading')} testID={`metric-change-${row.key}`}>
            {row.latest ? (row.change ?? '') : '+ Log'}
          </Text>
        </View>
      </Pressable>
      {expanded && units ? (
        <View style={{ paddingBottom: space[3], gap: space[1] }} testID={`metric-history-${row.key}`}>
          {/* The latest reading is the row above; only its Edit shows here. */}
          {row.latest && clientEditKind(row.latest) ? (
            <View style={[styles.row, styles.entry, { gap: space[2.5] }]}>
              <Text style={[text('caption'), styles.flex]}>Your latest entry</Text>
              <Pressable
                testID={`metric-edit-${row.latest.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Change or delete your latest ${row.label}`}
                onPress={() => row.latest && onEdit(row.latest)}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <Text style={[text('body'), styles.underline]}>Edit</Text>
              </Pressable>
            </View>
          ) : null}
          {history.length > 0 ? <Text style={[text('caption'), styles.muted]}>Earlier</Text> : null}
          {history.length === 0 && !(row.latest && clientEditKind(row.latest)) ? <Text style={text('caption')}>No earlier entries.</Text> : null}
          {shown.map((e) => {
            const mine = clientEditKind(e) !== null;
            const when = e.measuredOn === today ? 'Today' : formatShortDate(e.measuredOn, today);
            return (
              <View key={`${e.origin}-${e.id}-${e.metricKey}`} style={[styles.row, styles.entry, { gap: space[2.5] }]} testID={`metric-entry-${e.id}`}>
                <View style={styles.flex}>
                  <Text style={text('sectionHeading')}>{formatMetricValue(e.metricKey, e.value, units)}</Text>
                  <Text style={text('caption')}>{`${when} · ${metricSourceLabel(e, coachFirst)}`}</Text>
                </View>
                {mine ? (
                  <Pressable
                    testID={`metric-edit-${e.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Change or delete ${row.label} from ${when}`}
                    onPress={() => onEdit(e)}
                    style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                  >
                    <Text style={[text('body'), styles.underline]}>Edit</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {history.length > HISTORY_SHOWN && !all ? <TextButton testID={`metric-more-${row.key}`} title={`Show all ${history.length}`} onPress={() => setAll(true)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  baseline: { flexDirection: 'row', alignItems: 'baseline' },
  rows: { borderTopWidth: 1, borderTopColor: palette.border },
  divider: { borderBottomWidth: 1, borderBottomColor: palette.border },
  metricRow: { minHeight: 76 },
  right: { alignItems: 'flex-end' },
  muted: { color: palette.inkMuted },
  entry: { minHeight: tapTarget.min },
  action: { minHeight: tapTarget.min, minWidth: tapTarget.min, justifyContent: 'center', alignItems: 'flex-end' },
  underline: { textDecorationLine: 'underline' },
  create: { minHeight: tapTarget.min, justifyContent: 'center', backgroundColor: palette.lime, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink },
  outline: { minHeight: tapTarget.min, justifyContent: 'center', borderWidth: borderWidth.secondaryButton, borderColor: palette.ink },
  pressed: { opacity: pressedOpacity },
  sheet: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  end: { alignItems: 'flex-end' },
});
