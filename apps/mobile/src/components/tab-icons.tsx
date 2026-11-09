import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { palette } from '@/theme/theme';

// The tab bar icons (approved TabIcons board, option A): bold outline icons, grey when inactive; the active tab's
// icon sits in a lime pill with an ink outline. Coach is option B's clipboard drawn in the same outline style.
// Decorative: the tab button carries the label.

export type TabIconName = 'today' | 'workouts' | 'coach' | 'food' | 'progress';

function Glyph({ name }: { name: TabIconName }) {
  switch (name) {
    case 'today':
      return (
        <>
          <Circle cx={12} cy={12} r={4} />
          <Path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
        </>
      );
    case 'workouts':
      return <Path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />;
    case 'coach':
      return (
        <>
          <Rect x={5} y={4.5} width={14} height={16.5} rx={2.5} />
          <Rect x={9} y={2.5} width={6} height={4} rx={1.2} />
          <Path d="M8.5 11.5h7M8.5 15.5h5" />
        </>
      );
    case 'food':
      return (
        <>
          <Path d="M12 7c-1-2-3-3-5-2.5C4 5.2 3 8.5 4 12c1 3.5 3.5 7.5 6 7.5 1 0 1.3-.5 2-.5s1 .5 2 .5c2.5 0 5-4 6-7.5 1-3.5 0-6.8-3-7.5-2-.5-4 .5-5 2.5z" />
          <Path d="M12 7c0-2 1-3.5 3-4" />
        </>
      );
    case 'progress':
      return (
        <>
          <Path d="M3 17l6-6 4 4 8-8" />
          <Path d="M15 7h6v6" />
        </>
      );
  }
}

export function TabIcon({ name, focused }: { name: TabIconName; focused: boolean }) {
  const size = focused ? 24 : 26;
  return (
    <View style={[styles.slot, focused && styles.pill]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={focused ? palette.ink : palette.inkMuted}
        strokeWidth={focused ? 2.4 : 2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Glyph name={name} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { width: 56, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  pill: { backgroundColor: palette.lime, borderWidth: 2, borderColor: palette.ink },
});
