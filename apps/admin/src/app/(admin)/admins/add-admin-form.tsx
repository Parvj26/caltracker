'use client';

import { useState } from 'react';
import { ConfirmAction } from '@/components/confirm-dialog';
import { SelectField, TextField } from '@/components/ui';
import styles from '@/components/admin.module.css';
import { setAdmin } from './actions';

const ROLE_HELP: Record<string, string> = {
  owner: 'Owner: everything, including adding and removing admins.',
  support: 'Support: sees everything and can run support actions.',
  readonly: 'Readonly: sees the pages with emails hidden; no actions.',
};

/**
 * Add by email, pick a role. The account must already exist (they sign up in the app first). `lastOwnerEmail` is the
 * only owner's email when there is just one: giving that email a lower role would leave no owner, so the button is
 * disabled with a hint (the database refuses it anyway).
 */
export function AddAdminForm({ lastOwnerEmail }: { lastOwnerEmail: string | null }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('support');
  const demotesLastOwner =
    lastOwnerEmail !== null && role !== 'owner' && email.trim().toLowerCase() === lastOwnerEmail.toLowerCase();
  return (
    <>
    <div className={styles.filters}>
      <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="support">Support</option>
        <option value="readonly">Readonly</option>
        <option value="owner">Owner</option>
      </SelectField>
      <ConfirmAction
        label="Add admin"
        title="Add this admin?"
        confirmLabel="Add admin"
        className={styles.actionButton}
        disabled={demotesLastOwner}
        action={async () => {
          const result = await setAdmin(email, role);
          if (result.ok) setEmail('');
          return result;
        }}
      >
        <p>{email || 'This account'} becomes {role}. They sign in here with their CalTracker password and set up two-step.</p>
      </ConfirmAction>
    </div>
    {/* Below the row, not under the Role box, so the three controls line up. */}
    {demotesLastOwner ? <p className={styles.panelNote}><b>Add another owner first.</b></p> : null}
    <p className={styles.panelNote}>{ROLE_HELP[role] ?? ''}</p>
    </>
  );
}
