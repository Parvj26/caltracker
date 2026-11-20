import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { BellIcon } from '@/components/settings/icons';
import { CloseIcon } from '@/components/ui/icons';
import { afterPushDismiss, pushCardDismissKey, pushCardSnoozeKey, pushCardText, showPushCard } from '@/lib/push-logic';
import { usePush } from '@/lib/use-push';
import { fontFamilyFor } from '@/theme/fonts';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type Stored = { snoozedUntil: number | null; dismissals: number };

async function readStored(userId: string): Promise<Stored> {
  const [until, count] = await Promise.all([AsyncStorage.getItem(pushCardSnoozeKey(userId)), AsyncStorage.getItem(pushCardDismissKey(userId))]);
  return { snoozedUntil: until ? Number(until) || null : null, dismissals: Number(count) || 0 };
}

/**
 * Today's notifications banner (approved Main board): a small grey strip BELOW the workout card, shown only while iOS
 * has never asked. iOS asks only from its Turn on button (never on Start, never on first launch). × (Not now) hides it
 * for a week; after the second time it never comes back (Settings -> Notifications still turns them on).
 */
export function PushCard({ userId, coachName }: { userId: string; coachName: string | null }) {
  const { text, space } = useTheme();
  const { permission, requestPermission, refreshPermission } = usePush();
  // undefined until read from the phone, so the banner never flashes before a snooze is known.
  const [stored, setStored] = useState<Stored | undefined>(undefined);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    readStored(userId)
      .then((v) => alive && setStored(v))
      .catch(() => alive && setStored({ snoozedUntil: null, dismissals: 0 }));
    return () => {
      alive = false;
    };
  }, [userId]);

  // Settings may have answered meanwhile.
  useFocusEffect(
    useCallback(() => {
      refreshPermission();
    }, [refreshPermission]),
  );

  if (stored === undefined) return null;
  if (!showPushCard({ permission, snoozedUntil: stored.snoozedUntil, dismissals: stored.dismissals, now: Date.now() })) return null;

  const notNow = () => {
    const next = afterPushDismiss(stored.dismissals, Date.now());
    setStored(next);
    AsyncStorage.setItem(pushCardSnoozeKey(userId), String(next.snoozedUntil)).catch(() => undefined);
    AsyncStorage.setItem(pushCardDismissKey(userId), String(next.dismissals)).catch(() => undefined);
  };

  return (
    <View testID="push-card" style={[styles.banner, { paddingLeft: space[3.5], paddingRight: space[1], paddingVertical: space[2], gap: space[3] }]}>
      <BellIcon size={22} />
      <Text style={[text('body'), styles.line]}>{pushCardText(coachName)}</Text>
      <Pressable
        testID="push-card-allow"
        onPress={() => {
          setAsking(true);
          void requestPermission().finally(() => setAsking(false));
        }}
        disabled={asking}
        accessibilityRole="button"
        accessibilityLabel="Turn on notifications"
        style={({ pressed }) => [styles.turnOn, { paddingHorizontal: space[3.5] }, pressed && styles.pressed]}
      >
        {asking ? <ActivityIndicator color={palette.ink} /> : <Text style={[text('sectionHeading'), styles.turnOnText]}>Turn on</Text>}
      </Pressable>
      <Pressable
        testID="push-card-later"
        onPress={notNow}
        accessibilityRole="button"
        accessibilityLabel="Not now"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <CloseIcon color={palette.inkMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, backgroundColor: palette.surface },
  line: { flex: 1, fontSize: 14, fontFamily: fontFamilyFor('sans', 700) },
  turnOn: {
    minHeight: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  turnOnText: { fontSize: 14 },
  close: { width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: pressedOpacity },
});
