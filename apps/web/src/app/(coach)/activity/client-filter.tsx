'use client';

import { useRouter } from 'next/navigation';
import { ClientCombobox, type ComboClient } from '@/components/client-combobox/client-combobox';
import styles from './activity.module.css';

/**
 * The Activity client filter: type a name (typos forgiven), pick a suggestion and the feed narrows straight away via
 * ?client=<id> (so links and Back keep working). The × shows everyone again.
 */
export function ClientFilter({ clients, selectedId }: { clients: { id: string; name: string }[]; selectedId: string | null }) {
  const router = useRouter();
  // The names come as one string, so the whole name sits in firstName for the search.
  const options: ComboClient[] = clients.map((c) => ({ id: c.id, firstName: c.name, lastName: '' }));
  const selected = clients.find((c) => c.id === selectedId);
  return (
    <ClientCombobox
      clients={options}
      label="Filter by client"
      placeholder="All clients"
      committed={selected?.name ?? ''}
      clearLabel="Show all clients"
      className={styles.filter}
      onPick={(c) => {
        if (c.id !== selectedId) router.push(`/activity?client=${c.id}`);
      }}
      onClear={() => {
        if (selectedId) router.push('/activity');
      }}
    />
  );
}
