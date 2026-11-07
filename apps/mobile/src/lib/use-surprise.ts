// "Surprise!": the extra stickers a finished workout earned that the reveal couldn't show (offline, or the server
// was slow). Checked when Today comes into view and when the app returns to the foreground; the first award
// that has something to show opens the reveal screen in its surprise mode. Then a workout the coach finished that
// this phone hasn't revealed yet (coach-reveal.ts) opens the full reveal (?coach=1), animal and all.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { collectPending, pendingQueue } from './awards';
import { nextCoachReveal } from './coach-reveal';
import { canShowCoachReveal } from './coach-reveal-logic';
import { useActiveLog } from './use-active-log';
import { surpriseCards } from './awards-logic';
import { useSession } from './session';

export function useSurpriseReveal(): void {
  const userId = useSession().session?.user.id ?? null;
  const router = useRouter();
  const checking = useRef(false);
  // Read after each await: the client may have started a workout, or left Today, while the check ran.
  const { log } = useActiveLog();
  const active = useRef(log);
  active.current = log;
  const focused = useRef(false);

  const check = useCallback(async () => {
    if (!userId || checking.current) return;
    checking.current = true;
    try {
      for (const e of await collectPending(userId)) {
        if (!e.result) continue;
        // Units only matter for the "You lifted" line, which a surprise card doesn't show.
        if (surpriseCards(e.result, 'kg', e.volumeKg).length > 0) {
          router.push({ pathname: '/log/[id]/reveal', params: { id: e.logId, surprise: '1' } });
          return;
        }
        await pendingQueue(userId).remove(e.logId); // nothing to show: forget it
      }
      // A coach-finished workout waits while a workout is in progress (the client's own, or one they are watching
      // the coach log); it shows the next time they are on Today with nothing open.
      if (!canShowCoachReveal(active.current, focused.current)) return;
      const coached = await nextCoachReveal(userId);
      if (coached && canShowCoachReveal(active.current, focused.current)) {
        router.push({ pathname: '/log/[id]/reveal', params: { id: coached, coach: '1' } });
      }
    } finally {
      checking.current = false;
    }
  }, [userId, router]);

  // A workout stopped being in progress while Today is in view (finished elsewhere, or by the coach): check now.
  const inProgress = log?.status === 'in_progress';
  useEffect(() => {
    if (!inProgress && focused.current) void check();
  }, [inProgress, check]);

  // Only while Today is the screen in view: useFocusEffect cleans the listener up when something opens on top.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void check();
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') void check();
      });
      return () => {
        focused.current = false;
        sub.remove();
      };
    }, [check]),
  );
}
