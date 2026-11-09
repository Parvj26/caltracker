import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import type { Units } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { palette, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** kg / lb switch for Settings. Saves as soon as one is tapped. */
export function UnitsPicker({ units, onChange }: { units: Units; onChange: (units: Units) => Promise<void> }) {
  const { text, space, radius } = useTheme();
  const [error, setError] = useState<string | null>(null);

  async function pick(next: Units) {
    if (next === units) return;
    setError(null);
    try {
      await onChange(next);
    } catch {
      setError('Could not save your units. Try again.');
    }
  }

  return (
    <View style={{ gap: space[2] }}>
      <Text style={text('sectionHeading')}>Weight units</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Weight units"
        style={[styles.segments, { borderRadius: radius.button, padding: space[1] }]}
      >
        {(['lb', 'kg'] as const).map((u) => {
          const on = u === units;
          return (
            <Pressable
              key={u}
              testID={`units-${u}`}
              onPress={() => void pick(u)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
              style={[styles.segment, { borderRadius: radius.input }, on && styles.segmentOn]}
            >
              <Text style={[text('button'), { color: on ? white : palette.ink }]}>{u}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={text('caption')}>Used for workouts, PRs and body weight.</Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', backgroundColor: palette.surface },
  segment: { flex: 1, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: palette.ink },
});
