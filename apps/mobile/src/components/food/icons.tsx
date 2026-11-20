import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { palette } from '@/theme/theme';

// Line icons for the food screens. Decorative: the button around each one carries the label.
const line = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no' } as const;

export function CameraIcon({ size = 20, color = palette.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...line} stroke={color} strokeWidth={2.2} {...hidden}>
      <Rect x={3} y={6} width={18} height={14} rx={3} />
      <Circle cx={12} cy={13} r={3.5} />
      <Path d="M9 6l1.5-2h3L15 6" />
    </Svg>
  );
}

export function PencilIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...line} stroke={palette.ink} strokeWidth={2.2} {...hidden}>
      <Path d="M4 20h4l10-10-4-4L4 16z" />
      <Path d="M13 7l4 4" />
    </Svg>
  );
}

export function ChevronIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...line} stroke={palette.ink} strokeWidth={2.4} {...hidden}>
      <Path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function BackIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...line} stroke={palette.ink} strokeWidth={2.4} {...hidden}>
      <Path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function SearchIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...line} stroke={palette.ink} strokeWidth={2.4} {...hidden}>
      <Circle cx={11} cy={11} r={7} />
      <Path d="M20 20l-3.5-3.5" />
    </Svg>
  );
}

export function BowlIcon({ size = 20, color = palette.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...line} stroke={color} strokeWidth={2.2} {...hidden}>
      <Path d="M4 11h16a8 8 0 0 1-16 0z" />
      <Path d="M8 7c0-1.5 1-2 1-3M12 7c0-1.5 1-2 1-3M16 7c0-1.5 1-2 1-3" />
    </Svg>
  );
}

export function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...line} stroke={palette.ink} strokeWidth={2.6} {...hidden}>
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function MoreIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={palette.ink} {...hidden}>
      <Circle cx={5} cy={12} r={2} />
      <Circle cx={12} cy={12} r={2} />
      <Circle cx={19} cy={12} r={2} />
    </Svg>
  );
}

export function CaretIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...line} stroke={palette.ink} strokeWidth={2.8} {...hidden}>
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}
