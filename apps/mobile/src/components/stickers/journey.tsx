import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AlbumModel } from '@/lib/album-logic';
import { palette, stickerTheme } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { Sticker } from './sticker';

const DOT = stickerTheme.pathDot;

/** Section 1: "🔥 3-week streak", a path of dots (filled up to this week), "next: ...", and the landmarks collected. */
export function Journey({ journey, onOpen }: { journey: AlbumModel['journey']; onOpen: (key: string) => void }) {
  const { text, space } = useTheme();
  return (
    <View style={{ gap: space[3] }} testID="zoo-journey">
      <Text style={text('sectionHeading')} accessibilityRole="header" testID="zoo-streak">
        {journey.title}
      </Text>
      <View style={[styles.path, { gap: space[1] }]} accessible accessibilityLabel={`${journey.streak} weeks of the journey`}>
        {journey.dots.map((d) => (
          <View key={d.key} style={[styles.dot, d.reached && styles.dotOn]} />
        ))}
      </View>
      <Text style={text('caption')} testID="zoo-next">
        {journey.nextLabel}
      </Text>
      {journey.collected.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[3] }}>
          {journey.collected.map((c) => (
            <Tappable key={c.key} id={`zoo-landmark-${c.key}`} label={c.name} onPress={() => onOpen(c.key)}>
              <View style={styles.landmark}>
                <Sticker stickerKey={c.key} size={stickerTheme.landmarkSize} variant="sm" />
                {c.count > 1 ? <Text style={[text('caption'), styles.ink]}>{c.badge}</Text> : null}
              </View>
            </Tappable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Tappable({ id, label, onPress, children }: { id: string; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  path: { flexDirection: 'row', flexWrap: 'wrap' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  dotOn: { backgroundColor: palette.magenta, borderColor: palette.magenta },
  landmark: { alignItems: 'center' },
  ink: { color: palette.ink },
});
