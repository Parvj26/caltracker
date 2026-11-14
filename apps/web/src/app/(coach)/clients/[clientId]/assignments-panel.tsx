'use client';

import { showDialog } from '@/components/calendar/show-dialog';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { IsoDate } from '@caltracker/shared';
import { formatDayMonth, formatShortDay } from '@/components/calendar/format';
import { Button } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cx } from '@/components/ui/cx';
import { failureMessage } from '@/lib/action-errors';
import { unassignProgram } from './actions';
import type { AssignmentSummary } from './client-calendar';
import styles from '@/components/calendar/calendar.module.css';
import pageStyles from './client-page.module.css';

const workoutsText = (n: number) => `${n} ${n === 1 ? 'workout' : 'workouts'}`;
const assignmentText = (a: AssignmentSummary) => `${a.programName} · ${formatDayMonth(a.startDate)} – ${formatDayMonth(a.endDate)}`;

/**
 * The client's assigned programs, folded into one line ("2 programs on the calendar ›") so the calendar starts on the
 * first screen of a phone. A tap opens the list: each row opens its program, and its "⋯" has Remove from calendar
 * (red; it asks first, saying how many upcoming workouts go). Nothing shows while no program is assigned (the empty
 * calendar offers Assign program itself).
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
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<AssignmentSummary | null>(null);
  const n = assignments.length;
  return (
    <>
      {n > 0 ? (
        <section aria-labelledby={headingId} className={pageStyles.programs}>
          <h2 id={headingId} className={pageStyles.visuallyHidden}>Assigned programs</h2>
          <button type="button" className={pageStyles.programsSummary} aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
            <span className={pageStyles.programsText}>
              <span className={pageStyles.programsCount}>
                {n} {n === 1 ? 'program' : 'programs'} on the calendar
              </span>
              <span className={pageStyles.programsNames}>{assignments.map((a) => a.programName).join(' · ')}</span>
            </span>
            <span className={pageStyles.programsChevron} aria-hidden="true">
              <ChevronIcon direction="right" size={18} />
            </span>
          </button>
          <ul id={listId} className={pageStyles.programsList} hidden={!open}>
            {assignments.map((a) => (
              <li key={a.id} className={pageStyles.programRow}>
                {a.programId ? (
                  // The row opens the program (no "›": the row's ⋯ sits at its end).
                  <Link href={`/programs/${a.programId}`} className={styles.assignmentLink}>
                    <span className={styles.assignmentName}>{assignmentText(a)}</span>
                  </Link>
                ) : (
                  // Its program has been deleted since: nothing to open.
                  <span className={styles.assignmentLink}>
                    <span className={styles.assignmentName}>{assignmentText(a)}</span>
                  </span>
                )}
                {readOnly ? null : <ProgramMenu name={a.programName} onRemove={() => setRemoving(a)} />}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
    </>
  );
}

/** A program row's "⋯": Remove from calendar, in red. Escape closes and returns focus; a tap outside closes. */
function ProgramMenu({ name, onRemove }: { name: string; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div ref={wrapRef} className={pageStyles.menuWrap}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.menuButton}
        aria-label={`Options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={`Options for ${name}`}
          className={cx(styles.menu, pageStyles.barMenu)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
              buttonRef.current?.focus();
            } else if (e.key === 'Tab') setOpen(false);
          }}
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={itemRef}
              className={cx(styles.menuItem, pageStyles.menuDanger)}
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              Remove from calendar
            </button>
          </li>
        </ul>
      ) : null}
    </div>
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
