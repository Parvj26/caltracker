import type { ChangeEvent } from 'react';
import {
  distanceUnitFor,
  formatClock,
  formatDistance,
  formatDuration,
  formatLogSetTarget,
  formatWeight,
  fromMeters,
  isAddedExercise,
  kgToInput,
  liveExercises,
  needsPick,
  sectionRuns,
  type LogSetDoc,
  type TrackingType,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { Chip } from '@/components/ui';
import styles from './log.module.css';

/** What a set's boxes hold while the coach corrects, as the text typed. Keys that don't apply to the exercise are absent. */
export type SetDraft = { reps?: string; weight?: string; time?: string; distance?: string };
export type Drafts = Record<string, SetDraft>;

/** The boxes' starting text for a set, in the coach's units. */
export function draftFor(set: LogSetDoc, trackingType: TrackingType, units: Units): SetDraft {
  const reps = set.actualReps === null ? '' : String(set.actualReps);
  const weight = set.actualWeightKg === null ? '' : String(kgToInput(set.actualWeightKg, units));
  const time = set.actualDurationS === null ? '' : formatClock(set.actualDurationS);
  const distance = set.actualDistanceM === null ? '' : String(fromMeters(set.actualDistanceM, distanceUnitFor(units)));
  switch (trackingType) {
    case 'weight_reps': return { weight, reps };
    case 'reps': return { reps };
    case 'time': return { time };
    case 'distance': return { distance };
  }
}

const reps = (n: number) => `${n} ${n === 1 ? 'rep' : 'reps'}`;

function actualText(s: LogSetDoc, t: TrackingType, units: Units): string {
  switch (t) {
    case 'weight_reps':
      if (s.actualReps !== null && s.actualWeightKg !== null) return `${formatWeight(s.actualWeightKg, units)} × ${s.actualReps}`;
      if (s.actualReps !== null) return reps(s.actualReps);
      return s.actualWeightKg !== null ? formatWeight(s.actualWeightKg, units) : '–';
    case 'reps': return s.actualReps !== null ? reps(s.actualReps) : '–';
    case 'time': return s.actualDurationS !== null ? formatDuration(s.actualDurationS) : '–';
    case 'distance': return s.actualDistanceM !== null ? formatDistance(s.actualDistanceM, units) : '–';
  }
}

type Edit = { drafts: Drafts; onChange: (setId: string, patch: SetDraft) => void };

/**
 * One table per exercise: Set, Planned (the log's own snapshot of the target, so later edits to the plan never
 * change it), Actual. Sets that were not ticked are muted and say "Not done". With `edit`, the Actual cells are boxes.
 */
export function PlannedVsActual({
  log,
  units,
  swappedFrom,
  edit,
}: {
  log: WorkoutLogDoc;
  units: Units;
  /** Names of the exercises that were swapped out, by exercise id. */
  swappedFrom: Readonly<Record<string, string>>;
  edit?: Edit | undefined;
}) {
  const distUnit = distanceUnitFor(units);
  return (
    <div className={styles.runs}>
      {sectionRuns(log.blocks, log.sections).map((run) => (
        <div key={run.blockIndexes[0]} className={styles.run}>
          {run.section ? <h2 className={styles.runHeading}>{run.section.name}</h2> : null}
          <div className={styles.exercises}>
            {run.blockIndexes.flatMap((bi) => {
              const block = log.blocks[bi]!;
              if (needsPick(block)) {
                return [
                  <section key={block.id} className={styles.exercise}>
                    <p className={styles.pickLine}>Pick one · not done</p>
                    <p className={styles.options}>{block.exercises.map((e) => e.exerciseName).join(' · ')}</p>
                  </section>,
                ];
              }
              return liveExercises(block).map(({ exercise: ex }) => {
                const swapped = ex.swappedFromExerciseId ? (swappedFrom[ex.swappedFromExerciseId] ?? 'another exercise') : null;
                // Only a log that followed a plan (even one deleted since) has added exercises; an unplanned one is
                // all the client's own.
                const added = isAddedExercise(log, ex);
                return (
                  <section key={ex.id} className={styles.exercise}>
                    <header className={styles.exerciseHead}>
                      <h3 className={styles.exerciseName}>{ex.exerciseName}</h3>
                      {block.kind === 'choice' ? <Chip>Picked: {ex.exerciseName}</Chip> : null}
                      {swapped ? <Chip>Swapped from {swapped}</Chip> : null}
                      {added ? <Chip tone="blue">Added</Chip> : null}
                    </header>
                    <table className={styles.table} aria-label={ex.exerciseName}>
                      <thead>
                        <tr>
                          <th scope="col">Set</th>
                          <th scope="col">Planned</th>
                          <th scope="col">Actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ex.sets.map((set, i) => {
                          const done = set.completedAt !== null;
                          const draft = edit?.drafts[set.id];
                          const field = (key: keyof SetDraft, label: string, mode: 'numeric' | 'decimal' | 'text') => (
                            <input
                              className={styles.cellInput}
                              aria-label={`Set ${i + 1} ${label}`}
                              inputMode={mode}
                              value={draft?.[key] ?? ''}
                              onChange={(e: ChangeEvent<HTMLInputElement>) => edit?.onChange(set.id, { [key]: e.target.value })}
                            />
                          );
                          return (
                            <tr key={set.id} className={done ? undefined : styles.notDone}>
                              <th scope="row">
                                {i + 1}
                                {set.setType === 'warmup' ? ' · warm-up' : set.setType === 'drop' ? ' · drop' : ''}
                              </th>
                              <td>{formatLogSetTarget(set.target, ex.trackingType, units)}</td>
                              <td>
                                {edit && draft ? (
                                  <span className={styles.inputs}>
                                    {ex.trackingType === 'weight_reps' ? field('weight', `weight (${units})`, 'decimal') : null}
                                    {ex.trackingType === 'weight_reps' || ex.trackingType === 'reps' ? field('reps', 'reps', 'numeric') : null}
                                    {ex.trackingType === 'time' ? field('time', 'time (m:ss)', 'text') : null}
                                    {ex.trackingType === 'distance' ? field('distance', `distance (${distUnit})`, 'decimal') : null}
                                  </span>
                                ) : done ? (
                                  actualText(set, ex.trackingType, units)
                                ) : (
                                  'Not done'
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                );
              });
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
