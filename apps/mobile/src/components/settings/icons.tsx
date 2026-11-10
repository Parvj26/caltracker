import Svg, { Path } from 'react-native-svg';
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
