import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/admin.module.css';
import { KpiTile } from '@/components/kpi-tile';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { PeopleSearch } from '@/components/people-search';
import { Pill } from '@/components/pill';
import { TestToggle } from '@/components/test-toggle';
import { requireAdmin } from '@/lib/admin';
import { fromJson, nameOr } from '@/lib/admin-data';
import { coachHealth, coachWeekLabel } from '@/lib/coach-health';
import { agoLabel } from '@/lib/format';
import {
  NO_PLAN,
  productHealthItems,
  showTestAccounts,
  testToggleHref,
  weekTrend,
  type OwnerOverview,
  type WeekPair,
} from '@/lib/owner-overview';
import { loadPeople } from '@/lib/people';
import { isProductionEnv } from '@/lib/roles';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Overview' };

type SearchParams = Record<string, string | string[] | undefined>;

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statNote}>{note}</span>
    </div>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;
  const showTest = showTestAccounts(sp.test);
  const supabase = await createServerSupabase();
  const [overview, coachRows, people] = await Promise.all([
    supabase.rpc('admin_owner_overview', { p_show_test: showTest }),
    supabase.rpc('admin_coaches'),
    loadPeople(),
  ]);
  if (overview.error) throw new Error(`Could not load the overview: ${overview.error.message}`);
  if (coachRows.error) throw new Error(`Could not load coaches: ${coachRows.error.message}`);
  const o = fromJson<OwnerOverview>(overview.data);
  const coaches = coachRows.data.filter((c) => showTest || !c.is_test);
  const now = new Date();
  const health = productHealthItems(o.health, now, (iso) => agoLabel(iso, now));
  const notificationsOk = !health.some((h) => h.tag === 'Not sending' || h.tag === 'Failed');
  const g = o.growth;
  const u = o.usage;
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(now);
  const usage: Array<[string, WeekPair, (string | undefined)?]> = [
    ['WORKOUTS LOGGED', u.workouts],
    ['MEALS', u.meals],
    ['METRICS', u.metrics, u.metrics.apple_health_this_week > 0 ? `${u.metrics.apple_health_this_week} from Apple Health` : undefined],
    ['NEW CONNECTIONS', u.new_connections],
    ['POSTS', u.posts],
    ['MESSAGES', u.messages],
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle={`${today}${isProductionEnv(process.env.NEXT_PUBLIC_APP_ENV) ? '' : ' · staging'}`}>
        <div className={styles.headerTools}>
          <TestToggle on={showTest} href={testToggleHref('/overview', sp, showTest)} />
          <PeopleSearch people={people} />
        </div>
      </PageHeader>

      <Panel title={`Coaches · ${new Set(coaches.map((c) => c.user_id)).size}`}>
        {coaches.length === 0 ? (
          <p className={styles.empty}>No coaches yet.</p>
        ) : (
          <>
            <div className={`${styles.tableWrap} ${styles.coachTable}`}>
              <table className={styles.table}>
                <thead>
                  <tr><th>COACH</th><th>LAST ACTIVE</th><th>THIS WEEK</th><th>CLIENTS / LIMIT</th><th>HEALTH</th></tr>
                </thead>
                <tbody>
                  {coaches.map((c) => {
                    const h = coachHealth(c.health);
                    return (
                      <tr key={`${c.user_id}-${c.workspace_id}`}>
                        <td>
                          <Link href={`/coaches/${c.user_id}`} className={styles.rowLink}>{nameOr(c.name)}</Link>
                          <span className={styles.cellNote}>{c.workspace_name}</span>
                        </td>
                        <td><LocalTime iso={c.last_active} kind="ago" /></td>
                        <td>{coachWeekLabel(c.workouts_built_week, c.programs_assigned_week)}</td>
                        <td>{c.clients} <span className={styles.muted}>· {NO_PLAN}</span></td>
                        <td><Pill tone={h.tone}>{h.label}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={styles.coachCards}>
              {coaches.map((c) => {
                const h = coachHealth(c.health);
                return (
                  <div key={`${c.user_id}-${c.workspace_id}`} className={styles.coachCard}>
                    <div className={styles.coachCardHead}>
                      <span>
                        <Link href={`/coaches/${c.user_id}`} className={styles.rowLink}>{nameOr(c.name)}</Link>
                        <span className={styles.cellNote}>{c.workspace_name}</span>
                      </span>
                      <Pill tone={h.tone}>{h.label}</Pill>
                    </div>
                    <div className={styles.coachLine}>
                      <span className={styles.coachKey}>Last active</span>
                      <span className={styles.coachValue}><LocalTime iso={c.last_active} kind="ago" /></span>
                    </div>
                    <div className={styles.coachLineStack}>
                      <span className={styles.coachKey}>This week</span>
                      <span className={styles.coachValue}>{coachWeekLabel(c.workouts_built_week, c.programs_assigned_week)}</span>
                    </div>
                    <div className={styles.coachLine}>
                      <span className={styles.coachKey}>Clients / limit</span>
                      <span className={styles.coachValue}>{c.clients} · {NO_PLAN}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>

      <div className={styles.gridGrowth}>
        <Panel title="Growth · this week">
          <div className={styles.growthTiles}>
            <KpiTile label="NEW COACHES" value={g.new_coaches.this_week} note={weekTrend(g.new_coaches)} />
            <KpiTile label="CLIENTS ADDED" value={g.clients_added.this_week} note={weekTrend(g.clients_added)} />
            <KpiTile
              tone="cream"
              label="INVITES"
              value={<>{g.invites_sent.this_week} <span className={styles.tileValueSmall}>sent · {g.invites_joined.this_week} joined</span></>}
              note={`last week ${g.invites_sent.last_week} · ${g.invites_joined.last_week}`}
            />
          </div>
        </Panel>

        <Panel title="Product health">
          <div className={styles.healthList}>
            {health.map((h) => (
              <div key={h.tag} className={styles.healthItem}>
                <Pill tone="tape">{h.tag}</Pill>
                <span className={styles.healthText}>
                  <span className={styles.healthMain}>{h.main}</span>
                  <span className={styles.healthSub}>{h.sub}</span>
                </span>
              </div>
            ))}
            {notificationsOk ? <div className={styles.healthOk}>Notifications and errors: all good</div> : null}
          </div>
        </Panel>
      </div>

      <Panel title="Usage · this week">
        <div className={styles.usageStats}>
          {usage.map(([label, pair, note]) => (
            <Stat key={label} label={label} value={pair.this_week} note={note ?? weekTrend(pair, true)} />
          ))}
        </div>
      </Panel>
    </>
  );
}
