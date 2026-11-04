import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { styles } from '@/lib/styles';

// Opened by caltracker://auth/confirmed from the confirmation email. Supabase appends either
// #access_token=...&refresh_token=... (implicit) or ?code=... (PKCE). Signing in here triggers the
// session listener, which runs claimWorkspace() and moves the user into the app.
export default function Confirmed() {
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void (async () => {
      const parsed = new URL(url);
      const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const code = parsed.searchParams.get('code');
      let message: string | null;
      if (accessToken && refreshToken) {
        message = (await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })).error?.message ?? null;
      } else if (code) {
        message = (await supabase.auth.exchangeCodeForSession(code)).error?.message ?? null;
      } else {
        message = hash.get('error_description') ?? parsed.searchParams.get('error_description') ?? 'This link is no longer valid.';
      }
      if (cancelled) return;
      if (message) setError(message);
      else router.replace('/');
    })();
    return () => {
      cancelled = true;
    };
  }, [url, router]);

  return (
    <View style={styles.screen}>
      {error ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.body} onPress={() => router.replace('/sign-in')}>
            Go to sign in
          </Text>
        </>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
