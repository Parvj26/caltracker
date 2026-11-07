import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { logVolumeKg, type AwardResult, type LadderAward, type WorkoutLogDoc } from '@caltracker/shared';
import { RevealCard } from '@/components/stickers/reveal-card';
import { loadLadderAwards, pendingQueue, rememberLadderPick, requestAward } from '@/lib/awards';
import { buildRevealCards, surpriseCards } from '@/lib/awards-logic';
import { markCoachRevealed } from '@/lib/coach-reveal';
import { fetchLog } from '@/lib/log-api';
import { useSession } from '@/lib/session';
import { useActiveLog } from '@/lib/use-active-log';
import { useUnits } from '@/lib/use-units';
import { buttonMinHeight } from '@caltracker/design-tokens';
import { palette, pressedOpacity, stickerTheme, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * The big reveal after Finish: a dark full screen showing the sticker this workout's weight earned, then any
 * extra cards (drop, rare find, landmark, milestone) the server awards. Finish -> reveal -> summary.
 *
 *   * the ladder card comes from this phone's own log at once, so it shows with no signal: the same shared rule as
 *     the server, with the client's earlier animals (read from the server for up to 1.5 s, else the phone's copy)
 *   * the server's answer is waited for up to 4 s; after that the extras are queued and shown as "Surprise!" the
 *     next time the app opens (?surprise=1 is that second showing, read from the queue)
 *   * a workout with nothing to show (cardio only, nothing new) goes straight on to the summary
 *   * ?coach=1: a workout the coach finished (single active logger). Says "Your coach logged this session"; the log
 *     comes from the server when it isn't on this phone; once shown it is remembered as revealed here
 *     (coach-reveal.ts), so Today doesn't show it again
 */
export default function RevealScreen() {
  const { id, surprise, coach } = useLocalSearchParams<{
    id: string;
    surprise?: string;
    coach?: string;
  }>();
  const isSurprise = surprise === '1';
  const byCoach = coach === '1' && !isSurprise;
  const router = useRouter();
  const units = useUnits();
  const { text, space, radius, device } = useTheme();
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  const { finishedLog, log: active, pending, ready } = useActiveLog();

  const local =
    finishedLog?.id === id
      ? finishedLog
      : active?.id === id && active.status === 'completed'
        ? active
        : (pending.find((p) => p.id === id && p.status === 'completed') ??
          null);
  // Coach-finished: the server's copy when this phone has none (the client never opened it, or it has left).
  const [fetched, setFetched] = useState<WorkoutLogDoc | 'none' | null>(null);
  useEffect(() => {
    if (!byCoach || local || !ready) return;
    let alive = true;
    fetchLog(id)
      .then((l) => alive && setFetched(l?.status === 'completed' ? l : 'none'))
      .catch(() => alive && setFetched('none'));
    return () => {
      alive = false;
    };
  }, [byCoach, local, ready, id]);
  const log = local ?? (fetched && fetched !== 'none' ? fetched : null);

  const [award, setAward] = useState<AwardResult | null>(null);
  const [settled, setSettled] = useState(false);
  const [queued, setQueued] = useState<
    { result: AwardResult; volumeKg: number } | null | 'none'
  >(null);
  const [index, setIndex] = useState(0);
  // The client's earlier ladder animals, for the preview; null while loading.
  const [ladderAwards, setLadderAwards] = useState<LadderAward[] | null>(null);
  const left = useRef(false);
  const asked = useRef(false);

  const toSummary = useCallback(() => {
    left.current = true;
    router.replace({ pathname: '/log/[id]/summary', params: { id } });
  }, [router, id]);
  const toToday = useCallback(() => {
    left.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/today');
  }, [router]);

  // Just finished: ask the server once.
  useEffect(() => {
    if (isSurprise || !log || !userId || asked.current) return;
    asked.current = true;
    void requestAward(
      log.id,
      userId,
      logVolumeKg(log),
      () => left.current,
    ).then((r) => {
      setAward(r);
      setSettled(true);
    });
  }, [isSurprise, log, userId]);
  useEffect(
    () => () => {
      left.current = true;
    },
    [],
  );

  useEffect(() => {
    if (isSurprise || !userId) return;
    if (!workspaceId) {
      setLadderAwards([]);
      return;
    }
    let alive = true;
    void loadLadderAwards(userId, workspaceId).then((a) => alive && setLadderAwards(a));
    return () => {
      alive = false;
    };
  }, [isSurprise, userId, workspaceId]);

  // Surprise: the award the queue is holding for this log.
  useEffect(() => {
    if (!isSurprise || !userId) return;
    let alive = true;
    void pendingQueue(userId)
      .list()
      .then((all) => {
        const e = all.find((x) => x.logId === id);
        if (alive)
          setQueued(
            e?.result ? { result: e.result, volumeKg: e.volumeKg } : 'none',
          );
      });
    return () => {
      alive = false;
    };
  }, [isSurprise, userId, id]);

  const cards = useMemo(() => {
    if (units === null) return [];
    if (isSurprise)
      return queued && queued !== 'none'
        ? surpriseCards(queued.result, units, queued.volumeKg)
        : [];
    return log && ladderAwards ? buildRevealCards(log, award, units, ladderAwards) : [];
  }, [units, isSurprise, queued, log, award, ladderAwards]);

  // The animal shown counts for the next workout's preview until the server's list has it.
  const shownKey = !isSurprise && cards[0]?.type === 'ladder' ? cards[0].stickerKey : null;
  useEffect(() => {
    if (!shownKey || !log?.finishedAt || !userId || !workspaceId) return;
    void rememberLadderPick(userId, workspaceId, { logId: log.id, finishedAt: log.finishedAt, key: shownKey });
  }, [shownKey, log?.id, log?.finishedAt, userId, workspaceId]);

  const finish = useCallback(async () => {
    if (isSurprise && userId) await pendingQueue(userId).remove(id);
    if (isSurprise) toToday();
    else toSummary();
  }, [isSurprise, userId, id, toToday, toSummary]);

  // Nothing to reveal: on to the summary (or back to Today for an empty surprise).
  const nothing = isSurprise
    ? queued === 'none' || (queued !== null && cards.length === 0)
    : settled && units !== null && ladderAwards !== null && cards.length === 0;
  const missing = !isSurprise && ready && !log && (!byCoach || fetched === 'none');
  useEffect(() => {
    if (nothing) void finish();
    else if (missing) toSummary();
  }, [nothing, missing, finish, toSummary]);

  // No card yet and the server hasn't answered: let the client move on instead of staring at a spinner.
  const waitingForServer =
    !isSurprise && !settled && ladderAwards !== null && cards.length === 0 && !missing;

  const card = cards[Math.min(index, cards.length - 1)];
  const last = index >= cards.length - 1;

  // Coach-finished: shown (or nothing to show) once is enough; Today won't open it again. Not when it couldn't load.
  const shown = card !== undefined || nothing;
  useEffect(() => {
    if (byCoach && shown && userId) void markCoachRevealed(userId, id);
  }, [byCoach, shown, userId, id]);

  return (
    <SafeAreaView style={styles.screen} testID="reveal-screen">
      {byCoach ? (
        <Text
          testID="reveal-coach-line"
          style={[text('sectionHeading'), styles.coachLine, { marginTop: space[4], paddingHorizontal: space[6] }]}
          accessibilityRole="header"
        >
          Your coach logged this session
        </Text>
      ) : null}
      {card ? (
        <RevealCard
          key={card.id}
          card={card}
          waiting={!isSurprise && !settled && last}
          onContinue={() => (last ? void finish() : setIndex((i) => i + 1))}
        />
      ) : (
        <View style={styles.wait}>
          {nothing || missing ? null : (
            <ActivityIndicator
              color={palette.lime}
              accessibilityLabel="Loading"
            />
          )}
          {waitingForServer ? (
            <>
              <Text
                style={[
                  text('caption'),
                  styles.waitText,
                  { opacity: stickerTheme.dimOpacity, marginTop: space[3] },
                ]}
              >
                Checking for surprises…
              </Text>
              {/* The late answer is already queued (abandoned()), so leaving now loses nothing. */}
              <Pressable
                testID="reveal-continue"
                accessibilityRole="button"
                onPress={toSummary}
                style={({ pressed }) => [
                  styles.waitButton,
                  {
                    borderRadius: radius.button,
                    minHeight: buttonMinHeight[device],
                    marginTop: space[6],
                    paddingHorizontal: space[6],
                    opacity: pressed ? pressedOpacity : 1,
                  },
                ]}
              >
                <Text style={text('button')}>Continue</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.ink },
  wait: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  waitText: { color: white, textAlign: 'center' },
  coachLine: { color: palette.lime, textAlign: 'center' },
  waitButton: {
    backgroundColor: palette.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
