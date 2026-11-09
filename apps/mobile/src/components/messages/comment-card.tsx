import { Pressable, StyleSheet, Text } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { palette, pressedOpacity, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** A coach's comment on one of the client's workouts, inline in the chat; tapping opens that workout's summary. */
export function CommentCard({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  const { text } = useTheme();
  return (
    <Pressable
      testID="coach-workout-comment"
      accessibilityRole="button"
      accessibilityLabel={`Comment on your workout, ${title}: ${body}`}
      accessibilityHint="Opens the workout"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={[text('sectionHeading'), styles.kicker]}>Comment on your workout</Text>
      <Text style={[text('sectionHeading'), styles.title]}>{title}</Text>
      <Text style={[text('body'), styles.body]}>{`“${body}”`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    maxWidth: '78%',
    gap: 2,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
    borderRadius: 16,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
  },
  kicker: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: palette.inkMuted },
  title: { fontSize: 15 },
  body: { fontSize: 14 },
});
