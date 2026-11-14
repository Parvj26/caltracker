import type { Metadata } from 'next';
import Link from 'next/link';
import {
  LOG_TREE_SELECT,
  awardHasPrs,
  completedSetCount,
  formatLogDuration,
  formatLogVolume,
  isLoggedByCoach,
  isPlannedLog,
  logDurationS,
  logReviewByLog,
  logRowToDoc,
  logVolumeKg,
  type LogTreeRow,
} from '@caltracker/shared';
import { Card } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';
import { renderTime } from '@/lib/live-refresh';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { ClientFilter } from './client-filter';
import { ActivityFeed, type FeedRow } from './activity-feed';
import styles from './activity.module.css';

export const metadata: Metadata = { title: 'Activity' };

const PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ client?: string | string[]; page?: string | string[] }> }) {
  const { workspaceId, units } = await requireCoach();
  const query = await searchParams;
  const clientParam = first(query.client);
  const clientFilter = clientParam && UUID.test(clientParam) ? clientParam : null;
  const pageNumber = Math.max(1, Math.min(10_000, Number.parseInt(first(query.page) ?? '1', 10) || 1));
  const from = (pageNumber - 1) * PAGE_SIZE;

  const supabase = await createServerSupabase();
  let logsQuery = supabase
    .from('workout_logs')
    .select(`client_id, logged_by, ${LOG_TREE_SELECT}`)
    .eq('workspace_id', workspaceId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .order('id', { ascending: false })
    // One extra row tells whether there is a next page.
    .range(from, from + PAGE_SIZE);
  if (clientFilter) logsQuery = logsQuery.eq('client_id', clientFilter);

  const [logs, members, past] = await Promise.all([
    logsQuery,
    supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'client'),
    supabase.from('past_clients').select('user_id, email, full_name').eq('workspace_id', workspaceId),
  ]);
  if (logs.error) throw new Error(`Could not load activity: ${logs.error.message}`);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (past.error) throw new Error(`Could not load past clients: ${past.error.message}`);

  // Logs that set a personal best get a PR chip.
  const logIds = logs.data.slice(0, PAGE_SIZE).map((l) => (l as unknown as { id: string }).id);
  const awards = logIds.length
    ? await supabase.from('awards').select('log_id, result').in('log_id', logIds)
    : { data: [], error: null };
  if (awards.error) throw new Error(`Could not load awards: ${awards.error.message}`);
  const prLogs = new Set(awards.data.filter((a) => awardHasPrs(a.result)).map((a) => a.log_id));

  // Comment counts, and whether the coach has commented yet (nothing records the coach opening a log).
  const comments = logIds.length
    ? await supabase.from('workout_log_comments').select('log_id, author_id').in('log_id', logIds)
    : { data: [], error: null };
  if (comments.error) throw new Error(`Could not load comments: ${comments.error.message}`);

  // No direct foreign key links workspace_members to profiles, so load names separately.
  const memberIds = members.data.map((m) => m.user_id);
  const profiles = memberIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', memberIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const names = new Map<string, string>();
  for (const p of past.data) names.set(p.user_id, p.full_name || p.email);
  for (const p of profiles.data ?? []) names.set(p.id, p.full_name || 'Client');
  const options = [...names].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ id, name }));

  // Built by concatenation, so supabase-js cannot infer the shape; LogTreeRow describes it.
  const logRows = (logs.data as unknown as (LogTreeRow & { client_id: string; logged_by: string | null })[]).slice(0, PAGE_SIZE);
  const review = logReviewByLog(
    logRows.map((r) => ({ id: r.id, clientId: r.client_id })),
    comments.data.map((c) => ({ logId: c.log_id, authorId: c.author_id })),
  );
  const rows: FeedRow[] = logRows.flatMap((row) => {
    if (!row.finished_at) return [];
    const log = logRowToDoc(row);
    const volumeKg = logVolumeKg(log);
    const state = review.get(row.id) ?? { comments: 0, reviewed: false };
    return [
      {
        id: row.id,
        href: `/clients/${row.client_id}/logs/${row.id}`,
        clientId: row.client_id,
        clientName: names.get(row.client_id) ?? 'Client',
        workoutName: row.name,
        finishedAt: row.finished_at,
        facts: [formatLogDuration(logDurationS(log)), count(completedSetCount(log), 'set', 'sets'), ...(volumeKg > 0 ? [formatLogVolume(volumeKg, units)] : [])].join(' · '),
        hasPr: prLogs.has(row.id),
        autoFinished: row.auto_finished,
        byCoach: isLoggedByCoach({ loggedBy: row.logged_by, clientId: row.client_id }),
        planned: isPlannedLog(log),
        reviewed: state.reviewed,
        comments: state.comments,
      },
    ];
  });
  const toReview = rows.filter((r) => !r.reviewed).length;
  const hasNext = logs.data.length > PAGE_SIZE;
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (clientFilter) params.set('client', clientFilter);
    if (n > 1) params.set('page', String(n));
    const qs = params.toString();
    return qs ? `/activity?${qs}` : '/activity';
  };

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <div className={styles.titleLine}>
          <h1 className={styles.title}>Activity</h1>
          {toReview > 0 ? (
            <p className={styles.toReview}>
              <span className={styles.dot} aria-hidden="true" />
              <b>{toReview}</b> to review
            </p>
          ) : null}
        </div>
        <ClientFilter clients={options} selectedId={clientFilter} />
      </header>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          {pageNumber > 1
            ? 'Nothing on this page.'
            : clientFilter
              ? 'No finished workouts for this client yet.'
              : 'No finished workouts yet. They show up here as soon as a client finishes one.'}
        </p>
      ) : (
        <Card className={styles.listCard}>
          <ActivityFeed rows={rows} now={new Date(renderTime()).toISOString()} />
        </Card>
      )}

      {pageNumber > 1 || hasNext ? (
        <nav aria-label="Pages" className={styles.pager}>
          {pageNumber > 1 ? (
            <Link href={pageHref(pageNumber - 1)} className={styles.smallButton}>
              ← Newer
            </Link>
          ) : null}
          <span className={styles.caption}>Page {pageNumber}</span>
          {hasNext ? (
            <Link href={pageHref(pageNumber + 1)} className={styles.smallButton}>
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
      <LiveRefresh
        on={[
          { table: 'workout_logs', filter: `workspace_id=eq.${workspaceId}` },
          { table: 'awards', filter: `workspace_id=eq.${workspaceId}` },
        ]} renderedAt={renderTime()} maxWaitMs={8000} />
    </div>
  );
}
