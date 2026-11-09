import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { BellIcon } from '@/components/settings/icons';
import { Button, TextButton } from '@/components/ui';
import { PUSH_CARD_SNOOZE_MS, pushCardSnoozeKey, pushCardText, showPushCard } from '@/lib/push-logic';
import { usePush } from '@/lib/use-push';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * Today's "Never miss a workout" card (approved Main board): asks for notifications only while iOS has never asked.
 * "Later" hides it for 7 days on this phone. Permission is never asked on first launch, only from here (or the first
 * time a workout starts). A new client sees it too, worded for their first workout (approved new-client board).
 */
export function PushCard({ userId, coachName, firstTime }: { userId: string; coachName: string | null; firstTime: boolean }) {
  const { text, space, radius } = useTheme();
  const { permission, requestPermission, refreshPermission } = usePush();
  // undefined until read from the phone, so the card never flashes before a snooze is known.
  const [snoozedUntil, setSnoozedUntil] = useState<number | null | undefined>(undefined);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(pushCardSnoozeKey(userId))
      .then((v) => alive && setSnoozedUntil(v ? Number(v) || null : null))
      .catch(() => alive && setSnoozedUntil(null));
    return () => {
      alive = false;
    };
  }, [userId]);

  // The first workout's ask may have answered meanwhile.
  useFocusEffect(
    useCallback(() => {
      refreshPermission();
    }, [refreshPermission]),
  );

  if (snoozedUntil === undefined) return null;
  if (!showPushCard({ permission, snoozedUntil, now: Date.now() })) return null;

  const later = () => {
    const until = Date.now() + PUSH_CARD_SNOOZE_MS;
    setSnoozedUntil(until);
    AsyncStorage.setItem(pushCardSnoozeKey(userId), String(until)).catch(() => undefined);
  };

  return (
    <View testID="push-card" style={[styles.card, { borderRadius: radius.card, padding: space[4], gap: space[3] }]}>
      <View style={[styles.row, { gap: space[2.5] }]}>
        <View style={styles.bell}>
          <BellIcon size={20} />
        </View>
        <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header">
          Never miss a workout
        </Text>
      </View>
      <Text style={text('body')}>{pushCardText(coachName, firstTime)}</Text>
      <View style={[styles.row, { gap: space[3] }]}>
        <View style={styles.flex}>
          <Button
            testID="push-card-allow"
            title="Turn on notifications"
            busy={asking}
            onPress={() => {
              setAsking(true);
              void requestPermission().finally(() => setAsking(false));
            }}
          />
        </View>
        <TextButton testID="push-card-later" title="Later" onPress={later} />
      </View>
      <Text style={text('caption')}>You can change these anytime in Settings.</Text>
    </View>
  );
}

const BELL = 40;

const styles = StyleSheet.create({
  card: { backgroundColor: palette.drop, borderWidth: borderWidth.card, borderColor: palette.ink },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  bell: {
    width: BELL,
    height: BELL,
    borderRadius: BELL / 2,
    backgroundColor: palette.bg,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
