import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/admin.module.css';
import { PageHeader } from '@/components/page-header';
import { PeopleSearch } from '@/components/people-search';
import { requireAdmin } from '@/lib/admin';
import { nameOr } from '@/lib/admin-data';
import { loadPeople } from '@/lib/people';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage() {
  await requireAdmin();
  const people = await loadPeople();
  const clients = people.filter((p) => p.kind === 'client').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Clients" subtitle={`${clients.length} client${clients.length === 1 ? '' : 's'}, including removed ones`}>
        <PeopleSearch people={people} />
      </PageHeader>
      <div className={styles.panel}>
        {clients.length === 0 ? (
          <p className={styles.empty}>No clients yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>CLIENT</th><th>EMAIL</th><th>COACH</th></tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.user_id}>
                    <td><Link href={`/clients/${c.user_id}`} className={styles.rowLink}>{nameOr(c.name)}</Link></td>
                    <td>{c.email}</td>
                    <td>{c.coach_name ?? <span className={styles.muted}>Removed</span>}</td>
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
