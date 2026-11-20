import { Stack } from 'expo-router';
import { palette } from '@/theme/theme';

// The Coach tab: the chat first (the tab bar stays), with the coach's profile and goal one tap away (/coach/about).
// A tapped message push opens /coach, so it always lands on the chat.
export const unstable_settings = { initialRouteName: 'index' };

export default function CoachLayout() {
  return <Stack screenOptions={{ headerShown: false, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: palette.bg } }} />;
}
