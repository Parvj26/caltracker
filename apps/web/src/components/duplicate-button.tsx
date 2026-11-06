'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { duplicateProgram } from '@/app/(coach)/programs/actions';
import { duplicateWorkout } from '@/app/(coach)/workouts/actions';
import { Button, ErrorText } from '@/components/ui';
import { failureMessage } from '@/lib/action-errors';
import styles from './duplicate-button.module.css';

type Props = {
  kind: 'workout' | 'program';
  id: string;
  name: string;
  /** A small outlined button for list rows (named "Duplicate <name>"), instead of the page's secondary button. */
  compact?: boolean;
};

/**
 * Makes "<name> (copy)" in the coach's workspace and opens it. It copies what is saved, so unsaved edits in the
 * workout builder are not part of the copy.
 */
export function DuplicateButton({ kind, id, name, compact = false }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = kind === 'workout' ? await duplicateWorkout(id) : await duplicateProgram(id);
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        router.push(kind === 'workout' ? `/workouts/${outcome.id}` : `/programs/${outcome.id}`);
      } catch (e) {
        setError(failureMessage(e, "Couldn't copy. Check your connection and try again."));
      }
    });
  }

  const label = pending ? 'Duplicating…' : 'Duplicate';
  return (
    <span className={styles.wrap}>
      {compact ? (
        <button
          type="button"
          className={styles.small}
          aria-label={`Duplicate ${name}`}
          aria-busy={pending || undefined}
          disabled={pending}
          onClick={run}
        >
          {label}
        </button>
      ) : (
        <Button variant="secondary" pending={pending} onClick={run}>
          {label} {kind}
        </Button>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </span>
  );
}
