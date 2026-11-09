import { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { SeriesPoint } from '@caltracker/shared';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const H = 150;
const PAD = 10;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * The weight trend: the smoothed line in ink over the single weigh-ins as faint dots. One element for VoiceOver,
 * read as `summary`; the first and last dates and the low and high values are printed as text too.
 */
export function WeightTrendChart({
  raw,
  trend,
  summary,
  firstLabel,
  lastLabel,
  lowLabel,
  highLabel,
  testID,
}: {
  /** Values already in the viewer's units. */
  raw: readonly SeriesPoint[];
  trend: readonly SeriesPoint[];
  summary: string;
  firstLabel: string;
  lastLabel: string;
  lowLabel: string;
  highLabel: string;
  testID?: string;
}) {
  const { text, space } = useTheme();
  const [width, setWidth] = useState(0);
  if (raw.length === 0) return null;
  const all = [...raw, ...trend];
  const t0 = Math.min(...all.map((p) => dayNumber(p.date)));
  const t1 = Math.max(...all.map((p) => dayNumber(p.date)));
  const lo = Math.min(...all.map((p) => p.value));
  const hi = Math.max(...all.map((p) => p.value));
  const span = hi - lo || 1;
  const yLo = lo - span * 0.1;
  const yHi = hi + span * 0.1;
  const x = (d: string) => (t1 === t0 ? width / 2 : PAD + ((dayNumber(d) - t0) / (t1 - t0)) * (width - 2 * PAD));
  const y = (v: number) => PAD + (1 - (v - yLo) / (yHi - yLo)) * (H - 2 * PAD);
  const path = trend.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={text('caption')}>{`High ${highLabel}`}</Text>
        <Text style={text('caption')}>{`Low ${lowLabel}`}</Text>
      </View>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height: H }}>
        {width > 0 ? (
          <Svg width={width} height={H}>
            <Line x1={0} x2={width} y1={H - 1} y2={H - 1} stroke={palette.border} strokeWidth={2} />
            {raw.map((p, i) => (
              <Circle key={`${p.date}-${i}`} cx={x(p.date)} cy={y(p.value)} r={4} fill={palette.blue} />
            ))}
            {trend.length > 1 ? (
              <Path d={path} fill="none" stroke={palette.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={text('caption')}>{firstLabel}</Text>
        <Text style={text('caption')}>{lastLabel}</Text>
      </View>
    </View>
  );
}
