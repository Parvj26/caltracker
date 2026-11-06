'use client';

import { useState } from 'react';
import type { ExerciseIndexRow } from '@caltracker/shared';
import { Button, ButtonLink, Chip } from '@/components/ui';
import styles from './exercise-search.module.css';

type Props = {
  row: ExerciseIndexRow;
  /** Null until the photos and instructions load. */
  detail: { imagePaths: string[]; instructions: string[] } | null;
  imageUrl: (path: string) => string;
  /** The primary button. Omitted when the mode has none for this row. */
  action: { label: string; onClick: () => void } | { label: string; href: string } | null;
  onBack: () => void;
};

/** The right-hand pane: two photos, every muscle, equipment and the instructions collapsed after 2 lines. */
export function Preview({ row, detail, imageUrl, action, onBack }: Props) {
  const [expanded, setExpanded] = useState(false);
  const paths = detail?.imagePaths ?? (row.imagePath ? [row.imagePath] : []);
  const muscles = [...row.primaryMuscles, ...row.secondaryMuscles];
  const steps = detail?.instructions ?? [];

  return (
    <div className={styles.previewBody}>
      <button type="button" className={styles.back} onClick={onBack}>
        ← Back to list
      </button>
      <h3 className={styles.previewName}>{row.name}</h3>
      {paths.length > 0 ? (
        <div className={styles.photos}>
          {paths.slice(0, 2).map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- plain img keeps the app host-agnostic (no image optimizer)
            <img key={p} src={imageUrl(p)} alt={`${row.name}, ${i === 0 ? 'start' : 'end'} position`} width={240} height={160} loading="lazy" className={styles.photo} />
          ))}
        </div>
      ) : null}
      <div className={styles.tags} aria-label="Muscles and equipment">
        {muscles.map((m, i) => <Chip key={m} tone="pink">{i < row.primaryMuscles.length ? m : `${m} (secondary)`}</Chip>)}
        {row.equipment ? <Chip tone="grey">{row.equipment}</Chip> : null}
      </div>
      {steps.length > 0 ? (
        <div>
          <p className={expanded ? styles.stepsOpen : styles.steps}>{steps.join(' ')}</p>
          <button type="button" className={styles.more} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'less' : 'more'}
          </button>
        </div>
      ) : null}
      {action ? (
        'href' in action ? (
          <ButtonLink href={action.href} className={styles.addButton}>{action.label}</ButtonLink>
        ) : (
          <Button className={styles.addButton} onClick={action.onClick}>{action.label}</Button>
        )
      ) : null}
    </div>
  );
}
