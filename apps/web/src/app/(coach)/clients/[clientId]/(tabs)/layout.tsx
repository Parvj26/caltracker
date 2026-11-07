import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Chip } from '@/components/ui';
import { getClient, getClientLimitations } from '@/lib/page-data';
import { ClientTabs } from '../client-tabs';
import styles from '../client-page.module.css';

/**
 * The client page's frame: back to Clients, the client's name, a gentle flag when the coach has noted injuries, and
 * the tabs (Overview, Training, Body, Documents, Settings). Each tab is its own page below this layout.
 */
export default async function ClientTabsLayout({ children, params }: { children: ReactNode; params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();
  const limitations = await getClientLimitations(client.id);

  return (
    <div className={styles.page}>
      <Link href="/clients" className={styles.back}>← Clients</Link>
      <header className={styles.header}>
        <h1 className={styles.name}>{client.name}</h1>
        {client.removedAt ? <Chip tone="grey">Past client</Chip> : null}
        {limitations ? (
          <Link href={`/clients/${client.id}#limitations`} className={styles.flag} title={limitations}>
            <Chip tone="amber">Injury notes</Chip>
          </Link>
        ) : null}
      </header>
      <ClientTabs clientId={client.id} />
      <div className={styles.panel}>{children}</div>
    </div>
  );
}
