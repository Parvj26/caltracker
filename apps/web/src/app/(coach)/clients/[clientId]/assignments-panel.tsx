'use client';

import { showDialog } from '@/components/calendar/show-dialog';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { IsoDate } from '@caltracker/shared';
import { formatDayMonth, formatShortDay } from '@/components/calendar/format';
import { Button, Card } from '@/components/ui';
import { failureMessage } from '@/lib/action-errors';
import { unassignProgram } from './actions';
import type { AssignmentSummary } from './client-calendar';
import styles from '@/components/calendar/calendar.module.css';

const workoutsText = (n: number) => `${n} ${n === 1 ? 'workout' : 'workouts'}`;
const assignmentText = (a: AssignmentSummary) => `${a.programName} · ${formatDayMonth(a.startDate)} – ${formatDayMonth(a.endDate)}`;

/**
 * The client's assigned programs: each row opens its program, with "Remove from calendar" (from the coach's today on)
 * beside it.
 */
export function AssignmentsPanel({
  assignments,
  today,
  readOnly,
  onMessage,
}: {
  assignments: AssignmentSummary[];
  today: IsoDate;
  readOnly: boolean;
  onMessage: (message: string) => void;
}) {
  const headingId = useId();
  const [removing, setRemoving] = useState<AssignmentSummary | null>(null);
  return (
    <Card className={styles.panel}>
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className={styles.sectionHeading}>Assigned programs</h2>
        {assignments.length === 0 ? (
          <p className={styles.caption}>
            {readOnly ? 'No programs assigned.' : 'No programs assigned. Use Assign program to add one.'}
          </p>
        ) : (
          <ul className={styles.assignments}>
            {assignments.map((a) => (
              <li key={a.id} className={styles.assignment}>
                {a.programId ? (
                  // The row opens the program; "Remove from calendar" stays its own button beside it.
                  <Link href={`/programs/${a.programId}`} className={styles.assignmentLink}>
                    <span className={styles.assignmentName}>{assignmentText(a)}</span>
                    <span aria-hidden="true" className={styles.assignmentChevron}>›</span>
                  </Link>
                ) : (
                  // Its program has been deleted since: nothing to open.
                  <span className={styles.assignmentLink}>
                    <span className={styles.assignmentName}>{assignmentText(a)}</span>
                  </span>
                )}
                {readOnly ? null : (
                  <Button
                    variant="secondary"
                    aria-label={`Remove ${a.programName} from calendar`}
                    onClick={() => setRemoving(a)}
                  >
                    Remove from calendar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {removing ? (
        <UnassignDialog
          assignment={removing}
          today={today}
          onDone={(removed) => {
            setRemoving(null);
            if (removed !== null) onMessage(`Removed ${workoutsText(removed)}.`);
          }}
          onError={(message) => {
            setRemoving(null);
            onMessage(message);
          }}
        />
      ) : null}
    </Card>
  );
}

function UnassignDialog({
  assignment,
  today,
  onDone,
  onError,
}: {
  assignment: AssignmentSummary;
  today: IsoDate;
  /** `removed` is null when the coach cancelled. */
  onDone: (removed: number | null) => void;
  onError: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [pending, setPending] = useState(false);
  const upcoming = assignment.dates.filter((d) => d >= today).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) showDialog(dialog);
  }, []);

  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      // From the coach's own today, as the browser sees it.
      const { removed } = await unassignProgram({ assignmentId: assignment.id, fromDate: today });
      onDone(removed);
    } catch (e) {
      onError(failureMessage(e, "Couldn't remove the program. Please try again."));
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClose={() => onDone(null)}
    >
      <h2 id={titleId} className={styles.dialogTitle}>Remove {assignment.programName} from the calendar?</h2>
      <p id={bodyId} className={styles.dialogBody}>
        Removes {upcoming} upcoming {upcoming === 1 ? 'workout' : 'workouts'} from {formatShortDay(today)}. Past workouts
        stay.
      </p>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={() => void confirm()} pending={pending}>
          {pending ? 'Removing…' : 'Remove'}
        </Button>
      </div>
    </dialog>
  );
}
