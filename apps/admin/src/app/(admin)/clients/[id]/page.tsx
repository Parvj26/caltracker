import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { mergeTimeline, type TimelineEvent } from '@caltracker/shared';
import styles from '@/components/admin.module.css';
import { ActionStatus, ConfirmAction } from '@/components/confirm-dialog';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { Pill } from '@/components/pill';
import { SelectField } from '@/components/ui';
import { requireAdmin } from '@/lib/admin';
import { UUID } from '@/lib/actions-shared';
import { fromJson, nameOr, type ClientDetail } from '@/lib/admin-data';
import { fetchPosthogTimeline } from '@/lib/posthog';
import { roleAtLeast } from '@/lib/roles';
import { createServerSupabase } from '@/lib/supabase/server';
import { moveClient, restoreClient, sendPasswordReset, sendTestPush } from './actions';

export const metadata: Metadata = { title: 'Client' };

const PUSH_TYPES: Record<string, string> = {
  workout_assigned: 'Workout assigned',
  workout_changed: 'Workout changed',
  daily_reminder: 'Daily reminder',
  coach_logged: 'Coach logged a workout',
  message: 'New message',
  workout_comment: 'Workout comment',
  meal_comment: 'Meal comment',
  food_targets: 'Food targets',
  community_coach_post: 'Community post from the coach',
  community_activity: 'Community activity',
  test: 'Test notification',
};
const pushType = (type: string) => PUSH_TYPES[type] ?? type;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createServerSupabase();
  const detail = await supabase.rpc('admin_client', { p_user_id: id });
  if (detail.error) {
    if (detail.error.code === 'P0002') notFound();
    throw new Error(`Could not load the client: ${detail.error.message}`);
  }
  const c = fromJson<ClientDetail>(detail.data);
  const canAct = roleAtLeast(admin.role, 'support');
  const name = nameOr(c.name);
  const firstName = name.split(' ')[0] ?? name;
  const device = c.devices[0];

  // Support and above: the timeline. The audit row (admin_log_timeline_view) comes first; PostHog only if it worked.
  let timeline: { events: TimelineEvent[]; trackingUnavailable: boolean } | null = null;
  let coaches: Array<{ workspace_id: string; label: string }> = [];
  if (canAct) {
    const [pushes, logged, coachRows] = await Promise.all([
      supabase.rpc('admin_push_log', { p_user_id: id, p_limit: 50 }),
      supabase.rpc('admin_log_timeline_view', { p_user_id: id }),
      supabase.rpc('admin_coaches'),
    ]);
    const db: TimelineEvent[] = (pushes.data ?? []).map((p) => ({
      at: p.sent_at ?? p.at,
      source: 'db',
      label: `Notification ${p.outcome === 'failed' ? 'failed' : 'sent'} · ${pushType(p.type)}`,
      ...(p.outcome === 'failed' ? { status: 'failed' as const } : p.sent_at ? { status: 'delivered' as const } : {}),
    }));
    const app = logged.error ? new Error('Timeline view not logged') : await fetchPosthogTimeline(id);
    timeline = mergeTimeline(db, app);
    coaches = (coachRows.data ?? [])
      .filter((w) => w.workspace_id !== c.workspace_id)
      .map((w) => ({ workspace_id: w.workspace_id, label: `${nameOr(w.name)} · ${w.workspace_name}` }));
  }

  const subtitle = c.coach ? (
    <>Client of {nameOr(c.coach.name)} · joined <LocalTime iso={c.joined_at} kind="date" /></>
  ) : c.removed ? (
    <>Removed from {c.removed.workspace_name} on <LocalTime iso={c.removed.removed_at} kind="date" /></>
  ) : (
    'No coach'
  );

  return (
    <>
      <PageHeader title={name} subtitle={<>{subtitle} · {c.email}</>}>
        {canAct ? (
          <Link href={`/clients/${id}/view-as`} className={styles.viewAs}>View as {firstName} (read-only)</Link>
        ) : null}
      </PageHeader>

      <div className={styles.grid3}>
        <Panel title="Account health">
          <ul className={styles.lines}>
            <li>Email confirmed <Pill tone={c.email_confirmed ? 'lime' : 'tape'}>{c.email_confirmed ? 'Yes' : 'No'}</Pill></li>
            <li>Last sign-in: <LocalTime iso={c.last_sign_in_at} kind="ago" /></li>
            <li>{device ? `App: ${device.app_version ?? 'unknown version'}` : 'App: not installed'}</li>
            <li>Notifications: <Pill tone={c.notifications_on ? 'lime' : 'tape'}>{c.notifications_on ? 'On' : 'Off'}</Pill></li>
            <li>Last sync: <LocalTime iso={c.last_sync_at} kind="ago" /></li>
          </ul>
        </Panel>

        {canAct ? (
          <Panel title="Fix it">
            <ActionStatus>
              <ConfirmAction label="Send password reset" title="Send a password reset?" confirmLabel="Send" action={sendPasswordReset.bind(null, id)}>
                <p>{name} gets an email with a link to choose a new password{c.email ? ` (${c.email})` : ''}.</p>
              </ConfirmAction>
              {c.coach ? (
                <ConfirmAction label="Move to another coach…" title="Move to another coach?" confirmLabel="Move" action={moveClient.bind(null, id)}>
                  <p>{name} is removed from {nameOr(c.coach.name)} (their history is kept) and gets an invite to join the new coach.</p>
                  <SelectField label="New coach" name="workspace_id" required defaultValue="">
                    <option value="" disabled>Pick a coach</option>
                    {coaches.map((w) => (
                      <option key={w.workspace_id} value={w.workspace_id}>{w.label}</option>
                    ))}
                  </SelectField>
                </ConfirmAction>
              ) : null}
              {c.removed ? (
                <ConfirmAction
                  label={`Restore to ${c.removed.workspace_name}`}
                  title="Restore this client?"
                  confirmLabel="Send invite"
                  action={restoreClient.bind(null, id)}
                >
                  <p>{name} gets an invite to rejoin {c.removed.workspace_name} at {c.removed.email}. Their history comes back when they accept.</p>
                </ConfirmAction>
              ) : null}
              <ConfirmAction label="Send test notification" title="Send a test notification?" confirmLabel="Send" action={sendTestPush.bind(null, id)}>
                <p>{name}&apos;s phone shows &ldquo;Test notification from CalTracker support&rdquo;.</p>
              </ConfirmAction>
              <p className={styles.panelNote}>Every action asks to confirm and goes in the audit log.</p>
            </ActionStatus>
          </Panel>
        ) : null}

        <Panel title="Recent errors">
          {c.push_errors.length === 0 ? (
            <p className={styles.empty}>None in the last 7 days.</p>
          ) : (
            <ul className={styles.lines}>
              {c.push_errors.map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <LocalTime iso={e.at} kind="when" /> · {pushType(e.type)}
                  <span className={styles.cellNote}>{e.error}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/logs?person=${id}`} className={styles.panelNote}>All notifications and invites</Link>
        </Panel>
      </div>

      {timeline ? (
        <Panel title="Timeline">
          {timeline.trackingUnavailable ? <p className={styles.panelNote}>Tracking timeline unavailable. Showing database events only.</p> : null}
          {timeline.events.length === 0 ? (
            <p className={styles.empty}>Nothing yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>WHEN</th><th>WHAT</th></tr>
                </thead>
                <tbody>
                  {timeline.events.map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td><LocalTime iso={e.at} kind="when" /></td>
                      <td>
                        {e.label}{' '}
                        {e.status ? <Pill tone={e.status === 'delivered' ? 'lime' : 'tape'}>{e.status === 'delivered' ? 'Delivered' : 'Failed'}</Pill> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </>
  );
}
