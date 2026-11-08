import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AnalyticsProvider } from '@/lib/analytics/provider';
import { SessionProvider, useSession } from '@/lib/session';
import { FONT_ASSETS } from '@/theme/fonts';
import { palette } from '@/theme/theme';

// Keep the native splash up until the fonts are ready, so text never flashes in the system font.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Never hold the app on the splash longer than this, even if font loading stalls. */
const FONT_TIMEOUT_MS = 3000;

function RootStack() {
  const { loading, session } = useSession();
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: palette.bg }}>
        <ActivityIndicator color={palette.ink} />
      </View>
    );
  }
  const signedIn = session !== null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="index" />
      <Stack.Screen name="auth/confirmed" />
      {/* Reachable signed in or out: it handles both (see the screen). */}
      <Stack.Screen name="invite/[token]" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const [timedOut, setTimedOut] = useState(false);
  // If loading fails or stalls, carry on with the system font rather than hang on the splash.
  const ready = fontsLoaded || fontError !== null || timedOut;

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <AnalyticsProvider>
        <RootStack />
      </AnalyticsProvider>
    </SessionProvider>
  );
}
