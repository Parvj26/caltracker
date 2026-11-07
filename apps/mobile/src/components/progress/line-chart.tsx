import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { ChartModel } from '@/lib/progress';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const HEIGHT = 120;
const PAD = 8;
const DOT = 8;
const LINE = 2;

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * One small line chart drawn with plain views (no graphics library, so no new native code). Time runs across, the
 * value up. VoiceOver skips the drawing and reads one sentence: the latest value, the change and the number of
 * points. The first and last dates and the high and low values are printed as text too.
 */
export function LineChart({ chart }: { chart: ChartModel }) {
  const { text, space } = useTheme();
  const [width, setWidth] = useState(0);
  const pts = chart.points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const t0 = dayNumber(first.date);
  const t1 = dayNumber(last.date);
  const values = pts.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const yLo = lo - span * 0.1;
  const yHi = hi + span * 0.1;
  const inner = Math.max(width - 2 * PAD, 1);
  const x = (d: string) => PAD + ((dayNumber(d) - t0) / (t1 - t0 || 1)) * inner;
  const y = (v: number) => PAD + (1 - (v - yLo) / (yHi - yLo)) * (HEIGHT - 2 * PAD);
  const xy = pts.map((p) => ({ x: x(p.date), y: y(p.value) }));

  return (
    <View testID={`chart-${chart.key}`} accessible accessibilityLabel={chart.summary} style={{ gap: space[2] }}>
      <View style={styles.read}>
        <Text style={text('sectionHeading')}>{last.text}</Text>
        <Text style={text('caption')}>{last.label}</Text>
      </View>
      <View style={styles.plotRow}>
        <View style={styles.yLabels} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={text('caption')}>{hi}</Text>
          <Text style={text('caption')}>{lo}</Text>
        </View>
        <View style={[styles.plot, { height: HEIGHT }]} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0
            ? xy.slice(1).map((b, i) => {
                const a = xy[i];
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                const angle = Math.atan2(b.y - a.y, b.x - a.x);
                return (
                  <View
                    key={pts[i + 1].date}
                    style={[
                      styles.segment,
                      {
                        width: len,
                        left: (a.x + b.x) / 2 - len / 2,
                        top: (a.y + b.y) / 2 - LINE / 2,
                        transform: [{ rotate: `${angle}rad` }],
                      },
                    ]}
                  />
                );
              })
            : null}
          {width > 0
            ? xy.map((p, i) => (
                <View
                  key={pts[i].date}
                  style={[styles.dot, { left: p.x - DOT / 2, top: p.y - DOT / 2 }, i === xy.length - 1 && styles.dotLast]}
                />
              ))
            : null}
        </View>
      </View>
      <View style={styles.xLabels} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={text('caption')}>{first.label}</Text>
        <Text style={text('caption')}>{last.label}</Text>
      </View>
      {chart.change ? <Text style={text('body')}>{chart.change}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  read: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  plotRow: { flexDirection: 'row', gap: 8 },
  yLabels: { justifyContent: 'space-between', minWidth: 36 },
  plot: { flex: 1, backgroundColor: palette.surface, borderRadius: 8, overflow: 'hidden' },
  segment: { position: 'absolute', height: LINE, backgroundColor: palette.ink },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: palette.ink },
  dotLast: { backgroundColor: palette.magenta },
  xLabels: { flexDirection: 'row', justifyContent: 'space-between' },
});
