import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { HELP_LEGAL_ROWS, versionLine, type HelpLegalKey } from '@/lib/help-legal';
import { appRelease, openHelpLegal } from '@/lib/open-help-legal';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ChevronIcon, DocumentIcon, HelpIcon, LockIcon } from './icons';

const ICONS: Record<HelpLegalKey, ReactNode> = { help: <HelpIcon />, privacy: <LockIcon />, terms: <DocumentIcon /> };

/** Settings' "HELP & LEGAL" box: Help & feedback, Privacy policy and Terms of use. */
export function HelpLegalSection() {
  const { text, space, radius } = useTheme();
  return (
    <View style={[styles.box, { borderRadius: radius.card }]}>
      <Text style={[text('caption'), styles.heading, { paddingHorizontal: space[4], paddingTop: space[3.5], paddingBottom: space[1] }]}>
        HELP & LEGAL
      </Text>
      {HELP_LEGAL_ROWS.map((row, i) => (
        <Pressable
          key={row.key}
          testID={row.testID}
          onPress={() => void openHelpLegal(row)}
          accessibilityRole={row.url ? 'link' : 'button'}
          accessibilityLabel={row.detail ? `${row.label}, ${row.detail}` : row.label}
          style={({ pressed }) => [
            styles.row,
            { gap: space[3], paddingHorizontal: space[4] },
            i < HELP_LEGAL_ROWS.length - 1 && styles.divider,
            pressed && styles.pressed,
          ]}
        >
          {ICONS[row.key]}
          <View style={styles.flex}>
            <Text style={text('sectionHeading')}>{row.label}</Text>
            {row.detail ? <Text style={text('caption')}>{row.detail}</Text> : null}
          </View>
          <ChevronIcon />
        </Pressable>
      ))}
    </View>
  );
}

/** "CalTracker 1.0.0 (3)" at the foot of Settings. */
export function AppVersionLine() {
  const { text } = useTheme();
  return (
    <Text style={[text('caption'), styles.centre]} testID="settings-version">
      {versionLine(appRelease())}
    </Text>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: borderWidth.card, borderColor: palette.ink, overflow: 'hidden' },
  heading: { letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  divider: { borderBottomWidth: borderWidth.card, borderBottomColor: palette.border },
  flex: { flex: 1 },
  pressed: { opacity: pressedOpacity },
  centre: { textAlign: 'center', alignSelf: 'center' },
});
