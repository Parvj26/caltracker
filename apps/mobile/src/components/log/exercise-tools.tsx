import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import { exerciseImageUrl } from '@/lib/exercise-detail-api';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { fontFamilyFor } from '@/theme/fonts';
import { PlaceholderIcon } from './exercise-thumb';

/** The demo's thumbnail on a logging page (approved Logger board): small, so the sets stay on screen. */
export const DEMO_SMALL = 64;

/**
 * The exercise's photo with a play button over it. Tap opens the exercise sheet: photos, steps and Watch demo. On a
 * superset row (approved SS boards) it is smaller, with its A1 tag in the top-left corner and no play button.
 */
export function ExerciseDemo({
  name,
  detail,
  testID,
  onPress,
  tag,
  size = DEMO_SMALL,
}: {
  name: string;
  detail: ExerciseDetail | undefined;
  testID: string;
  onPress: () => void;
  /** "B1": a corner tag instead of the play button. */
  tag?: string | null;
  size?: number;
}) {
  const { radius } = useTheme();
  const first = detail?.imagePaths[0];
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tag ? `${tag} ${name}. How to do it` : `Play the ${name} demo`}
      style={({ pressed }) => [
        styles.demo,
        { width: size, height: size },
        { borderRadius: radius.input + 2 },
        pressed && { opacity: pressedOpacity },
      ]}
    >
      {first && failed !== first ? (
        <Image source={{ uri: exerciseImageUrl(first) }} style={styles.image} resizeMode="cover" onError={() => setFailed(first)} />
      ) : (
        <PlaceholderIcon />
      )}
      {tag ? (
        <View style={[styles.cornerTag, { borderBottomRightRadius: radius.input - 4 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.cornerText} maxFontSizeMultiplier={1}>
            {tag}
          </Text>
        </View>
      ) : (
        <View style={[styles.play, styles.playSmall]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[styles.playMark, { fontSize: 14 }]}>▶</Text>
        </View>
      )}
    </Pressable>
  );
}

/** One labelled chip of the tools row (44 pt tall). */
export function Tool({
  title,
  label,
  testID,
  dotted,
  onPress,
}: {
  title: string;
  label: string;
  testID: string;
  /** A dashed ring: something is waiting here (the coach added a substitute). */
  dotted?: boolean;
  onPress: () => void;
}) {
  const { logText: text, radius, space } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tool, { borderRadius: radius.pill, paddingHorizontal: space[3.5] }, dotted && styles.dotted, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={[text('caption'), styles.toolText]}>{title}</Text>
    </Pressable>
  );
}

/**
 * Short chips (approved LT1 board): "Note" (when given), "Swap" (dotted when the coach added a substitute; else any
 * exercise) and ··· (more: last time, add set, add drop set, delete set, remove). Screen readers hear the full words.
 */
export function ExerciseTools({
  idKey,
  name,
  coachName,
  hasSubstitute,
  onMessage,
  onSwap,
  onMore,
}: {
  /** "<page>-<exercise>", for test ids. */
  idKey: string;
  name: string;
  /** The coach's first name ("Note for Luis"); null says "your coach". */
  coachName: string | null;
  hasSubstitute: boolean;
  onMessage: (() => void) | null;
  /** Null hides Swap and ··· (read only, while the coach logs). */
  onSwap: (() => void) | null;
  onMore: (() => void) | null;
}) {
  const { space } = useTheme();
  if (!onMessage && !onSwap && !onMore) return null;
  return (
    <View style={[styles.tools, { gap: space[2] }]}>
      {onMessage ? (
        <Tool title="Note" label={`Note for ${coachName ?? 'your coach'} about ${name}`} testID={`message-${idKey}`} onPress={onMessage} />
      ) : null}
      {onSwap ? (
        <Tool
          title="Swap"
          label={hasSubstitute ? `Substitute available for ${name}` : `Swap ${name}`}
          testID={`swap-${idKey}`}
          dotted={hasSubstitute}
          onPress={onSwap}
        />
      ) : null}
      {onMore ? <Tool title="···" label={`More for ${name}`} testID={`more-${idKey}`} onPress={onMore} /> : null}
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
  cornerTag: { position: 'absolute', top: 0, left: 0, backgroundColor: palette.ink, paddingHorizontal: 4, paddingVertical: 1 },
  cornerText: { color: white, fontFamily: fontFamilyFor('sans', 800), fontSize: 11 },
  image: StyleSheet.absoluteFill,
  play: { position: 'absolute', backgroundColor: white, alignItems: 'center', justifyContent: 'center' },
  playSmall: { width: 34, height: 34, borderRadius: 17 },
  playMark: { color: palette.ink, marginLeft: 3 },
  tools: { flexDirection: 'row', flexWrap: 'wrap' },
  tool: {
    minWidth: tapTarget.min + 4,
    minHeight: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bg,
    borderWidth: borderWidth.secondaryButton,
    borderColor: palette.borderStrong,
  },
  toolText: { color: palette.ink, fontFamily: fontFamilyFor('sans', 700), fontSize: 14 },
  dotted: { borderWidth: borderWidth.card, borderStyle: 'dashed', borderColor: palette.ink },
  ink: { color: palette.ink },
});
