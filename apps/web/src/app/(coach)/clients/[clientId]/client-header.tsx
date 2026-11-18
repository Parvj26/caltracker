'use client';

import Link from 'next/link';
import { BackLink } from '@/components/back-link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MoreMenu } from '@/components/more-menu';
import { Chip } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cx } from '@/components/ui/cx';
import { avatarTone, initials } from '../avatar';
import { RemoveClientDialog } from '../row-actions';
import styles from './client-page.module.css';

export const CLIENT_NAME_ID = 'client-name';

function MessageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

/**
 * The client page's bar: back to Clients, the client's initials and name, Message (or a past client's message
 * history) and "⋯" with Client settings and, for a current client, Remove client (red; it asks first, with the same
 * explanation as everywhere else). On a phone it is one small row that stays at the top with the tabs.
 */
export function ClientHeader({ client }: { client: { id: string; name: string; firstName: string; removedAt: string | null } }) {
  const past = client.removedAt !== null;
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  return (
    <header className={styles.bar}>
      <BackLink href="/clients" className={styles.barBack} aria-label="Back to Clients">
        <ChevronIcon direction="left" size={22} />
        <span className={styles.barBackText} aria-hidden="true">Clients</span>
      </BackLink>
      <span aria-hidden="true" className={cx(styles.avatar, styles[`avatar-${avatarTone(client.id)}`])}>
        {initials(client.name)}
      </span>
      <h1 id={CLIENT_NAME_ID} tabIndex={-1} className={styles.name} title={client.name}>
        {client.name}
      </h1>
      {past ? <Chip tone="grey" phSafe className={styles.pastChip}>Past client</Chip> : null}
      <div className={styles.barActions}>
        {past ? (
          <Link href={`/clients/${client.id}/training#message-history`} className={styles.barIconButton} aria-label="Message history" title="Message history">
            <MessageIcon />
          </Link>
        ) : (
          <Link href={`/messages/${client.id}`} className={cx(styles.barIconButton, styles.barMessage)} aria-label="Message" title={`Message ${client.firstName || client.name}`}>
            <MessageIcon />
            <span className={styles.barMessageText} aria-hidden="true">Message</span>
          </Link>
        )}
        {/* ⋯ is a menu (UI rules §5.5); Remove client… is red and asks first in the one pop-up (§10). */}
        <MoreMenu
          label="More for this client"
          className={styles.menuWrap}
          items={[
            { label: 'Client settings', onSelect: () => router.push(`/clients/${client.id}/settings`) },
            ...(past ? [] : [{ label: 'Remove client…', onSelect: () => setRemoving(true), danger: true }]),
          ]}
        />
      </div>
      {removing ? <RemoveClientDialog userId={client.id} name={client.name} focusAfterId={CLIENT_NAME_ID} onClose={() => setRemoving(false)} /> : null}
    </header>
  );
}
