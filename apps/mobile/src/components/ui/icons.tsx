import Svg, { Path } from 'react-native-svg';
import { palette } from '@/theme/theme';

// Line icons drawn the way the approved mockups draw them. Bricolage's own ‹ › ↺ glyphs render tiny, so standalone
// arrows use these. Decorative: the button around each one carries the label.
const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no' } as const;

export function ChevronIcon({ size = 20, direction = 'right' }: { size?: number; direction?: 'left' | 'right' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...hidden}>
      <Path d={direction === 'right' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
    </Svg>
  );
}

/** A clock with a turning arrow, for History. */
export function HistoryIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...hidden}>
      <Path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <Path d="M3 3v5h5" />
      <Path d="M12 7v5l3 2" />
    </Svg>
  );
}
