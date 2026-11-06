import { Pressable, StyleSheet, Text } from 'react-native';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** "Resume {name}" at the top of Today and Workouts while a workout is in progress. */
export function ResumeBanner({ name, onPress }: { name: string; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  return (
    <Pressable
      testID="resume-banner"
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.resume,
        { borderRadius: radius.card, padding: space[4.5], gap: space[1] },
        pressed && styles.pressed,
      ]}
    >
      {/* Text on a pastel tile is always ink, never muted. */}
      <Text style={[text('caption'), styles.ink]}>Workout in progress</Text>
      <Text style={text('sectionHeading')}>{`Resume ${name}`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  resume: { backgroundColor: palette.lime },
  pressed: { opacity: pressedOpacity },
  ink: { color: palette.ink },
});
