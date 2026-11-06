import Link from 'next/link';
import { notFound } from 'next/navigation';
import { awardHasPrs, completedSetCount, formatLogDuration, formatLogVolume, isPlannedLog, logDurationS, logVolumeKg } from '@caltracker/shared';
import { LocalDateTime } from '@/app/(coach)/activity/local-date-time';
import { LocalDate } from '@/app/(coach)/workouts/local-date';
import { Chip } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { loadLog } from '@/lib/logs';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadClient } from '../../client';
import { Comments, type CommentView } from './comments';
import { CorrectForm } from './correct-form';
import { ClientNote } from './planned-vs-actual';
import styles from './log.module.css';

/** One logged workout: planned against actual, comments, and corrections. A past client's log stays readable. */
export default async function LogPage({ params }: { params: Promise<{ clientId: string; logId: string }> }) {
  const { workspaceId, userId, units } = await requireCoach();
  const { clientId, logId } = await params;
  const supabase = await createServerSupabase();
  const [client, loaded] = await Promise.all([loadClient(supabase, workspaceId, clientId), loadLog(supabase, logId)]);
  // RLS limits the log to this coach's workspace; it must also belong to the client in the URL.
  if (!client || !loaded || loaded.clientId !== client.id) notFound();
  const { log, correctedAt } = loaded;

  const swappedIds = [...new Set(log.blocks.flatMap((b) => b.exercises.flatMap((e) => (e.swappedFromExerciseId ? [e.swappedFromExerciseId] : []))))];
  const [comments, swapped, award] = await Promise.all([
    supabase.from('workout_log_comments').select('id, body, created_at, author_id').eq('log_id', log.id).order('created_at').order('id'),
    swappedIds.length ? supabase.from('exercises').select('id, name').in('id', swappedIds) : Promise.resolve({ data: [], error: null }),
    supabase.from('awards').select('result').eq('log_id', log.id).maybeSingle(),
  ]);
  if (award.error) throw new Error(`Could not load awards: ${award.error.message}`);
  if (comments.error) throw new Error(`Could not load comments: ${comments.error.message}`);
  if (swapped.error) throw new Error(`Could not load exercises: ${swapped.error.message}`);
  const authorIds = [...new Set(comments.data.flatMap((c) => (c.author_id ? [c.author_id] : [])))];
  const authors = authorIds.length ? await supabase.from('profiles').select('id, full_name').in('id', authorIds) : { data: [], error: null };
  if (authors.error) throw new Error(`Could not load comment authors: ${authors.error.message}`);
  const authorName = new Map((authors.data ?? []).map((a) => [a.id, a.full_name || 'Coach']));

  const commentViews: CommentView[] = comments.data.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    authorName: c.author_id === userId ? 'You' : (authorName.get(c.author_id ?? '') ?? 'Coach'),
    mine: c.author_id === userId,
  }));
  const swappedFrom = Object.fromEntries(swapped.data.map((e) => [e.id, e.name]));
  const sets = completedSetCount(log);
  const volumeKg = logVolumeKg(log);

  return (
    <div className={styles.page}>
      <Link href={`/clients/${client.id}`} className={styles.back}>
        ← {client.name}&apos;s calendar
      </Link>
      <header className={styles.titleBlock}>
        <h1 className={styles.title}>{log.name}</h1>
        <p className={styles.caption}>
          {client.name}
          {client.removedAt ? ' (past client)' : ''}
        </p>
        <ul className={styles.facts}>
          <li>
            Started <LocalDateTime iso={log.startedAt} />
          </li>
          {log.finishedAt ? (
            <li>
              Finished <LocalDateTime iso={log.finishedAt} />
            </li>
          ) : null}
          <li>{formatLogDuration(logDurationS(log))}</li>
          <li>{sets} {sets === 1 ? 'set' : 'sets'}</li>
          {volumeKg > 0 ? <li>{formatLogVolume(volumeKg, units)}</li> : null}
        </ul>
        <div className={styles.chips}>
          {log.status !== 'completed' ? <Chip>{log.status === 'in_progress' ? 'In progress' : 'Discarded'}</Chip> : null}
          {awardHasPrs(award.data?.result) ? <Chip tone="lime">PR</Chip> : null}
          {log.autoFinished ? <Chip tone="amber">Auto-finished</Chip> : null}
          {isPlannedLog(log) ? null : <Chip>Unplanned</Chip>}
          {correctedAt ? (
            <Chip tone="blue">
              Edited by coach · <LocalDate iso={correctedAt} />
            </Chip>
          ) : null}
        </div>
        <ClientNote text={log.notes} label="Client's note on this workout" />
      </header>

      <CorrectForm log={log} units={units} swappedFrom={swappedFrom} canCorrect={log.status === 'completed'} />
      <Comments logId={log.id} comments={commentViews} />
    </div>
  );
}
