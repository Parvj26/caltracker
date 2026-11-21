'use client';

import { useId, useState } from 'react';
import { FLAG_TYPE_LABELS, flagPlace, formatPlainDayMonth, openFlagsNewestFirst, resolvedFlags, type ClientFlag, type FlagType } from '@caltracker/shared';
import { Button } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import styles from './flags.module.css';

/** Pain / Injury / Limitation as a small chip; the word is the cue, the colour only helps (Pain red, Injury ink). */
export function FlagTypeChip({ type }: { type: FlagType }) {
  return (
    <span className={cx(styles.typeChip, styles[`type-${type}`])} data-ph-safe="">
      {FLAG_TYPE_LABELS[type]}
    </span>
  );
}

/**
 * The flag list (boards AS9 / AS1): open flags numbered as on the map (newest first) with their type, since when, the
 * note and Resolve; resolved ones behind a collapsed "Resolved (n)" with Reopen. Shared by the Overview card and the
 * Limitations & injuries tab.
 */
export function FlagList({
  flags,
  readOnly,
  busyId,
  onResolve,
  onReopen,
}: {
  flags: readonly ClientFlag[];
  readOnly: boolean;
  /** The flag being saved (its button shows it). */
  busyId: string | null;
  onResolve: (flag: ClientFlag) => void;
  onReopen: (flag: ClientFlag) => void;
}) {
  const open = openFlagsNewestFirst(flags);
  const done = resolvedFlags(flags);
  const [showResolved, setShowResolved] = useState(false);
  const resolvedId = useId();

  return (
    <div className={styles.list}>
      {open.length === 0 ? (
        <p className={styles.caption} data-ph-safe="">
          Nothing flagged.
        </p>
      ) : (
        <ol className={styles.rows} aria-label="Open flags, newest first">
          {open.map((f, i) => (
            <li key={f.id} className={styles.row}>
              <span className={styles.number} aria-hidden="true">
                {i + 1}
              </span>
              <div className={styles.rowText}>
                <span className={styles.rowHead}>
                  <span className={styles.place}>{flagPlace(f)}</span>
                  <FlagTypeChip type={f.type} />
                  <span className={styles.caption}>since {formatPlainDayMonth(f.since)}</span>
                </span>
                {f.note.trim() ? <span className={styles.note}>“{f.note.trim()}”</span> : null}
              </div>
              {readOnly ? null : (
                <Button
                  variant="quiet"
                  size="compact"
                  className={styles.rowButton}
                  pending={busyId === f.id}
                  aria-label={`Resolve ${flagPlace(f)} ${FLAG_TYPE_LABELS[f.type].toLowerCase()}`}
                  onClick={() => onResolve(f)}
                  data-ph-capture-attribute-label="flag_resolve"
                >
                  Resolve
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {done.length > 0 ? (
        <div className={styles.resolved}>
          <button type="button" className={styles.resolvedToggle} aria-expanded={showResolved} aria-controls={resolvedId} onClick={() => setShowResolved((s) => !s)}>
            <span data-ph-safe="">Resolved ({done.length})</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.chevron}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <ul id={resolvedId} className={styles.rows} hidden={!showResolved} aria-label="Resolved flags">
            {done.map((f) => (
              <li key={f.id} className={cx(styles.row, styles.rowResolved)}>
                <div className={styles.rowText}>
                  <span className={styles.rowHead}>
                    <span className={styles.place}>{flagPlace(f)}</span>
                    <FlagTypeChip type={f.type} />
                  </span>
                  <span className={styles.caption}>
                    since {formatPlainDayMonth(f.since)}
                    {f.resolvedOn ? ` · resolved ${formatPlainDayMonth(f.resolvedOn)}` : ''}
                  </span>
                  {f.note.trim() ? <span className={styles.note}>“{f.note.trim()}”</span> : null}
                </div>
                {readOnly ? null : (
                  <Button
                    variant="quiet"
                    size="compact"
                    className={styles.rowButton}
                    pending={busyId === f.id}
                    aria-label={`Reopen ${flagPlace(f)} ${FLAG_TYPE_LABELS[f.type].toLowerCase()}`}
                    onClick={() => onReopen(f)}
                    data-ph-capture-attribute-label="flag_reopen"
                  >
                    Reopen
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
