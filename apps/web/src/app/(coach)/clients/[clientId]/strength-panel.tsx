'use client';

import { useState } from 'react';
import { addDays, diffDays, formatWeight, shortDate, strengthSummary, type Units } from '@caltracker/shared';
import { LineChart } from '@/components/charts/line-chart';
import { Card, SelectField } from '@/components/ui';
import type { ClientStrength } from '@/lib/client-strength';
import styles from './stickers-panel.module.css';

const EPOCH = '2000-01-01';

/** Strength progress: pick an exercise to chart its estimated 1RM over time. */
export function StrengthPanel({ data, units }: { data: ClientStrength; units: Units }) {
  const [id, setId] = useState(data[0]?.exerciseId ?? '');
  const chosen = data.find((e) => e.exerciseId === id) ?? data[0];
  return (
    <Card className={styles.card} aria-labelledby="strength-heading">
      <h2 id="strength-heading" className={styles.heading}>Strength</h2>
      {!chosen ? (
        <p className={styles.caption}>No lifts to chart yet. They appear as the client logs weights and reps.</p>
      ) : (
        <>
          <SelectField label="Exercise" value={chosen.exerciseId} onChange={(e) => setId(e.target.value)}>
            {data.map((e) => (
              <option key={e.exerciseId} value={e.exerciseId}>{e.name}</option>
            ))}
          </SelectField>
          <LineChart
            key={chosen.exerciseId}
            title={`${chosen.name}, estimated one-rep max over time`}
            points={chosen.points.map((p) => ({
              x: diffDays(EPOCH, p.date),
              y: p.e1rmKg,
              label: `${shortDate(p.date)}: ${formatWeight(p.e1rmKg, units)} estimated 1RM, from ${formatWeight(p.bestSet.weightKg, units)} × ${p.bestSet.reps}`,
            }))}
            summary={strengthSummary(chosen.name, chosen.points, units)}
            yLabel={(y) => formatWeight(y, units)}
            xLabel={(x) => shortDate(addDays(EPOCH, x))}
          />
        </>
      )}
    </Card>
  );
}
