import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LocalDate } from '@/app/(coach)/workouts/local-date';
import { Card } from '@/components/ui';
import { getClient } from '@/lib/page-data';
import { clientPageTitle } from '@/lib/page-titles';
import { RemoveClientButton } from '../../../row-actions';
import styles from '../../client-page.module.css';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId, 'Settings');
}

/** Settings for one client. For now: remove them (their history stays under Past clients). */
export default async function ClientSettingsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();
  return (
    <Card className={styles.card} aria-labelledby="settings-heading">
      <h2 id="settings-heading" tabIndex={-1} className={styles.heading}>Remove client</h2>
      {client.removedAt ? (
        <p className={styles.body}>
          {client.firstName} was removed on <LocalDate iso={client.removedAt} />. Their history stays here, read-only. Invite them again
          from Clients to bring everything back.
        </p>
      ) : (
        <>
          <p className={styles.body}>
            {client.firstName} loses access to your workouts, messages and community. Their history stays under Past clients, and
            inviting them again brings everything back.
          </p>
          <div className={styles.actions}>
            <RemoveClientButton userId={client.id} name={client.name} focusAfterId="settings-heading" />
          </div>
        </>
      )}
    </Card>
  );
}
