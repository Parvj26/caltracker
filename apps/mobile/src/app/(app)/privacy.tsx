import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { BackCircle, SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { Screen } from '@/components/ui';
import { HELP_LEGAL_ROWS } from '@/lib/help-legal';
import { openHelpLegal } from '@/lib/open-help-legal';
import { useTheme } from '@/theme/use-theme';

/**
 * Settings › Privacy & delete account (approved Settings board, 2026-11-19): the privacy policy, and Delete account on
 * its own, in red, away from Sign out. Delete account still asks the client to type DELETE.
 */
export default function PrivacyScreen() {
  const { text, space } = useTheme();
  const router = useRouter();
  const privacy = HELP_LEGAL_ROWS.find((r) => r.key === 'privacy');
  return (
    <Screen>
      <View style={{ gap: space[2.5] }}>
        <View style={{ alignSelf: 'flex-start' }}>
          <BackCircle testID="privacy-back" label="Back to Settings" fallback="/settings" />
        </View>
        <Text style={text('screenTitle')} accessibilityRole="header">
          Privacy & delete account
        </Text>
        <Text style={text('body')}>Your coach sees what you log so they can coach you. The privacy policy says what we keep and why.</Text>
      </View>
      <SettingsGroup title="Privacy">
        {privacy ? <SettingsRow testID="settings-privacy" label="Privacy policy" onPress={() => void openHelpLegal(privacy)} /> : null}
      </SettingsGroup>
      <SettingsGroup title="Delete account">
        <SettingsRow testID="settings-delete-account" label="Delete account…" danger onPress={() => router.push('/delete-account')} />
      </SettingsGroup>
    </Screen>
  );
}
