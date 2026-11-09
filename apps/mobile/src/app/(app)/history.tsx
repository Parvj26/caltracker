import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { localToday } from '@caltracker/shared';
import { Button, Card, ErrorText, Screen } from '@/components/ui';
import { fetchHistory, readCachedHistory } from '@/lib/history-api';
import { useSession } from '@/lib/session';
import { useCachedLoad } from '@/lib/use-cached-load';
import { useUnits } from '@/lib/use-units';
import { historyRow, monthSummary, type CurrentCoach, type HistoryRow } from '@/lib/workout-history';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { fontFamilyFor } from '@/theme/fonts';
import { ChevronIcon } from '@/components/ui/icons';

const LOAD_FAILED = 'Couldn’t load your history. Check your connection and pull down to try again.';

/** The client's finished workouts, newest first, under this month's summary. Opens from the saved copy offline. */
export default function History() {
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  const units = useUnits() ?? 'lb';
  // The phone can't read the coach's user id yet (get_my_coach returns only the name), so a coach-logged workout
  // reads "Logged by your coach" rather than naming someone who may not have logged it.
  const coach: CurrentCoach | null = null;
  const [refreshKey, setRefreshKey] = useState(0);
  const history = useCachedLoad(
    userId && workspaceId ? `${userId}.${workspaceId}` : null,
    () => (userId && workspaceId ? readCachedHistory(userId, workspaceId) : Promise.resolve(null)),
    () => (userId && workspaceId ? fetchHistory(userId, workspaceId) : Promise.reject(new Error('signed out'))),
    refreshKey,
  );
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const data = history.data;
  const summary = data ? monthSummary(data.logs, data.prs, localToday(), timeZone) : null;
  const rows = data ? data.logs.map((l) => historyRow(l, units, coach, timeZone)) : [];
  const back = () => (router.canGoBack() ? router.back() : router.replace('/workouts'));

  return (
    <Screen refreshing={history.refreshing} onRefresh={() => setRefreshKey((k) => k + 1)}>
      <View style={[styles.row, { gap: space[2] }]}>
        <Pressable
          testID="back"
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel="Back to Workouts"
          style={({ pressed }) => [styles.back, { borderRadius: radius.pill }, pressed && styles.pressed]}
        >
          <ChevronIcon direction="left" />
        </Pressable>
        <Text style={[text('screenTitle'), styles.title]} accessibilityRole="header">
          History
        </Text>
      </View>

      {history.status === 'loading' && !data ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
      {history.status === 'offline' && !data ? (
        <Card>
          <ErrorText>{LOAD_FAILED}</ErrorText>
          <Button variant="secondary" title="Try again" onPress={() => setRefreshKey((k) => k + 1)} />
        </Card>
      ) : null}
      {history.status === 'offline' && data ? (
        <Text style={text('caption')}>No connection. This is your history as last saved on your phone.</Text>
      ) : null}

      {summary && data ? (
        <View testID="history-month" style={[styles.month, { borderRadius: radius.card, padding: space[4], gap: space[2.5] }]}>
          <Text style={[text('caption'), styles.overline]}>{summary.title}</Text>
          <View style={[styles.row, { gap: space[2] }]}>
            <Stat value={String(summary.workouts)} label={summary.workouts === 1 ? 'workout' : 'workouts'} />
            <Stat value={summary.time} label="training" />
            <Stat value={String(summary.prs)} label={summary.prs === 1 ? 'new PR' : 'new PRs'} />
          </View>
          {data.streak > 0 ? (
            <Text style={[text('sectionHeading'), styles.ink]}>{`🔥 ${data.streak}-week streak`}</Text>
          ) : null}
        </View>
      ) : null}

      {data && rows.length === 0 ? (
        <Text style={[text('body'), styles.muted]}>No finished workouts yet. They show here once you finish one.</Text>
      ) : null}

      {rows.length > 0 ? (
        <View style={{ gap: space[2] }}>
          {rows.map((r) => (
            <LogRow key={r.id} row={r} onPress={() => router.push({ pathname: '/log/[id]/summary', params: { id: r.id } })} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const { text } = useTheme();
  return (
    <View style={styles.flex} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={[text('bigNumber'), styles.ink]}>{value}</Text>
      <Text style={[text('caption'), styles.ink, styles.bold]}>{label}</Text>
    </View>
  );
}

function LogRow({ row, onPress }: { row: HistoryRow; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  return (
    <Pressable
      testID={`history-row-${row.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      accessibilityHint="Opens the workout summary"
      style={({ pressed }) => [
        styles.row,
        styles.logRow,
        { borderRadius: radius.button, paddingHorizontal: space[3.5], paddingVertical: space[3], gap: space[3] },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.dateCol}>
        <Text style={[text('caption'), styles.bold]}>{row.dow}</Text>
        <Text style={[text('sectionHeading'), styles.dayNum]}>{row.num}</Text>
      </View>
      <View style={[styles.flex, { gap: 2 }]}>
        <Text style={text('sectionHeading')}>{row.name}</Text>
        <Text style={text('caption')}>{row.meta}</Text>
      </View>
      {row.pr ? (
        <View style={[styles.pr, { borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 3 }]}>
          <Text style={[text('caption'), styles.ink, styles.heavy]}>PR</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  pressed: { opacity: pressedOpacity },
  back: {
    width: tapTarget.min,
    height: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  title: { fontSize: 28 },
  ink: { color: palette.ink },
  muted: { color: palette.inkMuted },
  bold: { fontFamily: fontFamilyFor('sans', 700) },
  heavy: { fontFamily: fontFamilyFor('sans', 800) },
  overline: { color: palette.ink, fontFamily: fontFamilyFor('sans', 700), textTransform: 'uppercase', letterSpacing: 0.6 },
  month: { backgroundColor: palette.lime, borderWidth: borderWidth.card, borderColor: palette.ink },
  logRow: { minHeight: 60, borderWidth: borderWidth.card, borderColor: palette.border },
  dateCol: { width: tapTarget.min, alignItems: 'center' },
  dayNum: { fontSize: 18, fontFamily: fontFamilyFor('sans', 800) },
  pr: { backgroundColor: palette.tape, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink },
});
