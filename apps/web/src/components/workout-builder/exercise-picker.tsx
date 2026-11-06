'use client';

import { useEffect, useId, useRef } from 'react';
import type { ExercisePick } from '@caltracker/shared';
import { SearchPanel } from '@/components/exercise-search/search-panel';
import styles from '@/components/exercise-search/exercise-search.module.css';

type Props = {
  title: string;
  /** Pick several (a superset needs at least two) and confirm, instead of picking one. */
  multiple: boolean;
  onPick: (exercises: ExercisePick[]) => void;
  onClose: () => void;
};

/** Search built-in and custom exercises in a native modal dialog (focus is trapped and Escape closes it). */
export function ExercisePicker({ title, multiple, onPick, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
      <SearchPanel
        mode={multiple ? 'pick-many' : 'pick-one'}
        onPick={onPick}
        onCancel={() => dialogRef.current?.close()}
      />
    </dialog>
  );
}
