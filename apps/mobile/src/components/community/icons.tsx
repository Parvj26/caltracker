import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { palette } from '@/theme/theme';

// Line icons for the community screens. Decorative: the button around each one carries the label.
const stroke = { fill: 'none', stroke: palette.ink, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function BackIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function BellIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </Svg>
  );
}

export function PhotoIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} accessibilityElementsHidden importantForAccessibility="no">
      <Rect x={3} y={5} width={18} height={14} rx={3} />
      <Circle cx={9} cy={10} r={1.6} />
      <Path d="M21 16l-5-5-8 8" />
    </Svg>
  );
}

export function PinIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M12 17v5" />
      <Path d="M5 17h14l-2-5V4H7v8z" />
    </Svg>
  );
}
