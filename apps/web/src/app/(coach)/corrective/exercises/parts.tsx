'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { DIRECTION_LABELS, EVIDENCE_LABELS, doseText, type CorrectiveDirection } from '@caltracker/shared';
import { Chip } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cx } from '@/components/ui/cx';
import { muscleTagLabel, tagsByMuscle, type LibraryItem } from '@/lib/corrective-library';
import styles from './corrective.module.css';

/** "↓ Under" with blue hatching, "↑ Over" with a red square: never colour alone (UI rules §2.7). */
export function DirectionTag({ direction, long = false }: { direction: CorrectiveDirection; long?: boolean }) {
  const l = DIRECTION_LABELS[direction];
  return (
    <span className={cx(styles.dirTag, direction === 'under' ? styles.dirUnder : styles.dirOver)} data-ph-safe="">
      <span className={styles.dirSwatch} aria-hidden="true" />
      {direction === 'under' ? '↓ ' : '↑ '}
      {long ? l.long : l.short}
    </span>
  );
}

/** The exercise's first photo, or a plain dumbbell mark when it has none. */
export function Thumb({ item, size = 'row' }: { item: Pick<LibraryItem, 'imageUrl' | 'name'>; size?: 'row' | 'hero' }) {
  if (item.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- plain img keeps the app host-agnostic (no image optimizer)
      <img src={item.imageUrl} alt="" className={size === 'row' ? styles.thumb : styles.hero} loading="lazy" />
    );
  }
  return (
    <span className={cx(size === 'row' ? styles.thumb : styles.hero, styles.thumbEmpty)} aria-hidden="true">
      <svg width={size === 'row' ? 20 : 40} height={size === 'row' ? 20 : 40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" />
      </svg>
    </span>
  );
}

/** Muscle chips: "Glute medius · L R". */
export function MuscleChips({ item }: { item: Pick<LibraryItem, 'muscles'> }) {
  return (
    <ul className={styles.chipList} aria-label="Muscle groups">
      {tagsByMuscle(item.muscles).map((g) => (
        <li key={g.muscleId}>
          <Chip tone="grey">{muscleTagLabel(g.muscleId, g.sides)}</Chip>
        </li>
      ))}
    </ul>
  );
}

/** What a corrective is (desktop's pane, the phone and iPad pop-up's first step). */
export function CorrectiveSummary({ item, headingLevel = 2, actions }: { item: LibraryItem; headingLevel?: 2 | 3; actions?: ReactNode }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.summary}>
      <Thumb item={item} size="hero" />
      <div className={styles.summaryHead}>
        <H className={styles.summaryTitle}>{item.name}</H>
        {item.yours ? <YoursChip /> : null}
        {actions ? <span className={styles.summaryActions}>{actions}</span> : null}
      </div>
      <p className={styles.summaryDir}>
        <DirectionTag direction={item.direction} /> <span className={styles.muted}>{DIRECTION_LABELS[item.direction].action}</span>
      </p>
      <section className={styles.summarySection}>
        <p className={styles.label}>Muscle groups</p>
        <MuscleChips item={item} />
      </section>
      <section className={styles.summarySection}>
        <p className={styles.label}>Default</p>
        <p className={styles.dose}>{doseText(item.dose)}</p>
      </section>
      {item.evidence ? <p className={styles.muted}>Built-in default · {EVIDENCE_LABELS[item.evidence]}</p> : null}
      <Link href={`/exercises/${item.exerciseId}`} className={styles.openLink}>
        {item.custom ? 'Exercise page (photos, steps)' : 'Exercise page'}
        <ChevronIcon direction="right" size={16} />
      </Link>
    </div>
  );
}

export function YoursChip() {
  return (
    <Chip tone="lime" phSafe className={styles.yours}>
      Yours
    </Chip>
  );
}
