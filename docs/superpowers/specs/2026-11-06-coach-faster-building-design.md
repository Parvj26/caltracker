# Coach faster building (Batch 3)

Date: 2026-11-06. Status: built (PR "feat(web): faster workout building"). Source: coach audit finding 8 and 11
(62 clicks and 43 typed boxes for a 6-exercise workout with a superset, because every set was typed by hand; no
duplicate or copy anywhere).

## What the coach gets

1. **Copy set 1 to all sets** (per exercise, under its sets, beside "+ Set"). Copies set 1's reps (single or range),
   weight, time, distance and rest to the exercise's other main sets.
   **Fill down from…** (a menu plus a "Fill" button beside it, shown when an exercise has 3+ main sets) does the same
   from set 2, 3… to the sets below it. Choosing in the menu only picks the set; "Fill" fills, so arrowing through the
   menu never changes anything.
   - While the set being copied has no targets typed yet, the button is disabled with "Type set 1 first, then copy
     it.", so an empty set 1 never wipes sets the coach already typed (`hasTargets`).
   - Warm-ups and drop sets are never changed; nor are set notes or set types.
   - Only that exercise changes: a superset partner or another pick-one option is never touched.
   - Rest in a superset: rest is copied only where both sets show a rest box. An exercise that goes straight into the
     next one keeps its 0 s, and an uneven superset's extra round keeps its rest.
   - It is an ordinary edit before Save: nothing is saved until "Save workout", and leaving warns as before.
   - Logic: `fillDown` / `copyFirstSetToAll` in `packages/shared/src/workouts/doc-ops.ts`, tested in
     `packages/shared/test/workouts/fill.test.ts`.
2. **Set count when adding** ("Sets each: − 3 +" in the picker, beside the Add button; "Rounds" for a superset). We
   chose the picker over a stepper on every exercise header because the header already holds Swap / ↑ / ↓ / Move /
   Remove (and Batch 1 is reworking that layout on iPad), the per-exercise "+ Set" and "Remove" already cover later
   changes, and one choice in the picker sets every exercise picked at once. Default stays 3; 1 to 20.
3. **Add several exercises at once.** "+ Exercise" now lets the coach tap several exercises, then "Add N exercises".
   Each becomes its own straight-sets block, in the order picked (`addStraightBlocks`). Up to 10 per pick, and never
   more than the room left under the workout's 30-block cap: the picker says "This workout has room for N more", and
   at 30 the add buttons are disabled with a line saying why. Trade-off: adding a single exercise now takes one more tap ("Add 1
   exercise"); "Swap exercise" still adds on the first tap.
4. **Duplicate a workout / a program.** "Duplicate workout" / "Duplicate program" on their pages, and "Duplicate" on
   each row of the Workouts and Programs lists. Makes "<name> (copy)" (shortened if needed to fit 100 characters,
   `copyName`) in the same workspace and opens it. It copies what is saved, not unsaved builder edits. A copied
   program opens with "Copied. Workouts are shared with the original — editing a workout changes both." (a program
   holds library workouts, not copies of them).
   - Workout: the server action loads the library workout (filtered by the coach's workspace), gives every row a new
     id (`duplicateWorkoutDoc`) and saves it with the existing `save_workout`. No new SQL.
   - Program: new `duplicate_program(p_new_id, p_program_id, p_name)` copies the program and its slots in one
     transaction. Security invoker (like `set_program_weeks`): RLS hides other workspaces' programs, so the function
     finds nothing and refuses (42501). pgTAP: `supabase/tests/program_copy.test.sql` (cross-workspace and client
     duplicate refused, nothing created).
5. **Copy a week inside a program.** Each week row has "Copy…" → a dialog: "Copy to: Week 2 / Week 3 / Every
   following week (weeks 2 to 4)". Copying **replaces** the target weeks (afterwards they match the source week,
   same days and order). Replacing is the least surprising reading of "copy week 1 to week 2"; merging would double
   up workouts when a coach copies twice. When a target week already has workouts, the dialog says how many and asks
   "Replace week 2" before doing it (inside the dialog, no browser confirm box). An empty source week can't be copied.
   - Logic: `copyWeek`, `followingWeeks`, `slotsInWeeks` in `packages/shared/src/programs/grid.ts` (tests in
     `packages/shared/test/programs/grid.test.ts`).
   - New `copy_program_week(p_program_id, p_from, p_to, p_ids)` reads the source week and writes the target weeks in
     one transaction (security invoker, `search_path ''`, anon revoked; RLS decides which programs the caller sees).
     `p_to` must be distinct weeks in increasing order inside the program, not the source. The new slot ids come
     from the browser (`p_ids`, one per copy, in target week then day / position / id order, the same order
     `copyWeek` makes them), so the grid's ids are the saved ids. A count that doesn't match the saved source week
     (it changed since the page loaded) is refused with "Reload the page and try again".
   - The grid shows the copy at once. While it saves, the source and target weeks are locked: adding, moving or
     removing there says "That week is still being copied". On success only the copied slots are swapped for the
     saved rows; on failure they are removed and the replaced ones come back, with a message. The copy waits while
     earlier grid changes are still saving.
   - The dialog says "Clients already on this program keep their current workouts." (assigning copies workouts
     onto client calendars).
   - pgTAP: `supabase/tests/program_copy.test.sql` (ids kept, bounds, stale count, cross-workspace refused both
     ways, a client of the same workspace refused).

## Click count (6 exercises: 4 straight + a superset of 2, 3 sets each, reps + weight per set)

Same model as the audit (each typed box needs a tap into it; each picker search is a tap into the search box).

| | Before | After |
|---|---|---|
| Name | 1 | 1 |
| 4 straight exercises | 16 (4 × [+ Exercise, search, pick, Add]) | 10 (+ Exercise, 4 × [search, pick], Add 4) |
| Superset | 6 | 6 |
| Sets | 36 (18 sets × reps + weight) | 18 (6 × [set 1 reps, set 1 weight, Copy to all]) |
| Save | 1 | 1 |
| **Clicks** | ~60 (audit measured 62) | **36** |
| **Typed boxes** | 43 | **19** (name, 6 searches, 12 set-1 boxes) |

## Not changed

Set-row layout and CSS, the sidebar, the client calendar item menu and the assign dialog (Batches 1 and 2).
