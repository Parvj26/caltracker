import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { exerciseImageUrl } from '@/lib/exercise-detail-api';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { PlaceholderIcon } from './exercise-thumb';

/** Height of the big demo area on a straight exercise page; a superset's exercises use the medium square. */
export const DEMO_HEIGHT = 220;
export const DEMO_MEDIUM = 96;

/**
 * The exercise's photo with a play button over it. Tap opens the exercise sheet: photos, steps and Watch demo.
 */
export function ExerciseDemo({
  name,
  detail,
  size,
  testID,
  onPress,
}: {
  name: string;
  detail: ExerciseDetail | undefined;
  size: 'big' | 'medium';
  testID: string;
  onPress: () => void;
}) {
  const { radius } = useTheme();
  const first = detail?.imagePaths[0];
  const [failed, setFailed] = useState<string | null>(null);
  const big = size === 'big';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play the ${name} demo`}
      style={({ pressed }) => [
        styles.demo,
        big ? styles.big : styles.medium,
        { borderRadius: radius.card },
        pressed && { opacity: pressedOpacity },
      ]}
    >
      {first && failed !== first ? (
        <Image source={{ uri: exerciseImageUrl(first) }} style={styles.image} resizeMode="cover" onError={() => setFailed(first)} />
      ) : (
        <PlaceholderIcon />
      )}
      <View style={[styles.play, big ? styles.playBig : styles.playSmall]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={[styles.playMark, { fontSize: big ? 24 : 14 }]}>▶</Text>
      </View>
    </Pressable>
  );
}

/** One round icon button of the tools row. */
function Tool({
  glyph,
  label,
  testID,
  dotted,
  onPress,
}: {
  glyph: string;
  label: string;
  testID: string;
  /** A dashed ring: something is waiting here (the coach added a substitute). */
  dotted?: boolean;
  onPress: () => void;
}) {
  const { text, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tool, { borderRadius: radius.pill }, dotted && styles.dotted, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={[text('sectionHeading'), styles.ink]}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * History (last time's numbers), Message coach (a note for the coach, when given), ⇄ (switch to the substitute,
 * or swap the exercise) and ••• (more).
 */
export function ExerciseTools({
  idKey,
  name,
  hasSubstitute,
  onHistory,
  onMessage,
  onSwap,
  onMore,
}: {
  /** "<page>-<exercise>", for test ids. */
  idKey: string;
  name: string;
  hasSubstitute: boolean;
  onHistory: () => void;
  onMessage: (() => void) | null;
  onSwap: () => void;
  onMore: () => void;
}) {
  const { space } = useTheme();
  return (
    <View style={[styles.tools, { gap: space[2] }]}>
      <Tool glyph="↺" label={`History for ${name}`} testID={`history-${idKey}`} onPress={onHistory} />
      {onMessage ? <Tool glyph="✉" label={`Note for your coach about ${name}`} testID={`message-${idKey}`} onPress={onMessage} /> : null}
      <Tool
        glyph="⇄"
        label={hasSubstitute ? `Substitute available for ${name}` : `Swap ${name}`}
        testID={`swap-${idKey}`}
        dotted={hasSubstitute}
        onPress={onSwap}
      />
      <Tool glyph="•••" label={`More for ${name}`} testID={`more-${idKey}`} onPress={onMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  demo: {
    overflow: 'hidden',
    backgroundColor: palette.surface,
    borderWidth: borderWidth.card,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  big: { width: '100%', height: DEMO_HEIGHT },
  medium: { width: DEMO_MEDIUM, height: DEMO_MEDIUM },
  image: StyleSheet.absoluteFill,
  play: { position: 'absolute', backgroundColor: white, alignItems: 'center', justifyContent: 'center' },
  playBig: { width: 64, height: 64, borderRadius: 32 },
  playSmall: { width: 34, height: 34, borderRadius: 17 },
  playMark: { color: palette.ink, marginLeft: 3 },
  tools: { flexDirection: 'row', flexWrap: 'wrap' },
  tool: {
    minWidth: tapTarget.min + 8,
    minHeight: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  dotted: { borderWidth: borderWidth.card, borderStyle: 'dashed', borderColor: palette.ink },
  ink: { color: palette.ink },
});
