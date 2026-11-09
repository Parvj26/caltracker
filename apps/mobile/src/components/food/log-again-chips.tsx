import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { chipMacroLine, type MealSearchItem } from '@caltracker/shared';
import { palette, pressedOpacity } from '@/theme/theme';
import { font, foodText } from './food-type';

/** "Log again in one tap": up to three of the client's usual meals. Hidden when there are none. */
export function LogAgainChips({ items, onPick }: { items: MealSearchItem[]; onPick: (item: MealSearchItem) => void }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={[foodText.overline, styles.pad]} accessibilityRole="header">
        Log again in one tap
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => {
          const meta = chipMacroLine(item.macros);
          return (
            <Pressable
              key={item.key}
              onPress={() => onPick(item)}
              accessibilityRole="button"
              accessibilityLabel={`Log ${item.name} again${meta ? `, ${meta}` : ''}`}
              testID={`food-again-${item.name}`}
              style={({ pressed }) => [styles.chip, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={font(800, 14)}>+ {item.name}</Text>
              {meta ? <Text style={[font(500, 12), foodText.muted]}>{meta}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  pad: { paddingHorizontal: 4 },
  row: { gap: 8 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
  },
});
