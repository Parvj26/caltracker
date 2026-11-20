import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CHART_RANGES,
  CHART_RANGE_LABELS,
  formatPlainDayMonthInYear,
  heaviestChart,
  heaviestSessionRows,
  heaviestSessions,
  loadStyleOf,
  localToday,
  sessionsSince,
  strengthStats,
  type ChartRange,
} from '@caltracker/shared';
import { ParentBackLink } from '@/components/back-link';
import { ListRow, PageHeader, RowList } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { loadClientStrengthIn } from '@/lib/client-strength';
import { metricsTabHref, strengthExerciseHref } from '@/lib/metrics-paths';
import { getClient, getExercise } from '@/lib/page-data';
import { pageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { ExerciseChart } from './exercise-chart';
import styles from './exercise.module.css';

const RANGE_DAYS: Record<ChartRange, number | null> = { '3m': 91, '1y': 365, all: null };
const DEFAULT_RANGE: ChartRange = '1y';

const pickRange = (v: string | string[] | undefined): ChartRange => (typeof v === 'string' && (CHART_RANGES as readonly string[]).includes(v) ? (v as ChartRange) : DEFAULT_RANGE);

export async function generateMetadata({ params }: { params: Promise<{ clientId: string; exerciseId: string }> }): Promise<Metadata> {
  const { clientId, exerciseId } = await params;
  const [client, exercise] = await Promise.all([getClient(clientId), getExercise(exerciseId)]);
  return client ? pageTitle(exercise?.name ?? 'Strength', client.name, 'Clients') : pageTitle('Not found');
}

/**
 * One exercise's progress for a client (Metrics › Strength): the heaviest weight lifted (the headline) and the
 * estimated 1-rep max, over 3 months, 1 year or all time (kept in ?range=), a chart of both per session, and every
 * session with a "Heaviest yet" tag, each opening its log. All from sets already logged.
 */
export default async function ExerciseProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; exerciseId: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const { workspaceId, units } = await requireCoach();
  const [{ clientId, exerciseId }, query] = await Promise.all([params, searchParams]);
  const client = await getClient(clientId);
  if (!client) notFound();
  const { exercises, timeZone } = await loadClientStrengthIn(await createServerSupabase(), workspaceId, client.id);
  const exercise = exercises.find((e) => e.exerciseId === exerciseId);
  if (!exercise) notFound();

  const range = pickRange(query.range);
  const today = localToday(timeZone);
  const style = loadStyleOf(exercise.name);
  const all = heaviestSessions(exercise.points, style);
  const inRange = sessionsSince(all, RANGE_DAYS[range], today);
  const stats = strengthStats(inRange, units, style, today);
  const chart = heaviestChart(exercise.name, inRange, units, style, today);
  const rows = heaviestSessionRows(inRange, units, style, today);
  const first = all[0];
  const subtitle = first ? `${all.length} ${all.length === 1 ? 'session' : 'sessions'} logged since ${formatPlainDayMonthInYear(first.date, today)}` : null;
  const href = (r: ChartRange) => `${strengthExerciseHref(client.id, exercise.exerciseId)}${r === DEFAULT_RANGE ? '' : `?range=${r}`}`;

  return (
    <div className={styles.page}>
      <ParentBackLink href={metricsTabHref(client.id)} label={`${client.firstName || client.name}’s metrics`} />
      <PageHeader title={exercise.name} subtitle={subtitle} />

      <div className={styles.tiles}>
        <section className={styles.tile} aria-label="Heaviest weight" data-testid="tile-heaviest">
          <p className={styles.tileLabel}>Heaviest weight</p>
          <p className={styles.tileValue}>{stats.heaviest ?? '—'}</p>
          {stats.change ? (
            <p className={`${styles.tileSub} ${stats.change.direction === 'up' ? styles.tileUp : ''}`}>{stats.change.text}</p>
          ) : stats.heaviestDetail ? (
            <p className={styles.tileSub}>{stats.heaviestDetail}</p>
          ) : null}
        </section>
        <section className={styles.tile} aria-label="Estimated 1-rep max" data-testid="tile-e1rm">
          <p className={styles.tileLabel}>Estimated 1-rep max</p>
          <p className={styles.tileValue}>{stats.e1rm ?? '—'}</p>
          <p className={styles.tileSub}>{stats.e1rmDetail}</p>
        </section>
      </div>

      <nav aria-label="Range" className={styles.rangeNav}>
        <ul className={styles.ranges}>
          {CHART_RANGES.map((r) => (
            <li key={r} style={{ display: 'contents' }}>
              <Link href={href(r)} replace scroll={false} className={styles.range} aria-current={r === range ? 'true' : undefined}>
                {CHART_RANGE_LABELS[r]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {inRange.length === 0 ? (
        <p className={styles.empty}>
          No sessions in this range.{' '}
          <Link href={href('all')} replace scroll={false}>
            Show all
          </Link>
        </p>
      ) : (
        <ExerciseChart name={exercise.name} points={chart.points} summary={chart.summary} units={units} />
      )}

      {rows.length > 0 ? (
        <section className={styles.section} aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className={styles.sectionHeading}>
            Sessions
          </h2>
          <RowList aria-labelledby="sessions-heading" data-testid="strength-sessions">
            {rows.map((r) => (
              <ListRow
                key={r.key}
                href={r.logId ? `/clients/${client.id}/logs/${r.logId}` : undefined}
                title={r.set}
                meta={r.meta}
                end={r.heaviestYet ? <span className={styles.yet}>Heaviest yet</span> : undefined}
              />
            ))}
          </RowList>
        </section>
      ) : null}
    </div>
  );
}
