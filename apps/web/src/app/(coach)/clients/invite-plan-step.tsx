'use client';

import { useState } from 'react';
import {
  INVITE_PLAN_MAX_WORKOUTS,
  IsoDateSchema,
  addDays,
  isoWeekday,
  type ErrorCode,
  type InvitePlan,
  type IsoDate,
} from '@caltracker/shared';
import { formatShortDay } from '@/components/calendar/format';
import { WorkoutChoices } from '@/components/assign/workout-choices';
import { Button, ButtonLink, SelectField, TextField } from '@/components/ui';
import type { PickerHints } from '@/lib/picker-hints';
import styles from './clients.module.css';

export type LibraryWorkout = { id: string; name: string };
export type Program = { id: string; name: string; weeks: number };
type PlanKind = InvitePlan['kind'];
type Item = { key: string; workoutId: string | null; on: IsoDate };

const PLAN_LABEL: Record<PlanKind, string> = { program: 'Program', workouts: 'Single workout', none: 'Nothing yet' };

/** The Monday after `today` (a week on, when today is a Monday): when most programs start. */
export const nextMonday = (today: IsoDate) => addDays(today, 8 - isoWeekday(today));

export type PlanState = ReturnType<typeof useInvitePlan>;

/**
 * "Give them something to start with": Program, Single workout or Nothing yet, with its program and start day or its
 * workouts and days. Shared by the invite window and a pending invite's "Change plan". `initial` is the plan kept with
 * an invite (a day that has gone by starts from today: that's where it would land anyway).
 */
export function useInvitePlan({
  today,
  programs,
  hints,
  initial = { kind: 'none' },
}: {
  today: IsoDate;
  programs: Program[];
  hints: PickerHints;
  initial?: InvitePlan;
}) {
  const notPast = (d: IsoDate) => (d < today ? today : d);
  const [kind, setKind] = useState<PlanKind>(initial.kind);
  const [programId, setProgramId] = useState(() =>
    initial.kind === 'program' ? initial.programId : (programs.find((p) => p.id === hints.lastProgramId)?.id ?? programs[0]?.id ?? ''),
  );
  const [startOn, setStartOn] = useState<string>(() => (initial.kind === 'program' ? notPast(initial.startOn) : nextMonday(today)));
  const [items, setItems] = useState<Item[]>(() =>
    initial.kind === 'workouts'
      ? initial.items.map((i, n) => ({ key: `w${n}`, workoutId: i.workoutId, on: notPast(i.on) }))
      : [{ key: 'w0', workoutId: null, on: nextMonday(today) }],
  );
  const program = programs.find((p) => p.id === programId) ?? null;
  const chosen = items.filter((i): i is Item & { workoutId: string } => i.workoutId !== null);

  function build(): InvitePlan | ErrorCode {
    if (kind === 'program') {
      if (!program) return 'invite_plan_no_program';
      if (!IsoDateSchema.safeParse(startOn).success) return 'invite_plan_no_start';
      return { kind: 'program', programId: program.id, startOn };
    }
    if (kind === 'workouts') {
      if (chosen.length === 0) return 'invite_plan_no_workout';
      if (chosen.some((i) => !IsoDateSchema.safeParse(i.on).success)) return 'invite_plan_no_day';
      return { kind: 'workouts', items: chosen.map((i) => ({ workoutId: i.workoutId, on: i.on })) };
    }
    return { kind: 'none' };
  }

  return { kind, setKind, programId, setProgramId, startOn, setStartOn, items, setItems, program, chosen, build };
}

export function InvitePlanStep({
  plan,
  today,
  library,
  programs,
  hints,
  heading = 'Optional · give them something to start with',
  onChange,
}: {
  plan: PlanState;
  today: IsoDate;
  library: LibraryWorkout[];
  programs: Program[];
  hints: PickerHints;
  heading?: string;
  /** Anything picked (clears the form's error). */
  onChange?: () => void;
}) {
  const { kind, setKind, programId, setProgramId, startOn, setStartOn, items, setItems, chosen } = plan;
  const nameOf = (id: string | null) => library.find((w) => w.id === id)?.name ?? '';
  const last = items[items.length - 1]!;
  const firstChosen = chosen[0];
  return (
    <section className={styles.startBox} aria-labelledby="start-heading">
      <div className={styles.startHeader}>
        <h3 id="start-heading" className={styles.startHeading}>{heading}</h3>
        <div role="group" aria-labelledby="start-heading" className={styles.planToggle}>
          {(['program', 'workouts', 'none'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              className={styles.planOption}
              onClick={() => {
                setKind(k);
                onChange?.();
              }}
            >
              {PLAN_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {kind === 'program' ? (
        programs.length === 0 ? (
          <div className={styles.startEmpty}>
            <p className={styles.startNote}>You have no programs yet.</p>
            <ButtonLink href="/programs/new" variant="secondary" className={styles.rowButton}>Build a program</ButtonLink>
          </div>
        ) : (
          <>
            <div className={styles.programGrid}>
              <SelectField label="Program" value={programId} onChange={(e) => setProgramId(e.target.value)}>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectField>
              <TextField label="Start date" type="date" min={today} value={startOn} onChange={(e) => setStartOn(e.target.value)} />
            </div>
            <p className={styles.startNote}>
              Their first workouts will be waiting when they join. If they join after the start date, the program starts the day they join.
            </p>
          </>
        )
      ) : null}

      {kind === 'workouts' ? (
        <>
          {chosen.length > 0 ? (
            <ul className={styles.chosenList} aria-label="Chosen workouts">
              {items.map((item, index) =>
                item.workoutId ? (
                  <li key={item.key} className={styles.chosenItem}>
                    <span className={styles.chosenName}>{nameOf(item.workoutId)}</span>
                    <TextField
                      label="Day"
                      aria-label={`Day for ${nameOf(item.workoutId)}`}
                      type="date"
                      min={today}
                      value={item.on}
                      className={styles.chosenDay}
                      onChange={(e) => setItems((list) => list.map((x, i) => (i === index ? { ...x, on: e.target.value } : x)))}
                    />
                    <Button
                      variant="quiet"
                      size="compact"
                      className={styles.chosenRemove}
                      aria-label={`Remove ${nameOf(item.workoutId)}`}
                      onClick={() =>
                        setItems((list) => {
                          const next = list.filter((_, i) => i !== index);
                          return next.length > 0 ? next : [{ key: `w${Date.now()}`, workoutId: null, on: item.on }];
                        })
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ) : null,
              )}
            </ul>
          ) : null}
          {last.workoutId === null ? (
            <div className={styles.startPicker}>
              <WorkoutChoices
                library={library}
                hints={hints}
                chosenIds={new Set(chosen.map((i) => i.workoutId))}
                onPick={(w) => {
                  onChange?.();
                  setItems((list) => list.map((x, i) => (i === list.length - 1 ? { ...x, workoutId: w.id } : x)));
                }}
              />
            </div>
          ) : items.length < INVITE_PLAN_MAX_WORKOUTS ? (
            <button
              type="button"
              className={styles.addAnother}
              onClick={() => setItems((list) => [...list, { key: `w${Date.now()}`, workoutId: null, on: addDays(last.on, 1) }])}
            >
              + Add another workout
            </button>
          ) : null}
          {firstChosen ? (
            <p className={styles.startNote}>
              {nameOf(firstChosen.workoutId)} will be on their calendar for {formatShortDay(firstChosen.on)} when they join
              {chosen.length > 1 ? `, with ${chosen.length - 1} more` : ''}.
            </p>
          ) : (
            <p className={styles.startNote}>Pick a workout (Recent and Most used come first), then its day.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
