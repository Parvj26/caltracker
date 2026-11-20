// Today for a client with no workouts at all yet (approved board 3, trimmed on the less-text board LT3): meet the
// coach and the stickers to collect. The notifications card sits between them (today.tsx).
import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { CoachAvatar } from '@/components/coach-avatar';
import { Button } from '@/components/ui';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useMessages } from '@/lib/use-messages';
import { palette, radius, TITLE_MAX_SCALE } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import capybara from '../../../assets/stickers/capybara-locked@256.png';
import corgi from '../../../assets/stickers/corgi-locked@256.png';
import elephant from '../../../assets/stickers/elephant-locked@256.png';
import { Overline } from './parts';
import { COACH_CHAT_HREF, Hero } from './today-cards';

const LOCKED = [corgi, capybara, elephant] as const;

/** "Your coach": photo, name, business (and the coach's bio when they wrote one), and Say hi, which opens the chat. */
export function CoachIntroCard({ coachName, workspaceName }: { coachName: string | null; workspaceName: string }) {
  const { text, space } = useTheme();
  const router = useRouter();
  const coach = useCoachProfile();
  const chat = useMessages();
  const name = coach?.name ?? coachName;
  const first = name?.trim().split(/\s+/)[0] || null;

  return (
    <Hero tone="drop" testID="today-new-coach">
      <View style={[styles.row, { gap: space[3] }]}>
        <CoachAvatar name={name ?? workspaceName} url={coach?.avatarUrl ?? null} size={56} ring={2} />
        <View style={styles.flex}>
          <Overline>Your coach</Overline>
          {name ? (
            <Text style={[text('screenTitle'), styles.name]} accessibilityRole="header" maxFontSizeMultiplier={TITLE_MAX_SCALE}>
              {name}
            </Text>
          ) : null}
          <Text style={[text('caption'), styles.business]}>{coach?.businessName ?? workspaceName}</Text>
        </View>
      </View>
      {coach?.bio ? (
        <Text testID="coach-bio" style={text('body')}>
          {coach.bio}
        </Text>
      ) : null}
      <Text testID="today-building-plan" style={[text('sectionHeading'), styles.coming]}>{`${first ?? 'Your coach'} is building your plan`}</Text>
      {chat ? (
        <Button variant="secondary" title={first ? `Say hi to ${first}` : 'Say hi to your coach'} testID="today-say-hi" onPress={() => router.navigate(COACH_CHAT_HREF)} />
      ) : null}
    </Hero>
  );
}

export function StickerTeaser() {
  const { text, space } = useTheme();
  return (
    <View testID="today-sticker-teaser" style={[styles.teaser, { padding: space[4], gap: space[2.5] }]}>
      <Text style={[text('sectionHeading'), styles.title]} accessibilityRole="header">
        Collect animal stickers
      </Text>
      <View style={[styles.row, { gap: space[2] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {LOCKED.map((src, i) => (
          <View key={i} style={[styles.locked, { padding: space[2] }]}>
            <Image source={src} style={styles.lockedImage} resizeMode="contain" accessible={false} />
          </View>
        ))}
      </View>
      <Text style={[text('body'), styles.unlock]}>Finish a workout to unlock one</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  name: { fontSize: 22 },
  business: { color: palette.ink, fontSize: 14 },
  coming: { color: palette.magentaDeep },
  title: { fontSize: 18 },
  teaser: { backgroundColor: palette.celebrateBg, borderWidth: borderWidth.card, borderColor: palette.ink, borderRadius: radius.card },
  locked: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: palette.bg,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    borderStyle: 'dashed',
  },
  lockedImage: { width: '100%', height: '100%' },
  unlock: { fontSize: 14 },
});
