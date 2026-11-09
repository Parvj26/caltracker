import { Image, StyleSheet, Text, View } from 'react-native';
import { Card, HandNote } from '@/components/ui';
import { CoachAvatar } from '@/components/coach-avatar';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import capybara from '../../assets/stickers/capybara-locked@256.png';
import corgi from '../../assets/stickers/corgi-locked@256.png';
import elephant from '../../assets/stickers/elephant-locked@256.png';

const NEXT_STEPS = ['Your coach builds your plan', 'Workouts show up here', 'Log your sets and earn stickers'] as const;
const STICKERS = [corgi, capybara, elephant] as const;

type Props = {
  coachName: string | null;
  workspaceName: string;
};

/** Today for a client with no workouts at all yet: meet the coach, what happens next, sticker teaser. (kg/lb lives in Settings.) */
export function FirstTimeWelcome({ coachName, workspaceName }: Props) {
  const { text, space, radius } = useTheme();
  const coach = useCoachProfile();
  const shownName = coach?.name ?? coachName;

  return (
    <>
      <Card>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          Meet your coach
        </Text>
        <View style={[styles.row, { gap: space[3] }]}>
          <CoachAvatar name={coach?.name ?? coachName ?? workspaceName} url={coach?.avatarUrl ?? null} />
          <View style={styles.flex}>
            {shownName ? <Text style={text('sectionHeading')}>{shownName}</Text> : null}
            <Text style={text('body')}>{coach?.businessName ?? workspaceName}</Text>
          </View>
        </View>
        {coach?.bio ? (
          <Text testID="coach-bio" style={text('body')}>
            {coach.bio}
          </Text>
        ) : null}
        <HandNote>Your first workout is coming!</HandNote>
      </Card>

      <Card>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          What happens next
        </Text>
        {NEXT_STEPS.map((step, i) => (
          <View key={step} style={[styles.row, { gap: space[3] }]}>
            <View
              style={[styles.stepNumber, { borderRadius: radius.pill }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={text('sectionHeading')}>{i + 1}</Text>
            </View>
            <Text style={[text('body'), styles.flex]} accessibilityLabel={`Step ${i + 1}: ${step}`}>
              {step}
            </Text>
          </View>
        ))}
      </Card>


      <Card>
        <View
          style={[styles.stickers, { gap: space[3] }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {STICKERS.map((src, i) => (
            <View key={i} style={[styles.stickerTile, { borderRadius: radius.card, padding: space[2] }]}>
              <Image source={src} style={styles.sticker} resizeMode="contain" accessible={false} />
            </View>
          ))}
        </View>
        <Text style={text('body')}>Finish your first workout to unlock your first sticker.</Text>
      </Card>
    </>
  );
}


const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 120 },
  stepNumber: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.lime },
  stickers: { flexDirection: 'row', justifyContent: 'space-between' },
  // The locked silhouettes are pale grey: a slightly darker tile with a border keeps them visible on white.
  stickerTile: { flex: 1, aspectRatio: 1, backgroundColor: palette.surface, borderWidth: 2, borderColor: palette.border },
  sticker: { width: '100%', height: '100%' },
});
