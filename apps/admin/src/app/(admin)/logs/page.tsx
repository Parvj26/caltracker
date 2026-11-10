import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/admin.module.css';
import { ActionStatus, ConfirmAction } from '@/components/confirm-dialog';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { Pill, type PillTone } from '@/components/pill';
import { Button, SelectField } from '@/components/ui';
import { requireAdmin } from '@/lib/admin';
import { UUID } from '@/lib/actions-shared';
import { nameOr } from '@/lib/admin-data';
import { loadPeople } from '@/lib/people';
import { roleAtLeast } from '@/lib/roles';
import { createServerSupabase } from '@/lib/supabase/server';
import { cancelInvite, resendInvite } from './actions';

export const metadata: Metadata = { title: 'Logs' };

const OUTCOME: Record<string, { label: string; tone: PillTone }> = {
  sent: { label: 'Sent', tone: 'lime' },
  failed: { label: 'Failed', tone: 'tape' },
  skipped: { label: 'Skipped', tone: 'grey' },
};
const STATUS: Record<string, { label: string; tone: PillTone }> = {
  pending: { label: 'Pending', tone: 'blue' },
  expired: { label: 'Expired', tone: 'tape' },
  accepted: { label: 'Accepted', tone: 'lime' },
};

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ tab?: string; person?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const tab = sp.tab === 'invites' ? 'invites' : 'notifications';
  const person = sp.person && UUID.test(sp.person) ? sp.person : null;
  const canAct = roleAtLeast(admin.role, 'support');
  const supabase = await createServerSupabase();
  const filter = person ? { p_user_id: person, p_limit: 200 } : { p_limit: 200 };
  const [people, pushes, invites] = await Promise.all([
    loadPeople(),
    tab === 'notifications' ? supabase.rpc('admin_push_log', filter) : null,
    tab === 'invites' ? supabase.rpc('admin_invite_log', filter) : null,
  ]);
  if (pushes?.error) throw new Error(`Could not load notifications: ${pushes.error.message}`);
  if (invites?.error) throw new Error(`Could not load invites: ${invites.error.message}`);
  const uniquePeople = [...new Map(people.map((p) => [p.user_id, p])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const tabHref = (t: string) => `/logs?tab=${t}${person ? `&person=${person}` : ''}`;

  return (
    <>
      <PageHeader title="Logs" subtitle="Notifications and invites, newest first" />
      <div className={styles.tabs} role="navigation" aria-label="Log type">
        <Link href={tabHref('notifications')} aria-current={tab === 'notifications' ? 'page' : undefined} className={`${styles.tab} ${tab === 'notifications' ? styles.tabActive : ''}`}>Notifications</Link>
        <Link href={tabHref('invites')} aria-current={tab === 'invites' ? 'page' : undefined} className={`${styles.tab} ${tab === 'invites' ? styles.tabActive : ''}`}>Invites</Link>
      </div>
      <form method="get" className={styles.filters}>
        <input type="hidden" name="tab" value={tab} />
        <SelectField label="Person" name="person" defaultValue={person ?? ''}>
          <option value="">Everyone</option>
          {uniquePeople.map((p) => (
            <option key={p.user_id} value={p.user_id}>{nameOr(p.name, p.email)}</option>
          ))}
        </SelectField>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      <div className={styles.panel}>
        {pushes ? (
          pushes.data.length === 0 ? (
            <p className={styles.empty}>No notifications.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>WHEN</th><th>WHO</th><th>TYPE</th><th>OUTCOME</th><th>TRIES</th><th>ERROR</th></tr>
                </thead>
                <tbody>
                  {pushes.data.map((p) => {
                    const outcome = (p.outcome && OUTCOME[p.outcome]) || { label: 'Waiting', tone: 'grey' as const };
                    return (
                      <tr key={p.id}>
                        <td><LocalTime iso={p.at} kind="datetime" /></td>
                        <td><Link href={`/clients/${p.user_id}`} className={styles.rowLink}>{nameOr(p.name)}</Link></td>
                        <td>{p.type}</td>
                        <td><Pill tone={outcome.tone}>{outcome.label}</Pill></td>
                        <td>{p.attempts}</td>
                        <td>{p.last_error ?? ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : invites ? (
          invites.data.length === 0 ? (
            <p className={styles.empty}>No invites.</p>
          ) : (
            <ActionStatus>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>INVITED</th><th>COACH</th><th>SENT</th><th>EXPIRES</th><th>STATUS</th>{canAct ? <th><span className="visually-hidden">Actions</span></th> : null}</tr>
                  </thead>
                  <tbody>
                    {invites.data.map((i) => {
                      const status = STATUS[i.status] ?? { label: i.status, tone: 'grey' as const };
                      const who = nameOr(`${i.first_name ?? ''} ${i.last_name ?? ''}`, i.email);
                      return (
                        <tr key={i.id}>
                          <td>{who}<span className={styles.cellNote}>{i.email}</span></td>
                          <td>{i.workspace_name}</td>
                          <td><LocalTime iso={i.created_at} kind="datetime" /></td>
                          <td><LocalTime iso={i.expires_at} kind="datetime" /></td>
                          <td><Pill tone={status.tone}>{i.accepted_at ? 'Accepted' : status.label}</Pill></td>
                          {canAct ? (
                            <td>
                              {i.status !== 'accepted' ? (
                                <span className={styles.filters}>
                                  <ConfirmAction look="link" label="Resend" title="Resend invite?" confirmLabel="Resend invite" action={resendInvite.bind(null, i.id)}>
                                    <p>Send {who} a new invite link at {i.email} to join {i.workspace_name}.</p>
                                  </ConfirmAction>
                                  <ConfirmAction look="link" label="Cancel invite" title="Cancel this invite?" confirmLabel="Cancel invite" action={cancelInvite.bind(null, i.id)}>
                                    <p>The link in {who}&apos;s email stops working. You can invite them again later.</p>
                                  </ConfirmAction>
                                </span>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ActionStatus>
          )
        ) : null}
      </div>
    </>
  );
}
