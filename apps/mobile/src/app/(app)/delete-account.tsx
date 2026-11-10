import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { ErrorText, Screen } from '@/components/ui';
import { DELETE_LIST, DELETE_WORD, canConfirmDelete, deleteMyAccount, historyWarning } from '@/lib/delete-account';
import { supabase } from '@/lib/supabase';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * Settings -> Delete account (approved account-canvas Delete board). What is erased, the coach warning, type DELETE
 * to turn the button on. On success it goes to the "Your account has been deleted" screen, which signs out.
 * A coach signed in on the phone gets the server's "write to support" message and nothing is deleted.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { text, space } = useTheme();
  const coach = useCoachProfile();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = canConfirmDelete(typed) && !busy;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/today'));

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await deleteMyAccount(supabase);
    if (result.status === 'deleted') {
      router.replace('/account-deleted');
      return;
    }
    setBusy(false);
    setError(result.message);
  }

  const footer = (
    <View style={{ gap: space[2] }}>
      <Pressable
        testID="delete-account-confirm"
        onPress={() => void confirm()}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel="Delete my account"
        accessibilityState={{ disabled: !ready, busy }}
        style={({ pressed }) => [styles.button, ready && styles.buttonOn, pressed && styles.pressed]}
      >
        {busy ? (
          <ActivityIndicator color={palette.dangerDeep} accessibilityLabel="Deleting your account" />
        ) : (
          <Text style={[text('screenTitle'), styles.buttonLabel, ready && styles.buttonLabelOn]}>Delete my account</Text>
        )}
      </Pressable>
      {error ? <ErrorText testID="delete-account-error">{error}</ErrorText> : null}
      <Text style={[text('caption'), styles.centre, styles.hint]}>The button turns on once you type {DELETE_WORD}.</Text>
      <Pressable
        testID="delete-account-cancel"
        onPress={back}
        accessibilityRole="button"
        style={({ pressed }) => [styles.link, styles.centreSelf, pressed && styles.pressed]}
      >
        <Text style={[text('sectionHeading'), styles.linkLabel]}>Cancel</Text>
      </Pressable>
    </View>
  );

  return (
    <Screen footer={footer}>
      <View style={{ gap: space[4.5] }}>
        <Pressable
          testID="delete-account-back"
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text style={[text('sectionHeading'), styles.linkLabel]}>‹ Settings</Text>
        </Pressable>
        <Text style={[text('screenTitle'), styles.title]} accessibilityRole="header">
          Delete your account?
        </Text>
        <Text style={[text('body'), styles.body]}>This permanently erases everything in CalTracker that belongs to you:</Text>
        <View style={styles.list} testID="delete-account-list">
          {DELETE_LIST.map((item) => (
            <View key={item} style={[styles.bulletRow, { gap: space[2] }]}>
              <Text style={[text('body'), styles.body]}>•</Text>
              <Text style={[text('body'), styles.body, styles.flex]}>{item}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.callout, { paddingHorizontal: space[4], paddingVertical: space[3.5] }]}>
          <Text style={[text('sectionHeading'), styles.calloutText]} testID="delete-account-warning">
            {historyWarning(coach?.name)}
          </Text>
        </View>
        <Text style={[text('sectionHeading'), styles.label]} nativeID="delete-confirm-label">
          Type {DELETE_WORD} to confirm
        </Text>
        <TextInput
          testID="delete-account-input"
          value={typed}
          onChangeText={(v) => {
            setTyped(v);
            setError(null);
          }}
          editable={!busy}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          returnKeyType="done"
          accessibilityLabel={`Type ${DELETE_WORD} to confirm`}
          accessibilityLabelledBy="delete-confirm-label"
          style={[text('sectionHeading'), styles.input, { paddingHorizontal: space[3.5] }]}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  link: { minHeight: tapTarget.min, justifyContent: 'center' },
  centreSelf: { alignSelf: 'center' },
  linkLabel: { fontSize: 16 },
  title: { fontSize: 30 },
  body: { fontSize: 16, lineHeight: 23 },
  // The board's list: 6 pt between items.
  list: { gap: 6 },
  bulletRow: { flexDirection: 'row', paddingLeft: 6 },
  callout: {
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    borderRadius: 18,
    backgroundColor: palette.celebrateBg,
  },
  calloutText: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 15 },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    fontSize: 18,
    letterSpacing: 1,
    color: palette.ink,
  },
  // Off: the board's pale red. On: filled red, so it's clear the button now works.
  button: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: borderWidth.card,
    borderColor: palette.danger,
    backgroundColor: palette.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOn: { backgroundColor: palette.danger },
  buttonLabel: { fontSize: 17, color: palette.dangerDeep },
  buttonLabelOn: { color: white },
  hint: { fontSize: 13 },
  centre: { textAlign: 'center' },
  pressed: { opacity: pressedOpacity },
});
