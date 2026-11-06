# Workout sections and "Pick one" groups: design

Date: 2026-11-06 · Status: approved by the product owner (behaviour below is theirs, verbatim where quoted).
Builds on: master spec `2026-11-03-coaching-app-design.md`, logging redesign `2026-11-06-logging-redesign-design.md`
(the phone part sits on top of branch `feature/logging-redesign`).

## In plain words (for the product owner)

- **Sections.** In the workout builder the coach taps **+ Section**, picks a name (Warm-Up, Core, Main, Finisher,
  Cool-down) or types their own. Every exercise added after that belongs to that section. Workouts without sections
  keep working exactly as today.
- On the **client's phone** the logging screen shows where you are, for example "Core (Activation) · 1 of 2". The
  progress strip has small gaps between sections, and the "2 of 5" exercise list is grouped under section headings.
  The workout preview (before Start) shows the same headings.
- The **coach** sees the same headings on the workout page opened from the client's calendar and on the workout log
  page.
- **Pick one.** The coach adds a **Pick one** group of 2 to 5 exercises, each with its own sets (for example Medicine
  Ball Slam 3 × 12 or Farmer's Walk 3 × 40 m). On the phone, "Finisher · pick one" shows each option as a card (photo
  and sets). Tapping one turns the page into a normal exercise page. The client can switch until they finish the
  first set of the one they picked.
- Only the picked exercise counts towards volume and personal bests. The others are **not** treated as missed or "not
  done" anywhere. The coach sees "Picked: Medicine Ball Slam" on the log.

**What changes for existing data:** nothing. Old workouts, programs, logs and phones keep working; sections and
pick-one groups are simply absent from them.

## The real example this must support end to end

The trainer's "Upper / Core" workout:

| Section | Block | Exercises (sets) |
|---|---|---|
| Warm-Up | straight | Arm Circles 1 × 10 reps |
| Core (Activation) | superset | Hanging Leg Raise 3 × 10 · Medicine Ball Sit Up & Overhead Throw 10 / 12 / 14 lb × 12 |
| Resistance Training | superset | DB Bench Press 35 / 45 / 55 lb × 12 · Alternating DB Curl 25 lb × 12 × 3 |
| | superset | Lateral Raise 10 / 15 / 15 lb × 12 · Seated DB Press 25 / 30 / 30 lb × 12 |
| | superset | Lat Pulldown 85 / 115 / 85 / 85 lb × 12 · Tricep Pushdown 70 / 80 / 90 / 70 lb × 12 |
| Finisher | pick one | Medicine Ball Slam 15 lb × 12 × 3 **or** Farmer's Walk 3 × 40 m |

("Seated DB Press 25/30" is entered as 25 / 30 / 30 because a superset needs the same number of rounds; reps are 12
where the trainer's sheet gives none.)

## Data model

### Planned workout (`WorkoutDoc`, `packages/shared/src/workouts/schema.ts`)

- New: `sections: Array<{ id: uuid; name: string }>` on the workout, default `[]`. Order of the array is the order on
  screen. Name trimmed, 1–40 characters. At most 10 sections.
- New: `sectionId: uuid | null` on every block, default `null`.
- New block kind `choice` ("pick one"): 2–5 exercises, each a normal exercise with its own sets (all the usual set
  rules apply: warm-ups, drops, tracking-type fields). Unlike a superset there is **no** equal-rounds rule.
- Rules (zod, with the server mirroring the simple ones):
  - every `sectionId` is one of `sections[].id`;
  - blocks with no section may only come **before** the first section (that is where a coach's exercises sit if they
    add a section later);
  - each section's blocks are contiguous and the runs appear in `sections` order;
  - every section has at least one block ("Add an exercise to {name} or remove the section.").
- Database: two new nullable columns on `workout_blocks`: `section_id uuid`, `section_name text` (both null or both
  set; 1–40 characters). No new table, so no new RLS policy. Section names are repeated on each block of the section;
  on read, `sections` is rebuilt from the blocks in order of first appearance. That round trip is lossless because a
  section is never empty.
- `block_kind` enum gains `'choice'` (its own migration, because Postgres cannot use a new enum value in the
  transaction that adds it).

### Started log (`WorkoutLogDoc`, `packages/shared/src/logs/schema.ts`)

- The log gets the same `sections` (default `[]`) and `sectionId` per block (default `null`), copied from the plan by
  `startLogFromWorkout`.
- A `choice` block is copied into the log **with every option** (each with its `plannedWorkoutExerciseId`), so the
  client can pick and switch offline.
- New `pickedExerciseId: uuid | null` on log blocks (default `null`): the id of the picked option's **log exercise**.
  Only a `choice` block may have one, and it must be one of that block's exercises.
- Rule: in a choice block **only the picked option may have done sets.** So volume, personal bests, set counts,
  stickers, `last_results` and the server's auto-finish (which all look only at done sets) automatically ignore the
  other options without any change.
- **The pick is "locked" once the picked option has a done set** (derived, not stored). Unticking that set unlocks it
  again. While unlocked the client may switch to another option or go back to the cards.
- Logs are less strict than plans: sections may become empty (the client removed exercises) and an exercise the
  client adds gets `sectionId = null` and shows at the end without a heading.
- Database: `log_blocks` gets `section_id uuid`, `section_name text`, `picked_exercise_id uuid` (no foreign key, like
  `planned_workout_exercise_id`, so an offline save never fails on it; `save_workout_log` checks it belongs to the
  block).
- **Offline:** the pick is just a field in the log document, so it is stored on the phone and uploaded by the existing
  offline-lite sync (`log-store.ts` / `log-sync.ts`, whole-doc `save_workout_log`) with no change to the sync engine.
  Logs already saved on a phone before the update load fine because the new fields have zod defaults.

### Copies

`copy_workout` (used by "assign program" and "schedule workout") copies `kind`, `section_id` and `section_name`.
Section ids are reused in the copy; they only need to be unique within one workout.

## Behaviour

### Builder (web, `apps/web/src/components/workout-builder/`)

- Add row: "+ Exercise", "+ Superset / circuit", "+ Pick one", "+ Section".
- **+ Section** opens a small menu: Warm-Up, Core, Main, Finisher, Cool-down, and "Custom…" (a text box, 40 characters).
  The section is added at the end; every exercise added afterwards goes into the **last** section.
- A section shows as a heading row above its blocks with: rename (inline text box), move up / move down (moves the
  section with all its blocks), remove (its blocks join the section above, or become unsectioned if it was the first).
- A block's existing ↑ / ↓ move it within its own section only. A block menu "Move to section…" lists the other
  sections (and "No section" when it would be valid, that is for the top) and puts the block at the end of the chosen
  section.
- **+ Pick one** opens the exercise picker in multi-select (2–5). The group shows as "Pick one · {n} options"; each
  option is edited like a straight exercise (its own sets, + Set, drops, Swap, note). "+ Add option" (up to 5).
  Removing an option when only two are left turns the group into a normal straight exercise (like a superset does).
- Errors: "A pick-one group needs 2 to 5 exercises.", "Name the section.", "Keep section names to 40 characters.",
  "Use at most 10 sections.", "Add an exercise to {name} or remove the section.", "Keep each section's exercises
  together." (the last cannot happen through the builder; it guards bad data).

### Phone logging screen (on top of the logging redesign)

- **Section line** above the exercise name: "{Section name} · {n} of {m}" where n / m is the page's position among the
  pages of its section. Pages without a section show no line. Workouts without sections look exactly as today.
- **Progress strip:** one segment per page as today, with a small gap where the section changes.
- **"2 of 5" pill and exercise list:** the pill still counts all pages. The list shows each section's name as a heading
  above its rows; unsectioned rows have no heading.
- **Pick-one page, nothing picked:** heading "{Section} · pick one" (or "Pick one" with no section), the line "Tap the
  one you want to do. You can switch until you finish your first set.", then one card per option: photo (existing
  cached exercise thumb), name, plan ("3 × 12 reps · 15 lb", the existing `planSummary`). No Done button. Tapping a card
  picks it.
- **Pick-one page, picked:** exactly a straight exercise page for the picked option, with the line "Picked from {n}
  options · Switch" under the name. **Switch** (44 pt) returns to the cards; it is hidden once the pick is locked.
- Progress: an unpicked pick-one page is to-do; it is done when the picked option's sets are all done. List row:
  unpicked "Pick one: Medicine Ball Slam or Farmer's Walk" · "Not picked yet"; picked: the option's name · "2 of 3
  sets". Up next: "Pick one · Medicine Ball Slam or Farmer's Walk".
- **Finish question:** "N sets not done" counts only the picked option; an unpicked group counts as its first option's
  working sets (it is genuinely not done yet).
- Edit sets / Note / Swap act on the picked option only. Removing the picked exercise in Edit sets removes the whole
  pick-one group from this log. "Add exercise" never adds to a pick-one group.
- **Workout preview** (`workout/[id]`): section headings, and a pick-one group shown as "Pick one" with its options
  joined by "or".

### Coach views (web)

- The workout page opened from the client calendar is the builder, so it shows sections and pick-one groups as above.
  Calendar day cells do not change.
- Workout log page: section headings between exercises. A pick-one group shows only the picked exercise's table with
  the chip "Picked: {name}". If nothing was picked: the line "Pick one · not done" and the option names, muted; none of
  the options' sets is listed as "Not done".
- Coach home "Missed 2+" and adherence are workout-level (a planned workout with no completed log); unpicked options
  cannot affect them. No change needed there.

## Backward compatibility

- Zod defaults (`sections: []`, `sectionId: null`, `pickedExerciseId: null`) make every existing workout, log and
  stored phone log valid unchanged. New columns are nullable; existing rows read as "no sections".
- An older phone build receiving a workout with a pick-one group would treat it as a straight block and show every
  option. We are pre-launch, so web and phone ship together; no feature flag.
- The server treats a missing `sectionId` / `pickedExerciseId` key as null.

## Out of scope

Pick-one groups inside supersets; nested sections; per-section rest or timers; a client choosing more than one option;
section templates or reordering sections on the phone; sections on the iPad coach logging (3b, later).

## Testing

- Shared (Vitest, TDD): schema rules, doc-ops, start-from-plan, tree mappers, choice flow / ops / set counts, volume
  ignoring unpicked options, section grouping.
- Database (pgTAP): `save_workout` round trip and guards, `copy_workout` copies sections and choice, `save_workout_log`
  writes the pick and refuses bad picks or done sets on unpicked options. No new tables or policies, so no new RLS
  tests.
- Web e2e (Playwright): `workouts.spec.ts` (build the Upper / Core workout), `logs.spec.ts` ("Picked: …", headings, no
  "Not done" for options), `calendar.spec.ts` (headings on a scheduled copy).
- Phone: view-model unit tests; new Maestro flow `log-sections.yaml`; existing `log-workout.yaml` must pass unchanged
  (the "no sections" regression).
