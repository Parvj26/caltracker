import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import type { PageModel } from '@/lib/log-page-model';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ExerciseThumb } from './exercise-thumb';

/**
 * A pick-one page before anything is picked: "Finisher · pick one", how picking works, then one card per option
 * (photo, name, plan). Tapping a card (or its photo) picks it. No Done button: there is nothing to log yet.
 *
 * testIDs for Maestro: choice-heading-{p}, choice-option-{index} (index = the option's place in the group).
 */
export function ChoicePage({
  model,
  page,
  details,
  onPick,
}: {
  model: NonNullable<PageModel['choice']>;
  page: number;
  /** Photos per exercise id, once loaded (missing shows the placeholder). */
  details: Record<string, ExerciseDetail>;
  onPick: (logExerciseId: string) => void;
}) {
  const { text, space, radius } = useTheme();
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ gap: space[1] }}>
        <Text testID={`choice-heading-${page}`} style={text('screenTitle')} accessibilityRole="header">
          {model.heading}
        </Text>
        <Text style={text('body')}>Tap the one you want to do. You can switch until you finish your first set.</Text>
      </View>
      {model.options.map((option, index) => {
        const pick = () => onPick(option.logExerciseId);
        return (
          <Pressable
            key={option.logExerciseId}
            testID={`choice-option-${index}`}
            onPress={pick}
            accessibilityRole="button"
            accessibilityLabel={option.plan ? `${option.name}, ${option.plan}` : option.name}
            accessibilityHint="Picks this exercise"
            style={({ pressed }) => [
              styles.card,
              { borderRadius: radius.card, padding: space[3], gap: space[3] },
              pressed && { opacity: pressedOpacity },
            ]}
          >
            <ExerciseThumb
              name={option.name}
              detail={details[option.exerciseId]}
              testID={`choice-thumb-${index}`}
              onPress={pick}
            />
            <View style={[styles.flex, { gap: space[1] }]}>
              <Text style={[text('sectionHeading'), styles.ink]}>{option.name}</Text>
              {option.plan ? <Text style={[text('caption'), styles.ink]}>{option.plan}</Text> : null}
            </View>
            <Text style={[text('sectionHeading'), styles.ink]} accessibilityElementsHidden importantForAccessibility="no">
              ›
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: tapTarget.logging,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
  },
  flex: { flex: 1 },
  ink: { color: palette.ink },
});
