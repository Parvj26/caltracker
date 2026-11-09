import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { consistencyWeeks, localToday, monthCalendar, plannedDonePercent } from '@caltracker/shared';
import { InkCard, OfflineNote, Overline, SectionHeader, StatBox } from '@/components/progress/parts';
import { Screen } from '@/components/ui';
import { addedDays, trainedDays } from '@/lib/progress-hub-logic';
import { streakNow } from '@/lib/progress-view';
import { useAlbum, useHub, usePullRefresh } from '@/lib/use-progress-data';
import { palette, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const BAR_MAX = 80;
const BAR_STEP = 16;
/** The small gap between bars and calendar days. */
const GAP = 6;

/**
 * Consistency: share of planned workouts done, the streak now and the best one, workouts per week over 8 weeks (black
 * when every planned one was done, lime when some were), and this month's calendar. No red and no "missed": a rest day
 * is just rest.
 */
export default function ConsistencyScreen() {
  const { text, space, radius } = useTheme();
  const pull = usePullRefresh();
  const hub = useHub(pull.refreshKey);
  const album = useAlbum(pull.refreshKey);
  const today = localToday();

  const view = useMemo(() => {
    const h = hub.data;
    if (!h) return null;
    const trained = trainedDays(h);
    return {
      percent: plannedDonePercent(h.workouts, addedDays(h), today),
      streak: streakNow(album.data?.stats ?? null, trained, today),
      weeks: consistencyWeeks(h.workouts, addedDays(h), today),
      calendar: monthCalendar(trained, today),
    };
  }, [hub.data, album.data, today]);

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space[3.5] }}>
        <SectionHeader title="Consistency" />
        <OfflineNote show={hub.status === 'offline' || album.status === 'offline'} />
        {view ? (
          <>
            <View style={[styles.row, { gap: space[2] }]}>
              <StatBox tone="lime" value={view.percent === null ? '–' : `${view.percent}%`} label="planned done" testID="consistency-percent" />
              <StatBox value={`${view.streak.current} wk`} label="streak now" testID="consistency-streak" />
              <StatBox value={`${view.streak.best} wk`} label="best streak" testID="consistency-best" />
            </View>

            <InkCard>
              <Overline>Workouts per week · last 8 weeks</Overline>
              <View style={[styles.bars, { gap: GAP }]}>
                {view.weeks.map((w) => {
                  const h = w.state === 'rest' || w.done + w.extra === 0 ? 6 : Math.min(BAR_MAX, 18 + (w.done + w.extra) * BAR_STEP);
                  return (
                    <View key={w.monday} style={styles.barCol} accessible accessibilityRole="image" accessibilityLabel={w.label} testID={`week-${w.monday}`}>
                      <Text style={[text('caption'), styles.ink]}>{w.count}</Text>
                      <View
                        style={[
                          styles.bar,
                          { height: h, borderRadius: radius.input - 4 },
                          w.state === 'all' && styles.barAll,
                          w.state === 'some' && styles.barSome,
                          (w.state === 'none' || w.state === 'rest') && styles.barQuiet,
                        ]}
                      />
                      <Text style={text('caption')}>{w.short}</Text>
                    </View>
                  );
                })}
              </View>
              <View style={[styles.legend, { gap: space[3.5] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={[styles.row, { gap: GAP }]}>
                  <View style={[styles.swatch, styles.barAll]} />
                  <Text style={[text('caption'), styles.ink]}>All planned done</Text>
                </View>
                <View style={[styles.row, { gap: GAP }]}>
                  <View style={[styles.swatch, styles.barSome]} />
                  <Text style={[text('caption'), styles.ink]}>Some done</Text>
                </View>
              </View>
            </InkCard>

            <Text style={text('sectionHeading')} accessibilityRole="header">
              {`This month · ${view.calendar.title}`}
            </Text>
            <View style={{ gap: GAP }} testID="consistency-calendar">
              <View style={[styles.row, { gap: GAP }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {view.calendar.weekdays.map((d, i) => (
                  <Text key={i} style={[text('caption'), styles.cell, styles.center]}>
                    {d}
                  </Text>
                ))}
              </View>
              {view.calendar.rows.map((row) => (
                <View key={row[0].date} style={[styles.row, { gap: GAP }]}>
                  {row.map((d) =>
                    d.inMonth ? (
                      <View
                        key={d.date}
                        accessible
                        accessibilityRole="image"
                        accessibilityLabel={d.label}
                        style={[
                          styles.cell,
                          styles.day,
                          { borderRadius: radius.input },
                          d.trained ? styles.dayDone : d.future ? null : styles.dayPast,
                          d.isToday && styles.today,
                        ]}
                      >
                        <Text style={[text('sectionHeading'), styles.small, d.trained && styles.onInk, d.future && !d.trained && styles.muted]}>{String(d.day)}</Text>
                      </View>
                    ) : (
                      <View key={d.date} style={styles.cell} />
                    ),
                  )}
                </View>
              ))}
            </View>
            <Text style={text('caption')}>Filled days are workouts you did. Rest days are just rest.</Text>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: BAR_MAX + 44 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '100%' },
  barAll: { backgroundColor: palette.ink, borderWidth: borderWidth.card, borderColor: palette.ink },
  barSome: { backgroundColor: palette.lime, borderWidth: borderWidth.card, borderColor: palette.ink },
  barQuiet: { backgroundColor: palette.surface },
  legend: { flexDirection: 'row', flexWrap: 'wrap' },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  ink: { color: palette.ink },
  cell: { flex: 1 },
  center: { textAlign: 'center' },
  day: { height: 40, alignItems: 'center', justifyContent: 'center' },
  dayDone: { backgroundColor: palette.ink },
  dayPast: { backgroundColor: palette.surface },
  today: { borderWidth: borderWidth.card, borderColor: palette.magenta },
  small: { fontSize: 13 },
  onInk: { color: white },
  muted: { color: palette.inkMuted },
});
