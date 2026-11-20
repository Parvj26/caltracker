import { useLocalSearchParams, useRouter } from 'expo-router';
import { STICKERS, canReopen, logVolumeKg, sessionBestRows, type AwardResult, type WorkoutLogDoc } from '@caltracker/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { OffScreen, ShareCard } from '@/components/stickers/share-card';
import { Sticker } from '@/components/stickers/sticker';
import { Button, Card, ErrorText, Screen, TextButton, Toast } from '@/components/ui';
import { stickerSentence, workoutShareLine } from '@/lib/album-logic';
import { fetchAward } from '@/lib/awards';
import { SHARE_NOT_READY, prShareCard, shareHref, workoutShareCard } from '@/lib/community-share';
import { ActionMenu } from '@/components/log/action-menu';
import { useSaveCard } from '@/lib/use-save-card';
import { milestoneLine, summaryStickers } from '@/lib/awards-logic';
import { effortLine, formatCommentTime, summaryHeadline, unfinishedLines } from '@/lib/active-log-logic';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useHub } from '@/lib/use-progress-data';
import { coachFirstName } from '@/lib/workouts-plan';
import { fontFamilyFor } from '@/theme/fonts';
import { LoggedByCoachPill } from '@/components/log/coach-logging-banner';
import { useCoachLogging } from '@/lib/coach-logging';
import { fetchComments, fetchLog, type LogComment } from '@/lib/log-api';
import { planChanges } from '@/lib/log-flow-model';
import { useExerciseDetails } from '@/lib/use-exercise-details';
import { REOPEN_OFFLINE, useActiveLog } from '@/lib/use-active-log';
import { useUnits } from '@/lib/use-units';
import { palette, stickerTheme } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const LOAD_FAILED = 'Couldn’t load this workout. Check your connection and try again.';
/** Saving the stickers usually takes a moment; after this long the summary says it is still saving. */
const AWARD_SLOW_MS = 10_000;
const AWARD_RETRY_MS = 2000;
const AWARD_RETRY_MAX_MS = 30_000;
/** The phone's time zone: which day a workout belongs to, as the Strength screen reads it. */
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

type Remote = { kind: 'loading' } | { kind: 'ok'; log: WorkoutLogDoc | null } | { kind: 'failed' };
type Comments = { kind: 'loading' } | { kind: 'ok'; comments: LogComment[] } | { kind: 'offline' };

/**
 * A finished workout (approved Summary board): sets, skipped, time and weight; what the client told the coach; changes
 * from the plan; each exercise's best set against last time ("Heaviest yet" by the Strength rule); the sticker with its
 * maths; a milestone (shown here once, never later as a surprise); the coach's comment; Share and Done. Done goes back
 * to where the workout was opened from. Right after Finish it shows the log the phone remembers, so it works with no
 * signal; opened later (Today's done row, History) it reads the log from the server.
 */
export default function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const units = useUnits();
  const { finishedLog, log: active, pending, reopen } = useActiveLog();
  // The phone's own copy first (it works with no signal): just finished, or still waiting to upload.
  const local =
    finishedLog?.id === id
      ? finishedLog
      : active?.id === id && active.status === 'completed'
        ? active
        : (pending.find((p) => p.id === id && p.status === 'completed') ?? null);

  const [remote, setRemote] = useState<Remote>({ kind: 'loading' });
  const [comments, setComments] = useState<Comments>({ kind: 'loading' });
  const [award, setAward] = useState<AwardResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reopening, setReopening] = useState(false);
  const card = useRef<HostInstance>(null);
  const { save: saveImage, toast: saveToast, clearToast } = useSaveCard(card);
  const hasLocal = local !== null;
  const coach = useCoachLogging(id, false);
  const coachFirst = coachFirstName(useCoachProfile()?.name);
  // Earlier workouts' best sets (the Progress tab's saved series), for "+2.5 kg vs last time" and "Heaviest yet".
  const hub = useHub(attempt);
  const history = useMemo(
    () => (hub.data ? new Map(hub.data.exercises.map((e) => [e.exerciseId, e.points])) : null),
    [hub.data],
  );
  // The award normally arrives within a few seconds; after ~10 s without it, say so and offer Try again.
  const [slowAward, setSlowAward] = useState(false);
  const [shareMenu, setShareMenu] = useState(false);

  useEffect(() => {
    if (hasLocal) return;
    let alive = true;
    setRemote({ kind: 'loading' });
    fetchLog(id)
      .then((log) => alive && setRemote({ kind: 'ok', log }))
      .catch(() => alive && setRemote({ kind: 'failed' }));
    return () => {
      alive = false;
    };
  }, [id, hasLocal, attempt]);

  useEffect(() => {
    let alive = true;
    setComments({ kind: 'loading' });
    fetchComments(id)
      .then((c) => alive && setComments({ kind: 'ok', comments: c }))
      .catch(() => alive && setComments({ kind: 'offline' }));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  // The stickers and personal bests this workout earned. Best effort: with no signal (or before the award is
  // stored) the row is simply left out.
  // Keeps asking (with growing gaps) while the screen is open, since the reveal's request may still be saving it. The
  // "still saving" note shows only right after Finish on this phone, never for an older workout (History, a coach's).
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setSlowAward(false);
    const slow = hasLocal ? setTimeout(() => alive && setSlowAward(true), AWARD_SLOW_MS) : undefined;
    const load = (wait: number): void =>
      void fetchAward(id).then((a) => {
        if (!alive) return;
        if (a) {
          clearTimeout(slow);
          setSlowAward(false);
          setAward(a);
        } else {
          retry = setTimeout(() => load(Math.min(wait * 2, AWARD_RETRY_MAX_MS)), wait);
        }
      });
    load(AWARD_RETRY_MS);
    return () => {
      alive = false;
      clearTimeout(slow);
      clearTimeout(retry);
    };
  }, [id, attempt, hasLocal]);

  const done = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/today')), [router]);

  const log = local ?? (remote.kind === 'ok' ? remote.log : null);
  // The names of exercises swapped out: the log keeps only their ids.
  const swappedFrom = useMemo(
    () => (log ? log.blocks.flatMap((b) => b.exercises.flatMap((e) => (e.swappedFromExerciseId ? [e.swappedFromExerciseId] : []))) : []),
    [log],
  );
  const names = useExerciseDetails(swappedFrom);

  if (units === null || (log === null && remote.kind === 'loading')) {
    return (
      <Screen>
        <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" />
      </Screen>
    );
  }

  if (log === null || log.status !== 'completed') {
    return (
      <Screen>
        <Card>
          {remote.kind === 'failed' ? (
            <>
              <ErrorText code="workout_load_failed">{LOAD_FAILED}</ErrorText>
              <Button variant="secondary" title="Try again" onPress={() => setAttempt((n) => n + 1)} />
            </>
          ) : (
            <Text style={text('sectionHeading')}>
              {log === null
                ? 'Couldn’t find this workout.'
                : log.status === 'in_progress'
                  ? 'This workout is still going.'
                  : 'This workout wasn’t finished.'}
            </Text>
          )}
          <Button title="Done" testID="summary-done" onPress={done} />
        </Card>
      </Screen>
    );
  }

  const changes = [...planChanges(log, (exerciseId) => names[exerciseId]?.name ?? null), ...unfinishedLines(log)];
  const best = sessionBestRows(log, history, units, timeZone());
  const said = effortLine(log.notes, coachFirst);
  // What can be shared: the workout and, when it set any, its PRs. Both need the award on the server (the database
  // builds the card from the log and its award), so until it arrives Share says so.
  const workoutCard = workoutShareCard(log, award);
  const mayReopen = canReopen(log, Date.now());
  const ladder = award?.ladder ?? null;
  const ladderName = ladder ? (STICKERS.find((s) => s.key === ladder.key)?.name ?? ladder.key) : null;
  const milestone = milestoneLine(award);
  const theirComments = comments.kind === 'ok' ? comments.comments : [];

  const addMissedSets = async () => {
    setReopening(true);
    try {
      const open = await reopen(log.id);
      router.replace({ pathname: '/log/[id]', params: { id: open.id } });
    } catch (e) {
      Alert.alert(e instanceof Error && e.message ? e.message : REOPEN_OFFLINE);
    } finally {
      setReopening(false);
    }
  };

  const prCard = prShareCard(log, award);
  // Share: the workout card, or (when it set PRs) a choice of the workout or the PRs.
  const share = () => {
    if (!workoutCard) return Alert.alert(SHARE_NOT_READY);
    if (!prCard) return router.push(shareHref(workoutCard));
    setShareMenu(true);
  };

  const footer = (
    <View style={[styles.row, { gap: space[2.5] }]}>
      <Button variant="secondary" title="Share" testID="summary-share" onPress={share} />
      <View style={styles.flex}>
        <Button title="Done" testID="summary-done" onPress={done} />
      </View>
    </View>
  );

  return (
    <Screen footer={footer}>
      <View style={{ gap: space[1] }}>
        <Text style={[text('sectionHeading'), styles.doneLabel]}>{log.autoFinished ? 'Finished for you' : 'Workout done ✓'}</Text>
        <Text style={[text('screenTitle'), styles.title]} accessibilityRole="header" testID="summary-name">
          {log.name}
        </Text>
        {coach.byCoach ? <LoggedByCoachPill /> : null}
        <Text testID="summary-sets" style={[text('body'), styles.bold]}>
          {summaryHeadline(log, units)}
        </Text>
        {said ? (
          <Text testID="summary-effort" style={[text('body'), styles.soft]}>
            {said}
          </Text>
        ) : null}
      </View>

      {changes.length > 0 ? (
        <View testID="summary-changes" style={[styles.grey, { borderRadius: radius.input + 2, padding: space[3], gap: 2 }]}>
          <Text style={text('sectionHeading')} accessibilityRole="header">
            Changes from the plan
          </Text>
          <Text style={text('body')}>{changes.join(' · ')}</Text>
        </View>
      ) : null}

      {best.length > 0 ? (
        <View testID="summary-progress" style={{ gap: space[1] }}>
          <Text style={[text('sectionHeading'), styles.h2]} accessibilityRole="header">
            Your progress
          </Text>
          {best.map((r) => (
            <View
              key={r.exerciseId}
              testID={`summary-best-${r.exerciseId}`}
              accessible
              accessibilityLabel={[r.name, `best set ${r.best}`, r.compare?.text, r.heaviestYet ? 'heaviest yet' : null].filter(Boolean).join(', ')}
              style={[styles.row, styles.bestRow, { paddingVertical: space[3], gap: space[3] }]}
            >
              <View style={styles.flex}>
                <Text style={text('sectionHeading')}>{r.name}</Text>
                <Text style={[text('body'), styles.soft]}>{`Best set ${r.best}`}</Text>
              </View>
              <View style={[styles.end, { gap: space[1] }]}>
                {r.compare ? <Text style={[text('caption'), styles.bold, r.compare.tone === 'up' ? styles.up : styles.ink]}>{r.compare.text}</Text> : null}
                {r.heaviestYet ? (
                  <Text style={[text('caption'), styles.tag, { borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 2 }]}>Heaviest yet</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {ladder && ladderName ? (
        <View testID="summary-sticker" style={[styles.row, styles.grey, { borderRadius: radius.card, padding: space[3.5], gap: space[3.5] }]}>
          <Sticker stickerKey={ladder.key} size={64} shiny={ladder.shiny} variant="sm" />
          <View style={[styles.flex, { gap: 2 }]}>
            <Text style={text('sectionHeading')}>{ladder.isNew ? `New sticker: ${ladderName}` : `Sticker: ${ladderName}`}</Text>
            <Text style={[text('body'), styles.soft]}>{stickerSentence(logVolumeKg(log), units, ladder.multiple, ladderName)}</Text>
            <TextButton title="Save image" testID="summary-save-image" onPress={() => void saveImage()} />
          </View>
          <Toast message={saveToast} onHide={clearToast} testID="summary-save-toast" />
          <OffScreen>
            <ShareCard
              ref={card}
              stickerKey={ladder.key}
              shiny={ladder.shiny}
              line={workoutShareLine(logVolumeKg(log), units, ladder.multiple, ladderName)}
              subline={log.name}
            />
          </OffScreen>
        </View>
      ) : null}
      {award && summaryStickers(award).filter((x) => x.key !== ladder?.key).length > 0 ? (
        <View testID="summary-stickers" style={[styles.row, styles.wrap, { gap: space[3] }]}>
          {summaryStickers(award)
            .filter((x) => x.key !== ladder?.key)
            .map((x) => (
              <View key={x.key} style={[styles.centre, { gap: space[1] }]}>
                <Sticker stickerKey={x.key} size={stickerTheme.summarySize} shiny={x.shiny} variant="sm" />
                <Text style={text('caption')}>{x.label}</Text>
              </View>
            ))}
        </View>
      ) : null}
      {milestone ? (
        <View testID="summary-milestone" style={[styles.row, styles.celebrate, { borderRadius: radius.card, padding: space[3.5], gap: space[3] }]}>
          <Text style={[text('screenTitle'), styles.ink]}>🏆</Text>
          <Text style={[text('sectionHeading'), styles.flex]}>{`${milestone}! A milestone worth celebrating.`}</Text>
        </View>
      ) : null}

      {theirComments.length > 0 ? (
        <View testID="summary-comments" style={[styles.outlined, { borderRadius: radius.input + 2, padding: space[3], gap: space[2] }]}>
          <Text style={text('sectionHeading')}>{`${coachFirst ?? 'Your coach'} commented`}</Text>
          {theirComments.map((c) => (
            <View key={c.id} testID={`comment-${c.id}`} style={{ gap: 2 }}>
              <Text style={text('body')}>{c.body}</Text>
              <Text style={[text('caption'), styles.soft]}>{formatCommentTime(c.createdAt)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {slowAward ? (
        <View testID="summary-award-slow" style={[styles.row, styles.slow, { borderRadius: radius.input + 2, padding: space[3], gap: space[2.5] }]}>
          <Text style={[text('body'), styles.flex]}>Still saving your stickers… If this takes long they’ll show here when it’s ready.</Text>
          <Button variant="secondary" title="Try again" testID="summary-award-retry" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : null}

      <ActionMenu
        title={shareMenu ? 'Share' : null}
        items={[
          ...(workoutCard ? [{ title: 'Share this workout', testID: 'summary-share-workout', onPress: () => router.push(shareHref(workoutCard)) }] : []),
          ...(prCard ? [{ title: 'Share your PRs', testID: 'summary-share-prs', onPress: () => router.push(shareHref(prCard)) }] : []),
        ]}
        onClose={() => setShareMenu(false)}
      />

      {mayReopen ? <TextButton title="Add missed sets" testID="summary-reopen" onPress={() => void addMissedSets()} /> : null}
      {reopening ? <ActivityIndicator color={palette.ink} accessibilityLabel="Opening" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  flex: { flex: 1 },
  end: { alignItems: 'flex-end' },
  centre: { alignItems: 'center' },
  title: { fontSize: 30 },
  h2: { fontSize: 18, marginTop: 4 },
  doneLabel: { color: palette.ink, fontSize: 14 },
  bold: { fontFamily: fontFamilyFor('sans', 700) },
  ink: { color: palette.ink },
  soft: { color: palette.inkMuted },
  up: { color: palette.magentaDeep },
  grey: { backgroundColor: palette.surface },
  outlined: { borderWidth: borderWidth.secondaryButton, borderColor: palette.border },
  bestRow: { borderBottomWidth: 1, borderBottomColor: palette.border, minHeight: 56 },
  tag: { backgroundColor: palette.pink, color: palette.ink, overflow: 'hidden', fontFamily: fontFamilyFor('sans', 800) },
  celebrate: { backgroundColor: palette.celebrateBg },
  slow: { backgroundColor: palette.celebrateBg },
});
