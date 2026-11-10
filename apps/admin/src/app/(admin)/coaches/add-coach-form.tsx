'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WORKSPACE_NAME_MAX_LENGTH, NAME_MAX_LENGTH } from '@caltracker/shared';
import { Button, ErrorText, TextField } from '@/components/ui';
import { useActionStatus } from '@/components/confirm-dialog';
import styles from '@/components/admin.module.css';
import { addCoach } from './actions';

const EMPTY = { firstName: '', lastName: '', email: '', workspaceName: '' };

/** Owner only. Mockup: Coaches.dc.html ("Add a coach"). */
export function AddCoachForm() {
  const router = useRouter();
  const report = useActionStatus();
  const [fields, setFields] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: e.target.value });

  async function onSubmit() {
    setPending(true);
    setError(null);
    const result = await addCoach(fields);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFields(EMPTY);
    report?.(result.message);
    router.refresh();
  }

  return (
    <form action={() => void onSubmit()} className={styles.addCoach}>
      <div className={styles.filters}>
        <TextField label="First name" value={fields.firstName} onChange={set('firstName')} required maxLength={NAME_MAX_LENGTH} autoComplete="off" />
        <TextField label="Last name" value={fields.lastName} onChange={set('lastName')} maxLength={NAME_MAX_LENGTH} autoComplete="off" />
        <TextField label="Email" type="email" value={fields.email} onChange={set('email')} required autoComplete="off" />
        <TextField
          label="Workspace name"
          value={fields.workspaceName}
          onChange={set('workspaceName')}
          required
          maxLength={WORKSPACE_NAME_MAX_LENGTH}
          autoComplete="off"
        />
        <Button type="submit" pending={pending} className={styles.addCoachButton}>Add coach</Button>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <p className={styles.panelNote}>
        They get an email to set a password and sign in at caltracker.app. Their workspace starts with the standard exercise library.
      </p>
    </form>
  );
}
