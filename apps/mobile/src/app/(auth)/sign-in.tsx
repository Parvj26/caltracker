import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { styles } from '@/lib/styles';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(err.message);
    // On success the session listener routes to the app and links the workspace.
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Sign in</Text>
      <TextInput
        testID="email-input"
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="none"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        testID="password-input"
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoCapitalize="none"
        textContentType="none"
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable testID="submit-button" style={styles.button} onPress={() => void submit()} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Signing in...' : 'Sign in'}</Text>
      </Pressable>
      <Link testID="go-sign-up" href="/sign-up" style={[styles.link, styles.linkText]}>
        Create an account
      </Link>
    </View>
  );
}
