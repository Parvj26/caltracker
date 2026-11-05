import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { TextButton } from '@/components/ui';
import { useTheme } from '@/theme/use-theme';

export default function CheckEmail() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const { text } = useTheme();
  return (
    <AuthShell title="Check your email" note="Almost there!">
      <Text style={text('body')}>{`We sent a link to ${email ?? 'your email'}. Tap it, then come back and sign in.`}</Text>
      <Text style={text('body')}>Open the link on this phone. If you open it somewhere else, come back here and sign in.</Text>
      <TextButton testID="go-sign-in" href="/sign-in" title="Go to sign in" />
      {/* Signing up again with an existing email lands here too, but no email is sent (Supabase never reveals
          which emails have accounts), so offer the way out. */}
      <Text style={text('body')}>Already have an account?</Text>
      <TextButton testID="have-account-sign-in" href="/sign-in" title="Sign in" />
    </AuthShell>
  );
}
