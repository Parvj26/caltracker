# Phase 3a: Workout logging design (addendum to the coaching app spec)

**Status:** decisions approved by the product owner on 2026-11-05. This document records them and the technical design.
**Parent spec:** `2026-11-03-coaching-app-design.md`, Section 5 (Workout logging). Where this addendum differs, it wins. The differences are listed under "Changes to the parent spec".

## Changes to the parent spec (product owner decisions)
1. **Split.**
   - **3a** (this document): client logging on the phone, saving that survives bad signal, the forgotten-workout reminder and auto-finish, and coach review on the dashboard (feed, planned vs. actual, comments, corrections).
   - **3b** (later): coach session logging on the iPad and "single active logger".
2. **Offline: a lighter approach, no PowerSync for now.**
   - The workout in progress is saved on the phone after every change and uploaded in the background, with retries until it succeeds.
   - Opening the app for the first time with no signal at all is not supported. The workout must have loaded once (the Today screen caches it).
   - Reason: no extra vendor or monthly cost. PowerSync Pro is $49/month, and its free plan pauses when idle. Revisit when there are several paying coaches.
   - The data model (client-generated ids, a whole-document save with a revision number) is chosen so that moving to PowerSync later changes the sync layer, not the tables.
3. **Finish summary.** It shows duration, total volume and completed sets. Personal records, stickers and the badge reveal arrive in Phase 4, from the same logged data.
4. **Mid-workout changes apply to the client's log only.** The client can + Set, + Drop, swap an exercise, add an exercise, and add a note. The coach's plan is never changed.
5. **Coach comments are visible in the app only.** Push notifications come with the notifications phase.

## What the client sees (phone)
- **Today:**
  - Each workout card has a primary **Start** button.
  - A finished workout shows **"Done ✓"** with its duration and a "View" button.
  - A workout in progress shows a **"Resume {name}"** banner at the top of Today and Workouts.
- **Workouts tab:**
  - Finished days show a ✓.
  - A **"Log a workout"** button starts an unplanned workout: a blank log where the client adds exercises.
- **Logging screen** (`/log/[id]`):
  - The workout name, a running timer, then each block. Supersets are labelled A1/A2 as on the detail screen.
  - Each set row shows the set label (W, 1, 2, ↳), the target ("8–10 reps · 135 lb"), editable **actual** weight and reps (pre-filled from the target, or the reps maximum when the target is a range), and a large **✓** button.
  - Ticking a set marks it done, records its time, gives a light haptic, and **starts the rest timer** for that set's rest. The timer is a bottom sheet showing the countdown and buttons for −15 s, +15 s and Skip. At zero there is a vibration and a sound (a local notification if the app is in the background).
  - **"Last time: 135 lb × 8"** under each exercise: the client's most recent completed result for that exercise. It is hidden when there is none.
  - **Menus:**
    - Exercise menu: Swap exercise, Add note, Remove.
    - Set menu: + Drop, Remove set.
    - Buttons: + Set, + Exercise, Finish.
  - A **"Not synced yet"** pill shows while changes are waiting to upload. It disappears after a successful upload.
- **Finish:**
  - The coach sees a confirmation if any sets are unticked: "Finish with 3 sets not done? They won't count."
  - Then a **summary**: name, duration, total volume ("8,420 lb lifted"), completed sets, and a Done button.
  - Logs with zero completed sets can't be finished. The only options are **Discard** or keep going.
- **Discard:** from the logging screen menu, with a confirm. The log becomes `discarded`, and the planned workout is open to start again.
- **Resume:** closing the app or the phone dying never loses ticked sets. Reopening shows the Resume banner, or the logging screen if the client was on it.
- **Forgotten workouts:**
  - Every ticked set (re)schedules a local notification 20 minutes later: "Still training? 💪 Tap to finish your {name} workout." Finishing or discarding cancels it.
  - A log with no activity for 3 hours is finished automatically, ending at the last ticked set's time.
    - The phone does this on open/resume, and shows the note "We finished {name} for you at {time}."
    - A server job does it hourly for phones that never reopen.
  - An auto-finished log can be reopened to add missed sets within 24 hours of finishing.
- **Comments:** the finished workout's view shows the coach's comments, newest last. Comments are read-only for the client in 3a.

## What the coach sees (dashboard)
- **Activity** (new sidebar item, `/activity`):
  - Finished workouts across all clients, newest first. Each row shows client, workout name, finished date/time, duration, completed sets and volume, plus an "Auto-finished" or "Unplanned" chip.
  - The list is paginated (25 per page) and filterable by client.
- **Client calendar:**
  - A finished workout's chip shows ✓ and links to its log.
  - A planned workout that was never started is visibly "missed" (amber outline) once its day has passed.
- **Logged workout page** (`/clients/[clientId]/logs/[logId]`):
  - **Planned vs. actual** side by side, per exercise and set: target in one column, actual in the next, unticked sets greyed out. Swapped or added exercises are labelled ("Swapped from Barbell Bench Press", "Added").
  - Header: duration, volume, completed sets, started and finished times.
  - **Comments:** the coach writes comments (≤ 1,000 characters each), shown with author and time. The coach can delete their own comment.
  - **Correct:** the coach can edit actual weight, reps, time and distance of any set, then Save. Every correction records who and when ("Edited by coach · 5 Nov"). Structure (adding or removing exercises) isn't editable by the coach in 3a.
- Past clients' logs stay readable to the coach, as with calendars.

## Data model (new migration `20261105000700_workout_logs.sql`)
A log is a **separate tree** from the planned workout:
- The plan is never mutated, so planned vs. actual is always available.
- Unplanned workouts need no plan.
- Phase 4 (PRs, volume, stickers) reads only logs.

| Table | Key columns |
|---|---|
| `workout_logs` | `id` (client-generated uuid), `workspace_id`, `client_id`, `workout_id` → planned instance (null when unplanned; `on delete set null`), `name` 1..100, `status` `in_progress`/`completed`/`discarded`, `started_at`, `finished_at`, `last_activity_at`, `auto_finished` bool, `logged_by` (uid; the client in 3a, the coach in 3b), `revision` int, `notes` ≤ 2000, `corrected_at`, `corrected_by`, `created_at`, `updated_at`. Partial unique index: **one `in_progress` log per client**. |
| `log_blocks` | `id`, `log_id`, `workspace_id`, `client_id`, `position`, `kind` |
| `log_exercises` | `id`, `block_id`, `log_id`, `workspace_id`, `client_id`, `position`, `exercise_id` (restrict), `planned_workout_exercise_id` (nullable), `swapped_from_exercise_id` (nullable), `note` ≤ 500 |
| `log_sets` | `id`, `log_exercise_id`, `log_id`, `workspace_id`, `client_id`, `position`, `set_type`, a target snapshot (`target_reps_min/max`, `target_weight_kg`, `target_duration_s`, `target_distance_m`, `to_failure`, `rest_seconds`), actuals (`actual_reps` 0..1000, `actual_weight_kg` numeric(7,3) 0..1000, `actual_duration_s`, `actual_distance_m`), `completed_at` (null = not done) |
| `workout_log_comments` | `id`, `log_id`, `workspace_id`, `client_id`, `author_id`, `body` 1..1000, `created_at` |

- **Owner columns are inherited by trigger**, the same pattern as the workouts tables. `updated_at` is set by trigger. Hard deletes only.
- **Reads (RLS):** `is_coach_of(workspace_id) or (client_id = auth.uid() and is_client_in(workspace_id, client_id))`. Removed clients see nothing, and coaches keep history.
- **Writes go through functions only.** `authenticated` gets no table write grants except comments.
  - **`save_workout_log(p_doc jsonb) returns jsonb`**, security definer:
    - The caller must be the log's client and a current client of the workspace. A planned `workout_id` must be their own instance.
    - It upserts the whole tree by id. **It ignores a doc whose `revision` ≤ the stored revision** (stale retries are harmless) and returns the stored revision.
    - Allowed status changes: `in_progress` → `completed`/`discarded`, and `completed` → `in_progress` only when `auto_finished` and within 24 h.
    - It validates the doc's structure with the same rules as `save_workout`, plus actual-value ranges.
  - **`correct_workout_log(p_log_id uuid, p_sets jsonb)`**, security definer, coach of the workspace only, completed logs only. It updates actual values of the given sets and stamps `corrected_at`/`corrected_by`.
  - **Comments:** coach insert/delete under RLS (`is_coach_of`). Clients select only.
  - **`last_results(p_exercise_ids uuid[])`**, invoker. For the caller's own completed logs, it returns the most recent log's completed sets per exercise.
  - **`auto_finish_stale_logs()`**, definer, not callable by `authenticated`. It sets `completed`, `auto_finished`, and `finished_at` = the last `completed_at` (or `started_at`) for in-progress logs idle more than 3 h with at least one completed set. Idle logs with none are set to `discarded`. Scheduled hourly with `pg_cron`.

## Shared logic (`packages/shared/src/logs/`, pure and tested)
- `WorkoutLogDoc` (zod): the same block/exercise/set shape as `WorkoutDoc`, plus actuals, `completedAt`, status and revision.
- `startLogFromWorkout(workout: WorkoutDoc, makeId, now)` and `emptyLog(name, makeId, now)`.
- Log operations (pure, immutable):
  - `completeSet`
  - `uncompleteSet`
  - `updateActual`
  - `addLogSet` (copies the previous set's target and actuals)
  - `addLogDrop`
  - `removeLogSet`
  - `swapLogExercise`
  - `addLogExercise`
  - `removeLogExercise`
  - `setExerciseNote`
- Summary and timing:
  - `logVolumeKg(log)`: Σ weight × reps over completed sets of `weight_reps` exercises, including warm-ups and drops, per the parent spec.
  - `completedSetCount`
  - `logDurationS`
  - `shouldAutoFinish(log, now)` (3 h)
  - `autoFinishTime(log)`
  - `canReopen(log, now)` (24 h)
- `prefillActuals(set)`: actual reps = the target max (or the single value), actual weight = the target weight.

## Phone implementation
- **On-device store:** `apps/mobile/src/lib/log-store.ts` keeps the active log doc in AsyncStorage (already a dependency), keyed by user. Every operation writes there first, then bumps `revision`.
- **Sync:** `log-sync.ts` uploads the latest doc via `save_workout_log`:
  - right after each change, debounced 1 s
  - on app foreground
  - every 30 s while unsynced, with backoff up to 5 min
  
  It never blocks the UI. The "Not synced yet" pill reflects `revision > lastSyncedRevision`.
- **Caching:** Today's workouts and their detail are cached in AsyncStorage, so Start works with poor signal once they have loaded.
- **New Expo modules (free, part of Expo):** `expo-notifications` (local notifications only: rest end and the 20-min reminder; no push setup) and `expo-haptics`. Notification permission is asked the first time a workout starts.

## Testing
- **pgTAP:**
  - RLS on all five tables: cross-workspace, cross-client, removed client, anon.
  - `save_workout_log`:
    - ownership
    - a removed client is refused
    - a stale revision is ignored
    - status transitions
    - a planned workout of another client is refused
    - validation messages
  - `correct_workout_log` (coach only, completed only); comments (coach writes, client reads); `last_results`; `auto_finish_stale_logs` (finish time, discard when empty); the one-in-progress index.
- **Shared unit tests:** every log op keeps the doc valid; volume, duration and auto-finish maths; prefill rules.
- **Mobile unit tests:** the sync queue with a fake client (retry, backoff, a stale revision ignored, offline then online), and the store's persist/restore.
- **Maestro:** start today's workout, tick sets (the rest sheet appears), + Set, finish, then the summary shows volume. Relaunch mid-workout and resume. Start an unplanned workout.
- **Playwright:**
  - The activity feed shows a seeded log.
  - The log page shows planned vs. actual, a comment, and a correction saved and shown as "Edited by coach".
  - The calendar ✓ links to the log.
  - A missed planned workout is outlined.

## Out of scope (3a)
- iPad coach sessions and the single active logger (3b).
- PRs, stickers, badge reveal, sharing (Phase 4).
- Push notifications, including for comments.
- Full offline first open (PowerSync, later).
- Client replies to comments.
- Editing log structure as the coach.
