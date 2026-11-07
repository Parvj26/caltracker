import { useLocalSearchParams, useRouter } from 'expo-router';
import { STICKERS, canReopen, logVolumeKg, type AwardResult, type WorkoutLogDoc } from '@caltracker/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View, type HostInstance } from 'react-native';
import { OffScreen, ShareCard } from '@/components/stickers/share-card';
import { Sticker } from '@/components/stickers/sticker';
import { Button, Card, ErrorText, Screen } from '@/components/ui';
import { workoutShareLine } from '@/lib/album-logic';
import { fetchAward } from '@/lib/awards';
import { SAVE_MESSAGES, saveCardToPhotos } from '@/lib/save-image';
import { prPills, summaryStickers } from '@/lib/awards-logic';
import { formatCommentTime, summaryLines } from '@/lib/active-log-logic';
import { fetchComments, fetchLog, type LogComment } from '@/lib/log-api';
import { planChanges } from '@/lib/log-flow-model';
import { useExerciseDetails } from '@/lib/use-exercise-details';
import { REOPEN_OFFLINE, useActiveLog } from '@/lib/use-active-log';
import { useUnits } from '@/lib/use-units';
import { palette, stickerTheme } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const LOAD_FAILED = 'Couldn’t load this workout. Check your connection and try again.';

type Remote = { kind: 'loading' } | { kind: 'ok'; log: WorkoutLogDoc | null } | { kind: 'failed' };
type Comments = { kind: 'loading' } | { kind: 'ok'; comments: LogComment[] } | { kind: 'offline' };

/**
 * A finished workout: name, duration, volume, completed sets and the coach's comments (read only).
 * Right after Finish it shows the log the phone remembers, so it works with no signal; opened later (Today's
 * View) it reads the log from the server. Comments are best effort: without signal they wait.
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
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const hasLocal = local !== null;

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
  useEffect(() => {
    let alive = true;
    void fetchAward(id).then((a) => alive && setAward(a));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

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
              <ErrorText>{LOAD_FAILED}</ErrorText>
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

  const lines = summaryLines(log, units);
  const changes = planChanges(log, (exerciseId) => names[exerciseId]?.name ?? null);
  const mayReopen = canReopen(log, Date.now());

  const ladder = award?.ladder ?? null;
  const ladderName = ladder ? (STICKERS.find((s) => s.key === ladder.key)?.name ?? ladder.key) : null;
  const saveImage = async () => {
    setSaving(true);
    setSaveNote(null);
    setSaveNote(SAVE_MESSAGES[await saveCardToPhotos(card)]);
    setSaving(false);
  };

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

  return (
    <Screen>
      <View style={{ gap: space[1] }}>
        <Text style={text('caption')}>{log.autoFinished ? 'Finished for you' : 'Workout done ✓'}</Text>
        <Text style={text('screenTitle')} accessibilityRole="header" testID="summary-name">
          {log.name}
        </Text>
      </View>

      {/* Text on the lime pastel is always ink, never muted. */}
      <View style={[styles.stats, { borderRadius: radius.card, padding: space[4.5], gap: space[2.5] }]}>
        <Text testID="summary-duration" style={[text('caption'), styles.ink]}>
          {lines.duration}
        </Text>
        {lines.volume ? (
          <Text testID="summary-volume" style={text('bigNumber')}>
            {lines.volume}
          </Text>
        ) : null}
        <Text testID="summary-sets" style={text('sectionHeading')}>
          {lines.sets}
        </Text>
      </View>

      {changes.length > 0 ? (
        <View style={{ gap: space[2] }} testID="summary-changes">
          <Text style={text('sectionHeading')} accessibilityRole="header">
            Changes from the plan
          </Text>
          {changes.map((c, i) => (
            // Two identical lines are possible (the same swap in two slots), so the key includes the position.
            <Text key={`${i}-${c}`} style={text('body')}>
              {c}
            </Text>
          ))}
        </View>
      ) : null}

      {award && summaryStickers(award).length > 0 ? (
        <View style={{ gap: space[2] }} testID="summary-stickers">
          <Text style={text('sectionHeading')} accessibilityRole="header">
            Stickers earned
          </Text>
          <View style={[styles.row, { gap: space[3] }]}>
            {summaryStickers(award).map((s) => (
              <View key={s.key} style={[styles.sticker, { gap: space[1] }]}>
                <Sticker stickerKey={s.key} size={stickerTheme.summarySize} shiny={s.shiny} variant="sm" />
                <Text style={text('caption')}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {ladder && ladderName ? (
        <View style={{ gap: space[2] }}>
          <Button variant="secondary" title="Save image" testID="summary-save-image" busy={saving} onPress={() => void saveImage()} />
          {saveNote ? (
            <Text style={text('caption')} testID="summary-save-note" accessibilityLiveRegion="polite">
              {saveNote}
            </Text>
          ) : null}
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

      {award && award.prs.length > 0 ? (
        <View style={[styles.row, { gap: space[2] }]} testID="summary-prs">
          {prPills(award, log).map((p) => (
            <View key={p} style={[styles.pill, { borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: space[1] }]}>
              <Text style={[text('caption'), styles.ink]}>PR · {p}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Card>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          Coach comments
        </Text>
        {comments.kind === 'loading' ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading comments" /> : null}
        {comments.kind === 'offline' ? (
          <Text style={text('caption')}>Comments will show when you’re online.</Text>
        ) : null}
        {comments.kind === 'ok' && comments.comments.length === 0 ? (
          <Text style={text('caption')}>No comments from your coach yet.</Text>
        ) : null}
        {comments.kind === 'ok'
          ? comments.comments.map((c) => (
              <View
                key={c.id}
                testID={`comment-${c.id}`}
                style={[styles.comment, { borderRadius: radius.input, padding: space[3], gap: space[1] }]}
              >
                <Text style={text('body')}>{c.body}</Text>
                <Text style={text('caption')}>{formatCommentTime(c.createdAt)}</Text>
              </View>
            ))
          : null}
      </Card>

      {mayReopen ? (
        <Button
          variant="secondary"
          title="Add missed sets"
          testID="summary-reopen"
          busy={reopening}
          onPress={() => void addMissedSets()}
        />
      ) : null}
      <Button title="Done" testID="summary-done" onPress={done} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { backgroundColor: palette.lime },
  ink: { color: palette.ink },
  comment: { backgroundColor: palette.surface },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  sticker: { alignItems: 'center' },
  pill: { backgroundColor: palette.pink },
});
