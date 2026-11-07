import { formatWeight, progressionHint, type Suggestion, type Units, type WorkoutDoc } from '@caltracker/shared';
import { Card } from '@/components/ui';
import styles from './progression-card.module.css';

/**
 * Auto progression's suggested weights for one client's workout (shared suggestionsForWorkout), shown above the plan
 * so the coach can see what the phone will pre-fill. Typing a weight on an exercise in the plan overrides it.
 */
export function ProgressionCard({
  doc,
  suggestions,
  units,
}: {
  doc: Pick<WorkoutDoc, 'blocks'>;
  suggestions: Record<string, Suggestion>;
  units: Units;
}) {
  const rows = doc.blocks
    .flatMap((b) => b.exercises)
    .flatMap((e) => (suggestions[e.id] ? [{ id: e.id, name: e.exerciseName, s: suggestions[e.id]! }] : []));
  if (rows.length === 0) return null;
  return (
    <Card className={styles.card}>
      <h2 className={styles.heading}>Auto progression</h2>
      <ul className={styles.list} data-testid="progression-suggestions">
        {rows.map(({ id, name, s }) => (
          <li key={id}>
            {name}: {formatWeight(s.weightKg, units)} <span className={styles.hint}>{progressionHint(s, units)}</span>{' '}
            <span className={styles.caption}>(last time {formatWeight(s.fromWeightKg, units)})</span>
          </li>
        ))}
      </ul>
      <p className={styles.caption}>
        The client&apos;s phone suggests these weights. Type a weight on the exercise below to use yours instead.
      </p>
    </Card>
  );
}
