import { useState } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { palette } from '@/theme/theme';

export type ChartPoint = { x: number; y: number; label: string };

const H = 220;
const PAD = { top: 14, right: 18, bottom: 30, left: 58 };

/**
 * A small line chart drawn with react-native-svg and the palette. Tap near a point to pick it; with a screen reader
 * the chart is one adjustable element (swipe up or down to move between points) and reads the chosen point.
 */
export function LineChart({
  points,
  title,
  yLabel,
  xLabel,
  onPick,
  testID,
}: {
  points: readonly ChartPoint[];
  title: string;
  yLabel: (y: number) => string;
  xLabel: (x: number) => string;
  /** Called with the chosen point, so the screen can show its text. */
  onPick?: (index: number) => void;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(Math.max(points.length - 1, 0));
  const last = points.length - 1;
  const current = Math.min(active, Math.max(last, 0));
  if (points.length === 0) return null;

  const choose = (i: number) => {
    const next = Math.max(0, Math.min(last, i));
    setActive(next);
    onPick?.(next);
  };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
  const rawMin = Math.min(...ys);
  const rawMax = Math.max(...ys);
  const spread = rawMax - rawMin || Math.max(rawMax * 0.1, 1);
  const yMin = rawMin - spread * 0.15;
  const yMax = rawMax + spread * 0.15;
  const px = (x: number) => (xMax === xMin ? (PAD.left + width - PAD.right) / 2 : PAD.left + ((x - xMin) / (xMax - xMin)) * (width - PAD.left - PAD.right));
  const py = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');

  const onPress = (e: GestureResponderEvent) => {
    const tapX = e.nativeEvent.locationX;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(px(p.x) - tapX) < Math.abs(px(points[best].x) - tapX)) best = i;
    });
    choose(best);
  };

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} testID={testID}>
      {width > 0 ? (
        <Pressable
          onPress={onPress}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${title}. ${points.length} ${points.length === 1 ? 'point' : 'points'}.`}
          accessibilityValue={{ text: points[current].label }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => choose(current + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
        >
          <Svg width={width} height={H}>
            <Line x1={PAD.left} x2={width - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke={palette.border} strokeWidth={2} />
            <Line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke={palette.border} strokeWidth={2} />
            <SvgText x={PAD.left - 8} y={py(rawMax) + 4} fill={palette.inkMuted} fontSize={12} textAnchor="end">{yLabel(rawMax)}</SvgText>
            {rawMax !== rawMin ? (
              <SvgText x={PAD.left - 8} y={py(rawMin) + 4} fill={palette.inkMuted} fontSize={12} textAnchor="end">{yLabel(rawMin)}</SvgText>
            ) : null}
            <SvgText x={px(xMin)} y={H - 8} fill={palette.inkMuted} fontSize={12} textAnchor={xMax === xMin ? 'middle' : 'start'}>{xLabel(xMin)}</SvgText>
            {xMax !== xMin ? <SvgText x={px(xMax)} y={H - 8} fill={palette.inkMuted} fontSize={12} textAnchor="end">{xLabel(xMax)}</SvgText> : null}
            <Path d={path} fill="none" stroke={palette.ink} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <Circle
                key={i}
                cx={px(p.x)}
                cy={py(p.y)}
                r={i === current ? 7 : 4.5}
                fill={i === current ? palette.lime : palette.bg}
                stroke={palette.ink}
                strokeWidth={i === current ? 3 : 2.5}
              />
            ))}
          </Svg>
        </Pressable>
      ) : null}
    </View>
  );
}
