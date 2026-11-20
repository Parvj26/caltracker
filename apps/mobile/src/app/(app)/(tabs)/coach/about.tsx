import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { localDateOf } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { BackIcon } from '@/components/community/icons';
import { coachFirstName, coachSinceLabel, goalCountdown } from '@/lib/coach-tab';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { borderWidth } from '@caltracker/design-tokens';
import { palette, pressedOpacity, radius, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * About the coach (from the chat's header or its GOAL cell): who they are (photo, name, business, since when, their
 * bio) and the goal they set. Every line comes from real data and hides when empty.
 */
export default function CoachAboutScreen() {
  const { text } = useTheme();
  const router = useRouter();
  // Null while loading, when there is no coach link, or on first launch offline: the name then says "Your coach".
  const coach = useCoachProfile();
  const timeZone = useMemo(zone, []);
  const name = coach?.name.trim() || null;
  const first = coachFirstName(name);
  const since = coachSinceLabel(coach?.joinedAt, timeZone);
  const bio = coach?.bio.trim() || null;
  const goal = coach?.goal ?? null;
  const countdown = goal ? goalCountdown(goal.targetDate, localDateOf(new Date(), timeZone)) : null;

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          testID="coach-about-back"
          accessibilityRole="button"
          accessibilityLabel="Back to the chat"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/coach'))}
          style={({ pressed }) => [styles.back, pressed && { opacity: pressedOpacity }]}
        >
          <BackIcon />
        </Pressable>
        <View style={styles.who} accessibilityRole="header">
          <CoachAvatar name={name ?? 'Coach'} url={coach?.avatarUrl ?? null} size={120} ring={3} />
          <Text style={[text('screenTitle'), styles.name]} testID="coach-name" numberOfLines={2}>{name ?? 'Your coach'}</Text>
          {coach?.businessName ? <Text style={text('sectionHeading')} numberOfLines={1}>{coach.businessName}</Text> : null}
          {since ? <Text style={[text('body'), styles.muted]} testID="coach-since">{since}</Text> : null}
        </View>

        {bio ? (
          <View style={styles.about} testID="coach-about">
            <Text style={[text('sectionHeading'), styles.kicker, styles.muted]}>{first ? `About ${first}` : 'About your coach'}</Text>
            <Text style={[text('body'), styles.bio]}>{bio}</Text>
          </View>
        ) : null}

        {goal ? (
          <View style={styles.goal} testID="coach-goal">
            <View style={styles.goalText}>
              <Text style={[text('sectionHeading'), styles.kicker]}>{first ? `Your goal with ${first}` : 'Your goal'}</Text>
              <Text style={[text('screenTitle'), styles.goalTitle]}>{goal.goal}</Text>
            </View>
            {countdown ? (
              <View style={styles.countdown} testID="coach-goal-countdown">
                {countdown.number ? <Text style={[text('bigNumber'), styles.countdownNumber]}>{countdown.number}</Text> : null}
                <Text style={[text('sectionHeading'), styles.countdownLabel]}>{countdown.label}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: space[2], paddingBottom: space[6] },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, marginBottom: space[2] },
  who: { alignItems: 'center', gap: space[1] },
  name: { fontSize: 30, marginTop: space[3], textAlign: 'center' },
  muted: { color: palette.inkMuted },
  about: { marginTop: 22, padding: space[4.5], gap: space[2], borderRadius: radius.card, backgroundColor: palette.surface },
  kicker: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  bio: { fontSize: 16, lineHeight: 24 },
  goal: {
    marginTop: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2.5],
    paddingHorizontal: space[4],
    paddingVertical: space[3.5],
    borderRadius: radius.card,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.lime,
  },
  goalText: { flex: 1, gap: 2 },
  goalTitle: { fontSize: 17 },
  countdown: { alignItems: 'flex-end' },
  countdownNumber: { fontSize: 20 },
  countdownLabel: { fontSize: 12 },
});
