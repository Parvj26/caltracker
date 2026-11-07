# Automatic progression: design

Approved by the product owner for Wave 2 (it was on the spec's "not in Version 1" list).

## In plain words (for the product owner)

- Each program has an **Auto progression** switch on its page. **Existing programs: off. New programs (and
  duplicates): on**, the same as Live Sync.
- When it is on, the phone **suggests the next weight** for each weight-and-reps exercise the coach left without a
  weight:
  - **Every working set done at the top of the rep range last time** (for "8–10 reps": 10 or more on every set):
    **+5 lb** for upper-body exercises, **+10 lb** for lower-body (**+2.5 kg / +5 kg** for kg clients).
  - **Below the bottom of the range two sessions in a row** (at least one working set done with fewer reps than the
    bottom, in each of the last two sessions): **10% lighter**, rounded to the nearest 5 lb / 2.5 kg.
  - Otherwise: no suggestion, the phone behaves as before (last time's weight).
- The phone pre-fills the suggested weight in the set boxes and shows "Suggested 140 lb · ↑ +5 lb" under the
  exercise. "Last time" still shows what was really lifted. Mark all ticks with the suggested weight.
- The coach sees the same suggestions on the client's workout page ("Auto progression: Bench Press 140 lb ↑ +5 lb")
  and on the session logging page (pre-filled the same way).
- **A weight the coach typed always wins.** If any working set of that exercise in that workout has a weight, there is
  no suggestion. To override a suggestion, the coach edits the workout as today and types a weight.

## Rulings

- **Progression never rewrites workout plans.** It only changes the suggested weight (the pre-fill). So it never
  fights Live Sync, never marks a copy "customised", and switching it off simply stops the suggestions.
- **Upper vs lower body** comes from the exercise's existing `primary_muscles` (free-exercise-db names), so no new
  column was needed: lower body when any primary muscle is quadriceps, hamstrings, glutes, calves, adductors,
  abductors or lower back (so deadlifts get +10 lb); everything else, and unknown or empty muscles (most custom
  exercises), is upper body (+5 lb).
- **Which exercises qualify:** tracking type weight + reps, a rep target on every working set, and a weight above 0
  lifted last time. Time, distance, reps-only and bodyweight work are skipped.
- **Working sets** are the normal sets; warm-ups and drops are ignored, for judging and for the pre-fill.
- **Rep range per set:** each working set is judged against the plan's range for that set (pyramids work); sets the
  client added beyond the plan use the last planned range. A single number ("5 reps") is both top and bottom.
  The range is today's plan, not the one in the old log.
- **Base weight:** the heaviest working weight done in the last session. All working sets get the same suggestion.
- **Undone sets:** "every working set at the top" needs every working set ticked; a set left unticked is not a miss.
- **Sessions** are the client's completed logs (any workout, planned or not, in the same workspace) with at least one
  ticked set of that exercise, newest first; logs of the workout being done are left out. After a drop, two more
  misses in a row drop again.
- A drop that rounds back to the same weight (or to 0) is not suggested.
- Without signal the phone has no history, so it falls back to the normal pre-fill (like "Last time").

## How it works

- `packages/shared/src/progression/progression.ts` (unit tests in `packages/shared/test/progression/`):
  `exerciseRegion`, `nextSuggestion(history, prescription, region, units)`, `progressionHint`, `withSuggestion`
  (last time with the suggested weight, fed into the existing `resolveSetValues` rule 6, so the coach's number and the
  client's own carried-forward change still come first), `prefillLastTime`, `suggestionForLogExercise`,
  `suggestionsForLog`, `suggestionsForWorkout`, `progressionHistoryFromRows`.
- Migration `20261107004000_auto_progression.sql`:
  - `programs.auto_progression` (existing rows false, default true); coaches may insert and update it (RLS decides
    whose programs).
  - `progression_history(p_workout_id, p_exercise_ids)`: security definer (clients can't read programs). Returns rows
    only when the workout comes from an assignment whose program has the switch on, and only to a coach of the
    workout's workspace or the workout's own current client; history comes only from that client's logs in that
    workspace. Up to two sessions per exercise, every set (done or not), with the exercise's primary muscles.
- Phone: `fetchProgression` in `log-api.ts`; `log-flow-model.ts` threads it into `buildPage`, `markAll` and the tick.
- Web: Auto progression switch on the program page (`auto-progression-panel.tsx`, `setProgramAutoProgression`),
  `ProgressionCard` on the client's workout page, and the pre-fill and "Suggested" line on the session logging page.

## Tests

- Unit: shared rules (up, down, hold, units, rounding, coach wins, tracking types, bodyweight, ranges), parsing, the
  phone's page model and Mark all.
- pgTAP `supabase/tests/auto_progression.test.sql`: column and default, privileges, the history rows (last two
  sessions, undone sets, own-workout / discarded / empty / other-workspace logs left out), switch off, unplanned
  workouts, another client, another workspace's coach, anon, a removed client, who can switch it.
- Maestro `apps/mobile/.maestro/auto-progression.yaml` (not run yet).

## Not in this change

- No suggestion for reps, time or distance; no per-exercise step sizes; no "deload week".
- No notification when a suggestion changes. The overview list still shows the coach's plan line, not the suggestion.
