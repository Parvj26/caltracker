'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_SETS } from '@caltracker/shared';
import type { ExerciseIndexRow, ExercisePick } from '@caltracker/shared';
import { SearchPanel } from '@/components/exercise-search/search-panel';
import styles from '@/components/exercise-search/exercise-search.module.css';
import { SetCountStepper } from './set-count-stepper';

type Props = {
  title: string;
  /** The coach's workspace (from requireCoach). */
  workspaceId: string;
  /** Pick several (a superset needs at least two) and confirm, instead of picking one. */
  multiple: boolean;
  /** With `multiple`: how many must be picked (default 2) and the most that can be (default 10). */
  min?: number;
  max?: number;
  /** With `multiple`: the line under the search box. */
  hint?: string;
  /** With `multiple`: what the picks become, e.g. 'superset' or 'pick-one group'. */
  groupLabel?: string;
  /** With `multiple`: shows a "Sets each: − 3 +" control (or "Rounds" for a superset) beside the Add button. */
  setCount?: { label: string; noun: string };
  /** `sets` is the stepper's value (3 when there is no stepper). */
  onPick: (exercises: ExercisePick[], sets: number) => void;
  onClose: () => void;
  /** Exercise ids not to offer (a substitute's picker leaves out the planned exercise and its other substitutes). */
  exclude?: readonly string[];
};

/** Search built-in and custom exercises in a native modal dialog (focus is trapped and Escape closes it). */
export function ExercisePicker({ title, workspaceId, multiple, min, max, hint, groupLabel, setCount, onPick, onClose, exclude }: Props) {
  // SearchPanel needs a stable row filter: it only changes when the excluded ids do.
  const excludeKey = (exclude ?? []).join(',');
  const rowFilter = useCallback(
    (row: ExerciseIndexRow) => !excludeKey.split(',').includes(row.id),
    [excludeKey],
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [sets, setSets] = useState(DEFAULT_SETS);

  useEffect(() => {
    const dialog = dialogRef.current;
    // The picker unmounts when it closes, so hand focus back to the button that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.dialogHead}>
        <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
        <button type="button" className={styles.close} aria-label="Close picker" onClick={() => dialogRef.current?.close()}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <SearchPanel
        mode={multiple ? 'pick-many' : 'pick-one'}
        workspaceId={workspaceId}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(hint !== undefined ? { hint } : {})}
        {...(groupLabel !== undefined ? { groupLabel } : {})}
        {...(setCount ? { footerExtra: <SetCountStepper label={setCount.label} noun={setCount.noun} value={sets} onChange={setSets} /> } : {})}
        {...(excludeKey ? { rowFilter } : {})}
        onPick={(exs) => onPick(exs, setCount ? sets : DEFAULT_SETS)}
        onCancel={() => dialogRef.current?.close()}
      />
    </dialog>
  );
}
