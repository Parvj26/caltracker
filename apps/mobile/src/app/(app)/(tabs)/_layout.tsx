import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { typeScale } from '@caltracker/design-tokens';
import { TabIcon } from '@/components/tab-icons';
import { fontFamilyFor } from '@/theme/fonts';
import { useUnreadCount } from '@/lib/use-messages';
import { palette, white } from '@/theme/theme';

// Files are discovered alphabetically (coach/ first), so a bare navigation into the tabs would open Coach. Today is home.
export const unstable_settings = { initialRouteName: 'today' };

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
        // Caption size: bold labels, the active one heavier. Colour comes from the tint.
        tabBarLabel: ({ focused, color, children }) => (
          <Text style={[styles.label, { color, fontFamily: fontFamilyFor('sans', focused ? 800 : 700) }]}>{children}</Text>
        ),
        tabBarIconStyle: { width: 56, height: 34 },
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{ title: 'Today', tabBarButtonTestID: 'tab-today', tabBarIcon: ({ focused }) => <TabIcon name="today" focused={focused} /> }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: 'Workouts',
          tabBarButtonTestID: 'tab-workouts',
          tabBarIcon: ({ focused }) => <TabIcon name="workouts" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarButtonTestID: 'tab-coach',
          tabBarIcon: ({ focused }) => <TabIcon name="coach" focused={focused} />,
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: palette.magenta, color: white },
        }}
      />
      <Tabs.Screen
        name="food"
        options={{ title: 'Food', tabBarButtonTestID: 'tab-food', tabBarIcon: ({ focused }) => <TabIcon name="food" focused={focused} /> }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarButtonTestID: 'tab-progress',
          tabBarIcon: ({ focused }) => <TabIcon name="progress" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: typeScale.caption.size.phone, marginTop: 4 },
});
