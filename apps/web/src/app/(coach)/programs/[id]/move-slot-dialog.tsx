'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button, SelectField } from '@/components/ui';
import { DAYS, cellLabel, chipDomId, focusSoon } from './grid-ids';
import type { Slot } from './program-grid';
import styles from '../programs.module.css';

/** Move one program workout to another week and day (the menu's non-drag path). */
export function MoveSlotDialog({
  slot,
  weeks,
  onMove,
  onClose,
}: {
  slot: Slot;
  weeks: number;
  onMove: (week: number, day: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [week, setWeek] = useState(Math.min(slot.week, weeks));
  const [day, setDay] = useState(slot.day);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // The menu that opened this is gone, and the chip remounts in its new day: focus the chip there.
    return () => {
      focusSoon(chipDomId(slot.id));
    };
  }, [slot.id]);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Move {slot.workoutName}</h2>
      <p className={styles.dialogBody}>Now on {cellLabel(slot.week, slot.day)}.</p>
      <div className={styles.moveFields}>
        <SelectField label="Week" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </SelectField>
        <SelectField label="Day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>Day {d}</option>
          ))}
        </SelectField>
      </div>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button onClick={() => onMove(week, day)}>Move</Button>
      </div>
    </dialog>
  );
}
