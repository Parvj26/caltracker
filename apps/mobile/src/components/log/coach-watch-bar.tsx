// Watching the coach log (single active logger): a slim bar over the normal logging pages, which are read only
// below it and follow the coach's saves live (coach-watch.ts). "Continue on my phone" appears here once the coach has
// stopped (20 minutes without activity), as on the full banner.
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { idleMinutes } from '@/lib/active-log-logic';
import type { CoachLogging } from '@/lib/coach-logging';
import { watchLine } from '@/lib/coach-watch';
import { contentMaxWidth, palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const READ_ONLY_NOTE = 'Your coach is logging this session. You can look through it, but not change anything.';

/** The window's real insets, for what draws over the whole screen (sheets) below the bar's override. */
const WindowInsetsContext = createContext<EdgeInsets | null>(null);

/**
 * Sheets (Modals) cover the whole window, so they get the window's own insets back, not the screen's top-0 copy.
 * Today they only use the native SafeAreaView, which measures for itself; this keeps a future useSafeAreaInsets()
 * in a sheet right too.
 */
export function WindowInsets({ children }: { children: ReactNode }) {
  const window = useContext(WindowInsetsContext);
  return window ? <SafeAreaInsetsContext.Provider value={window}>{children}</SafeAreaInsetsContext.Provider> : <>{children}</>;
}

/**
 * The logging screen, with the bar on top while `coach` is given (null: the client logs, no bar). The tree stays the
 * same either way, so a hand back or reclaim keeps the client on the same page.
 */
export function CoachWatchFrame({ coach, children }: { coach: CoachLogging | null; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  // Below the bar the screens must not leave room for the status bar again.
  const below = coach ? { ...insets, top: 0 } : insets;
  return (
    <View style={styles.fill}>
      {coach ? <CoachWatchBar coach={coach} top={insets.top} /> : null}
      <WindowInsetsContext.Provider value={insets}>
        <SafeAreaInsetsContext.Provider value={below}>{children}</SafeAreaInsetsContext.Provider>
      </WindowInsetsContext.Provider>
    </View>
  );
}

function CoachWatchBar({ coach, top }: { coach: CoachLogging; top: number }) {
  const { text, space } = useTheme();
  const idle = coach.lastActivityAt ? idleMinutes(coach.lastActivityAt, Date.now()) : 0;

  // VoiceOver: say once that the workout became read only (the pages below no longer take changes).
  const said = useRef(false);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    AccessibilityInfo.announceForAccessibility(READ_ONLY_NOTE);
  }, []);

  return (
    <View
      testID="coach-watch-bar"
      style={[styles.bar, { paddingTop: top + space[2], paddingBottom: space[2], paddingHorizontal: space[4] }]}
    >
      <View testID="coach-logging-banner" style={[styles.column, { gap: space[2] }]}>
        <Text
          style={[text('sectionHeading'), styles.ink]}
          accessibilityRole="header"
          accessibilityLabel={coach.canReclaim ? undefined : READ_ONLY_NOTE}
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.6}
        >
          {coach.canReclaim ? 'Your coach stopped logging' : 'Your coach is logging this session'}
        </Text>
        {coach.canReclaim ? (
          <>
            <Text style={[text('body'), styles.ink]}>{`Your coach stopped logging ${idle} min ago. You can carry on here.`}</Text>
            <Button title="Continue on my phone" testID="coach-logging-reclaim" busy={coach.reclaiming} onPress={() => void coach.reclaim()} />
          </>
        ) : (
          <Text
            testID="coach-watch-read-only"
            style={[text('caption'), styles.ink]}
            // Said only when it changes to "Reconnecting…" and back (the header already says it is read only).
            accessibilityLiveRegion="polite"
          >
            {watchLine(coach.live)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  // Text on a pastel tile is always ink, never muted.
  bar: { backgroundColor: palette.blue },
  ink: { color: palette.ink },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
});
