import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { palette } from '@/theme/theme';

// Line icons for the Coach tab (from the approved mockups). Decorative: the button around each one carries the label.
const stroke = { fill: 'none', stroke: palette.ink, strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2.2 } as const;
const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no' } as const;

export function ChatIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke} {...hidden}>
      <Path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </Svg>
  );
}

export function PeopleIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke} {...hidden}>
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <Circle cx={17} cy={9} r={2.5} />
      <Path d="M16 14.2a5 5 0 0 1 5.5 4.8" />
    </Svg>
  );
}

export function CameraIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke} {...hidden}>
      <Rect x={3} y={6} width={18} height={14} rx={3} />
      <Circle cx={12} cy={13} r={3.5} />
      <Path d="M9 6l1.5-2h3L15 6" />
    </Svg>
  );
}
