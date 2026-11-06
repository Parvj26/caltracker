import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Screen } from '@/components/ui';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** "Logged by coach" on a finished workout the coach logged in a session. */
export function LoggedByCoachPill() {
  const { text, space, radius } = useTheme();
  return (
    <View testID="logged-by-coach" style={[styles.pill, { borderRadius: radius.card, paddingHorizontal: space[2.5], paddingVertical: space[1] }]}>
      {/* Text on a pastel tile is always ink, never muted. */}
      <Text style={[text('caption'), styles.ink]}>Logged by coach</Text>
    </View>
  );
}

/**
 * Shown instead of the logging screen while the coach logs this workout from the website (single active logger):
 * the client can't edit it, and sees it in their history when the coach finishes.
 */
export function CoachLoggingBanner({ finished, onBack }: { finished: boolean; onBack: () => void }) {
  const { text, space } = useTheme();
  return (
    <Screen>
      <Card>
        <View testID="coach-logging-banner" style={{ gap: space[2] }}>
          <LoggedByCoachPill />
          <Text style={text('sectionHeading')} accessibilityRole="header">
            {finished ? 'Your coach logged this session' : 'Your coach is logging this session'}
          </Text>
          <Text style={text('body')}>
            {finished
              ? 'It is in your history, and any stickers it earned are in your album.'
              : 'They are filling it in for you, so it can’t be changed here. It shows in your history when they finish.'}
          </Text>
        </View>
        <Button variant="secondary" title="Back to Today" testID="coach-logging-back" onPress={onBack} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', backgroundColor: palette.blue },
  ink: { color: palette.ink },
});
