'use client';

import { useState } from 'react';
import { heaviestChart, heaviestSessions, loadStyleOf, strengthStats, type Units } from '@caltracker/shared';
import { Card, SelectField } from '@/components/ui';
import type { ClientStrength } from '@/lib/client-strength';
import { useLocalToday } from '@/lib/local-today';
import { ExerciseChart } from './metrics/strength/[exerciseId]/exercise-chart';
import styles from './stickers-panel.module.css';

/**
 * Strength progress on the client's Training tab: pick an exercise to see its heaviest weight (the headline, product
 * owner 2026-11-19) with the change since its first session, the estimated 1-rep max second, and a chart of both per
 * session. The same shared numbers as Metrics › Strength and the client's own Progress tab.
 */
export function StrengthPanel({ data, units }: { data: ClientStrength; units: Units }) {
  // The coach's own today (the browser's calendar), as the rest of the client page uses.
  const today = useLocalToday();
  const [id, setId] = useState(data[0]?.exerciseId ?? '');
  const chosen = data.find((e) => e.exerciseId === id) ?? data[0];
  const style = chosen ? loadStyleOf(chosen.name) : 'weight';
  const sessions = chosen ? heaviestSessions(chosen.points, style) : [];
  const stats = strengthStats(sessions, units, style, today);
  const chart = chosen ? heaviestChart(chosen.name, sessions, units, style, today) : null;
  return (
    <Card className={styles.card} aria-labelledby="strength-heading">
      <h2 id="strength-heading" className={styles.heading}>Strength</h2>
      {!chosen || !chart ? (
        <p className={styles.caption}>No lifts to chart yet. They appear as the client logs weights and reps.</p>
      ) : (
        <>
          <SelectField label="Exercise" value={chosen.exerciseId} onChange={(e) => setId(e.target.value)}>
            {data.map((e) => (
              <option key={e.exerciseId} value={e.exerciseId}>{e.name}</option>
            ))}
          </SelectField>
          <p className={styles.streak} data-testid="strength-heaviest">
            Heaviest weight {stats.heaviest ?? '—'}
            {stats.change ? ` · ${stats.change.text}` : stats.heaviestDetail ? ` · ${stats.heaviestDetail}` : ''}
          </p>
          <p className={styles.caption} data-testid="strength-e1rm">
            {stats.e1rm ? `Est. 1-rep max ${stats.e1rm} · ${stats.e1rmDetail}` : `Est. 1-rep max: ${stats.e1rmDetail.toLowerCase()}`}
          </p>
          <ExerciseChart key={chosen.exerciseId} name={chosen.name} points={chart.points} summary={chart.summary} units={units} />
        </>
      )}
    </Card>
  );
}
