import { Stack } from 'expo-router';
import { landingHref } from '@/lib/landing';
import { useSession } from '@/lib/session';
import { MessagesProvider } from '@/lib/use-messages';
import { ActiveLogProvider } from '@/lib/use-active-log';
import { CommunityProvider } from '@/lib/use-community';
import { FoodProvider } from '@/lib/use-food';
import { palette } from '@/theme/theme';

/**
 * Signed-in area. With no coach (never invited, or removed) only the "Ask your coach" screen exists;
 * with a coach, the tabs and the workout detail. When a coach removes the client, the next foreground
 * check clears `workspace` and the guards move them back to the "Ask your coach" screen.
 * The active workout (ActiveLogProvider) belongs to the signed-in user, so it wraps every screen here.
 *
 * Each guard names where to go when it closes (Today after joining a coach, "Ask your coach" after removal).
 * Left to itself the router redirects to the bare tab group, which doesn't pick Today.
 */
export default function AppLayout() {
  const { workspace } = useSession();
  const hasCoach = workspace !== null;
  const landing = landingHref({ signedIn: true, hasCoach });
  return (
    <ActiveLogProvider>
    <MessagesProvider>
    <CommunityProvider>
    <FoodProvider>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }}>
      <Stack.Protected guard={hasCoach} redirectTo={landing}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="workout/[id]" />
        <Stack.Screen name="plan/[id]" />
        <Stack.Screen name="history" />
        {/* No swipe back: leaving mid-set by accident is easy, and Today's Resume banner brings it back anyway. */}
        <Stack.Screen name="log/[id]/index" options={{ gestureEnabled: false }} />
        {/* The reveal replaces the logging screen and then the summary; no swipe back into either. */}
        <Stack.Screen name="log/[id]/reveal" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="log/[id]/summary" />
        <Stack.Screen name="community/index" />
        <Stack.Screen name="community/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="community/[id]" />
        <Stack.Screen name="community/notifications" />
        <Stack.Screen name="zoo" />
        <Stack.Screen name="food/meal" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!hasCoach} redirectTo={landing}>
        <Stack.Screen name="home" />
      </Stack.Protected>
    </Stack>
    </FoodProvider>
    </CommunityProvider>
    </MessagesProvider>
    </ActiveLogProvider>
  );
}
