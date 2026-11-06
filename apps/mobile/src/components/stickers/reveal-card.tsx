import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { buttonMinHeight } from '@caltracker/design-tokens';
import type { RevealCardView } from '@/lib/awards-logic';
import { tapHaptic } from '@/lib/log-notifications';
import { palette, pressedOpacity, stickerTheme, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { Sticker } from './sticker';

/**
 * One reveal card on the dark full screen: what you lifted, "that's about", the sticker popping in over a pink
 * burst, its name, a lime "NEW" pill (or the count in the name), the fun fact and Continue.
 */
export function RevealCard({
  card,
  buttonTitle = 'Continue',
  onContinue,
  waiting = false,
}: {
  card: RevealCardView;
  buttonTitle?: string;
  onContinue: () => void;
  /** The server hasn't answered yet: more cards may follow. */
  waiting?: boolean;
}) {
  const { text, space, radius, device } = useTheme();
  const size = stickerTheme.revealSize[device];

  // Each card is mounted fresh (key = card.id), so the tap and the pop play once per card.
  useEffect(() => {
    tapHaptic();
  }, []);

  return (
    <View
      style={[styles.fill, { padding: space[6], gap: space[4] }]}
      testID="reveal-card"
    >
      {/* The card scrolls (small phones, large text); Continue below stays pinned and always reachable. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { gap: space[4] }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.center, { gap: space[2] }]}>
          <Text
            style={[text('sectionHeading'), styles.light]}
            testID="reveal-lead"
          >
            {card.lead}
          </Text>
          {card.lead2 ? (
            <Text style={[text('caption'), styles.dim]}>{card.lead2}</Text>
          ) : null}
        </View>

        <View style={styles.center}>
          {card.stickerKey ? (
            <Sticker
              stickerKey={card.stickerKey}
              size={size}
              pop
              shiny={card.shiny}
            />
          ) : (
            <Text
              style={[
                text('bigNumber'),
                styles.light,
                { fontSize: size / 2, lineHeight: size / 1.8 },
              ]}
            >
              🏆
            </Text>
          )}
        </View>

        <View style={[styles.center, { gap: space[3] }]}>
          <Text
            style={[text('screenTitle'), styles.light]}
            accessibilityRole="header"
            testID="reveal-headline"
          >
            {card.headline}
          </Text>
          {card.pill ? (
            <View
              style={[
                styles.pill,
                {
                  borderRadius: radius.pill,
                  paddingHorizontal: space[4],
                  paddingVertical: space[1],
                },
              ]}
            >
              <Text
                style={[text('caption'), styles.pillText]}
                testID="reveal-pill"
              >
                {card.pill}
              </Text>
            </View>
          ) : null}
          {card.fact ? (
            <Text style={[text('body'), styles.light, styles.fact]}>
              {card.fact}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={{ gap: space[2] }}>
        {waiting ? (
          <Text style={[text('caption'), styles.dim, styles.fact]}>
            Checking for surprises…
          </Text>
        ) : null}
        {/* The kit's primary button is ink on ink here, so the dark screen gets a lime one. */}
        <Pressable
          testID="reveal-continue"
          accessibilityRole="button"
          onPress={onContinue}
          style={({ pressed }) => [
            styles.button,
            {
              borderRadius: radius.button,
              minHeight: buttonMinHeight[device],
              opacity: pressed ? pressedOpacity : 1,
            },
          ]}
        >
          <Text style={text('button')}>{buttonTitle}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'space-between' },
  center: { alignItems: 'center' },
  light: { color: white, textAlign: 'center' },
  dim: { color: white, opacity: stickerTheme.dimOpacity, textAlign: 'center' },
  button: {
    backgroundColor: palette.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fact: { textAlign: 'center', opacity: stickerTheme.factOpacity },
  pill: { backgroundColor: palette.lime },
  pillText: { color: palette.ink },
});
