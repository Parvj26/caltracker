import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEAL_TYPES, foodDayLabel, mealTypeForMinutes, type IsoDate } from '@caltracker/shared';
import { capWhen, pickerDays, stepWhen, timeLabel, whenForMealType, whenLabel, type When } from '@/lib/food-logic';
import { contentMaxWidth, palette, pressedOpacity, stickerTheme, white } from '@/theme/theme';
import { font, foodText } from './food-type';
import { CaretIcon, CloseIcon } from './icons';

/**
 * "Lunch · Today, 1:15 PM ▾": when the meal was eaten (the meal type comes from the time). Tapping it opens the
 * picker: meal chips that set a usual time in one tap, the day (today and the six before) and the time in quarter
 * hours (going past midnight moves the day). Never a time still to come. Changes apply as they are made; Done closes.
 */
export function WhenLine({ when, today, onChange, testID = 'meal-when' }: { when: When; today: IsoDate; onChange: (w: When) => void; testID?: string }) {
  const [open, setOpen] = useState(false);
  const label = whenLabel(when, today);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Change when`}
        testID={testID}
        style={({ pressed }) => [styles.line, pressed && { opacity: pressedOpacity }]}
      >
        <Text style={font(700, 16)} testID={`${testID}-label`}>
          {label}
        </Text>
        <CaretIcon />
      </Pressable>
      <WhenSheet visible={open} when={when} today={today} onChange={onChange} onClose={() => setOpen(false)} />
    </>
  );
}

function WhenSheet({ visible, when, today, onChange, onClose }: { visible: boolean; when: When; today: IsoDate; onChange: (w: When) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const days = pickerDays(today);
  const oldest = days[days.length - 1] ?? today;
  const type = mealTypeForMinutes(when.minutes);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no" accessibilityElementsHidden />
      <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]} accessibilityViewIsModal testID="when-sheet">
        <View style={styles.column}>
          <View style={styles.head}>
            <Text style={[font(800, 20), styles.flex]} accessibilityRole="header">
              When did you eat?
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" testID="when-close" style={({ pressed }) => [styles.close, pressed && { opacity: pressedOpacity }]}>
              <CloseIcon />
            </Pressable>
          </View>

          <Text style={foodText.overline}>Meal</Text>
          <View style={styles.wrap}>
            {MEAL_TYPES.map((t) => (
              <Chip key={t} label={t} selected={t === type} testID={`when-type-${t}`} onPress={() => onChange(whenForMealType(t, when))} />
            ))}
          </View>

          <Text style={foodText.overline}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {days.map((d) => (
              <Chip key={d} label={foodDayLabel(d, today)} selected={d === when.day} testID={`when-day-${d}`} onPress={() => onChange(capWhen({ ...when, day: d }))} />
            ))}
          </ScrollView>

          <Text style={foodText.overline}>Time</Text>
          <View style={styles.timeRow}>
            <Stepper glyph="−" label="15 minutes earlier" testID="when-earlier" onPress={() => onChange(capWhen(stepWhen(when, -1, today, oldest)))} />
            <Text style={[font(800, 20), styles.time]} accessibilityLiveRegion="polite" testID="when-time">
              {timeLabel(when.minutes).toUpperCase()}
            </Text>
            <Stepper glyph="+" label="15 minutes later" testID="when-later" onPress={() => onChange(capWhen(stepWhen(when, 1, today, oldest)))} />
          </View>

          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Done" testID="when-done" style={({ pressed }) => [styles.done, pressed && { opacity: pressedOpacity }]}>
            <Text style={[font(800, 17), styles.onInk]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={[font(700, 15), selected && styles.onInk]}>{label}</Text>
    </Pressable>
  );
}

function Stepper({ glyph, label, onPress, testID }: { glyph: string; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={({ pressed }) => [styles.stepper, pressed && { opacity: pressedOpacity }]}>
      <Text style={font(800, 24)}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  scrim: { flex: 1, backgroundColor: palette.ink, opacity: stickerTheme.scrimOpacity },
  sheet: { backgroundColor: palette.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingHorizontal: 16 },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center', gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: palette.borderStrong, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  onInk: { color: white },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  time: { minWidth: 110, textAlign: 'center' },
  stepper: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  done: { marginTop: 6, minHeight: 52, borderRadius: 26, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
});
