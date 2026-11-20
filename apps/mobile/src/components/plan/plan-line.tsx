// An exercise's plan as one line with its warm-ups and drops tagged (approved Preview board, 2026-11-19):
// "[W] 20 kg × 10 · then 3 × 8 at 60 kg [↓ Drop] 25 kg to failure". Every set shows, so the line agrees with the set
// count on Today, the preview and the logger.
import { Fragment } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { PlanPart } from '@/lib/workouts-plan';
import { fontFamilyFor } from '@/theme/fonts';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export function PlanLine({ parts, testID }: { parts: readonly PlanPart[]; testID?: string }) {
  const { text } = useTheme();
  if (parts.length === 0) return null;
  return (
    <Text testID={testID} style={text('body')}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? (p.kind === 'drop' ? ' ' : ' · ') : null}
          {p.kind === 'warmup' ? <Text style={styles.tag}>{' W '}</Text> : null}
          {p.kind === 'drop' ? <Text style={styles.tag}>{' ↓ Drop '}</Text> : null}
          {p.kind === 'work' ? p.text : ` ${p.text}`}
        </Fragment>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  tag: { fontFamily: fontFamilyFor('sans', 800), backgroundColor: palette.surface, color: palette.ink },
});
