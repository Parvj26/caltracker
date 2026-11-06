import Link from 'next/link';
import {
  LOG_TREE_SELECT,
  awardHasPrs,
  completedSetCount,
  formatLogDuration,
  formatLogVolume,
  isPlannedLog,
  logDurationS,
  logRowToDoc,
  logVolumeKg,
  type LogTreeRow,
} from '@caltracker/shared';
import { Card, Chip, SelectField } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { LocalDateTime } from './local-date-time';
import styles from './activity.module.css';

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
    .select(`client_id, ${LOG_TREE_SELECT}`)
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

  // No direct foreign key links workspace_members to profiles, so load names separately.
  const memberIds = members.data.map((m) => m.user_id);
  const profiles = memberIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', memberIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const names = new Map<string, string>();
  for (const p of past.data) names.set(p.user_id, p.full_name || p.email);
  for (const p of profiles.data ?? []) names.set(p.id, p.full_name || 'Client');
  const options = [...names].sort((a, b) => a[1].localeCompare(b[1]));

  // Built by concatenation, so supabase-js cannot infer the shape; LogTreeRow describes it.
  const rows = (logs.data as unknown as (LogTreeRow & { client_id: string })[]).slice(0, PAGE_SIZE).map((row) => {
    const log = logRowToDoc(row);
    return {
      row,
      log,
      clientName: names.get(row.client_id) ?? 'Client',
      sets: completedSetCount(log),
      volumeKg: logVolumeKg(log),
      seconds: logDurationS(log),
      planned: isPlannedLog(log),
      hasPr: prLogs.has(row.id),
    };
  });
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
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Activity</h1>
          <p className={styles.caption}>Workouts your clients have finished, newest first.</p>
        </div>
        <form method="get" action="/activity" className={styles.filter}>
          <SelectField label="Client" name="client" defaultValue={clientFilter ?? ''}>
            <option value="">All clients</option>
            {options.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectField>
          <button type="submit" className={styles.smallButton}>
            Filter
          </button>
        </form>
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
          <table className={styles.table} aria-label="Finished workouts">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Workout</th>
                <th scope="col">Finished</th>
                <th scope="col">Duration</th>
                <th scope="col">Sets</th>
                <th scope="col">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, clientName, sets, volumeKg, seconds, planned, hasPr }) => (
                <tr key={row.id}>
                  <td>{clientName}</td>
                  <td>
                    <div className={styles.workoutCell}>
                      <Link href={`/clients/${row.client_id}/logs/${row.id}`} className={styles.nameLink}>
                        {row.name}
                      </Link>
                      {hasPr ? <Chip tone="lime">PR</Chip> : null}
                      {row.auto_finished ? <Chip tone="amber">Auto-finished</Chip> : null}
                      {planned ? null : <Chip>Unplanned</Chip>}
                    </div>
                  </td>
                  <td className={styles.numeric}>{row.finished_at ? <LocalDateTime iso={row.finished_at} /> : null}</td>
                  <td className={styles.numeric}>{formatLogDuration(seconds)}</td>
                  <td className={styles.numeric}>{count(sets, 'set', 'sets')}</td>
                  <td className={styles.numeric}>{volumeKg > 0 ? formatLogVolume(volumeKg, units) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}
