import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { usePathname } from 'expo-router';
import { PostHogProvider } from 'posthog-react-native';
import { RageTapDetector, scrubUrl } from '@caltracker/shared';
import { useSession } from '@/lib/session';
import { getAnalyticsClient, getTaskTracker, identifyPerson, resetAnalytics, screen, track } from './client';
import { routeTaskSteps } from './route-tasks';
import { isTap } from './tap-filter';

/** Size of the grid that groups nearby taps when spotting rage taps (the responder gives no element). */
const TAP_CELL = 44;

/**
 * Starts analytics on the phone: names the signed-in client, records screens (secrets scrubbed), feeds taps,
 * back presses and background/foreground to the task tracker, spots rage taps and counts notification opens.
 * Touch autocapture keeps only `ph-label` (never on-screen text or accessibility labels).
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const client = getAnalyticsClient();
  const { session, workspace } = useSession();
  const pathname = usePathname();
  const recent = useRef<string[]>([]);
  const rage = useRef(new RageTapDetector());
  const signedInAs = useRef<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const user = session?.user ?? null;
  useEffect(() => {
    if (!user) {
      if (signedInAs.current) resetAnalytics();
      signedInAs.current = null;
      return;
    }
    signedInAs.current = user.id;
    const meta = user.user_metadata as { first_name?: string; last_name?: string } | undefined;
    const name = `${meta?.first_name ?? ''} ${meta?.last_name ?? ''}`.trim() || (user.email ?? '');
    identifyPerson({
      id: user.id,
      name,
      email: user.email ?? '',
      workspaceId: workspace?.workspaceId ?? null,
      workspaceName: workspace?.workspaceName ?? null,
    });
  }, [user, workspace]);

  useEffect(() => {
    const name = scrubUrl(pathname);
    screen(name);
    const tracker = getTaskTracker();
    // Coming back to the screen before the last one counts as going back.
    const r = recent.current;
    if (r.length >= 2 && r[r.length - 2] === name) tracker.back();
    recent.current = [...r.slice(-4), name];
    tracker.screen(name);
    for (const step of routeTaskSteps(name)) {
      if (step.action === 'start') tracker.start(step.task);
      else if (step.action === 'complete') tracker.complete(step.task);
      else tracker.abandon(step.task);
    }
  }, [pathname]);

  useEffect(() => {
    const tracker = getTaskTracker();
    track('app_opened');
    tracker.start('find_todays_workout');
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') tracker.backgrounded();
      if (state === 'active') {
        tracker.foregrounded();
        track('app_opened');
        tracker.start('find_todays_workout');
      }
    });
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      tracker.back();
      return false;
    });
    const notifSub = Notifications.addNotificationResponseReceivedListener((r) => {
      const kind = (r.notification.request.content.data as { kind?: unknown } | undefined)?.kind;
      track('notification_opened', { kind: typeof kind === 'string' ? kind : 'unknown' });
    });
    return () => {
      sub.remove();
      backSub.remove();
      notifSub.remove();
    };
  }, []);

  const content = (
    <View
      style={{ flex: 1 }}
      // Plain touch events see every touch without taking it from buttons. Only touches that barely move
      // count as taps, so scrolls and swipes don't inflate taps or look like rage taps.
      onTouchStart={(e) => {
        touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        const end = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        if (!start || !isTap(start, end)) return;
        getTaskTracker().tap();
        const where = scrubUrl(pathname);
        const cell = `${where}:${Math.round(end.x / TAP_CELL)}:${Math.round(end.y / TAP_CELL)}`;
        if (rage.current.tap(cell)) track('rage_tap', { screen: where });
      }}
    >
      {children}
    </View>
  );

  if (!client) return content;
  return (
    <PostHogProvider
      client={client}
      autocapture={{
        captureTouches: true,
        captureScreens: false,
        customLabelProp: 'ph-label',
        // Developer labels only (ph-label, testID); never on-screen text or accessibility labels.
        propsToCapture: ['ph-label', 'testID'],
        maxElementsCaptured: 10,
      }}
    >
      {content}
    </PostHogProvider>
  );
}
