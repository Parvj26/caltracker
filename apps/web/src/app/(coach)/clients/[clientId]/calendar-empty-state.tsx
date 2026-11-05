'use client';

import { useId } from 'react';
import { Card } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import styles from '@/components/calendar/calendar.module.css';

/** Shown above an empty calendar: the two ways to put workouts on it, as big tiles. */
export function CalendarEmptyState({
  firstName,
  onAssign,
  onAdd,
}: {
  firstName: string;
  onAssign: () => void;
  onAdd: () => void;
}) {
  const id = useId();
  return (
    <Card className={styles.panel}>
      <section aria-labelledby={`${id}-title`} className={styles.emptyState}>
        <h2 id={`${id}-title`} className={styles.sectionHeading}>
          Nothing on {firstName}&apos;s calendar yet
        </h2>
        <div className={styles.choices}>
          <ChoiceTile id={`${id}-assign`} tone="lime" title="Assign a program" body="Fill several weeks at once." onClick={onAssign} />
          <ChoiceTile id={`${id}-add`} tone="blue" title="Add a single workout" body="Pick a day and a workout." onClick={onAdd} />
        </div>
      </section>
    </Card>
  );
}

function ChoiceTile({
  id,
  tone,
  title,
  body,
  onClick,
}: {
  id: string;
  tone: 'lime' | 'blue';
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(styles.choice, tone === 'lime' ? styles.choiceLime : styles.choiceBlue)}
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      onClick={onClick}
    >
      <span id={`${id}-t`} className={styles.choiceTitle}>{title}</span>
      <span id={`${id}-d`} className={styles.choiceBody}>{body}</span>
    </button>
  );
}
