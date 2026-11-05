# Phase 3a: Workout Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients start, log and finish their workouts on the phone, with nothing lost to bad signal or a closed app. Coaches see every finished workout as planned vs. actual, comment on it and correct typos.

**Architecture:**
- **A log is a separate tree from the planned workout:** `workout_logs` → `log_blocks` → `log_exercises` → `log_sets`, holding a target snapshot plus actuals, so the plan is never mutated.
- **The phone owns the active log** as a JSON doc in AsyncStorage. It uploads the whole doc through one security-definer function, `save_workout_log`, which is idempotent by id and ignores stale revisions.
- **Coaches read logs** under RLS, correct them through `correct_workout_log`, and comment through a plain RLS table.
- **All log maths** (ops, volume, duration, auto-finish) are pure functions in `packages/shared`.

**Tech Stack:**
- Existing stack: Supabase with pgTAP and `pg_cron`; Next.js 16; Expo SDK 58 with Expo Router; zod 4; Vitest; Playwright; Maestro.
- New Expo modules, pinned exactly: `expo-notifications` (local only) and `expo-haptics`.

**Spec:** `docs/superpowers/specs/2026-11-05-phase-3a-logging-design.md`. Parent spec: `docs/superpowers/specs/2026-11-03-coaching-app-design.md`, Section 5.

## Global Constraints

**TypeScript and logic placement**
- TypeScript `strict`; no `any` without a comment.
- Run typecheck, lint and all tests before calling a task done, and show the output.
- Volume, duration and auto-finish logic live **only** in `packages/shared`, as pure tested functions. The apps never re-implement them.

**Migrations and generated types**
- Migrations: `20261105000700_workout_logs.sql`, `20261105000800_log_functions.sql`, `20261105000900_log_auto_finish.sql`.
- After every migration, run `pnpm db:reset`, re-import exercises (see Task 4), then `pnpm db:types`. CI diffs `packages/shared/src/database.types.ts`.

**Tables, RLS and functions**
- **Every new table:**
  - RLS enabled.
  - `revoke all … from anon, authenticated, service_role`, then least-privilege grants: authenticated gets `select` only, except comments `insert`/`delete`; `service_role` gets S/I/U/D.
  - Added to `supabase/tests/service_role_grants.test.sql`.
  - pgTAP proving anon gets 42501, and that other workspaces, other clients and removed clients get nothing.
- **Client read access** requires a current membership: `client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)`. Coaches use `public.is_coach_of(workspace_id)`.
- **Security-definer functions:** `set search_path = ''`, revoke execute from public and anon, and check authorization at the top.

**Data rules**
- Owner columns (`workspace_id`, `client_id`, `log_id`) are inherited from the parent by a before-insert trigger and are never client-writable.
- UUID primary keys are generated on the client; `updated_at` is set by trigger; hard deletes only.
- Weights are stored in kg as `numeric(7,3)`; display converts with the viewer's `profiles.units`. New accounts default to lb.
- Volume = Σ (weight × reps) over **completed** sets of `weight_reps` exercises, including warm-ups and drops.

**Timing**
- Reminder: 20 min after the last ticked set.
- Auto-finish: after 3 h idle, `finished_at` = the last `completed_at`; with no completed sets the log is discarded.
- An auto-finished log can be reopened within 24 h.
- Only one `in_progress` log per client.

**Copy (exact)**
- "Not synced yet"
- "Still training? 💪 Tap to finish your {name} workout."
- "We finished {name} for you at {time}."
- "Finish with {n} sets not done? They won't count."
- "Last time: {weight} × {reps}"
- "Done ✓"
- "Resume {name}"
- "Log a workout"
- "Edited by coach"

**Design and process**
- Tokens only (`--ct-*` on web, `useTheme()` on mobile).
- Tap targets ≥ 44 pt.
- At most one handwritten note per screen.
- Local Playwright runs as CI does: `CI=1 pnpm test:e2e`. Maestro runs locally with `pnpm --filter mobile e2e`; the iPhone simulator build is in place.
- Git: branch `feature/phase-3a-logging` cut from `main`. Conventional Commits ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only as a backup; no PR until the final checkpoint.

## Review Focus

1. **App killed or phone dies mid-workout.** Every ticked set must be there on reopen, and must reach the server once there's signal. Tests: Task 7 (store/restore and sync) and Task 9 (Maestro relaunch).
2. **A stale upload arrives after a newer one** (slow retry, or two quick saves). The server keeps the newer data. If the server holds a newer revision (for example after a coach correction), the phone adopts the server's doc instead of overwriting it. Tests: Task 5 (pgTAP revision) and Task 7 (sync adopts a newer server doc).
3. **Starting a second workout while one is in progress**, including tapping Start twice. The phone resumes the existing in-progress log; it never creates a duplicate or crashes on the unique index. Tests: Task 5 (pgTAP unique index) and Task 8 (the Start button resumes).
4. **The coach edits or deletes the planned workout mid-session.** The client's log is unaffected, because it holds its own snapshot. Deleting the plan sets `workout_id` null and keeps the log. Test: Task 5 (pgTAP).
5. **Time zones and "today".** "Done ✓" and calendar ✓ are matched by the planned workout's `scheduled_on`, not by `finished_at`'s UTC date. Auto-finish uses timestamps, never local dates. Test: Task 10 (Playwright, a log finished at 11 pm LA time shows on the right calendar day).

---

## File Structure

```
packages/shared/src/logs/
  schema.ts        WorkoutLogDoc, LOG_STATUSES, LogSetDoc, LogExerciseDoc, LogBlockDoc
  start.ts         startLogFromWorkout, emptyLog, prefillActuals
  ops.ts           completeSet, uncompleteSet, updateActual, addLogSet, addLogDrop, removeLogSet,
                   swapLogExercise, addLogExercise, removeLogExercise, setExerciseNote
  summary.ts       logVolumeKg, completedSetCount, logDurationS, shouldAutoFinish, autoFinishTime, canReopen,
                   AUTO_FINISH_IDLE_MS, REMINDER_DELAY_MS, REOPEN_WINDOW_MS
packages/shared/test/logs/{schema,start,ops,summary}.test.ts

supabase/migrations/20261105000700_workout_logs.sql     tables, triggers, RLS, comments table
supabase/migrations/20261105000800_log_functions.sql    save_workout_log, correct_workout_log, last_results
supabase/migrations/20261105000900_log_auto_finish.sql  auto_finish_stale_logs + pg_cron schedule
supabase/tests/{workout_logs_rls,log_functions,log_auto_finish}.test.sql

apps/mobile/src/lib/log-store.ts (+test)    persist/restore the active log in AsyncStorage
apps/mobile/src/lib/log-sync.ts  (+test)    upload queue: debounce, retry/backoff, adopt newer server doc
apps/mobile/src/lib/log-api.ts              save/load logs, last_results, comments, today cache
apps/mobile/src/lib/log-notifications.ts    rest-end + 20-min reminder (expo-notifications), haptics
apps/mobile/src/lib/use-active-log.tsx      React context: active log, ops, sync status
apps/mobile/src/app/(app)/log/[id].tsx      logging screen
apps/mobile/src/app/(app)/log/[id]/summary.tsx   finish summary + coach comments (read-only)
apps/mobile/src/components/log/{set-row,rest-sheet,exercise-header,sync-pill}.tsx
apps/mobile/.maestro/{log-workout,log-resume,log-unplanned}.yaml

apps/web/src/app/(coach)/activity/{page.tsx,activity.module.css}
apps/web/src/app/(coach)/clients/[clientId]/logs/[logId]/{page.tsx,planned-vs-actual.tsx,comments.tsx,correct-form.tsx,actions.ts,log.module.css}
apps/web/src/lib/logs.ts                    loadLog, LOG_TREE_SELECT mapping (web side)
apps/web/e2e/logs.spec.ts
```

---

### Task 1: Shared log document and starting a log

**Files:**
- Create: `packages/shared/src/logs/schema.ts`, `packages/shared/src/logs/start.ts`, `packages/shared/test/logs/schema.test.ts`, `packages/shared/test/logs/start.test.ts`
- Modify: `packages/shared/src/index.ts` (export everything in `logs/`)

**Interfaces:**
- **Consumes:** `WorkoutDoc`, `WorkoutSetDoc`, `TRACKING_TYPES`, `SET_TYPES`, `BLOCK_KINDS`, and the `WorkoutDoc` structural rules (`packages/shared/src/workouts/schema.ts`).
- **Produces:**
  - `LOG_STATUSES = ['in_progress','completed','discarded'] as const`, `type LogStatus`.
  - `LogSetDoc`, `LogExerciseDoc`, `LogBlockDoc` and `WorkoutLogDoc`, all zod. Field reference:

    | Doc | Fields |
    |---|---|
    | `LogSetDoc` | `{ id: uuid, setType, target: { repsMin, repsMax, weightKg, durationS, distanceM, toFailure, restSeconds }`, where every target value is the matching `WorkoutSetDoc` field or `null`; `actualReps: int 0..1000 \| null`, `actualWeightKg: number 0..1000 \| null`, `actualDurationS: int 0..86400 \| null`, `actualDistanceM: number 0..1_000_000 \| null`, `completedAt: ISO datetime string \| null }` |
    | `LogExerciseDoc` | `{ id, exerciseId, exerciseName, trackingType, plannedWorkoutExerciseId: uuid \| null, swappedFromExerciseId: uuid \| null, note: ≤500 \| null, sets: LogSetDoc[] 1..30 }` |
    | `LogBlockDoc` | `{ id, kind, exercises: LogExerciseDoc[] 1..10 }` |
    | `WorkoutLogDoc` | `{ id, workoutId: uuid \| null, name: trim 1..100, status, startedAt, finishedAt: \| null, lastActivityAt, autoFinished: boolean, revision: int ≥ 0, notes: ≤2000 \| null, blocks: LogBlockDoc[] 0..30 }` |

  - `WorkoutLogDoc` has a `superRefine`:
    - A leading drop gets `'A drop set must follow a normal or warm-up set.'`
    - A superset with fewer than 2 exercises gets `'A superset needs at least two exercises.'`
    - A `completed` log with 0 completed sets gets `'Complete at least one set to finish.'`
    - Every message path points at the field.
    - Superset round equality is **not** enforced: clients may add a set to one exercise mid-workout.
  - `prefillActuals(target): { actualReps, actualWeightKg, actualDurationS, actualDistanceM }`: reps take `repsMax ?? repsMin`; weight, time and distance are copied from the target.
  - `startLogFromWorkout(workout: WorkoutDoc, makeId: () => string, nowIso: string): WorkoutLogDoc`:
    - status `in_progress`, revision 0, `autoFinished: false`.
    - New ids at every level.
    - `plannedWorkoutExerciseId` = the source exercise id.
    - Targets are snapshotted, actuals prefilled, `completedAt` null.
    - `startedAt` = `lastActivityAt` = `nowIso`.
  - `emptyLog(name: string, makeId, nowIso): WorkoutLogDoc`: no blocks, `workoutId: null`.

- [ ] **Step 1: Write failing tests**
  - `startLogFromWorkout` on the Task-8 fixture doc (a straight block with W + 3 normal 8–10 @ 60 kg + 1 drop to failure, plus a 2×3 superset):
    - It yields 2 blocks and 3 exercises.
    - All ids are new and none equal the source ids.
    - `plannedWorkoutExerciseId` equals the source ids.
    - Set 2's `target.repsMax === 10` and `actualReps === 10`, `actualWeightKg === 60`.
    - The drop's `target.toFailure === true` and `actualReps === null`.
    - Every `completedAt === null`.
    - The output passes `WorkoutLogDoc.parse`.
  - `emptyLog('Morning run', …)` parses, with 0 blocks.
  - **Schema:**
    - A completed log with no completed set fails with the exact message at path `['status']`.
    - `actualReps: 1001` fails.
    - A superset with 2 exercises having 3 and 4 sets **parses**.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `schema.ts` and `start.ts`, and export them from `index.ts`.
- [ ] **Step 4: Run.** Expected: PASS in both time zones.
- [ ] **Step 5: Commit** `feat(shared): add the workout log document and starting a log from a plan`

---

### Task 2: Shared log operations

**Files:**
- Create: `packages/shared/src/logs/ops.ts`, `packages/shared/test/logs/ops.test.ts`

**Interfaces:**
- **Consumes:** Task 1 types, `ExercisePick` (`packages/shared/src/workouts/doc-ops.ts`), and `TARGET_FIELDS`.
- **Produces.** All operations are pure and immutable. Each sets `lastActivityAt = nowIso` and increments `revision` by 1, except `updateActual`, which bumps `revision` only. An unknown id returns the doc unchanged.
  - `completeSet(log, setId, nowIso)`: sets `completedAt = nowIso`.
  - `uncompleteSet(log, setId, nowIso)`
  - `updateActual(log, setId, patch: Partial<{ actualReps, actualWeightKg, actualDurationS, actualDistanceM }>)`
  - `addLogSet(log, logExerciseId, makeId, nowIso)`: appends a `normal` set that copies the last non-drop set's target and actuals, not completed.
  - `addLogDrop(log, logExerciseId, parentSetId, makeId, nowIso)`: inserts after the parent's existing drops, with rest 0, an empty target and null actuals.
  - `removeLogSet(log, logExerciseId, setId, nowIso)`: removing a parent also removes its drops. Removing the last non-drop set is a no-op.
  - `swapLogExercise(log, logExerciseId, ex: ExercisePick, nowIso)`:
    - sets `swappedFromExerciseId` to the old `exerciseId` (kept if already set);
    - replaces `exerciseId`, `exerciseName` and `trackingType`;
    - nulls targets and actuals not in `TARGET_FIELDS[ex.trackingType]`;
    - keeps `completedAt`.
  - `addLogExercise(log, ex: ExercisePick, makeId, nowIso)`: a new straight block with 3 normal sets, empty targets, null actuals and `plannedWorkoutExerciseId: null`.
  - `removeLogExercise(log, logExerciseId, nowIso)`: if a superset drops to one exercise, its block becomes `straight`. An empty block is removed.
  - `setExerciseNote(log, logExerciseId, note: string | null, nowIso)`

- [ ] **Step 1: Write failing tests**, one per op, with a counter `makeId`.
  - `completeSet` then `uncompleteSet` returns `completedAt` to null, and revision rises by 2.
  - `addLogDrop` twice after set 2 gives the order `[n1, n2, d, d, n3]`.
  - `removeLogSet(n2)` gives `[n1, n3]`.
  - `swapLogExercise` from `weight_reps` to `time` nulls weight and reps targets and actuals. `swappedFromExerciseId` equals the old id, and swapping again keeps the original.
  - `removeLogExercise` on a 2-exercise superset gives a straight block.
  - **Shared checks across all ops:**
    - Every op's output passes `WorkoutLogDoc.parse` when its input did.
    - Inputs are never mutated (deep-freeze a fixture).
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): add pure workout log operations`

---

### Task 3: Shared log summary and timing

**Files:**
- Create: `packages/shared/src/logs/summary.ts`, `packages/shared/test/logs/summary.test.ts`

**Interfaces:**
- **Produces:**
  - `AUTO_FINISH_IDLE_MS = 3 * 60 * 60 * 1000`
  - `REMINDER_DELAY_MS = 20 * 60 * 1000`
  - `REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000`
  - `logVolumeKg(log): number`: rounded to 1 decimal.
  - `completedSetCount(log): number`
  - `logDurationS(log): number`: `finishedAt − startedAt` in whole seconds, or `lastActivityAt − startedAt` while in progress.
  - `shouldAutoFinish(log, nowMs): boolean`: true when `in_progress` and `nowMs − lastActivityAt ≥ AUTO_FINISH_IDLE_MS`.
  - `autoFinishTime(log): string`: the latest `completedAt`, or `startedAt` when none.
  - `autoFinish(log): WorkoutLogDoc`:
    - At least one completed set gives `completed`, `autoFinished: true` and `finishedAt = autoFinishTime`.
    - None gives `discarded`.
    - Either way, revision +1.
  - `canReopen(log, nowMs): boolean`: true when `completed`, `autoFinished`, and `nowMs − finishedAt < REOPEN_WINDOW_MS`.

- [ ] **Step 1: Write failing tests**
  - **Volume:** 3 completed sets of 10 × 60 kg, plus an uncompleted set of 10 × 60 kg, plus a completed `reps` set of 15, gives `logVolumeKg === 1800`. A completed drop of 8 × 40 adds 320.
  - **Auto-finish:**
    - `shouldAutoFinish` is false at 2 h 59 m and true at 3 h.
    - `autoFinish` on a log with sets completed at 10:05 and 10:40 gives `finishedAt '…10:40…'` and `completed`.
    - `autoFinish` on a log with none gives `discarded`.
  - **Reopen:** `canReopen` is true at 23 h 59 m and false at 24 h. It is false when `autoFinished` is false.
  - **Duration:** `logDurationS` on start 10:00 and finish 10:45 gives 2700.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): add log volume, duration and auto-finish rules`

---

### Task 4: Database: log tables, RLS and comments

**Files:**
- Create: `supabase/migrations/20261105000700_workout_logs.sql`, `supabase/tests/workout_logs_rls.test.sql`
- Modify: `supabase/tests/00_helpers.sql` (adds `tests.create_log(ws uuid, client uuid, workout uuid default null, status text default 'completed') returns uuid`, which makes 1 straight block, 1 exercise (a built-in), and 2 sets: one completed at 8 × 60, one not), `supabase/tests/service_role_grants.test.sql`, `packages/shared/src/database.types.ts`

**Interfaces:**
- **Produces (SQL):**
  - **Enum** `public.log_status ('in_progress','completed','discarded')`.
  - **Tables:** `workout_logs`, `log_blocks`, `log_exercises`, `log_sets` and `workout_log_comments`, with the columns and checks in the spec's data model table.
    - `workout_logs.workout_id` → `workouts on delete set null`.
    - `log_exercises.exercise_id` → `exercises on delete restrict`.
    - `swapped_from_exercise_id` → `exercises on delete set null`.
  - **Constraints and indexes:**
    - Partial unique index `one_active_log_per_client on workout_logs (client_id) where status = 'in_progress'`.
    - Indexes `(workspace_id, finished_at desc) where status = 'completed'`, `(client_id, finished_at desc)` and `(workout_id)`.
    - `unique (parent, position) deferrable initially deferred` on the child tables.
  - **Triggers:**
    - `public.inherit_log_owner()` (definer, before insert) on `log_blocks`, `log_exercises`, `log_sets` and `workout_log_comments`. It copies `log_id`, `workspace_id` and `client_id` from the parent.
    - `touch_updated_at` on every log table.
    - If the existing workspace-delete trigger is needed (restrict FK on `exercises`), extend `workspaces_delete_workouts` to also delete the workspace's logs first. The Task 10 migration has the pattern.
  - **Grants:**
    - Every log table: `select` to `authenticated`.
    - `workout_log_comments`: `insert (id, log_id, body)` and `delete`.
    - `service_role` gets S/I/U/D everywhere.
  - **Policies:**
    - Select on all five tables: `is_coach_of(workspace_id) or (client_id = (select auth.uid()) and is_client_in(workspace_id, client_id))`.
    - Comments insert: `is_coach_of(workspace_id) and author_id = (select auth.uid())`. The insert sets `author_id default auth.uid()` and grants no column privilege on `author_id`.
    - Comments delete: `is_coach_of(workspace_id) and author_id = (select auth.uid())`.

- [ ] **Step 1: Write failing pgTAP** (`workout_logs_rls.test.sql`). Fixtures: coach A, clients A1 and A2, coach B, client B1. One completed log each for A1 and B1.
  - **Privileges:**
    - anon has none on all five tables.
    - `authenticated` has no insert/update/delete on the four log tables.
    - Comments have no update, and no insert on `author_id`/`workspace_id`/`client_id`.
  - **Reads:**
    - anon `select` throws 42501.
    - Coach A reads A1's log and its children, and 0 of B1's.
    - A1 reads their own log, and 0 of A2's or B1's.
    - After `remove_client(ws_a, a1)` (called as coach A), A1 reads 0 and coach A still reads it.
  - **Writes:**
    - A1 inserting into `workout_logs` directly throws 42501.
    - Coach A comments on A1's log: 1 row, `author_id` = coach A.
    - Coach B commenting on A1's log throws 42501.
    - A1 commenting throws 42501.
    - Coach A deletes their own comment.
  - **Constraints:**
    - A second `in_progress` log for A1, inserted as postgres, throws 23505.
    - `actual_reps = 1001` throws 23514.
- [ ] **Step 2: Run** `pnpm db:reset && pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** `pnpm db:reset`, then re-import exercises:
  ```
  eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"; SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm import:exercises
  ```
  Then run `pnpm db:test && pnpm db:types && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): add workout log tables, comments and access rules`

---

### Task 5: Database: saving, correcting and "last time"

**Files:**
- Create: `supabase/migrations/20261105000800_log_functions.sql`, `supabase/tests/log_functions.test.sql`
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- **Consumes:** the Task 4 tables, and `WorkoutLogDoc` JSON keys from Task 1 (camelCase, as in `save_workout`).
- **Produces:**
  - **`public.save_workout_log(p_doc jsonb) returns jsonb`**, security definer, execute for `authenticated` only. It returns `{ "revision": <stored>, "status": <stored> }`.
    - **Authorization:**
      - The caller is the log's client: on insert, `client_id := auth.uid()`; an existing row must already belong to the caller.
      - The caller is a current client (`is_client_in(workspace, uid)`) of the workspace taken from the planned workout, or of their single current membership when unplanned. Otherwise 42501.
      - `workoutId`, if set, must be the caller's own instance.
    - **Stale protection:** if a row exists with `revision ≥ doc.revision`, change nothing and return the stored values.
    - **Status rules:**
      - Allowed: insert as `in_progress`; `in_progress` → `in_progress`/`completed`/`discarded`; `completed` → `in_progress` only when `auto_finished` and `now() − finished_at < 24h`.
      - Anything else raises 23514 `'This workout can no longer be changed.'`
      - A `completed` doc with 0 completed sets raises 23514 `'Complete at least one set to finish.'`
    - **Tree upsert:** upserts the tree by ids, with positions from array indexes, deleting children that are absent. The cross-parent check works as in `save_workout`: 23514 `'Row % belongs to another log.'`
    - **Row updates:** sets `last_activity_at`, `finished_at`, `auto_finished` and `revision` from the doc. `logged_by := auth.uid()` on insert.
  - **`public.correct_workout_log(p_log_id uuid, p_sets jsonb) returns integer`**, security definer.
    - `p_sets` is an array of `{ id, actualReps, actualWeightKg, actualDurationS, actualDistanceM }`.
    - The caller must be `is_coach_of` the log's workspace, otherwise 42501. The log must be `completed`, otherwise 23514 `'Only finished workouts can be corrected.'`
    - It updates only those actual columns of sets in that log, sets `corrected_at = now()`, `corrected_by = auth.uid()` and `revision = revision + 1`, and returns the new revision.
  - **`public.last_results(p_exercise_ids uuid[]) returns table (exercise_id uuid, finished_at timestamptz, set_type public.set_type, actual_reps smallint, actual_weight_kg numeric, actual_duration_s int, actual_distance_m numeric, position smallint)`**, security invoker.
    - For each exercise id, it returns the completed sets from the caller's most recent `completed` log containing that exercise, ordered by position.

- [ ] **Step 1: Write failing pgTAP:**
  - **Insert and re-save:**
    - A1 saves a new in-progress doc for their own instance: 1 log, its blocks/exercises/sets, `logged_by = A1`, returns revision 1.
    - Re-saving with revision 2 and a set completed persists it.
    - Saving revision 1 again changes nothing and returns `{revision:2}` (Review Focus 2).
  - **Status rules:**
    - Finishing with 0 completed sets gives 23514 with the exact message.
    - A second new in-progress doc for A1 gives 23505 (Review Focus 3).
    - `completed` → `in_progress` on a non-auto-finished log gives 23514. On an auto-finished log within 24 h it is allowed; after 24 h (`finished_at` set back by `interval '25 hours'` as postgres) it gives 23514.
  - **Authorization:**
    - A1 saving a doc for A2's instance gives 42501.
    - B1 saving with A's workout gives 42501.
    - A removed client saving gives 42501.
    - A doc reusing a set id from another log gives 23514 `belongs to another log`.
  - **Plan changes:**
    - Deleting the planned workout as postgres leaves the log with `workout_id` null.
    - Editing the plan's target leaves the log's `target_weight_kg` unchanged (Review Focus 4).
  - **Corrections:**
    - Coach A's `correct_workout_log` updates actuals and `corrected_by`, and the revision rises.
    - Coach B gets 42501, A1 gets 42501, and an in-progress log gives 23514.
    - After a correction, A1 saving its old revision changes nothing.
  - **`last_results`** for A1 returns the sets of the newest completed log only. For B1 it returns nothing of A's.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm db:reset`, the re-import, then `pnpm db:test && pnpm db:types`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): add saving, correcting and last-result functions for logs`

---

### Task 6: Database: hourly auto-finish

**Files:**
- Create: `supabase/migrations/20261105000900_log_auto_finish.sql`, `supabase/tests/log_auto_finish.test.sql`

**Interfaces:**
- **Produces:**
  - **`public.auto_finish_stale_logs() returns integer`**, security definer. Execute is revoked from `authenticated`, granted to `service_role`, and available to the `postgres` cron runner.
    - For `in_progress` logs with `last_activity_at < now() − interval '3 hours'`:
      - with at least one completed set: `completed`, `auto_finished = true`, `finished_at = max(completed_at)`, `revision + 1`;
      - otherwise: `discarded`, `revision + 1`.
    - Returns the number changed.
  - **Schedule:** `create extension if not exists pg_cron with schema pg_catalog;` (Supabase convention), then `select cron.schedule('auto-finish-stale-logs', '7 * * * *', 'select public.auto_finish_stale_logs()');`. Re-running the migration must not duplicate the job: unschedule an existing job of that name first.

- [ ] **Step 1: Write failing pgTAP:**
  - **Fixtures**, created as postgres:
    - log L1, `in_progress`, idle 4 h, with sets completed at T−4h10m and T−4h05m;
    - log L2, `in_progress`, idle 4 h, with nothing completed;
    - log L3, `in_progress`, idle 2 h.
  - **Assertions:**
    - The call returns 2.
    - L1 is completed with `finished_at` = T−4h05m and auto-finished.
    - L2 is discarded.
    - L3 is unchanged.
    - `authenticated` lacks execute.
    - `cron.job` has exactly 1 row named `auto-finish-stale-logs`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.

  If local `pg_cron` isn't available in the test DB, check `supabase/config.toml`. Stop and report rather than skipping the schedule assertion.
- [ ] **Step 5: Commit** `feat(db): finish forgotten workouts automatically every hour`

---

### Task 7: Mobile: log store and background sync

**Files:**
- Create: `apps/mobile/src/lib/log-store.ts`, `apps/mobile/src/lib/log-store.test.ts`, `apps/mobile/src/lib/log-sync.ts`, `apps/mobile/src/lib/log-sync.test.ts`, `apps/mobile/src/lib/log-api.ts`

**Interfaces:**
- **Consumes:**
  - `WorkoutLogDoc` (Task 1) and `autoFinish`/`shouldAutoFinish` (Task 3).
  - `save_workout_log`, `last_results` and `workout_log_comments` (Tasks 4–5).
  - `@react-native-async-storage/async-storage`.
- **Produces:**
  - **`log-store.ts`** (the storage is injectable for tests):
    - `createLogStore(storage: { getItem, setItem, removeItem }, userId: string)` returns `{ load(): Promise<StoredLog | null>, save(s: StoredLog): Promise<void>, clear(): Promise<void> }`.
    - `type StoredLog = { log: WorkoutLogDoc; lastSyncedRevision: number }`.
    - The key is `caltracker.activeLog.<userId>`. A corrupt JSON value returns null and is cleared.
  - **`log-sync.ts`:**
    - `createLogSync({ save: (doc) => Promise<{ revision: number; status: LogStatus }>, fetchLog: (id) => Promise<WorkoutLogDoc | null>, store, now?, schedule? })` returns `{ push(): void, flushNow(): Promise<SyncResult>, status(): 'synced' | 'pending' | 'offline' }`.
    - **Debounce:** 1,000 ms.
    - **Retry backoff:** 5 s, 15 s, 60 s, then 300 s steady.
    - **After a save:**
      - If the returned `revision ≥ local`, set `lastSyncedRevision`.
      - If the returned `revision > local revision` (the server is newer, e.g. a coach correction), `fetchLog` and **adopt the server doc**. This is Review Focus 2.
    - Once the log is `completed` or `discarded` and synced, clear the store.
  - **`log-api.ts`:**
    - `saveLog(doc)`
    - `fetchLog(id): Promise<WorkoutLogDoc | null>`, which maps a nested select like `workoutRowToDoc`
    - `fetchLastResults(exerciseIds)`
    - `fetchComments(logId)`
    - `fetchLogsForDays(from, to)`, for the Done ✓ state
    - `cacheTodayDetail` / `readCachedDetail`, keeping today's `WorkoutDoc`s in AsyncStorage for starting with poor signal

- [ ] **Step 1: Write failing tests** (vitest, fake timers, in-memory storage and a fake save):
  - **Store:** store → reload returns an equal doc; a corrupt value returns null and is removed.
  - **Push and debounce:** `push()` twice within 1 s calls save once.
  - **Retries:**
    - A rejected save (`TypeError: Network request failed`) leaves the status `pending`, then retries at 5 s and 15 s and succeeds. `lastSyncedRevision` is updated and the status becomes `synced`.
    - An app restart mid-retry is simulated by recreating the sync from the same store: the restored doc uploads (Review Focus 1).
  - **Server newer:** the server returns revision 7 while local is 5, so `fetchLog` is called and the store holds the server doc (Review Focus 2).
  - **Finished:** a completed doc that synced leaves the store cleared.
- [ ] **Step 2: Run** `pnpm --filter mobile test`. Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): keep the active workout on the phone and sync it in the background`

---

### Task 8: Mobile: start, log and rest timer

**Files:**
- Create:
  - `apps/mobile/src/lib/use-active-log.tsx`
  - `apps/mobile/src/lib/log-notifications.ts`
  - `apps/mobile/src/app/(app)/log/[id].tsx`
  - `apps/mobile/src/components/log/{set-row,rest-sheet,exercise-header,sync-pill}.tsx`
- Modify:
  - `apps/mobile/package.json`: `expo-notifications` and `expo-haptics`, pinned with `pnpm --filter mobile exec expo install`, then pinned exactly in package.json.
  - `apps/mobile/app.json`: the `expo-notifications` plugin with no push config.
  - `apps/mobile/src/app/(app)/(tabs)/today.tsx`: Start, Resume and Done ✓.
  - `apps/mobile/src/app/(app)/_layout.tsx`: wrap in `ActiveLogProvider`.

**Interfaces:**
- **Consumes:** Tasks 1–3 and 7; `formatSetTarget`, `setLabels`, `groupDropSets`, `formatRest`, `formatWeight` and `kgToInput` from shared; the existing theme and UI kit; `WorkoutPicker`-style exercise search, via the existing `exercises` select under RLS.
- **Produces:**
  - **`ActiveLogProvider` and `useActiveLog()`** return `{ log, syncStatus, start(workoutDoc), startEmpty(name), resume(), op(fn), finish(), discard() }`.
    - `start` resumes the existing in-progress log when one exists (Review Focus 3). It never creates a second.
    - On mount and on app foreground, if `shouldAutoFinish`, it applies `autoFinish`, pushes, and stores a one-time banner message: "We finished {name} for you at {time}."
  - **`log-notifications.ts`:**
    - `ensurePermission()` is asked once at the first Start.
    - `scheduleRestEnd(seconds)` and `cancelRestEnd()`.
    - `scheduleReminder(name)` is re-scheduled on every completed set, `REMINDER_DELAY_MS` later, with the exact copy. `cancelReminder()`.
    - `tapHaptic()`.
  - **Logging screen `/log/[id]`:**
    - Shows the name, a running timer, blocks (A1/A2 lettering via the existing `supersetLetters`) and set rows.
    - **Set rows:** label, target text, editable actual inputs in the client's units (`kgToInput` for display, `toKg` on change), and a ✓ button.
      - testIDs: `set-<exerciseIndex>-<setIndex>`, `tick-<…>`, and `actual-reps-<…>` / `actual-weight-<…>`.
    - **"Last time"** comes from `fetchLastResults`: "Last time: 135 lb × 8", using the same exercise's first completed non-warm-up set.
    - **Rest sheet** (`rest-sheet`): countdown with −15 s, +15 s and Skip. testIDs `rest-sheet`, `rest-skip`.
    - **Menus:** + Set, + Drop, Swap, Remove, Note, + Exercise. Finish (`finish-button`) and Discard are in the header menu.
    - **Sync pill** (`sync-pill`) shows "Not synced yet" while pending.
  - **Today:**
    - Planned cards show **Start** (`start-<workoutId>`).
    - In progress shows a "Resume {name}" banner (`resume-banner`).
    - A completed planned workout shows "Done ✓ · {duration}". It is matched by `workout_id` against logs fetched by the planned `scheduled_on` range, not `finished_at` (Review Focus 5).

- [ ] **Step 1: Write failing unit tests** (`apps/mobile/src/lib/active-log.test.ts`, testing the pure parts extracted into `active-log-logic.ts`):
  - `startOrResume(existing, workoutDoc)` returns the existing log when one is in progress, otherwise a new one.
  - `foregroundCheck(log, nowMs)` returns `{ log: autoFinished, banner: 'We finished Upper A for you at 10:40 AM' }` past 3 h, and `null` before.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** the logic, provider, notifications, screen and Today changes.
- [ ] **Step 4: Run** `pnpm --filter mobile test && pnpm check`. Expected: PASS. Build the simulator app:
  ```
  cd apps/mobile && CI=1 pnpm exec expo prebuild --platform ios --clean && CI=1 pnpm exec expo run:ios --configuration Release --device <booted iPhone 18 Pro udid>
  ```
  The command keeps streaming logs after install, so stop it once "Complete 100%" appears. Then check the existing Maestro flows still pass: `pnpm --filter mobile e2e`.
- [ ] **Step 5: Commit** `feat(mobile): start, log and rest between sets`

---

### Task 9: Mobile: finish, discard, unplanned, comments and Maestro

**Files:**
- Create: `apps/mobile/src/app/(app)/log/[id]/summary.tsx`, `apps/mobile/.maestro/{log-workout,log-resume,log-unplanned}.yaml`
- Modify:
  - `apps/mobile/src/app/(app)/log/[id].tsx` (finish flow)
  - `apps/mobile/src/app/(app)/(tabs)/workouts.tsx` (✓ on done days; a "Log a workout" button with testID `log-unplanned`)
  - `apps/mobile/scripts/e2e-helper.ts` (actions `assign-today` and `cleanup-logs`)
  - `apps/mobile/.maestro/helpers/call.js` (document the new actions)

**Interfaces:**
- **Consumes:** `useActiveLog()` (Task 8), `logVolumeKg`, `completedSetCount` and `logDurationS` (Task 3), and `fetchComments` (Task 7).
- **Produces:**
  - **Finish:** if some sets are unticked, confirm with "Finish with {n} sets not done? They won't count." Zero completed sets shows "Complete at least one set to finish." with a Discard option.
  - **Summary screen:** name, duration, total volume in the client's units (`formatWeight`, e.g. "8,420 lb lifted"), "{n} sets completed", a Done button (`summary-done`), and **Coach comments** (read-only, newest last). It's reachable later from a Done ✓ card's View button.
  - **Discard:** confirm, then status `discarded`; the planned workout can be started again.
  - **Reopen:** a finished log with `canReopen` shows "Add missed sets" on the summary, which reopens it.
  - **Unplanned:** "Log a workout" asks for a name (default "Workout"), creates `emptyLog`, and opens the logging screen with "+ Exercise".

- [ ] **Step 1: Write failing Maestro flows:**
  - **`log-workout.yaml`:**
    1. The helper `assign-today` gives `client@demo.local` a 1-week program with "E2E Log" today: Barbell Squat, 3 × 8 @ 60 kg.
    2. Sign in, Start, tick set 1.
    3. Assert `rest-sheet`, then tap Skip.
    4. Tick sets 2 and 3, then `finish-button`.
    5. Assert "3 sets completed" and that a volume text is visible.
    6. Done. Today shows "Done ✓".
    7. Cleanup.
  - **`log-resume.yaml`:** Start, tick 1 set, `stopApp`, `launchApp` (no `clearState`). Assert the `resume-banner`, tap it, and assert set 1 is still ticked (Review Focus 1).
  - **`log-unplanned.yaml`:** Workouts tab, `log-unplanned`, name "Run", + Exercise (search "push"), tick a set, finish. Assert the summary.
- [ ] **Step 2: Run** `pnpm --filter mobile e2e`. Expected: the new flows FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter mobile test && pnpm check && pnpm --filter mobile e2e`. Expected: all flows PASS, the existing seven plus the three new ones.
- [ ] **Step 5: Commit** `feat(mobile): finish, discard and unplanned workouts with a summary`

---

### Task 10: Web: activity feed and calendar status

**Files:**
- Create: `apps/web/src/app/(coach)/activity/{page.tsx,activity.module.css}`, `apps/web/src/lib/logs.ts`, `apps/web/e2e/logs.spec.ts`
- Modify:
  - `apps/web/src/app/(coach)/layout.tsx`: a nav item `{ href: '/activity', label: 'Activity', icon: 'activity' }` plus an icon in `nav-icons.tsx`.
  - `apps/web/src/app/(coach)/clients/[clientId]/page.tsx` and its calendar item rendering: done ✓ linking to the log; missed outline.
  - `apps/web/e2e/helpers.ts`: `seedLog(opts)` via the service role, using the `save_workout_log` shape or direct inserts.

**Interfaces:**
- **Consumes:** the Task 4–5 tables, `logVolumeKg`/`logDurationS`/`completedSetCount`, `requireCoach`, and the calendar components.
- **Produces:**
  - `apps/web/src/lib/logs.ts`:
    - `LOG_TREE_SELECT`
    - `logRowToDoc(row): WorkoutLogDoc`
    - `loadLog(supabase, logId): Promise<{ log: WorkoutLogDoc; clientId: string; plannedWorkoutId: string | null; correctedAt: string | null } | null>`
  - **`/activity?client=<id>&page=<n>`:**
    - completed logs in the coach's workspace, newest first, 25 per page
    - each row shows client name, workout name, finished date and time (rendered in the browser's zone), duration, sets and volume, plus "Auto-finished"/"Unplanned" chips, and links to the log page
    - a client filter select
  - **Calendar:**
    - A planned item whose instance has a completed log shows ✓ and links to `/clients/[clientId]/logs/[logId]`.
    - A planned item before the browser's today with no completed log gets the class `missed` (amber outline) and the accessible text "Missed".

- [ ] **Step 1: Write failing Playwright tests** (`logs.spec.ts`):
  - A seeded completed log for Demo Client appears in /activity with the right sets count.
  - The client filter narrows the list.
  - The calendar item for that planned workout shows ✓ and links to the log URL.
  - A planned workout yesterday with no log shows "Missed".
  - **Review Focus 5:** in a `timezoneId: 'America/Los_Angeles'` context, a log finished at 23:30 LA time on its planned day stays on that planned day.
- [ ] **Step 2: Run** `CI=1 pnpm --filter web exec playwright test e2e/logs.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add the activity feed and done or missed status on the calendar`

---

### Task 11: Web: planned vs. actual, comments and corrections

**Files:**
- Create: `apps/web/src/app/(coach)/clients/[clientId]/logs/[logId]/{page.tsx,planned-vs-actual.tsx,comments.tsx,correct-form.tsx,actions.ts,log.module.css}`
- Modify: `apps/web/e2e/logs.spec.ts`

**Interfaces:**
- **Consumes:** `loadLog` (Task 10), `loadWorkoutDoc` (planned), `correct_workout_log`, the comments table, and the stale-deploy helper `failureMessage` from `apps/web/src/lib/action-errors.ts`.
- **Produces:**
  - **The page:** 404 unless the log is in the coach's workspace. A past client stays readable.
    - **Header:** name, client, started and finished times, duration, volume, sets, plus "Edited by coach · {date}" when corrected.
    - **`<PlannedVsActual>`:** per exercise, a table with columns Set · Planned · Actual. Unticked sets are greyed out ("Not done"). Swapped exercises are labelled "Swapped from {name}", added ones "Added". Values are shown in the coach's units.
  - **`actions.ts`:**
    - `addComment({ logId, body }): Promise<{ ok: true } | { ok: false; error: string }>`: trimmed 1..1000; "Write a comment first." when empty.
    - `deleteComment(id)`
    - `correctLog({ logId, sets: Array<{ id; actualReps?; actualWeightKg?; actualDurationS?; actualDistanceM? }> })`: weights are converted to kg with `toKg` in the action, from the coach's units.
  - **`<Comments>`:** list plus a textarea and "Post comment". Own comments get a Delete with confirm.
  - **`<CorrectForm>`:** "Correct" toggles the actual cells into inputs, then "Save corrections". The ✓ Saved status chip and the reload prompt follow the clarity-update patterns.

- [ ] **Step 1: Write failing Playwright tests:**
  - **Planned vs. actual:** the seeded log page shows "Planned" and "Actual" columns with "8 × 60 kg" and the actual values, and an unticked set reads "Not done".
  - **Comments:** post "Great depth today" and it appears. Reload and it is still there. Delete it and it is gone.
  - **Corrections:** correct the reps from 8 to 6 and save, which shows "Edited by coach". The database `actual_reps` is 6.
  - **Access:** a non-client log id gives a 404.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): show planned vs actual with comments and corrections`

---

### Task 12: Final verification and handoff

**Files:**
- Modify: `apps/web/e2e-staging/smoke.spec.ts` (the signed-in coach opens `/activity` and sees its heading), plus `apps/web/README.md` and `apps/mobile/README.md` (a few lines on logging, the new Maestro flows and pg_cron).

- [ ] **Step 1: Full local run**, showing the output:
  ```
  pnpm check && pnpm db:reset && <re-import exercises> && pnpm db:test && pnpm db:types && git diff --exit-code packages/shared/src/database.types.ts && pnpm functions:test && pnpm test:integration && CI=1 pnpm test:e2e && pnpm --filter mobile e2e
  ```
  Everything must be green.
- [ ] **Step 2: Scope check.** No iPad session mode, PR/sticker logic, push notifications or PowerSync code was added.
- [ ] **Step 3: Checkpoint (product owner).** Ask to push and open the PR. The PR's "Try on your phone":
  1. Start today's workout, tick sets, and see the rest timer.
  2. Close the app mid-workout and reopen it to Resume.
  3. Finish and see the summary.
  4. On the dashboard, open Activity, then the log: see planned vs. actual, add a comment, and correct a typo.
  5. On the phone, see the comment.
- [ ] **Step 4: After merge,** confirm the staging deploy and smoke test passed, and that `cron.job` has the auto-finish job on staging (read-only query).
