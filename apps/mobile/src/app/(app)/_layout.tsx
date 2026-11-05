import { Stack } from 'expo-router';
import { useSession } from '@/lib/session';
import { palette } from '@/theme/theme';

/**
 * Signed-in area. With no coach (never invited, or removed) only the "Ask your coach" screen exists;
 * with a coach, the tabs and the workout detail. When a coach removes the client, the next foreground
 * check clears `workspace` and the guards move them back to the "Ask your coach" screen.
 */
export default function AppLayout() {
  const { workspace } = useSession();
  const hasCoach = workspace !== null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }}>
      <Stack.Protected guard={hasCoach}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="workout/[id]" />
      </Stack.Protected>
      <Stack.Protected guard={!hasCoach}>
        <Stack.Screen name="home" />
      </Stack.Protected>
    </Stack>
  );
}
