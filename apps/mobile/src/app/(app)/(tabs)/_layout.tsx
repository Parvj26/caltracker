import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { borderWidth, radius, space, typeScale } from '@caltracker/design-tokens';
import { fontFamilyFor } from '@/theme/fonts';
import { palette } from '@/theme/theme';

/** Simple drawn icons (no icon font yet): a sun-like dot for Today, a small calendar for Workouts. */
function TodayIcon({ color }: { color: ColorValue }) {
  return <View style={[styles.todayIcon, { borderColor: color }]} />;
}

function WorkoutsIcon({ color }: { color: ColorValue }) {
  return (
    <View style={[styles.calendarIcon, { borderColor: color }]}>
      <View style={[styles.calendarBar, { backgroundColor: color }]} />
    </View>
  );
}

/** A small rising line: three bars of growing height. */
function ProgressIcon({ color }: { color: ColorValue }) {
  return (
    <View style={styles.barsIcon}>
      {[0.4, 0.7, 1].map((h) => (
        <View key={h} style={[styles.bar, { height: space[4.5] * h, backgroundColor: color }]} />
      ))}
    </View>
  );
}

// The other tabs in the spec (Messages, Community, Me) arrive with their phases.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.ink,
        tabBarInactiveTintColor: palette.inkMuted,
        tabBarShowLabel: true,
        tabBarStyle: { backgroundColor: palette.bg, borderTopColor: palette.border },
        // Caption size at section-heading weight, so short labels stay readable. Colour comes from the tint.
        tabBarLabelStyle: {
          fontFamily: fontFamilyFor('sans', typeScale.sectionHeading.weight),
          fontSize: typeScale.caption.size.phone,
        },
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{ title: 'Today', tabBarButtonTestID: 'tab-today', tabBarIcon: ({ color }) => <TodayIcon color={color} /> }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: 'Workouts',
          tabBarButtonTestID: 'tab-workouts',
          tabBarIcon: ({ color }) => <WorkoutsIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarButtonTestID: 'tab-progress',
          tabBarIcon: ({ color }) => <ProgressIcon color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  todayIcon: { width: space[4.5], height: space[4.5], borderRadius: radius.pill, borderWidth: borderWidth.card },
  calendarIcon: {
    width: space[4.5],
    height: space[4.5],
    borderRadius: space[1],
    borderWidth: borderWidth.card,
    overflow: 'hidden',
  },
  barsIcon: { width: space[4.5], height: space[4.5], flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { flex: 1, borderRadius: 1 },
  calendarBar: { height: space[1] },
});
