'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AssignButton } from '@/components/assign/assign-to-clients';
import { useDuplicate } from '@/components/duplicate-button';
import { MoreMenu } from '@/components/more-menu';
import { ErrorText } from '@/components/ui';
import { DeleteDialog } from '../workout-row-actions';
import styles from './header.module.css';

/**
 * The workout page's actions beside "‹ Workouts" (UI rules §4, §8): an outlined Assign, so Save stays the one main
 * button, and ⋯ with Duplicate and Delete…. Delete asks first, the same question as the Workouts list's Delete…, and
 * refuses while a program or an open invite's starting plan uses the workout. Once deleted, the list takes its place
 * in history (replace), so Back never shows the deleted workout.
 */
export function WorkoutPageActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const duplicate = useDuplicate('workout', id);
  return (
    <div className={styles.actions}>
      <AssignButton kind="workout" id={id} name={name} secondary />
      <MoreMenu
        label={`More for ${name}`}
        busy={duplicate.pending}
        items={[
          { label: duplicate.pending ? 'Duplicating…' : 'Duplicate', onSelect: duplicate.run, disabled: duplicate.pending },
          { label: 'Delete…', onSelect: () => setDeleting(true), danger: true },
        ]}
      />
      {duplicate.pending ? (
        <span className={styles.srOnly} role="status">
          Duplicating…
        </span>
      ) : null}
      {duplicate.error ? <ErrorText code={duplicate.error} className={styles.error} /> : null}
      {deleting ? <DeleteDialog id={id} name={name} onClose={() => setDeleting(false)} onDeleted={() => router.replace('/workouts')} /> : null}
    </div>
  );
}
