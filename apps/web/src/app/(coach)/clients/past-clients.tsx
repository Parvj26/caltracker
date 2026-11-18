'use client';

import { useState, type ReactNode } from 'react';
import { Button, ListRow } from '@/components/ui';
import { useResendInvite } from './resend-button';
import { StatusChip } from './status-chip';
import { cx } from '@/components/ui/cx';
import styles from './clients.module.css';

/** "Past clients (N)", folded by default: the rows are rendered by the page and passed in. */
export function PastClients({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="past-heading" className={styles.pastSection}>
      <h2 className={styles.sectionHeading}>
        <button
          type="button"
          id="past-heading"
          className={styles.csvToggle}
          aria-expanded={open}
          aria-controls="past-body"
          onClick={() => setOpen((o) => !o)}
        >
          {`Past clients (${count})`}
        </button>
      </h2>
      <div id="past-body" className={cx(styles.csvBody)} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** A removed client: the whole row opens their (read-only) page; Re-invite on the row, its result in the meta line. */
export function PastClientRow({
  id,
  name,
  email,
  firstName,
  lastName,
  removed,
  leading,
}: {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  removed: string;
  leading: ReactNode;
}) {
  const { resend, pending, message } = useResendInvite({ email, firstName, lastName });
  return (
    <ListRow
      href={`/clients/${id}`}
      title={name}
      leading={leading}
      meta={
        <>
          <span className={styles.inviteEmail}>{email}</span>
          <span>{removed}</span>
          {message ? (
            <span role="status" className={styles.inlineStatus}>
              <StatusChip view={message} />
            </span>
          ) : null}
        </>
      }
      action={
        <Button variant="quiet" size="compact" onClick={resend} pending={pending} aria-label={pending ? undefined : `Re-invite ${name}`}>
          {pending ? 'Sending…' : 'Re-invite'}
        </Button>
      }
    />
  );
}
