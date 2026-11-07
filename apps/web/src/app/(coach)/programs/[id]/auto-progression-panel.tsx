'use client';

import { useId, useState } from 'react';
import { Card, ErrorText } from '@/components/ui';
import { failureMessage } from '@/lib/action-errors';
import { setProgramAutoProgression } from '../actions';
import styles from '../programs.module.css';

/**
 * The program's Auto progression switch (docs/superpowers/specs/2026-11-07-auto-progression-design.md). It changes
 * only the suggested weight clients see, never the workouts themselves.
 */
export function AutoProgressionPanel({ programId, initial }: { programId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const helpId = useId();

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const outcome = await setProgramAutoProgression(programId, !on);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setOn(outcome.on);
    } catch (e) {
      setError(failureMessage(e, "Couldn't change Auto progression. Please try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className={styles.liveSync}>
      <div className={styles.liveSyncRow}>
        <span id={labelId} className={styles.sectionHeading}>
          Auto progression
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={helpId}
          className={styles.switch}
          disabled={pending}
          onClick={() => void toggle()}
          data-testid="auto-progression-switch"
        >
          <span aria-hidden="true">{on ? 'On' : 'Off'}</span>
        </button>
      </div>
      <p id={helpId} className={styles.caption}>
        When on, clients see a suggested weight for weight-and-reps exercises you left without a weight. All working
        sets at the top of the rep range last time: +5 lb upper body, +10 lb lower body (+2.5 / +5 kg). Below the
        bottom of the range two sessions in a row: 10% lighter. A weight you type in a workout always wins.
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}
