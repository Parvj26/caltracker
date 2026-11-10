import type { Metadata } from 'next';
import Link from 'next/link';
import { ATTENTION_KINDS, attentionCopy } from '@caltracker/shared';
import styles from '@/components/admin.module.css';
import { ActionStatus, ConfirmAction } from '@/components/confirm-dialog';
import { KpiTile } from '@/components/kpi-tile';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { PeopleSearch } from '@/components/people-search';
import { Pill, type PillTone } from '@/components/pill';
import { requireAdmin } from '@/lib/admin';
import { fromJson, nameOr, type Overview } from '@/lib/admin-data';
import { appVersionsLabel, trendLabel } from '@/lib/format';
import { loadPeople } from '@/lib/people';
import { isProductionEnv, roleAtLeast } from '@/lib/roles';
import { createServerSupabase } from '@/lib/supabase/server';
import { resendInvite } from '../logs/actions';

export const metadata: Metadata = { title: 'Overview' };

// The shared package also has a coach-home AttentionKind, which wins the root export, so name the admin one here.
type AttentionKind = (typeof ATTENTION_KINDS)[number];

const COACH_KINDS = new Set<AttentionKind>(['coach_inactive_14d', 'coach_no_meals']);
const KIND_TONE: Partial<Record<AttentionKind, PillTone>> = { invite_expired: 'tape', notifications_off: 'blue', push_failed: 'tape' };

function pushStatus(status: string | null): { label: string; tone: PillTone } {
  if (status === null) return { label: 'No runs yet', tone: 'grey' };
  if (status === 'succeeded') return { label: 'OK', tone: 'lime' };
  if (status === 'failed') return { label: 'Failed', tone: 'tape' };
  return { label: status.charAt(0).toUpperCase() + status.slice(1), tone: 'grey' };
}

export default async function OverviewPage() {
  const admin = await requireAdmin();
  const supabase = await createServerSupabase();
  const [overview, attention, people, invites] = await Promise.all([
    supabase.rpc('admin_overview'),
    supabase.rpc('admin_needs_attention'),
    loadPeople(),
    supabase.rpc('admin_invite_log', { p_limit: 1000 }),
  ]);
  if (overview.error) throw new Error(`Could not load the overview: ${overview.error.message}`);
  if (attention.error) throw new Error(`Could not load Needs attention: ${attention.error.message}`);
  const o = fromJson<Overview>(overview.data);
  const canAct = roleAtLeast(admin.role, 'support');
  const rows = attention.data.filter((r): r is typeof r & { kind: AttentionKind } => (ATTENTION_KINDS as readonly string[]).includes(r.kind));
  const inviteById = new Map((invites.data ?? []).map((i) => [i.id, i]));
  const push = pushStatus(o.system.last_push_status);
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date());

  return (
    <>
      <PageHeader title="Overview" subtitle={`${today}${isProductionEnv(process.env.NEXT_PUBLIC_APP_ENV) ? '' : ' · staging'}`}>
        <PeopleSearch people={people} />
      </PageHeader>

      <div className={styles.grid4}>
        <KpiTile tone="lime" label="COACHES" value={o.coaches.total} note={`${o.coaches.active7} active this week · ${o.coaches.new7} new`} />
        <KpiTile label="CLIENTS" value={o.clients.total} note={`${o.clients.active7} active · ${o.clients.new7} new this week`} />
        <KpiTile label="WORKOUTS" value={o.workouts.this_week} note={`logged this week · ${trendLabel(o.workouts.this_week, o.workouts.last_week)}`} />
        <KpiTile tone="cream" label="MEALS" value={o.meals.this_week} note={`logged this week · ${trendLabel(o.meals.this_week, o.meals.last_week)}`} />
      </div>

      <div className={styles.gridAttention}>
        <Panel title={`Needs attention · ${rows.length}`}>
          <ActionStatus>
            {rows.length === 0 ? (
              <p className={styles.empty}>Nothing needs attention.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>WHO</th><th>PROBLEM</th><th>SINCE</th><th><span className="visually-hidden">Action</span></th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const copy = attentionCopy(r.kind);
                      const who = r.kind === 'invite_expired' ? nameOr(r.name, 'new client (invite)') : nameOr(r.name);
                      const invite = r.invite_id ? inviteById.get(r.invite_id) : undefined;
                      const href = r.user_id ? (COACH_KINDS.has(r.kind) ? `/coaches/${r.user_id}` : `/clients/${r.user_id}`) : null;
                      return (
                        <tr key={`${r.kind}-${r.user_id ?? ''}-${r.invite_id ?? ''}`}>
                          <td>{who}</td>
                          <td><Pill tone={KIND_TONE[r.kind] ?? 'grey'}>{copy.problem}</Pill></td>
                          <td><LocalTime iso={r.since} kind="since" /></td>
                          <td>
                            {r.action === 'resend_invite' && r.invite_id ? (
                              canAct ? (
                                <ConfirmAction
                                  look="link"
                                  label={copy.actionLabel}
                                  title="Resend invite?"
                                  confirmLabel="Resend invite"
                                  action={resendInvite.bind(null, r.invite_id)}
                                >
                                  <p>
                                    Send {who} a new invite link
                                    {invite ? ` at ${invite.email} to join ${invite.workspace_name}` : ''}.
                                  </p>
                                </ConfirmAction>
                              ) : href ? (
                                <Link href={href} className={styles.rowLink}>Open</Link>
                              ) : null
                            ) : href ? (
                              <Link href={href} className={styles.rowLink}>{copy.actionLabel}</Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ActionStatus>
        </Panel>

        <Panel title="System">
          <ul className={styles.lines}>
            <li>
              Push sending: <Pill tone={push.tone}>{push.label}</Pill>{' '}
              {o.system.last_push_run_at ? <>last run <LocalTime iso={o.system.last_push_run_at} kind="ago" /></> : null}
            </li>
            <li>Invites sent today: {o.system.invites_sent_today}</li>
            <li>App versions: {appVersionsLabel(o.system.app_versions)}</li>
            <li>Notification failures last 24 h: {o.system.push_failed_24h}</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

