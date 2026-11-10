import { Linking, StyleSheet, View } from 'react-native';
import { TextButton } from '@/components/ui';
import { SIGN_IN_LEGAL_LINKS } from '@/lib/help-legal';
import { useTheme } from '@/theme/use-theme';

/** "Privacy · Terms" under the sign-in form. They open the public pages on caltracker.app. */
export function LegalLinks() {
  const { space } = useTheme();
  return (
    <View style={[styles.row, { gap: space[4] }]}>
      {SIGN_IN_LEGAL_LINKS.map((link) => (
        <TextButton key={link.testID} testID={link.testID} title={link.label} onPress={() => void Linking.openURL(link.url).catch(() => undefined)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center' },
});
