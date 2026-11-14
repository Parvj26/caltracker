import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getClient } from '@/lib/page-data';
import { ClientHeader } from '../client-header';
import { ClientTabs } from '../client-tabs';
import styles from '../client-page.module.css';

/**
 * The client page's frame: one bar (back to Clients, the client's initials and name, Message, and "⋯" with Client
 * settings and Remove client), then the tabs (Overview, Training, Body, Food, Documents). On a phone the bar and the
 * tabs stay at the top while the page scrolls. Each tab is its own page below this layout; Settings keeps its own
 * address (/settings), opened from "⋯".
 */
export default async function ClientTabsLayout({ children, params }: { children: ReactNode; params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();

  return (
    <div className={styles.page}>
      {/* data-overlay-edge: while stuck on a phone, open ⋯ menus keep below it (menu-placement.ts). */}
      <div className={styles.sticky} data-testid="client-sticky" data-overlay-edge="top">
        <ClientHeader client={{ id: client.id, name: client.name, firstName: client.firstName, removedAt: client.removedAt }} />
        <ClientTabs clientId={client.id} />
      </div>
      <div className={styles.panel}>{children}</div>
    </div>
  );
}
