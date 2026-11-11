import type { ChangeEvent } from 'react';
import {
  distanceUnitFor,
  formatClock,
  formatLogSetTarget,
  fromMeters,
  isAddedExercise,
  kgToInput,
  liveExercises,
  needsPick,
  sectionRuns,
  substitutedFrom,
  formatResult,
  targetFieldsFor,
  toTrackingType,
  type LogSetDoc,
  type TrackingType,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { Chip } from '@/components/ui';
import styles from './log.module.css';

const hasField = (t: TrackingType, f: 'weight' | 'reps' | 'duration' | 'distance') =>
  targetFieldsFor(toTrackingType(t)).includes(f);

/** What a set's boxes hold while the coach corrects, as the text typed. Keys that don't apply to the exercise are absent. */
export type SetDraft = { reps?: string; weight?: string; time?: string; distance?: string };
export type Drafts = Record<string, SetDraft>;

/** The boxes' starting text for a set, in the coach's units. */
export function draftFor(set: LogSetDoc, trackingType: TrackingType, units: Units): SetDraft {
  const reps = set.actualReps === null ? '' : String(set.actualReps);
  const weight = set.actualWeightKg === null ? '' : String(kgToInput(set.actualWeightKg, units));
  const time = set.actualDurationS === null ? '' : formatClock(set.actualDurationS);
  const distance = set.actualDistanceM === null ? '' : String(fromMeters(set.actualDistanceM, distanceUnitFor(units)));
  const fields = targetFieldsFor(toTrackingType(trackingType));
  return {
    ...(fields.includes('weight') ? { weight } : {}),
    ...(fields.includes('reps') ? { reps } : {}),
    ...(fields.includes('duration') ? { time } : {}),
    ...(fields.includes('distance') ? { distance } : {}),
  };
}

function actualText(s: LogSetDoc, t: TrackingType, units: Units): string {
  const values = { reps: s.actualReps, weightKg: s.actualWeightKg, durationS: s.actualDurationS, distanceM: s.actualDistanceM };
  return formatResult(values, t, units) ?? '–';
}

/** Something the client typed on the phone (a workout or an exercise note), labelled so the coach knows who wrote it. */
export function ClientNote({ text, label = "Client's note" }: { text: string | null; label?: string }) {
  const body = text?.trim();
  if (!body) return null;
  return (
    <figure className={styles.clientNote} aria-label={label}>
      <figcaption className={styles.clientNoteLabel}>Client&apos;s note</figcaption>
      <blockquote className={styles.clientNoteBody}>{body}</blockquote>
    </figure>
  );
}

function ExerciseHeading({ level, children }: { level: 3 | 4; children: string }) {
  return level === 4 ? <h4 className={styles.exerciseName}>{children}</h4> : <h3 className={styles.exerciseName}>{children}</h3>;
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
          {/* Inside the "Planned vs. actual" <h2>: a section is an <h3> and its exercises <h4>; without one, <h3>. */}
          {run.section ? <h3 className={styles.runHeading}>{run.section.name}</h3> : null}
          <div className={styles.exercises}>
            {run.blockIndexes.flatMap((bi) => {
              const block = log.blocks[bi]!;
              if (needsPick(block)) {
                return [
                  <div key={block.id} className={styles.exercise}>
                    <p className={styles.pickLine}>Pick one · not done</p>
                    <p className={styles.options}>{block.exercises.map((e) => e.exerciseName).join(' · ')}</p>
                  </div>,
                ];
              }
              return liveExercises(block).map(({ exercise: ex }) => {
                // A coach-added substitute also points swappedFromExerciseId at the planned exercise; say it as a substitute.
                const substitute = substitutedFrom(ex);
                const swapped =
                  !substitute && ex.swappedFromExerciseId ? (swappedFrom[ex.swappedFromExerciseId] ?? 'another exercise') : null;
                // Only a log that followed a plan (even one deleted since) has added exercises; an unplanned one is
                // all the client's own.
                const added = isAddedExercise(log, ex);
                return (
                  <section key={ex.id} className={styles.exercise}>
                    <header className={styles.exerciseHead}>
                      <ExerciseHeading level={run.section ? 4 : 3}>{ex.exerciseName}</ExerciseHeading>
                      {block.kind === 'choice' ? <Chip>Picked: {ex.exerciseName}</Chip> : null}
                      {substitute ? (
                        <Chip>
                          Did the substitute: {ex.exerciseName} (planned {substitute.exerciseName})
                        </Chip>
                      ) : null}
                      {swapped ? <Chip>Swapped from {swapped}</Chip> : null}
                      {added ? <Chip tone="blue">Added</Chip> : null}
                    </header>
                    <ClientNote text={ex.note} label={`Client's note on ${ex.exerciseName}`} />
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
                                    {hasField(ex.trackingType, 'weight') ? field('weight', `weight (${units})`, 'decimal') : null}
                                    {hasField(ex.trackingType, 'reps') ? field('reps', 'reps', 'numeric') : null}
                                    {hasField(ex.trackingType, 'duration') ? field('time', 'time (m:ss)', 'text') : null}
                                    {hasField(ex.trackingType, 'distance') ? field('distance', `distance (${distUnit})`, 'decimal') : null}
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
