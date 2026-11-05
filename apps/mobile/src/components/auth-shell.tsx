import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, HandNote, Logo, Screen } from '@/components/ui';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const SAMPLE_TILES = [
  { label: 'Streak', value: '🔥 12', bg: palette.pink, tilt: '-2deg' },
  { label: 'This week', value: '4/5', bg: palette.lime, tilt: '1.5deg' },
  { label: 'New PRs', value: '🎉 3', bg: palette.blue, tilt: '-1deg' },
] as const;

/** Branded frame for the signed-out screens: logo, a few decorative sample tiles, then the form card. */
export function AuthShell({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const { text, space, radius } = useTheme();
  return (
    <Screen centred>
      <Logo size="lg" />
      {/* A taste of the app. Decorative only, hidden from screen readers. */}
      <View
        style={[styles.tiles, { gap: space[2.5] }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {SAMPLE_TILES.map((t) => (
          <View
            key={t.label}
            style={[
              styles.tile,
              { backgroundColor: t.bg, borderRadius: radius.card, padding: space[3], transform: [{ rotate: t.tilt }] },
            ]}
          >
            <Text style={[text('caption'), styles.inkOnPastel]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
              {t.label}
            </Text>
            <Text style={text('bigNumber')} maxFontSizeMultiplier={1.3} numberOfLines={1}>
              {t.value}
            </Text>
          </View>
        ))}
      </View>
      <Card>
        <View style={{ gap: space[2] }}>
          <Text style={text('screenTitle')} accessibilityRole="header">
            {title}
          </Text>
          {note ? <HandNote>{note}</HandNote> : null}
        </View>
        {children}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row' },
  tile: { flex: 1 },
  inkOnPastel: { color: palette.ink },
});
