import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Button, ErrorText, Logo, Screen } from '@/components/ui';
import { LINK_FAILED, completeConfirmation } from '@/lib/confirm-link';
import { supabase } from '@/lib/supabase';
import { palette } from '@/theme/theme';

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
    <Screen centred>
      <Logo size="lg" />
      {error ? (
        <>
          <ErrorText>{error}</ErrorText>
          <Button testID="go-sign-in" title="Go to sign in" onPress={() => router.replace('/sign-in')} />
        </>
      ) : (
        <ActivityIndicator color={palette.ink} accessibilityLabel="Confirming your email" />
      )}
    </Screen>
  );
}
