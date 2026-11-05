import { Stack } from 'expo-router';
import { useSession } from '@/lib/session';
import { ActiveLogProvider } from '@/lib/use-active-log';
import { palette } from '@/theme/theme';

/**
 * Signed-in area. With no coach (never invited, or removed) only the "Ask your coach" screen exists;
 * with a coach, the tabs and the workout detail. When a coach removes the client, the next foreground
 * check clears `workspace` and the guards move them back to the "Ask your coach" screen.
 * The active workout (ActiveLogProvider) belongs to the signed-in user, so it wraps every screen here.
 */
export default function AppLayout() {
  const { workspace } = useSession();
  const hasCoach = workspace !== null;
  return (
    <ActiveLogProvider>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }}>
      <Stack.Protected guard={hasCoach}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="workout/[id]" />
        {/* No swipe back: leaving mid-set by accident is easy, and Today's Resume banner brings it back anyway. */}
        <Stack.Screen name="log/[id]/index" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!hasCoach}>
        <Stack.Screen name="home" />
      </Stack.Protected>
    </Stack>
    </ActiveLogProvider>
  );
}
