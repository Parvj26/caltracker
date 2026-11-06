'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { followingWeeks, slotsInWeeks } from '@caltracker/shared';
import { Button, SelectField } from '@/components/ui';
import { ASSIGNED_NOTE, copyWeekButtonDomId, focusSoon } from './grid-ids';
import type { Slot } from './program-grid';
import styles from '../programs.module.css';

const FOLLOWING = 'following';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const weeksLabel = (targets: readonly number[]) =>
  targets.length === 1 ? `week ${targets[0]}` : `weeks ${targets[0]} to ${targets[targets.length - 1]}`;

/**
 * "Copy week N to…": another week, or every following week ("Repeat week N"). Copying replaces what the target weeks
 * hold, so when they already have workouts the dialog asks once more, inside the dialog, before replacing them.
 */
export function CopyWeekDialog({
  week,
  weeks,
  slots,
  saving,
  onCopy,
  onClose,
}: {
  week: number;
  weeks: number;
  slots: Slot[];
  /** True while other grid changes are still saving: the copy waits, so it copies what is saved. */
  saving: boolean;
  onCopy: (toWeeks: number[]) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const following = followingWeeks(week, weeks);
  const others = Array.from({ length: weeks }, (_, i) => i + 1).filter((w) => w !== week);
  const [target, setTarget] = useState<string>(following.length > 1 ? FOLLOWING : String(others[0] ?? ''));
  const [confirming, setConfirming] = useState(false);
  const sourceCount = slotsInWeeks(slots, [week]);
  const targets = target === FOLLOWING ? following : target ? [Number(target)] : [];
  const replacing = slotsInWeeks(slots, targets);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      focusSoon(copyWeekButtonDomId(week));
    };
  }, [week]);

  const close = () => dialogRef.current?.close();

  function copy() {
    if (targets.length === 0) return;
    if (replacing > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    onCopy(targets);
  }

  const cannot =
    sourceCount === 0
      ? `Week ${week} has no workouts yet. Add some, then copy it.`
      : others.length === 0
        ? 'This program has only one week. Add a week first, then copy into it.'
        : null;

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} aria-describedby={bodyId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Copy week {week}</h2>
      {cannot ? (
        <>
          <p id={bodyId} className={styles.dialogBody}>{cannot}</p>
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={close}>Close</Button>
          </div>
        </>
      ) : confirming ? (
        <>
          <p id={bodyId} className={styles.dialogBody} role="alert">
            {weeksLabel(targets).replace(/^w/, 'W')} already {targets.length === 1 ? 'has' : 'have'}{' '}
            {plural(replacing, 'workout', 'workouts')}. Copying replaces {replacing === 1 ? 'it' : 'them'} with week{' '}
            {week}&apos;s {plural(sourceCount, 'workout', 'workouts')}.
          </p>
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Back</Button>
            <Button onClick={copy} disabled={saving}>
              Replace {weeksLabel(targets)}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p id={bodyId} className={styles.dialogBody}>
            Puts week {week}&apos;s {plural(sourceCount, 'workout', 'workouts')} on the same days of another week, replacing
            what that week has. {ASSIGNED_NOTE}
          </p>
          <SelectField label="Copy to" value={target} onChange={(e) => setTarget(e.target.value)}>
            {others.map((w) => (
              <option key={w} value={w}>Week {w}</option>
            ))}
            {following.length > 1 ? (
              <option value={FOLLOWING}>Every following week (weeks {following[0]} to {following[following.length - 1]})</option>
            ) : null}
          </SelectField>
          {saving ? <p className={styles.dialogBody}>Waiting for your last change to save…</p> : null}
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={copy} disabled={saving || targets.length === 0}>
              Copy
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
