import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, ErrorText } from '@/components/ui';
import { PROGRESS_LOAD_FAILED } from '@/lib/body-api';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** A Progress section's top row: a round back button (to Progress), the title, and an optional action on the right. */
export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { text, space } = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.header, { gap: space[2] }]}>
      <Pressable
        testID="section-back"
        accessibilityRole="button"
        accessibilityLabel="Back to Progress"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/progress'))}
        style={({ pressed }) => [styles.back, pressed && { opacity: pressedOpacity }]}
      >
        <Text style={text('sectionHeading')} accessibilityElementsHidden importantForAccessibility="no">
          ‹
        </Text>
      </Pressable>
      <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header">
        {title}
      </Text>
      {right}
    </View>
  );
}

/** A row of choices where one is on (time ranges, periods). Each is at least 44 pt tall. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  label,
  testIDPrefix,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  testIDPrefix: string;
}) {
  const { text, radius, space } = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.segments, { borderRadius: radius.input, padding: space[1] }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={`${testIDPrefix}-${o.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => [styles.segment, { borderRadius: radius.input - 2 }, on && styles.segmentOn, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[text('sectionHeading'), on && styles.onText]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type StatTone = 'lime' | 'ink' | 'surface' | 'bg';

/** A small number with a label under it ("3/4" / "workouts"). One element for VoiceOver. */
export function StatBox({ value, label, sub, tone = 'surface', testID }: { value: string; label: string; sub?: string | null; tone?: StatTone; testID?: string }) {
  const { text, radius, space } = useTheme();
  const onInk = tone === 'ink';
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}
      style={[
        styles.stat,
        { borderRadius: radius.input + 2, padding: space[2.5], backgroundColor: palette[tone] },
        (tone === 'lime' || tone === 'bg') && styles.inked,
      ]}
    >
      <Text style={[text('bigNumber'), onInk && styles.onText]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[text('sectionHeading'), styles.small, onInk && styles.onText]}>{label}</Text>
      {sub ? <Text style={[text('sectionHeading'), styles.small, onInk && styles.onText]}>{sub}</Text> : null}
    </View>
  );
}

/** A bordered card (ink border), as in the Progress mockups. */
export function InkCard({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { radius, space } = useTheme();
  return (
    <View testID={testID} style={[styles.inkCard, { borderRadius: radius.card, padding: space[4], gap: space[2] }, style]}>
      {children}
    </View>
  );
}

/** Small bold capitals ("ESTIMATED MAX"). */
export function Overline({ children }: { children: string }) {
  const { text } = useTheme();
  return (
    <Text style={[text('sectionHeading'), styles.overline]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function OfflineNote({ show }: { show: boolean }) {
  const { text } = useTheme();
  return show ? <Text style={text('caption')}>Showing your saved progress. It updates when you’re online.</Text> : null;
}

/** Shown until something is on screen: a spinner while loading, or what went wrong and Try again when offline with no saved copy. */
export function LoadState({ status, hasData, onRetry, busy }: { status: 'loading' | 'ready' | 'offline'; hasData: boolean; onRetry: () => void; busy: boolean }) {
  const { space } = useTheme();
  if (hasData) return null;
  if (status === 'offline') {
    return (
      <View style={{ gap: space[2] }} testID="progress-load-error">
        <ErrorText>{PROGRESS_LOAD_FAILED}</ErrorText>
        <Button variant="secondary" title="Try again" onPress={onRetry} busy={busy} />
      </View>
    );
  }
  return status === 'loading' ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  back: { width: tapTarget.min, height: tapTarget.min, borderRadius: tapTarget.min / 2, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', backgroundColor: palette.surface },
  segment: { flex: 1, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: palette.ink },
  onText: { color: white },
  stat: { flex: 1, minWidth: 0 },
  inked: { borderWidth: borderWidth.card, borderColor: palette.ink },
  small: { fontSize: 12 },
  inkCard: { borderWidth: borderWidth.card, borderColor: palette.ink, backgroundColor: palette.bg },
  overline: { textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 13 },
});
