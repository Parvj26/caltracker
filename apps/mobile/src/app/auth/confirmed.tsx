import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { LINK_FAILED, completeConfirmation } from '@/lib/confirm-link';
import { styles } from '@/lib/styles';
import { supabase } from '@/lib/supabase';

// Opened by caltracker://auth/confirmed?code=... from the confirmation email (PKCE flow).
// A successful exchange fires the session listener, which runs claimWorkspace() and enters the app.
export default function Confirmed() {
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      // No URL arrived (e.g. the screen was opened directly): never leave the spinner hanging.
      const t = setTimeout(() => setError(LINK_FAILED), 4000);
      return () => clearTimeout(t);
    }
    void completeConfirmation(supabase, url).then((result) => {
      if (cancelled) return;
      if (result.ok) router.replace('/');
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [url, router]);

  return (
    <View style={styles.screen}>
      {error ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <Pressable testID="go-sign-in" style={styles.button} onPress={() => router.replace('/sign-in')}>
            <Text style={styles.buttonText}>Go to sign in</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
