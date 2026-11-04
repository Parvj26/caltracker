import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Button, ErrorText, Logo, Screen } from '@/components/ui';
import { LINK_FAILED, codeFromLink, completeConfirmation } from '@/lib/confirm-link';
import { pkceVerifier, supabase } from '@/lib/supabase';
import { palette } from '@/theme/theme';

// Opened by caltracker://auth/confirmed?code=... from the confirmation email (PKCE flow).
// A successful exchange fires the session listener, which runs claimWorkspace() and enters the app.
export default function Confirmed() {
  const router = useRouter();
  // The route param is set on warm and cold opens; the linking URL is a fallback. Query string only (PKCE).
  const params = useLocalSearchParams<{ code?: string }>();
  const url = Linking.useLinkingURL();
  const code = codeFromLink(params.code, url);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      // No code arrived (e.g. the screen was opened directly): never leave the spinner hanging.
      const t = setTimeout(() => setError(LINK_FAILED), 4000);
      return () => clearTimeout(t);
    }
    void completeConfirmation(supabase, code, { verifier: pkceVerifier }).then((result) => {
      if (cancelled) return;
      if (result.ok) router.replace('/');
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [code, router]);

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
