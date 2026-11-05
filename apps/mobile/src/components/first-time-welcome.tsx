import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import type { Units } from '@caltracker/shared';
import { Card, ErrorText, HandNote } from '@/components/ui';
import { initials } from '@/lib/workouts';
import { palette, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import capybara from '../../assets/stickers/capybara-locked@256.png';
import corgi from '../../assets/stickers/corgi-locked@256.png';
import elephant from '../../assets/stickers/elephant-locked@256.png';

const NEXT_STEPS = ['Your coach builds your plan', 'Workouts show up here', 'Log your sets and earn stickers'] as const;
const STICKERS = [corgi, capybara, elephant] as const;

type Props = {
  coachName: string | null;
  workspaceName: string;
  units: Units;
  onChangeUnits: (units: Units) => Promise<void>;
};

/** Today for a client with no workouts at all yet: meet the coach, what happens next, units, sticker teaser. */
export function FirstTimeWelcome({ coachName, workspaceName, units, onChangeUnits }: Props) {
  const { text, space, radius } = useTheme();

  return (
    <>
      <Card>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          Meet your coach
        </Text>
        <View style={[styles.row, { gap: space[3] }]}>
          <View
            style={[styles.avatar, { borderRadius: radius.pill }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={text('sectionHeading')}>{initials(coachName ?? workspaceName)}</Text>
          </View>
          <View style={styles.flex}>
            {coachName ? <Text style={text('sectionHeading')}>{coachName}</Text> : null}
            <Text style={text('body')}>{workspaceName}</Text>
          </View>
        </View>
        <HandNote>Your first workout is coming!</HandNote>
      </Card>

      <Card>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          What happens next
        </Text>
        {NEXT_STEPS.map((step, i) => (
          <View key={step} style={[styles.row, { gap: space[3] }]}>
            <View
              style={[styles.stepNumber, { borderRadius: radius.pill }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={text('sectionHeading')}>{i + 1}</Text>
            </View>
            <Text style={[text('body'), styles.flex]} accessibilityLabel={`Step ${i + 1}: ${step}`}>
              {step}
            </Text>
          </View>
        ))}
      </Card>

      <UnitsCard units={units} onChange={onChangeUnits} />

      <Card>
        <View
          style={[styles.stickers, { gap: space[3] }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {STICKERS.map((src, i) => (
            <View key={i} style={[styles.stickerTile, { borderRadius: radius.card, padding: space[2] }]}>
              <Image source={src} style={styles.sticker} resizeMode="contain" accessible={false} />
            </View>
          ))}
        </View>
        <Text style={text('body')}>Finish your first workout to unlock your first sticker.</Text>
      </Card>
    </>
  );
}

function UnitsCard({ units, onChange }: { units: Units; onChange: (units: Units) => Promise<void> }) {
  const { text, space, radius } = useTheme();
  const [error, setError] = useState<string | null>(null);

  async function pick(next: Units) {
    if (next === units) return;
    setError(null);
    try {
      await onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your units. Try again.');
    }
  }

  return (
    <Card>
      <View style={[styles.row, { gap: space[3] }]}>
        <Text style={[text('sectionHeading'), styles.flex]}>
          Weights in
        </Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Weights in"
          style={[styles.segments, { borderRadius: radius.button, padding: space[1] }]}
        >
          {(['kg', 'lb'] as const).map((u) => {
            const on = u === units;
            return (
              <Pressable
                key={u}
                testID={`units-${u}`}
                onPress={() => void pick(u)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
                style={[
                  styles.segment,
                  { borderRadius: radius.input, paddingHorizontal: space[4] },
                  on && styles.segmentOn,
                ]}
              >
                <Text style={[text('button'), { color: on ? white : palette.ink }]}>{u}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 120 },
  avatar: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.pink },
  stepNumber: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.lime },
  segments: { flexDirection: 'row', backgroundColor: palette.surface },
  segment: { minHeight: tapTarget.min, minWidth: tapTarget.min + 12, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: palette.ink },
  stickers: { flexDirection: 'row', justifyContent: 'space-between' },
  // The locked silhouettes are pale grey: a slightly darker tile with a border keeps them visible on white.
  stickerTile: { flex: 1, aspectRatio: 1, backgroundColor: palette.surface, borderWidth: 2, borderColor: palette.border },
  sticker: { width: '100%', height: '100%' },
});
