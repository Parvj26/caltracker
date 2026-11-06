import { forwardRef } from 'react';
import { StyleSheet, Text, View, type HostInstance } from 'react-native';
import { Logo } from '@/components/ui';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { Sticker } from './sticker';

export const SHARE_CARD_WIDTH = 320;

/**
 * The picture "Save image" puts in the photo library: the sticker, one line ("3,175 lb ≈ 1.2 Giraffes"), a second
 * line (the workout name) and the CalTracker logo. Fixed size so the saved picture looks the same on every phone.
 * Rendered off screen by whoever offers the button.
 */
export const ShareCard = forwardRef<HostInstance, { stickerKey: string; shiny: boolean; line: string; subline: string | null }>(
  function ShareCard({ stickerKey, shiny, line, subline }, ref) {
    const { text, space, radius } = useTheme();
    return (
      <View
        ref={ref}
        collapsable={false}
        testID="share-card"
        style={[styles.card, { borderRadius: radius.card, padding: space[6], gap: space[3] }]}
      >
        <Sticker stickerKey={stickerKey} size={200} shiny={shiny} />
        <Text style={[text('sectionHeading'), styles.center]}>{line}</Text>
        {subline ? <Text style={[text('caption'), styles.ink, styles.center]}>{subline}</Text> : null}
        <Logo />
      </View>
    );
  },
);

/** Keeps a share card out of sight but still drawn, so it can be captured. */
export function OffScreen({ children }: { children: React.ReactNode }) {
  return (
    <View pointerEvents="none" style={styles.off} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: SHARE_CARD_WIDTH, backgroundColor: palette.lime, alignItems: 'center' },
  ink: { color: palette.ink },
  center: { textAlign: 'center', color: palette.ink },
  off: { position: 'absolute', left: -2000, top: 0 },
});
