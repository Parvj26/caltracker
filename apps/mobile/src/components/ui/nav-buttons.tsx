import type { ReactNode } from 'react';
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import { palette, pressedOpacity, space, TITLE_MAX_SCALE } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ChevronIcon, CloseIcon } from './icons';

// The app's only two ways out of a screen (Patterns board, 2026-11-19): a grey circle ‹ on pushed pages (iOS
// swipe-back does the same) and a grey circle × on sheets (swipe down does the same). × sits top-left on full-screen
// flows (logging) and top-right on sheets. No "Back", "Close", "Cancel", "OK" or ⌄ text links.

type RoundProps = {
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

function Round({ onPress, accessibilityLabel, testID, style, children }: RoundProps & { children: ReactNode }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => [styles.round, pressed && styles.pressed, style]}
    >
      <View>{children}</View>
    </Pressable>
  );
}

/**
 * Grey circle ‹ for a pushed page. Goes exactly one step back; when there is nothing to go back to (opened from a
 * link or a notification) it replaces the screen with `fallback`.
 */
export function BackButton({
  fallback = '/today',
  onPress,
  accessibilityLabel = 'Back',
  testID = 'back',
  style,
}: {
  /** Where to go when there is no screen to go back to (default Today). */
  fallback?: Href;
  /** Instead of going back (e.g. to ask first). */
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  return (
    <Round
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={style}
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace(fallback)))}
    >
      <ChevronIcon direction="left" />
    </Round>
  );
}

/** Grey circle × for a sheet (top-right) or a full-screen flow (top-left). */
export function CloseButton({ onPress, accessibilityLabel = 'Close', testID = 'close', style }: Omit<RoundProps, 'accessibilityLabel'> & { accessibilityLabel?: string }) {
  return (
    <Round testID={testID} accessibilityLabel={accessibilityLabel} onPress={onPress} style={style}>
      <CloseIcon size={16} />
    </Round>
  );
}

/** A sheet's top row: the title on the left (it wraps whole words), the grey × on the right. */
export function SheetHeader({ title, onClose, closeTestID, titleTestID }: { title: string; onClose: () => void; closeTestID: string; titleTestID?: string }) {
  const { text } = useTheme();
  return (
    <View style={styles.header}>
      <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header" testID={titleTestID} maxFontSizeMultiplier={TITLE_MAX_SCALE}>
        {title}
      </Text>
      <CloseButton testID={closeTestID} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  flex: { flex: 1, paddingTop: space[1] },
  round: {
    width: tapTarget.min,
    height: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: pressedOpacity },
});
