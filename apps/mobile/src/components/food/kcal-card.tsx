import { StyleSheet, Text, View } from 'react-native';
import type { KcalCard as KcalCardData } from '@caltracker/shared';
import { palette } from '@/theme/theme';
import { font, inkShadow } from './food-type';

const NAMES = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' } as const;

/** The lime card: kcal left (or the day's total), a bar per macro, and who set the targets. */
export function KcalCard({ card, coachName }: { card: KcalCardData; coachName: string | null }) {
  const footer = card.hasTargets ? (coachName ? `Targets set by ${coachName}` : 'Targets set by your coach') : "Your coach hasn't set targets yet";
  return (
    <View style={[styles.card, inkShadow]} accessibilityLabel={`${card.headline} ${card.caption}`} testID="food-kcal-card">
      <View style={styles.head}>
        <Text style={[font(800, 34), styles.big]} testID="food-kcal-headline">
          {card.headline}
        </Text>
        <Text style={font(700, 16)} testID="food-kcal-caption">
          {card.caption}
        </Text>
      </View>
      {card.bars.map((b) => {
        const pct = b.fraction === null ? null : Math.round(Math.min(1, b.fraction) * 100);
        return (
          <View key={b.key} style={styles.bar}>
            <View style={styles.barHead}>
              <Text style={[font(800, 14), styles.flex]}>{NAMES[b.key]}</Text>
              <Text style={font(700, 13)} testID={`food-bar-${b.key}`}>
                {b.text}
              </Text>
            </View>
            <View
              style={styles.track}
              accessibilityRole="image"
              accessibilityLabel={pct === null ? `${NAMES[b.key]} ${b.text}` : `${NAMES[b.key]} ${pct} percent`}
            >
              {pct !== null ? <View style={[styles.fill, { width: `${pct}%` }]} /> : null}
            </View>
          </View>
        );
      })}
      <Text style={font(700, 12)} testID="food-targets-by">
        {footer}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.lime, borderWidth: 2, borderColor: palette.ink, borderRadius: 22, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  big: { lineHeight: 38 },
  bar: { gap: 4 },
  barHead: { flexDirection: 'row', alignItems: 'baseline' },
  flex: { flex: 1 },
  track: { height: 12, borderRadius: 6, backgroundColor: palette.bg, borderWidth: 1.5, borderColor: palette.ink, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: palette.ink },
});
