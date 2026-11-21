import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import Svg, { Path } from 'react-native-svg';
import { coachMealsButton } from '@/lib/coach-meals-button';
import { useFood } from '@/lib/use-food';
import { palette } from '@/theme/theme';
import { BigButton } from './big-button';

function BowlIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M4 11h16a8 8 0 0 1-16 0z" />
      <Path d="M8 7c0-1.5 1-2 1-3M12 7c0-1.5 1-2 1-3M16 7c0-1.5 1-2 1-3" />
    </Svg>
  );
}

/** "Meals from <coach> · N" (yellow), opening the coach's shared meals. Hidden when the coach shares none. */
export function CoachMealsButton({ firstName }: { firstName: string | null }) {
  const router = useRouter();
  const food = useFood();
  const load = food?.loadCoachMeals;
  // The saved list shows at once; a fresh one loads each time the Coach tab is opened.
  useFocusEffect(
    useCallback(() => {
      void load?.();
    }, [load]),
  );
  const button = coachMealsButton(food?.coachMeals.length ?? 0, food?.coachName ?? firstName);
  if (!button) return null;
  return (
    <BigButton
      testID="open-coach-meals"
      label={button.label}
      icon={<BowlIcon />}
      fill={palette.celebrateBg}
      badge={button.badge}
      accessibilityLabel={button.accessibilityLabel}
      onPress={() => router.push('/coach-meals')}
    />
  );
}
