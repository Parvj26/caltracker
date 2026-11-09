import { Stack } from 'expo-router';
import { palette } from '@/theme/theme';

// The Coach tab: the coach's profile first, the chat on top of it (the tab bar stays). A tapped message push opens
// /coach/chat with the profile underneath, so Back always lands on the profile.
export const unstable_settings = { initialRouteName: 'index' };

export default function CoachLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />;
}
