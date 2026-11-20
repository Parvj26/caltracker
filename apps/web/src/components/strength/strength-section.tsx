'use client';

import { useState } from 'react';
import type { StrengthExerciseRow } from '@caltracker/shared';
import { Button, ListRow, RowList } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { strengthExerciseHref } from '@/lib/metrics-paths';
import { Sparkline } from './sparkline';
import styles from './strength-section.module.css';

/** Rows shown before "Show all N exercises". */
export const STRENGTH_ROWS_SHOWN = 5;

const COLUMNS = ['Exercise', 'Last session', 'Trend', 'Heaviest', 'Since start'];

/**
 * Metrics' Strength section: the heaviest weight lifted per exercise, from logged workouts (product owner,
 * 2026-11-19). Plain rows on a phone (name, last session, trend, heaviest, change); a table with column headings when
 * the list is wide. Each row opens the exercise's progress page. Rows come from strengthExerciseRows (shared).
 */
export function StrengthSection({ clientId, rows, headingLevel = 2 }: { clientId: string; rows: readonly StrengthExerciseRow[]; headingLevel?: 2 | 3 }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, STRENGTH_ROWS_SHOWN);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={styles.section} aria-labelledby="strength-section-heading" data-testid="strength-section">
      <div className={styles.head}>
        <Heading id="strength-section-heading" className={styles.heading}>
          Strength
        </Heading>
        <p className={styles.caption}>Heaviest weight lifted per exercise, from logged workouts</p>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>No lifts yet. They appear here as the client logs weights and reps.</p>
      ) : (
        <>
          <RowList columns={COLUMNS} aria-label="Strength by exercise" className={styles.table}>
            {shown.map((r) => {
              const change = r.sinceStart ? <span className={cx(styles.change, r.direction !== 'up' && styles.changeFlat)}>{r.sinceStart}</span> : null;
              return (
                <ListRow
                  key={r.exerciseId}
                  href={`${strengthExerciseHref(clientId, r.exerciseId)}?range=all`}
                  title={r.name}
                  meta={<span>Last: {r.lastSession}</span>}
                  itemProps={{ 'data-exercise-row': r.name }}
                  linkProps={{ 'aria-label': `${r.name}: heaviest ${r.heaviest}${r.sinceStart ? `, ${r.sinceStart} since start` : ''}. Last session ${r.lastSession}.` }}
                  end={
                    <span className={cx(styles.end, styles.narrowOnly)}>
                      <Sparkline values={r.trend} invert={r.style === 'assisted'} className={styles.narrowSpark} />
                      <span className={styles.endNumbers}>
                        <span className={styles.heaviest}>{r.heaviest}</span>
                        {change}
                      </span>
                    </span>
                  }
                  cells={[
                    <span key="last">{r.lastSession}</span>,
                    <Sparkline key="trend" values={r.trend} invert={r.style === 'assisted'} />,
                    <span key="heaviest" className={cx(styles.cellNumber, styles.cellHeaviest)}>{r.heaviest}</span>,
                    <span key="since" className={styles.cellNumber}>{change}</span>,
                  ]}
                />
              );
            })}
          </RowList>
          {rows.length > STRENGTH_ROWS_SHOWN ? (
            <Button variant="quiet" size="compact" className={styles.more} onClick={() => setAll((a) => !a)} aria-expanded={all}>
              {all ? 'Show fewer' : `Show all ${rows.length} exercises`}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
