import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { styles } from '@/lib/styles';

export default function SignUp() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cleanEmail = email.trim();
    if (!name.trim()) return setError('Enter your name.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { full_name: name.trim() }, emailRedirectTo: 'caltracker://auth/confirmed' },
    });
    setBusy(false);
    if (err) return setError(err.message);
    router.replace({ pathname: '/check-email', params: { email: cleanEmail } });
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Create your account</Text>
      <TextInput
        testID="name-input"
        style={styles.input}
        placeholder="Full name"
        textContentType="none"
        value={name}
        onChangeText={setName}
      />
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
        placeholder="Password (min 8 characters)"
        secureTextEntry
        autoCapitalize="none"
        textContentType="none"
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable testID="submit-button" style={styles.button} onPress={() => void submit()} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Creating account...' : 'Create account'}</Text>
      </Pressable>
      <Link testID="go-sign-in" href="/sign-in" style={[styles.link, styles.linkText]}>
        I already have an account
      </Link>
    </View>
  );
}
