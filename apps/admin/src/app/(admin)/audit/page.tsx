import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/admin.module.css';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { Button, SelectField } from '@/components/ui';
import { requireAdmin } from '@/lib/admin';
import { auditActionLabel, nameOr } from '@/lib/admin-data';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Audit log' };

type AuditRow = { action: string; target_user_id: string | null; target_name: string | null; details: unknown };

/** The target cell. A coach's page for coach actions; a deleted coach is gone, so just their name (from the row). */
function auditTarget(r: AuditRow) {
  if (!r.target_user_id) return '—';
  const details = (r.details ?? {}) as Record<string, unknown>;
  if (r.action === 'delete_coach') {
    return nameOr(r.target_name?.trim() || (typeof details.coach_name === 'string' ? details.coach_name : ''), 'Deleted coach');
  }
  const href = r.action === 'add_coach' ? `/coaches/${r.target_user_id}` : `/clients/${r.target_user_id}`;
  return <Link href={href} className={styles.rowLink}>{nameOr(r.target_name, 'Open')}</Link>;
}

/** Owners see every admin's actions; support sees their own (the database decides). */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; admin?: string }> }) {
  const admin = await requireAdmin('support');
  const sp = await searchParams;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('admin_audit', { p_limit: 500 });
  if (error) throw new Error(`Could not load the audit log: ${error.message}`);
  const actions = [...new Set(data.map((r) => r.action))].sort();
  const admins = [...new Map(data.map((r) => [r.admin_id, nameOr(r.admin_name, 'Unknown admin')])).entries()];
  const rows = data.filter((r) => (!sp.action || r.action === sp.action) && (!sp.admin || r.admin_id === sp.admin));

  return (
    <>
      <PageHeader title="Audit log" subtitle={admin.role === 'owner' ? 'Every admin action, newest first' : 'Your actions, newest first'} />
      <form method="get" className={styles.filters}>
        <SelectField label="What" name="action" defaultValue={sp.action ?? ''}>
          <option value="">Everything</option>
          {actions.map((a) => <option key={a} value={a}>{auditActionLabel(a)}</option>)}
        </SelectField>
        {admin.role === 'owner' ? (
          <SelectField label="Who" name="admin" defaultValue={sp.admin ?? ''}>
            <option value="">Every admin</option>
            {admins.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </SelectField>
        ) : null}
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <div className={styles.panel}>
        {rows.length === 0 ? (
          <p className={styles.empty}>Nothing logged yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>WHEN</th><th>WHO</th><th>WHAT</th><th>TARGET</th><th>DETAILS</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><LocalTime iso={r.at} kind="datetime" /></td>
                    <td>{nameOr(r.admin_name, 'Unknown admin')}</td>
                    <td>{auditActionLabel(r.action)}</td>
                    <td>{auditTarget(r)}</td>
                    <td className={styles.details}>{r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
