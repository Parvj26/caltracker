'use client';

import { createContext, useContext } from 'react';
import { FindingsMap } from '@/components/assessment-findings/findings-map';
import type { RegionStates } from '@/components/body-map/state';
import { Card } from '@/components/ui';
import styles from './assessments.module.css';

/**
 * The assessment ids Compare shows right now: all of them on iPad and desktop, the two picked on a phone. Compare's
 * server-rendered parts (the body maps) read it, so they follow the phone's two boxes.
 */
export const CompareColumnsContext = createContext<readonly string[] | null>(null);

export type CompareMapColumn = { id: string; label: string; states: RegionStates };

/** "Body map · coach-confirmed": a small map per column shown. */
export function CompareMapsCard({ columns }: { columns: CompareMapColumn[] }) {
  const shown = useContext(CompareColumnsContext);
  const visible = shown ? columns.filter((c) => shown.includes(c.id)) : columns;
  if (visible.every((c) => Object.keys(c.states).length === 0)) return null;
  return (
    <Card className={styles.card} aria-labelledby="compare-maps-heading" data-testid="compare-maps">
      <h2 id="compare-maps-heading" className={styles.heading}>Body map · coach-confirmed</h2>
      <div className={styles.compareMaps}>
        {visible.map((c) => (
          <section key={c.id} aria-label={c.label} className={styles.compareMap} data-testid={`compare-map-${c.id}`}>
            <h3 className={styles.kicker}>{c.label}</h3>
            <FindingsMap states={c.states} size="small" allViews label={`${c.label} findings`} />
          </section>
        ))}
      </div>
    </Card>
  );
}
