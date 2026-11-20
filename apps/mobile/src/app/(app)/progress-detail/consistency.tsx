import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { UPDATING, consistencyWeeks, localToday, monthCalendar, plannedDoneCount, streakWords } from '@caltracker/shared';
import { InkCard, LoadState, Overline, SectionHeader, StatBox } from '@/components/progress/parts';
import { Screen } from '@/components/ui';
import { addedDays, trainedDays } from '@/lib/progress-hub-logic';
import { useProgressFacts } from '@/lib/use-progress-facts';
import { usePullRefresh } from '@/lib/use-progress-data';
import { palette, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const BAR_MAX = 80;
const BAR_STEP = 16;
/** The small gap between bars and calendar days. */
const GAP = 6;

/**
 * Consistency: planned workouts done as counts ("1 of 1", never a bare 100%), the streak now and the best one, workouts per week over 8 weeks (black
 * when every planned one was done, lime when some were), and this month's calendar (only days with a workout are filled; past rest days stay plain). No red and no "missed": a rest day
 * is just rest.
 */
export default function ConsistencyScreen() {
  const { text, space, radius } = useTheme();
  const pull = usePullRefresh();
  const { facts, hub, album } = useProgressFacts(pull.refreshKey);
  const today = localToday();

  const view = useMemo(() => {
    const h = hub.data;
    if (!h || !facts.streak) return null;
    const trained = trainedDays(h);
    return {
      planned: plannedDoneCount(h.workouts, addedDays(h), today, trained[0] ?? null),
      streak: facts.streak,
      words: streakWords(facts.streak, trained.length > 0),
      weeks: consistencyWeeks(h.workouts, addedDays(h), today),
      calendar: monthCalendar(trained, today),
    };
  }, [hub.data, facts.streak, today]);

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space[3.5] }}>
        <SectionHeader title="Consistency" offline={(hub.status === 'offline' && hub.data !== null) || album.status === 'offline'} />
        <LoadState status={hub.status} hasData={hub.data !== null} onRetry={pull.onRefresh} busy={pull.refreshing} />
        {view ? (
          <>
            <View style={[styles.row, { gap: space[2] }]}>
              <StatBox
                tone="lime"
                value={facts.updating ? UPDATING : view.planned ? `${view.planned.done} of ${view.planned.planned}` : '–'}
                label="planned done"
                sub={facts.updating ? null : (view.planned?.since ?? null)}
                testID="consistency-percent"
              />
              <StatBox
                value={facts.updating ? UPDATING : view.streak.current > 0 ? `${view.streak.current} wk` : 'New'}
                label={view.streak.current > 0 || facts.updating ? 'streak now' : 'journey'}
                testID="consistency-streak"
              />
              <StatBox value={`${view.streak.best} wk`} label="best streak" testID="consistency-best" />
            </View>
            {!facts.updating && view.words.line ? (
              <Text style={text('body')} testID="consistency-journey">
                {view.words.line}
              </Text>
            ) : null}

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
                          d.trained ? styles.dayDone : null,
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
  // Every day carries today's border width (transparent), so today's ring doesn't widen its column.
  day: { height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: borderWidth.card, borderColor: 'transparent' },
  dayDone: { backgroundColor: palette.ink },
  today: { borderWidth: borderWidth.card, borderColor: palette.magenta },
  small: { fontSize: 13 },
  onInk: { color: white },
  muted: { color: palette.inkMuted },
});
