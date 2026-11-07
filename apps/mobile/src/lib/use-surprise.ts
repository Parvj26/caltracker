// "Surprise!": the extra stickers a finished workout earned that the reveal couldn't show (offline, or the server
// was slow). Checked when Today comes into view and when the app returns to the foreground; the first award
// that has something to show opens the reveal screen in its surprise mode. Then a workout the coach finished that
// this phone hasn't revealed yet (coach-reveal.ts) opens the full reveal (?coach=1), animal and all.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { collectPending, pendingQueue } from './awards';
import { nextCoachReveal } from './coach-reveal';
import { surpriseCards } from './awards-logic';
import { useSession } from './session';

export function useSurpriseReveal(): void {
  const userId = useSession().session?.user.id ?? null;
  const router = useRouter();
  const checking = useRef(false);

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
      const coached = await nextCoachReveal(userId);
      if (coached) router.push({ pathname: '/log/[id]/reveal', params: { id: coached, coach: '1' } });
    } finally {
      checking.current = false;
    }
  }, [userId, router]);

  // Only while Today is the screen in view: useFocusEffect cleans the listener up when something opens on top.
  useFocusEffect(
    useCallback(() => {
      void check();
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') void check();
      });
      return () => sub.remove();
    }, [check]),
  );
}
