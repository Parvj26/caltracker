'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { PlanCell } from '@caltracker/shared';
import { Button, SelectField } from '@/components/ui';
import { DAYS, cellLabel, cellsLabel, focusSoon } from './grid-ids';
import styles from '../programs.module.css';

/**
 * Pick where a workout goes on the plan (the non-drag path):
 * - move: one week and day for a placed workout ("Move to…");
 * - add: one week and day for a library workout ("Add to which day?", tapping a Library workout);
 * - copy: one or more days for a placed workout ("Copy to…"); the day it is on can't be picked.
 */
export function MoveSlotDialog({
  mode = 'move',
  name,
  from,
  weeks,
  initial,
  returnFocusTo,
  onMove,
  onCopy,
  onClose,
}: {
  mode?: 'move' | 'add' | 'copy';
  /** The workout's name, for the title. */
  name: string;
  /** Where the workout is now (move, copy); nothing for a library workout. */
  from?: PlanCell;
  weeks: number;
  /** The week and day the pickers start on. */
  initial: PlanCell;
  /** DOM id to focus once the dialog is gone. */
  returnFocusTo?: string;
  /** Move and add: the one day picked. */
  onMove?: (week: number, day: number) => void;
  /** Copy: the days picked. */
  onCopy?: (cells: PlanCell[]) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [week, setWeek] = useState(Math.min(Math.max(initial.week, 1), weeks));
  const [day, setDay] = useState(initial.day);
  const [picked, setPicked] = useState<PlanCell[]>([]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (returnFocusTo) focusSoon(returnFocusTo);
    };
  }, [returnFocusTo]);

  const isPicked = (d: number) => picked.some((c) => c.week === week && c.day === d);
  const toggle = (d: number) =>
    setPicked((p) => (isPicked(d) ? p.filter((c) => !(c.week === week && c.day === d)) : [...p, { week, day: d }]));
  const sorted = [...picked].sort((a, b) => a.week - b.week || a.day - b.day);

  const title = mode === 'move' ? `Move ${name}` : mode === 'add' ? `Add ${name}` : `Copy ${name}`;
  const weekSelect = (
    <SelectField label="Week" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
      {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
        <option key={w} value={w}>Week {w}</option>
      ))}
    </SelectField>
  );

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
      {mode === 'add' ? <p className={styles.dialogBody}>Add to which day?</p> : null}
      {mode === 'move' && from ? <p className={styles.dialogBody}>Now on {cellLabel(from.week, from.day)}.</p> : null}
      {mode === 'copy' && from ? (
        <p className={styles.dialogBody}>
          Now on {cellLabel(from.week, from.day)}. Pick the days to copy it to; you can switch weeks and pick more.
        </p>
      ) : null}

      {mode === 'copy' ? (
        <>
          {weekSelect}
          <fieldset className={styles.dayChecks}>
            <legend className={styles.visuallyHidden}>Days of week {week}</legend>
            {DAYS.map((d) => {
              const here = from?.week === week && from.day === d;
              return (
                <label key={d} className={styles.dayCheck}>
                  <input type="checkbox" checked={isPicked(d)} disabled={here} onChange={() => toggle(d)} />
                  <span>
                    Day {d}
                    {here ? <span className={styles.caption}> (here now)</span> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className={styles.caption} role="status">
            {sorted.length === 0 ? 'No days picked yet.' : `Copies to ${cellsLabel(sorted)}.`}
          </p>
        </>
      ) : (
        <div className={styles.moveFields}>
          {weekSelect}
          <SelectField label="Day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d) => (
              <option key={d} value={d}>Day {d}</option>
            ))}
          </SelectField>
        </div>
      )}

      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        {mode === 'copy' ? (
          <Button disabled={sorted.length === 0} onClick={() => onCopy?.(sorted)} data-ph-capture-attribute-label="program_copy_slot_save">
            {sorted.length > 1 ? `Copy to ${sorted.length} days` : 'Copy'}
          </Button>
        ) : (
          <Button onClick={() => onMove?.(week, day)}>{mode === 'add' ? 'Add' : 'Move'}</Button>
        )}
      </div>
    </dialog>
  );
}
