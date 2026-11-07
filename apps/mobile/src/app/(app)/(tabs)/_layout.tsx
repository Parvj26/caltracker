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

/** A tiny rising line made of three bars for Progress. */
function ProgressIcon({ color }: { color: ColorValue }) {
  return (
    <View style={styles.progressIcon}>
      {[0.4, 0.7, 1].map((h) => (
        <View key={h} style={[styles.progressBar, { backgroundColor: color, height: space[4.5] * h }]} />
      ))}
    </View>
  );
}

/** A plate seen from above for Food: a ring with a smaller ring inside. */
function FoodIcon({ color }: { color: ColorValue }) {
  return (
    <View style={[styles.plateIcon, { borderColor: color }]}>
      <View style={[styles.plateInner, { borderColor: color }]} />
    </View>
  );
}

// Today is the tab group's anchor: opening the group without naming a tab (a guard redirect, a deep link into a
// tab) starts on Today, not on whichever tab the router would pick.
// Food took the Zoo's place (2026-11-07); the Zoo book is now a screen opened from Progress (zooHref()).
// The other tabs in the spec (Community, Me) arrive with their phases.
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
      <Tabs.Screen
        name="food"
        options={{ title: 'Food', tabBarButtonTestID: 'tab-food', tabBarIcon: ({ color }) => <FoodIcon color={color} /> }}
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
  bubbleIcon: { width: space[4.5], height: space[3.5] + 2, borderRadius: space[1], borderWidth: borderWidth.card },
  bubbleTail: { position: 'absolute', left: space[2], bottom: -2, width: space[1] + 2, height: space[1] + 2, transform: [{ rotate: '45deg' }] },
  plateIcon: {
    width: space[4.5],
    height: space[4.5],
    borderRadius: radius.pill,
    borderWidth: borderWidth.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateInner: { width: space[2], height: space[2], borderRadius: radius.pill, borderWidth: 1 },
  progressIcon: { width: space[4.5], height: space[4.5], flexDirection: 'row', alignItems: 'flex-end', gap: space[1] },
  progressBar: { flex: 1, borderRadius: 1 },
  calendarBar: { height: space[1] },
});
