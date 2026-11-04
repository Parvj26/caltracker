import { Link, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { styles } from '@/lib/styles';

export default function CheckEmail() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Check your email</Text>
      <Text style={styles.body}>{`We sent a link to ${email ?? 'your email'}. Tap it, then come back and sign in.`}</Text>
      <Link testID="go-sign-in" href="/sign-in" style={[styles.link, styles.linkText]}>
        Go to sign in
      </Link>
    </View>
  );
}
