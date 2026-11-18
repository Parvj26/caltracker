'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ExerciseIndexRow, ExercisePick } from '@caltracker/shared';
import { SearchPanel } from '@/components/exercise-search/search-panel';
import { Button } from '@/components/ui/button';
import styles from '@/components/exercise-search/exercise-search.module.css';
import discardStyles from '@/components/ui/adaptive-dialog.module.css';
import { openLayer } from '@/lib/open-layer';

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
  /** With `multiple`: a line above the Add button. */
  footerNote?: string;
  onPick: (exercises: ExercisePick[]) => void;
  onClose: () => void;
  /** Exercise ids not to offer (a substitute's picker leaves out the planned exercise and its other substitutes). */
  exclude?: readonly string[];
};

/** Search built-in and custom exercises in a native modal dialog (focus is trapped and Escape closes it). */
export function ExercisePicker({ title, workspaceId, multiple, min, max, hint, groupLabel, footerNote, onPick, onClose, exclude }: Props) {
  // SearchPanel needs a stable row filter: it only changes when the excluded ids do.
  const excludeKey = (exclude ?? []).join(',');
  const rowFilter = useCallback(
    (row: ExerciseIndexRow) => !excludeKey.split(',').includes(row.id),
    [excludeKey],
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const discardId = useId();
  // Picked but not added yet: closing (×, Cancel, Escape, a tap outside, Back) asks before dropping them.
  const [picked, setPicked] = useState(0);
  // Also kept in a ref: Back can come before the re-render with the new count (a pick inside a slow transition).
  const pickedNow = useRef(0);
  const onSelectionChange = useCallback((n: number) => {
    pickedNow.current = n;
    setPicked(n);
  }, []);
  const [asking, setAsking] = useState(false);
  const requestClose = () => {
    if (pickedNow.current > 0) setAsking(true);
    else dialogRef.current?.close();
  };
  useEffect(() => {
    if (asking) dialogRef.current?.querySelector<HTMLButtonElement>('[data-discard-keep]')?.focus();
  }, [asking]);

  useEffect(() => {
    const dialog = dialogRef.current;
    // The picker unmounts when it closes, so hand focus back to the button that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog) openLayer(dialog);
    return () => {
      // Without scrolling: the builder scrolls to what was just added, and the opener was in sight when tapped.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (asking) setAsking(false);
        else requestClose();
      }}
    >
      <div className={styles.dialogHead}>
        <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
        <button type="button" className={styles.close} aria-label="Close picker" onClick={requestClose}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {asking ? (
        <div className={discardStyles.discard} role="group" aria-labelledby={discardId}>
          <p id={discardId} className={discardStyles.discardText} data-ph-safe="">
            <strong>Discard changes?</strong> {picked === 1 ? '1 picked exercise isn’t added yet.' : `${picked} picked exercises aren’t added yet.`}
          </p>
          <div className={discardStyles.discardActions}>
            <Button variant="secondary" size="compact" data-discard-keep="" onClick={() => setAsking(false)} phSafe>
              Keep picking
            </Button>
            <Button variant="danger" size="compact" onClick={() => dialogRef.current?.close()} phSafe>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      <SearchPanel
        mode={multiple ? 'pick-many' : 'pick-one'}
        workspaceId={workspaceId}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(hint !== undefined ? { hint } : {})}
        {...(groupLabel !== undefined ? { groupLabel } : {})}
        {...(footerNote ? { footerExtra: <p className={styles.footerNote}>{footerNote}</p> } : {})}
        {...(excludeKey ? { rowFilter } : {})}
        onPick={onPick}
        onCancel={requestClose}
        onSelectionChange={onSelectionChange}
      />
    </dialog>
  );
}
