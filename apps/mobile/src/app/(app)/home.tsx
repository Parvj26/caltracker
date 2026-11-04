import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { styles } from '@/lib/styles';

export default function Home() {
  const { workspace, claimError, recheck } = useSession();
  const [checking, setChecking] = useState(false);

  async function checkAgain() {
    setChecking(true);
    await recheck();
    setChecking(false);
  }

  return (
    <View style={styles.screen}>
      {workspace ? (
        <>
          <Text style={styles.title}>{`Welcome to ${workspace.workspaceName}`}</Text>
          <Text style={styles.body}>Your coach will add your workouts here soon.</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>Ask your coach for an invite</Text>
          {claimError ? <Text style={styles.error}>{claimError}</Text> : null}
          <Pressable testID="check-again" style={styles.button} onPress={() => void checkAgain()} disabled={checking}>
            <Text style={styles.buttonText}>Check again</Text>
          </Pressable>
        </>
      )}
      <Pressable testID="sign-out" style={styles.link} onPress={() => void supabase.auth.signOut()}>
        <Text style={styles.linkText}>Sign out</Text>
      </Pressable>
    </View>
  );
}
