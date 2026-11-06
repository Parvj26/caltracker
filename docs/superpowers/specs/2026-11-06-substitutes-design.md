# Coach-added substitute exercises

Approved by the product owner on 2026-11-06. Mock-ups: simple-logging (Main "⇄ or: Machine Assisted Pull Up",
SubSheet / SS3Sub picking, Summary "Changes from the plan: ⇄ Did X instead of Y").

When building a workout the coach can give any exercise up to **3 substitutes** ("alternatives"), e.g. Lat
Pulldown → Machine Assisted Pull Up, for when the machine is taken. Each substitute is its own library exercise
with its own set targets (a copy of the exercise's sets when added, editable). The client sees the planned
exercise with "or: …" and picks which one they are doing; the coach sees which one they did.

Scope: straight blocks and supersets. **Not inside pick-one groups** (their options already are alternatives;
the schema, the ops and the builder all refuse it).

## Plan doc (`packages/shared/src/workouts/schema.ts`)

```ts
WorkoutExerciseDoc.substitutes: WorkoutSubstituteDoc[]   // default [], max 3 (MAX_SUBSTITUTES)
WorkoutSubstituteDoc = { id, exerciseId, exerciseName, trackingType, note: string | null, sets: WorkoutSetDoc[] }
```

Rules: a substitute is a different exercise from the planned one and from the other substitutes; its sets follow
the same rules as any exercise's sets (targets fit its tracking type, no leading drop, drops have no rest).

Builder ops (`workouts/doc-ops.ts`, all return the same doc when they refuse):
`addSubstitute(doc, blockId, workoutExerciseId, pick, makeId)`, `removeSubstitute(…, substituteId)`,
`updateSubstitute(…, substituteId, { note })`, `addSubstituteSet`, `addSubstituteDrop`, `removeSubstituteSet`,
`updateSubstituteSet`, and `substituteSetShowsRest(block, exerciseIndex, substitute, setIndex)` for the rest box.

## Log doc (`packages/shared/src/logs/schema.ts`)

```ts
LogExerciseDoc.substituteId: string | null               // default null = the planned exercise
LogExerciseDoc.substituteOptions: LogSubstituteOption[]  // default []; the planned exercise first, then substitutes
LogSubstituteOption = { substituteId: string | null, exerciseId, exerciseName, trackingType,
                        sets: Array<{ setType, target: LogSetTarget }> }  // planned-set snapshot
```

**The exercise's own fields (exerciseId, exerciseName, trackingType, sets) are always the option being done.**
`substituteId` says which option they are. Options not being done are a snapshot of their planned sets only, so
they can never have logged sets. Because of that, volume, set counts, PRs, strength, summaries, "last time",
awards and `recent_exercises_for_client` count the exercise actually done with no special code (`liveExercise`
is the identity, kept as a named helper).

Ops and helpers (`logs/substitutes.ts`, exported from `@caltracker/shared`):

| Function | What it does |
|---|---|
| `chooseSubstitute(log, logExerciseId, substituteId \| null, makeId, nowIso)` | Switches to that option: its exercise, tracking type and planned sets (new set ids, nothing typed). While a substitute is chosen `swappedFromExerciseId` = the planned exercise, so "Did X instead of Y" works like a swap. Refused (same object) once any set of the exercise is done, for an unknown option, or the option already chosen. Bumps revision and lastActivityAt. |
| `clearSubstitute(log, logExerciseId, makeId, nowIso)` | `chooseSubstitute(…, null, …)`: back to the planned exercise. |
| `isSubstituteLocked(ex)` | True once a set is done (hide or disable the switch). |
| `substituteChoices(ex)` | `{ substituteId, exerciseId, exerciseName, planned, chosen }[]` for a picker; empty = no substitutes. |
| `otherSubstituteOptions(ex)` | The options not being done ("or: Machine Assisted Pull Up"). |
| `substitutedFrom(ex)` | `{ exerciseId, exerciseName }` of the planned exercise when a substitute is chosen, else null. |

`startLogFromWorkout` fills `substituteOptions` from the plan. `swapLogExercise` (the client's own free swap)
clears `substituteId` and `substituteOptions`: the slot is then off-plan.

### How the phone should use it

1. Render the exercise as usual from its own fields. If `otherSubstituteOptions(ex)` is not empty and
   `!isSubstituteLocked(ex)`, show "⇄ or: <names>" and open a sheet listing `substituteChoices(ex)`.
2. On pick, run `chooseSubstitute` through the log store's queued edit (like `pickChoice`). After the first done
   set, show the choice read-only (`substitutedFrom(ex)` → "Doing X instead of Y").
3. Summary "Changes from the plan": an exercise with `substitutedFrom(ex)` reads "⇄ Did X instead of Y".

## Database (migration `20261106001200_substitutes.sql`)

- Plans: new table `workout_substitutes` (one row per substitute: `workout_exercise_id`, `position`,
  `exercise_id`, `note`, `sets jsonb` = the `WorkoutSetDoc[]`), owner columns inherited like the other workout
  tables, same RLS (coach of the workspace writes; the client reads their own scheduled copy). `save_workout`
  writes them, `copy_workout` copies them, `WORKOUT_TREE_SELECT` reads them.
- Logs: `log_exercises.substitute_id` and `log_exercises.substitute_options jsonb`. `save_workout_log` stores
  them and refuses a `substituteId` that is not one of the options. The exercise row and its sets are the option
  actually done, so `award_inputs` and `recent_exercises_for_client` already use it.
