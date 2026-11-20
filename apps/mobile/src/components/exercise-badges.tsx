// The coach's "Each side" and "Tempo 3-1-1-0" badges under an exercise's name, then the one line explaining them.
// What they say comes from the shared exerciseBadges; this only draws them (the logging pages, the plan and the
// workout preview, and the coach's live view, which is the logging pages read only). The workout preview shows the
// chips only (showHelp false): its row's screen-reader label still says the help line.
import { StyleSheet, Text, View } from 'react-native';
import { fontFamilyFor } from '@/theme/fonts';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export function ExerciseBadges({
  badges,
  help,
  testID,
  logging = false,
  showHelp = true,
}: {
  badges: readonly string[];
  help: string | null;
  testID: string;
  /** On the logging pages: their slightly bigger text. */
  logging?: boolean;
  /** False: the chips without the line explaining them (the workout preview). */
  showHelp?: boolean;
}) {
  const theme = useTheme();
  const text = logging ? theme.logText : theme.text;
  const { space, radius } = theme;
  if (badges.length === 0) return null;
  return (
    <View testID={testID} style={{ gap: space[2] }}>
      <View style={[styles.row, { gap: space[2] }]}>
        {badges.map((b) => (
          <Text
            key={b}
            testID={`${testID}-badge`}
            style={[
              text('body'),
              styles.badge,
              b.startsWith('Tempo') ? styles.tempo : styles.eachSide,
              { borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: space[1] },
            ]}
          >
            {b}
          </Text>
        ))}
      </View>
      {help && showHelp ? (
        <Text testID={`${testID}-help`} style={[text('body'), styles.help]}>
          {help}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  badge: { color: palette.ink, fontFamily: fontFamilyFor('sans', 700), overflow: 'hidden' },
  eachSide: { backgroundColor: palette.drop },
  tempo: { backgroundColor: palette.surface },
  help: { color: palette.inkMuted },
});
