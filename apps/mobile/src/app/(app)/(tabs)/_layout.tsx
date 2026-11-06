import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { borderWidth, radius, space, typeScale } from '@caltracker/design-tokens';
import { fontFamilyFor } from '@/theme/fonts';
import { useUnreadCount } from '@/lib/use-messages';
import { palette, white } from '@/theme/theme';

// Files are discovered alphabetically (coach.tsx first), so a bare navigation into the tabs would open Coach. Today is home.
export const unstable_settings = { initialRouteName: 'today' };

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

/** A speech bubble: a rounded box with a small tail. */
function CoachIcon({ color }: { color: ColorValue }) {
  return (
    <View>
      <View style={[styles.bubbleIcon, { borderColor: color }]} />
      <View style={[styles.bubbleTail, { backgroundColor: color }]} />
    </View>
  );
}

// The other tabs in the spec (Progress, Messages, Community, Me) arrive with their phases.
export default function TabsLayout() {
  const unread = useUnreadCount();
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
        name="coach"
        options={{
          title: 'Coach',
          tabBarButtonTestID: 'tab-coach',
          tabBarIcon: ({ color }) => <CoachIcon color={color} />,
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: palette.magenta, color: white },
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
  bubbleIcon: { width: space[4.5], height: space[3.5] + 2, borderRadius: space[1], borderWidth: borderWidth.card },
  bubbleTail: { position: 'absolute', left: space[2], bottom: -2, width: space[1] + 2, height: space[1] + 2, transform: [{ rotate: '45deg' }] },
  calendarBar: { height: space[1] },
});
