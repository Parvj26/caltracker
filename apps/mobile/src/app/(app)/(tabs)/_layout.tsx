import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';
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

// The other tabs in the spec (Progress, Messages, Community, Me) arrive with their phases.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.ink,
        tabBarInactiveTintColor: palette.inkMuted,
        tabBarShowLabel: true,
        tabBarStyle: { backgroundColor: palette.bg, borderTopColor: palette.border },
        tabBarLabelStyle: { fontFamily: fontFamilyFor('sans', 700), fontSize: 12 },
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
    </Tabs>
  );
}

const styles = StyleSheet.create({
  todayIcon: { width: 20, height: 20, borderRadius: 10, borderWidth: 2.5 },
  calendarIcon: { width: 20, height: 19, borderRadius: 4, borderWidth: 2.5, overflow: 'hidden' },
  calendarBar: { height: 4 },
});
