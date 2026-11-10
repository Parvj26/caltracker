import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { palette } from '@/theme/theme';

/** The bell of the Notifications row and the Today card. */
export function BellIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </Svg>
  );
}

export { ChevronIcon } from '@/components/ui/icons';

/** A question mark in a circle, for Help & feedback. */
export function HelpIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={9} />
      <Path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5" />
      <Path d="M12 17h.01" />
    </Svg>
  );
}

/** A padlock, for the Privacy policy. */
export function LockIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={5} y={11} width={14} height={9} rx={2} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

/** A page with lines, for the Terms of use. */
export function DocumentIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7 3h7l5 5v13H7z" />
      <Path d="M14 3v5h5M10 13h6M10 17h6" />
    </Svg>
  );
}
