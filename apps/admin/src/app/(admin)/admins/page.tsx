import type { Metadata } from 'next';
import styles from '@/components/admin.module.css';
import { ActionStatus, ConfirmAction } from '@/components/confirm-dialog';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { requireAdmin } from '@/lib/admin';
import { nameOr } from '@/lib/admin-data';
import { createServerSupabase } from '@/lib/supabase/server';
import { removeAdmin } from './actions';
import { AddAdminForm } from './add-admin-form';

export const metadata: Metadata = { title: 'Admins' };

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', support: 'Support', readonly: 'Readonly' };

export default async function AdminsPage() {
  await requireAdmin('owner');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('admin_list_admins');
  if (error) throw new Error(`Could not load admins: ${error.message}`);
  // The database never lets the last owner go (private.admin_keep_an_owner); the page just doesn't offer it.
  const owners = data.filter((a) => a.role === 'owner');
  const lastOwner = owners.length === 1 ? owners[0]! : null;

  return (
    <>
      <PageHeader title="Admins" subtitle="Who can use this site" />
      <ActionStatus>
        <Panel title="Add an admin">
          <AddAdminForm lastOwnerEmail={lastOwner?.email ?? null} />
          <p className={styles.panelNote}>To change someone&apos;s role, add them again with the new role.</p>
        </Panel>
        <div className={styles.panel}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>ADDED</th><th><span className="visually-hidden">Actions</span></th></tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.user_id}>
                    <td>{nameOr(`${a.first_name ?? ''} ${a.last_name ?? ''}`)}</td>
                    <td>{a.email}</td>
                    <td>{ROLE_LABEL[a.role] ?? a.role}</td>
                    <td><LocalTime iso={a.created_at} kind="date" /></td>
                    <td>
                      {a.user_id === lastOwner?.user_id ? (
                        <span className={styles.muted}>Last owner</span>
                      ) : (
                        <ConfirmAction look="link" label="Remove" title="Remove this admin?" confirmLabel="Remove" action={removeAdmin.bind(null, a.user_id)}>
                          <p>{a.email} can no longer use this site. Their past actions stay in the audit log.</p>
                        </ConfirmAction>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ActionStatus>
    </>
  );
}
