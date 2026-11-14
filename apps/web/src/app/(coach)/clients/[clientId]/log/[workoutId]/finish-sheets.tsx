'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { UntickedRow } from '@caltracker/shared';
import { showDialog } from '@/components/calendar/show-dialog';
import { Button } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import styles from './session.module.css';

const sets = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'}`;

/** A modal sheet: slides up from the bottom on a phone, a centred box on wider screens. Escape or ✕-less close = Keep logging. */
function LoggerSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog) showDialog(dialog);
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={onClose}
      // A tap on the dimmed page around the sheet closes it, as Keep logging does.
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <span aria-hidden="true" className={styles.grab} />
      <h2 id={titleId} className={styles.sheetTitle}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}

/**
 * Finish with sets left open: says how many and which exercises, then Mark all done and finish (the main one),
 * Finish anyway (only the ticked sets count), or Keep logging.
 */
export function UntickedSheet({
  open,
  done,
  rows,
  clientName,
  onMarkAllAndFinish,
  onFinishAnyway,
  onKeepLogging,
}: {
  open: number;
  done: number;
  rows: readonly UntickedRow[];
  clientName: string;
  onMarkAllAndFinish: () => void;
  onFinishAnyway: () => void;
  onKeepLogging: () => void;
}) {
  const unpicked = rows.some((r) => r.needsPick);
  return (
    <LoggerSheet title={`${sets(open)} ${open === 1 ? "isn't" : "aren't"} ticked`} onClose={onKeepLogging}>
      <ul className={styles.untickedList} aria-label="Exercises with sets not ticked">
        {rows.map((r) => (
          <li key={r.key} className={styles.untickedRow}>
            <span className={styles.untickedName}>{r.name}</span>
            <span className={styles.caption}>{r.needsPick ? 'Not picked yet' : `${r.done} of ${r.total} ticked`}</span>
          </li>
        ))}
      </ul>
      <p className={styles.caption}>
        Sets that aren&apos;t ticked are left out of {clientName}&apos;s history and totals.
        {unpicked ? ' Pick-one groups with no pick stay empty.' : ''}
      </p>
      <div className={styles.sheetActions}>
        <Button className={styles.sheetButton} onClick={onMarkAllAndFinish} data-ph-safe="">
          Mark all done and finish
        </Button>
        {done > 0 ? (
          <Button variant="secondary" className={styles.sheetButton} onClick={onFinishAnyway} data-ph-safe="">
            Finish anyway ({sets(done)})
          </Button>
        ) : null}
        <button type="button" className={styles.textButton} onClick={onKeepLogging} data-ph-safe="">
          Keep logging
        </button>
      </div>
    </LoggerSheet>
  );
}

/** Cancel session…: "Discard this session?" with what goes, then Discard session (red) or Keep logging. */
export function DiscardSheet({
  done,
  earlierSets,
  workoutName,
  clientName,
  onDiscard,
  onKeepLogging,
}: {
  done: number;
  /** Sets ticked before this page opened (after a take over, the ones the client logged on their phone). */
  earlierSets: number;
  workoutName: string;
  clientName: string;
  onDiscard: () => void;
  onKeepLogging: () => void;
}) {
  return (
    <LoggerSheet title="Discard this session?" onClose={onKeepLogging}>
      <p className={styles.sheetBody}>
        {done > 0 ? `The ${sets(done)} ticked and the notes are deleted` : 'The notes are deleted'}
        {earlierSets > 0 ? `, including the ${sets(earlierSets)} ${clientName} logged on their phone before you took over` : ''}.{' '}
        {workoutName} goes back to &ldquo;Not started&rdquo; on {clientName}&apos;s calendar.
      </p>
      <div className={styles.sheetActions}>
        <Button className={cx(styles.sheetButton, styles.dangerButton)} onClick={onDiscard} data-ph-safe="">
          Discard session
        </Button>
        <Button variant="secondary" className={styles.sheetButton} onClick={onKeepLogging} data-ph-safe="">
          Keep logging
        </Button>
      </div>
    </LoggerSheet>
  );
}
