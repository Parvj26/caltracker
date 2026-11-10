import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/admin.module.css';
import { PageHeader } from '@/components/page-header';
import { PeopleSearch, type Person } from '@/components/people-search';
import { requireAdmin } from '@/lib/admin';
import { nameOr } from '@/lib/admin-data';
import { groupClientsByCoach } from '@/lib/group-clients';
import { loadPeople } from '@/lib/people';

export const metadata: Metadata = { title: 'Clients' };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** One coach's clients (or the "No coach" group): a named region, so tests and screen readers find it by its heading. */
function ClientPanel({ id, title, note, clients }: { id: string; title: string; note: string; clients: Person[] }) {
  return (
    <section aria-labelledby={id} className={`${styles.panel} ${styles.groupPanel}`}>
      <div className={styles.groupHead}>
        <h2 id={id} className={styles.panelTitle}>{title}</h2>
        <span className={styles.groupNote}>{note}</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th className={styles.clientCol}>CLIENT</th><th>EMAIL</th></tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.user_id}>
                <td><Link href={`/clients/${c.user_id}`} className={styles.rowLink}>{nameOr(c.name)}</Link></td>
                <td>{c.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function ClientsPage() {
  await requireAdmin();
  const people = await loadPeople();
  const groups = groupClientsByCoach(people);
  const total = groups.reduce((n, g) => n + g.clients.length, 0);
  return (
    <>
      <PageHeader title="Clients" subtitle={`${plural(total, 'client')}, including removed ones`}>
        <PeopleSearch people={people} />
      </PageHeader>
      {groups.length === 0 ? (
        <div className={styles.panel}>
          <p className={styles.empty}>No clients yet.</p>
        </div>
      ) : (
        groups.map((g, i) =>
          g.coachName === null ? (
            <ClientPanel key="no-coach" id="clients-no-coach" title="No coach"
              note={`Removed or their coach was deleted · ${g.clients.length}`} clients={g.clients} />
          ) : (
            <ClientPanel key={`coach-${g.coachName}`} id={`clients-coach-${i}`} title={g.coachName}
              note={plural(g.clients.length, 'client')} clients={g.clients} />
          ),
        )
      )}
    </>
  );
}
