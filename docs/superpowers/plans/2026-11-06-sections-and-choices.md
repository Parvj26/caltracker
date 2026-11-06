# Workout Sections and "Pick One" Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let coaches split a workout into named sections and add "pick one" groups of 2–5 exercises, and show both
on the builder, the coach's log page, the phone's workout preview and the new one-exercise logging screen, where the
client picks one option (switchable until its first set is done) and only that option counts.

**Architecture:**
- Plans: `sections: [{id, name}]` on `WorkoutDoc` + `sectionId` per block; new block kind `choice`. Stored as two
  nullable columns on `workout_blocks` (`section_id`, `section_name`); sections are rebuilt from blocks on read.
- Logs: same `sections` / `sectionId`; a `choice` block carries all options plus `pickedExerciseId` (a log exercise
  id). Only the picked option may have done sets, so volume, PRs, stickers, set counts and auto-finish need no change.
  The pick travels in the log document through the existing offline-lite sync.
- All rules are pure functions in `packages/shared` (TDD); the apps only lay them out.

**Tech Stack:** TypeScript strict, zod, Vitest, Postgres/pgTAP (Supabase), Next.js (web builder and coach pages),
Playwright, Expo / React Native, Maestro.

**Spec:** `docs/superpowers/specs/2026-11-06-sections-and-choices-design.md` (read it first; its copy and rules are
binding).

**Branch:** `feature/sections-and-choices`, created from `feature/logging-redesign` (the phone tasks build on its
`log-page-model.ts`, `flow.ts` and components). If `feature/logging-redesign` merges first, rebase onto `main`.
If `feature/stickers` merges first, check its PR logic (`awards/prs.ts`) only reads done sets (it does today) and add
the Task 4 "unpicked options give no PR" test there.

**Shared resources:** Tasks 1–4 and 8 need no database or simulator. Task 5 needs local Supabase. Tasks 6–7 need
local Supabase + Playwright. Task 10 needs lane A (local Supabase + iOS simulator + Maestro), one session.

## Global Constraints

- Section presets, exactly: `Warm-Up`, `Core`, `Main`, `Finisher`, `Cool-down`; plus `Custom…`. Section name trimmed,
  1–40 characters; at most 10 sections per workout.
- Pick-one group: 2–5 exercises, each with its own sets; no equal-rounds rule; not allowed inside a superset.
- Copy, exactly: "+ Section", "+ Pick one", "Pick one · {n} options", "+ Add option", "Move to section…",
  "No section", "{Section} · pick one" / "Pick one", "Tap the one you want to do. You can switch until you finish your
  first set.", "Picked from {n} options", "Switch", "Picked: {name}", "Pick one · not done", "Not picked yet",
  "Pick one: {A} or {B}" (three or more: "{A}, {B} or {C}"), section line "{Section} · {n} of {m}".
- Errors, exactly: "A pick-one group needs 2 to 5 exercises.", "Name the section.", "Keep section names to 40
  characters.", "Use at most 10 sections.", "Add an exercise to {name} or remove the section.", "Keep each section's
  exercises together.", "Unknown section.", "Each section needs its own id.", "Only the picked option can have done sets.", "The pick must be one of
  the group's exercises.", "Only a pick-one group can have a pick."
- Backward compatibility: `sections` defaults to `[]`, `sectionId` and `pickedExerciseId` default to `null` in zod
  and are treated as null when absent in SQL. A workout or log with no sections must render exactly as today.
- Volume, PR, streak, set-count and unit rules stay only in `packages/shared` (CLAUDE.md). The apps never re-check
  "is this option picked" themselves; they call the shared helpers from Task 4.
- Migrations: `20261106000900_choice_block_kind.sql` (only `alter type public.block_kind add value 'choice'`), then
  `20261106001000_sections_and_choices.sql` (everything else). Two files because Postgres cannot use a new enum value
  in the transaction that adds it. After them: `pnpm db:reset`, re-import exercises
  (`eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"; SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm import:exercises`),
  `pnpm db:types`.
- Phone: tap targets ≥ 44 pt (`tapTarget.min`), colours and sizes only from `@/theme`. No changes to `log-store.ts` or
  `log-sync.ts`.
- Each task ends with `pnpm check` (typecheck + lint + all tests) green, output shown; database tasks also
  `pnpm db:test`.

## Review Focus

1. **Old data on a new build** — a log saved on the phone before the update (no `sections`, no `pickedExerciseId`)
   and a workout saved before the migration must load, log and save unchanged. Test: Task 3
   (`parses a pre-sections log`) and Task 5 (`save_workout_log without the new keys`).
2. **Switching after a set, then unticking it** — the pick locks after the first done set and unlocks if that set is
   unticked; `pickChoice` to another option while locked is refused and never moves done sets. Test: Task 4.
3. **Finish with an unpicked group** — "N sets not done" counts the group once (its first option), never every
   option; finishing with the group unpicked is allowed when other sets are done, and the coach page shows "Pick one ·
   not done" without "Not done" rows. Test: Task 4 (`openSetCount`) and Task 7 (e2e).
4. **Coach edits the plan around sections** — removing the first section, moving a section, moving a block into
   another section, removing a pick-one option down to one: the doc stays valid (contiguous runs, no empty section
   created by an op except the section the coach just added). Test: Task 2.
5. **Client edits the log** — removing the picked exercise removes the whole group; adding an exercise puts it at the
   end with no section; completing a set of an unpicked option (stale UI) is refused. Test: Task 4.

---

### Task 1: Shared schema for sections and pick-one groups

**Files:**
- Create: `packages/shared/src/workouts/sections.ts`
- Modify: `packages/shared/src/workouts/schema.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/workouts/schema.test.ts`, `packages/shared/test/workouts/sections.test.ts` (create)

**Interfaces:**
- Produces:
  - `BLOCK_KINDS = ['straight', 'superset', 'choice'] as const`
  - `WorkoutSectionDoc = z.object({ id: z.uuid(), name: z.string().trim().min(1, 'Name the section.').max(40, 'Keep section names to 40 characters.') })`, type `WorkoutSectionDoc`
  - `WorkoutBlockDoc` gains `sectionId: z.uuid().nullable().default(null)`; `WorkoutDoc` gains
    `sections: z.array(WorkoutSectionDoc).max(10, 'Use at most 10 sections.').default([])`
  - `MIN_CHOICE_OPTIONS = 2`, `MAX_CHOICE_OPTIONS = 5`, `SECTION_PRESETS = ['Warm-Up', 'Core', 'Main', 'Finisher', 'Cool-down'] as const`
  - `type SectionRun = { section: { id: string; name: string } | null; blockIndexes: number[] }`
  - `sectionRuns(blocks: ReadonlyArray<{ sectionId: string | null }>, sections: ReadonlyArray<{ id: string; name: string }>): SectionRun[]` — consecutive blocks with the same `sectionId` form one run; unknown ids are treated as null
  - `sectionPlace(blocks, sections, blockIndex: number): { name: string; at: number; of: number } | null` — 1-based position inside its run; null for an unsectioned block

- [ ] **Step 1: Write failing tests**
  - `sections.test.ts`: `sectionRuns` on the spec's Upper / Core shape (6 blocks, 4 sections) returns 4 runs with
    blockIndexes `[0]`, `[1]`, `[2,3,4]`, `[5]`; with no sections returns one run `{ section: null, blockIndexes: [0..n-1] }`;
    with `[]` blocks returns `[]`. `sectionPlace(…, 3)` → `{ name: 'Resistance Training', at: 2, of: 3 }`;
    unsectioned block → `null`.
  - `schema.test.ts`: a doc without `sections`/`sectionId` keys parses with `sections: []` and every `sectionId: null`;
    the Upper / Core doc parses; choice with 1 and with 6 exercises → "A pick-one group needs 2 to 5 exercises."; a
    choice whose options have different set counts parses; unknown sectionId → "Unknown section."; an unsectioned block
    after a sectioned one, or a section split in two runs, or runs out of `sections` order → "Keep each section's
    exercises together."; a section with no block → "Add an exercise to Core or remove the section." at
    `['sections', i]`; name "   " → "Name the section."; 41 chars → "Keep section names to 40 characters."; 11 sections
    → "Use at most 10 sections."; two sections with the same id → "Each section needs its own id."
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test -- workouts` — Expected: FAIL.
- [ ] **Step 3: Implement** the schema additions in `superRefine` (choice count check sits next to the superset
  checks; section checks after the block loop, using `sectionRuns`) and `sections.ts`. Keep the existing `.transform`
  passing `sections` and `sectionId` through. Export the new names from `index.ts`.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `pnpm check`.
- [ ] **Step 5: Commit** `feat(shared): add workout sections and pick-one groups to the workout schema`

### Task 2: Builder doc-ops for sections and pick-one groups

**Files:**
- Modify: `packages/shared/src/workouts/doc-ops.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/workouts/doc-ops.test.ts`

**Interfaces:**
- Consumes: Task 1 types and `sectionRuns`.
- Produces (all return the same object when refused):
  - `addSection(doc, name: string, makeId): WorkoutDoc` — appends; refused at 10 sections
  - `renameSection(doc, sectionId, name: string): WorkoutDoc`
  - `removeSection(doc, sectionId): WorkoutDoc` — its blocks take the previous section's id (or null if it was first)
  - `moveSection(doc, sectionId, delta: -1 | 1): WorkoutDoc` — swaps with the neighbour section, moving both runs of blocks
  - `moveBlockToSection(doc, blockId, sectionId: string | null): WorkoutDoc` — puts the block at the end of that
    section's run (null: at the end of the unsectioned run at the top, which always comes before the first section)
  - `addChoice(doc, exs: ExercisePick[], makeId): WorkoutDoc` — refused unless 2–5 exercises; each option gets 3
    normal sets like `addStraightBlock`
  - `addChoiceOption(doc, blockId, ex: ExercisePick, makeId): WorkoutDoc` — refused at 5 or for non-choice blocks
  - existing `addStraightBlock`, `addSuperset`, `addChoice` set `sectionId` to the **last** section's id (null if none)
  - existing `moveBlock(doc, blockId, toIndex)` clamps `toIndex` to the block's own run
  - existing `removeExercise` on a choice with two options turns it into `kind: 'straight'`
  - existing `addRound` / `removeRound` refuse choice blocks

- [ ] **Step 1: Write failing tests**, one per op above, plus: after any sequence of `addSection` + adds, the doc
  parses with `WorkoutDoc` (once every section has a block); `removeSection` on the first section leaves its blocks
  unsectioned at the top and the doc valid; `moveSection(+1)` on Core in the Upper / Core doc gives section order
  Warm-Up, Resistance Training, Core, Finisher with block order matching; `moveBlock` cannot push a block across a
  section heading; removing one of two options yields a straight block that keeps the other option's sets.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test -- doc-ops` — Expected: FAIL.
- [ ] **Step 3: Implement** the ops in `doc-ops.ts`.
- [ ] **Step 4: Run** — Expected: PASS. `pnpm check`.
- [ ] **Step 5: Commit** `feat(shared): add builder operations for sections and pick-one groups`

### Task 3: Log schema, start-from-plan and tree mappers

**Files:**
- Modify: `packages/shared/src/logs/schema.ts`, `packages/shared/src/logs/start.ts`, `packages/shared/src/logs/tree.ts`,
  `packages/shared/src/workouts/tree.ts`
- Test: `packages/shared/test/logs/schema.test.ts`, `packages/shared/test/logs/start.test.ts`,
  `packages/shared/test/workouts/tree.test.ts`, `packages/shared/test/logs/tree.test.ts` (create if absent)

**Interfaces:**
- Consumes: Task 1 `WorkoutSectionDoc`, `BLOCK_KINDS`.
- Produces:
  - `LogBlockDoc` gains `sectionId: z.uuid().nullable().default(null)`, `pickedExerciseId: z.uuid().nullable().default(null)`
  - `WorkoutLogDoc` gains `sections: z.array(WorkoutSectionDoc).max(10).default([])`
  - log rules: unknown sectionId → "Unknown section."; pick on a non-choice → "Only a pick-one group can have a
    pick."; pick not in the block → "The pick must be one of the group's exercises."; a done set in an unpicked
    option → "Only the picked option can have done sets."; choice with < 2 exercises → "A pick-one group needs 2 to 5
    exercises." (no contiguity or non-empty rules for logs)
  - `startLogFromWorkout` copies `sections`, each block's `sectionId`, `kind`, and sets `pickedExerciseId: null`
  - `WORKOUT_TREE_SELECT` / `WorkoutTreeRow` add `section_id, section_name` on `workout_blocks`;
    `LOG_TREE_SELECT` / `LogTreeRow` add `section_id, section_name, picked_exercise_id` on `log_blocks`
  - `workoutRowToDoc` / `logRowToDoc` rebuild `sections` in order of first appearance (one entry per distinct id;
    name from the first block seen)

- [ ] **Step 1: Write failing tests**: `parses a pre-sections log` (a stored-log JSON fixture with none of the new keys
  → defaults); each new log error above; `startLogFromWorkout` on the Upper / Core doc gives 6 blocks, the choice
  block with 2 exercises (each `plannedWorkoutExerciseId` = the option's plan id) and `pickedExerciseId: null`, and
  identical `sections`; tree mappers round-trip sections and the pick, and rows with null section columns give
  `sections: []`.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test -- logs tree` — Expected: FAIL.
- [ ] **Step 3: Implement.** Share one small helper `sectionsFromBlocks(blocks: Array<{ section_id: string | null; section_name: string | null }>)` in `workouts/sections.ts` for both mappers.
- [ ] **Step 4: Run** — Expected: PASS. `pnpm check` (the mobile and web typecheck will flag places that build
  `LogBlockDoc` / `WorkoutBlockDoc` literals: add `sectionId: null` (and `pickedExerciseId: null`) there, nothing more).
- [ ] **Step 5: Commit** `feat(shared): carry sections and the pick through logs and the workout tree`

### Task 4: Choice rules for logging (flow, ops, counts)

**Files:**
- Modify: `packages/shared/src/logs/flow.ts`, `packages/shared/src/logs/ops.ts`, `packages/shared/src/logs/summary.ts`,
  `packages/shared/src/index.ts`
- Test: `packages/shared/test/logs/flow.test.ts`, `packages/shared/test/logs/ops.test.ts`,
  `packages/shared/test/logs/summary.test.ts` (create if absent)

**Interfaces:**
- Consumes: Task 3 types.
- Produces:
  - `needsPick(block: LogBlockDoc): boolean` — choice with `pickedExerciseId === null`
  - `liveExercises(block): Array<{ exercise: LogExerciseDoc; exerciseIndex: number }>` — for choice: the picked one (or
    none); otherwise all, with their original indexes
  - `isChoiceLocked(block): boolean` — choice whose picked option has a done set
  - `blockSteps`, `currentStep`, `roundRestSeconds`, `blockRoundCount` use only live exercises (exerciseIndex stays the
    index in `block.exercises`); a choice behaves like a straight block
  - `isBlockDone(block)`: false while `needsPick`; otherwise every live set done
  - `afterDone`: an unpicked choice anywhere counts as open work (so "Done · last set" never shows while a group is
    unpicked); unpicked options' sets never count
  - `pickChoice(log, blockId, logExerciseId: string | null, nowIso): WorkoutLogDoc` — sets or clears the pick; refused
    when the block is not a choice, the id is not one of its exercises, or the block is locked and the id differs from
    the current pick
  - `completeSet` / `completeSetWith` / `toggleSet` refuse (same object) a set of an unpicked option
  - `removeLogExercise` on any exercise of a choice block removes the whole block
  - `addLogExercise` adds a block with `sectionId: null`, `pickedExerciseId: null`
  - `openSetCount(log): number` — live sets not done, plus, for each unpicked group, its first option's normal sets
  - `completedSetCount`, `logVolumeKg`, `autoFinish` unchanged (tests only)

- [ ] **Step 1: Write failing tests**: each item above; Review Focus 2 sequence (pick A, complete A's set 1, `pickChoice`
  B refused, uncomplete A's set 1, `pickChoice` B accepted, A keeps no done sets); `pickChoice(null)` when unlocked
  returns to `needsPick`; Upper / Core log with the finisher unpicked: `afterDone` on the last Resistance set is not
  `last`, `openSetCount` counts 3 for the finisher; `logVolumeKg` of a log whose picked option is Medicine Ball Slam
  (3 × 12 × 15 lb done) equals that option's volume only; `completeSet` on Farmer's Walk's set while Slam is picked
  returns the same object.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test -- logs` — Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the body-level `block.exercises` walks in `flow.ts` with `liveExercises`.
- [ ] **Step 4: Run** — Expected: PASS. `pnpm check`.
- [ ] **Step 5: Commit** `feat(shared): pick one option in a log and count only the picked one`

### Task 5: Database

**Files:**
- Create: `supabase/migrations/20261106000900_choice_block_kind.sql`,
  `supabase/migrations/20261106001000_sections_and_choices.sql`
- Modify: `supabase/tests/save_workout.test.sql`, `supabase/tests/assignments.test.sql`,
  `supabase/tests/log_functions.test.sql`, `supabase/tests/service_role_grants.test.sql` (only if it lists
  `workout_blocks` column grants), `packages/shared/src/database.types.ts` (generated)

**Interfaces:**
- Consumes: the doc shapes from Tasks 1 and 3 (JSON keys `sections`, `sectionId`, `pickedExerciseId`).
- Produces (second migration):
  - `workout_blocks`: `section_id uuid`, `section_name text check (char_length(btrim(section_name)) between 1 and 40)`,
    `check ((section_id is null) = (section_name is null))`; grant insert/update `(section_id, section_name)` to
    `authenticated` (`save_workout` is security invoker)
  - `log_blocks`: same two columns + `picked_exercise_id uuid` (no foreign key),
    `check (picked_exercise_id is null or kind = 'choice')`
  - `create or replace` of `save_workout(uuid, jsonb)`: choice guard "A pick-one group needs 2 to 5 exercises.";
    `sectionId` must be an id in `p_doc -> 'sections'` ("Unknown section."); writes `section_id`, `section_name` (the
    trimmed name from `sections`); the "only rewrite when changed" comparison includes both columns
  - `create or replace` of `copy_workout(...)`: copies `section_id`, `section_name` with `kind`
  - `create or replace` of `save_workout_log(jsonb)`: choice guard (2–5); pick guards with the Task 3 messages
    (errcode `23514`); unknown `sectionId` guard; writes the three columns, all compared in the upsert's
    `is distinct from`; a missing key is null
  - copy each function from its latest definition (`20261105000200`, `20261105000400`, `20261105000800`) and change
    only the lines above; keep grants/revokes as they were

- [ ] **Step 1: Write failing pgTAP tests**: `save_workout` round-trips the Upper / Core doc (section names per block,
  kind `choice`); refuses a 1-option choice and an unknown section; `copy_workout` / `assign_program` copies carry
  `section_id`, `section_name` and `choice`; `save_workout_log` stores a pick, refuses a pick on a straight block, a
  pick outside the block and a done set on an unpicked option; `save_workout_log without the new keys` still saves a
  plain log.
- [ ] **Step 2: Run** `pnpm db:test` — Expected: FAIL.
- [ ] **Step 3: Write the migrations.**
- [ ] **Step 4: Run** `pnpm db:reset`, re-import exercises, `pnpm db:test`, `pnpm db:types`, `pnpm check` —
  Expected: all PASS; `database.types.ts` shows `block_kind: 'straight' | 'superset' | 'choice'` and the new columns.
- [ ] **Step 5: Commit** `feat(db): store sections and pick-one groups on workouts and logs`

### Task 6: Web builder

**Files:**
- Create: `apps/web/src/components/workout-builder/section-header.tsx`,
  `apps/web/src/components/workout-builder/add-section-menu.tsx`
- Modify: `apps/web/src/components/workout-builder/workout-builder.tsx`, `block-editor.tsx`, `builder.module.css`
- Test: `apps/web/e2e/workouts.spec.ts`, `apps/web/e2e/helpers.ts` (add `addSection(page, name)`)

**Interfaces:**
- Consumes: Task 2 ops, Task 1 `sectionRuns`, `SECTION_PRESETS`.
- Produces: builder UI per the spec's Builder section. `BlockActions` gains `onMoveToSection(sectionId: string | null)`,
  `onAddOption()`. Picker state gains `{ kind: 'choice' }` (multi-select, title "Add a pick-one group") and
  `{ kind: 'addOption'; blockId }`. The block list renders `sectionRuns(doc.blocks, doc.sections)`, with a
  `SectionHeader` (rename text box labelled "Section name", "Move {name} up/down", "Remove {name}") before each named
  run; sections with no blocks yet render as a header with the caption "No exercises yet." Inline errors keyed
  `section:<id>`.

- [ ] **Step 1: Write the failing e2e** `builds the Upper / Core workout with sections and a pick-one finisher`:
  create a workout, add the 4 sections (Warm-Up and Finisher from presets, "Core (Activation)" and "Resistance
  Training" via Custom…), add the spec's blocks, add a Pick one with Medicine Ball Slam + Farmer's Walk, save, reload:
  headings appear in order, "Pick one · 2 options" is under Finisher. Second test: saving with an empty section shows
  "Add an exercise to Main or remove the section." Third: a workout with no sections looks as before (existing tests
  keep passing unchanged).
- [ ] **Step 2: Run** `CI=1 pnpm test:e2e -- workouts.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the components.
- [ ] **Step 4: Run** the e2e and `pnpm check` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add sections and pick-one groups to the workout builder`

### Task 7: Coach log page and calendar

**Files:**
- Modify: `apps/web/src/app/(coach)/clients/[clientId]/logs/[logId]/planned-vs-actual.tsx`, `log.module.css`
- Test: `apps/web/e2e/logs.spec.ts`, `apps/web/e2e/calendar.spec.ts`, `apps/web/e2e/helpers.ts` (`seedLog` accepts
  `sections` and blocks with `sectionId`, `kind: 'choice'`, `pickedExerciseId`)

**Interfaces:**
- Consumes: Task 1 `sectionRuns`, Task 4 `liveExercises`, `needsPick`.
- Produces: `PlannedVsActual` renders runs with an `<h2>` per named section; a choice block renders only
  `liveExercises` with the chip "Picked: {name}", or, when `needsPick`, the line "Pick one · not done" and the
  option names in muted text (no table, no "Not done" rows). Correction mode only edits live exercises.

- [ ] **Step 1: Write the failing e2e**: `logs.spec.ts` — a seeded completed Upper / Core log with Slam picked shows
  the 4 headings, "Picked: Medicine Ball Slam", and no "Farmer's Walk" table or "Not done" row for it; a log with the
  finisher unpicked shows "Pick one · not done". `calendar.spec.ts` — a scheduled copy of a sectioned workout opened
  from the calendar shows the section headings.
- [ ] **Step 2: Run** `CI=1 pnpm test:e2e -- logs.spec.ts calendar.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the e2e and `pnpm check` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): show sections and the picked option on the coach's log page`

### Task 8: Phone view models

**Files:**
- Modify: `apps/mobile/src/lib/log-page-model.ts`, `apps/mobile/src/lib/workouts.ts`,
  `apps/mobile/src/lib/active-log-logic.ts`
- Test: `apps/mobile/src/lib/log-page-model.test.ts`, `apps/mobile/src/lib/workouts.test.ts`,
  `apps/mobile/src/lib/active-log.test.ts`, `apps/mobile/src/lib/log-fixtures.ts` (add `upperCoreLog()`)

**Interfaces:**
- Consumes: Tasks 1, 4 (`sectionPlace`, `sectionRuns`, `needsPick`, `liveExercises`, `isChoiceLocked`,
  `openSetCount`, `planSummary`).
- Produces:
  - `PageModel.kind: 'straight' | 'superset' | 'choice'`; `PageModel.section: { name: string; at: number; of: number } | null`
  - `PageModel.choice: null | { heading: string; options: Array<{ logExerciseId: string; exerciseId: string; name: string; plan: string | null }>; picked: boolean; canSwitch: boolean; pickedLine: string | null }`
    — `heading` "{Section} · pick one" or "Pick one"; `pickedLine` "Picked from {n} options" when picked
  - when a choice is picked, `exercises`, `steps` and `current` describe only the picked option (as a straight page);
    when unpicked, `current` is null, `steps` empty, `allDone` false
  - `progressGroups(log, pageIndex): Progress[][]` (one array per section run)
  - `listSections(log): Array<{ heading: string | null; rows: Array<{ pageIndex: number; title: string; detail: string; done: boolean }> }>`
    replacing `listRows`; choice rows per the spec ("Pick one: A or B" · "Not picked yet", or the picked name ·
    "{n} of {m} sets")
  - `upNext` for an unpicked choice: "Pick one · A or B"; `firstOpenPage` uses `!isBlockDone`
  - `supersetLetters` accepts `kind: 'straight' | 'superset' | 'choice'`
  - `finishPrompt` counts with shared `openSetCount` (delete the local `setCount`)

- [ ] **Step 1: Write failing tests** for each item, using `upperCoreLog()`: page 1 section `{ name: 'Core (Activation)', at: 1, of: 1 }`,
  page 3 `{ name: 'Resistance Training', at: 2, of: 3 }`; `progressGroups` lengths `[1,1,3,1]`; `listSections` has
  4 headings; finisher page unpicked → choice model with 2 options and `canSwitch` true; after `pickChoice` Slam →
  straight-like page for Slam with `pickedLine` "Picked from 2 options"; after a done set `canSwitch` false; a log
  with no sections gives `section: null`, one group in `progressGroups`, one `heading: null` section in `listSections`
  (the regression); `finishPrompt` with finisher unpicked and all else done → `{ kind: 'unticked', count: 3 }`.
- [ ] **Step 2: Run** `pnpm --filter mobile test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS. `pnpm check`.
- [ ] **Step 5: Commit** `feat(mobile): describe sections and pick-one pages in the logging view model`

### Task 9: Phone screens

**Files:**
- Create: `apps/mobile/src/components/log/choice-page.tsx`
- Modify: `apps/mobile/src/components/log/progress-strip.tsx` (gaps between groups), `exercise-list-sheet.tsx`
  (headings), `exercise-header.tsx` (section line and "Picked from … · Switch"), `apps/mobile/src/app/(app)/log/[id]/index.tsx`
  (render `ChoicePage` when `model.choice && !model.choice.picked`; wire `pickChoice` through `applyEdit`),
  `apps/mobile/src/app/(app)/workout/[id].tsx` (section headings; pick-one shown as "Pick one" with options joined
  by "or")

**Interfaces:**
- Consumes: Task 8 models; Task 4 `pickChoice`; existing `ExerciseThumb`, `applyEdit`.
- Produces: `ChoicePage({ model: NonNullable<PageModel['choice']>, onPick: (logExerciseId: string) => void })`, each
  card a 44 pt+ pressable with accessibility label "{name}, {plan}" and testID `choice-option-{index}`; Switch has
  testID `choice-switch`; section line testID `section-line`.

- [ ] **Step 1: Implement** the components (no new logic: everything comes from the model).
- [ ] **Step 2: Run** `pnpm check` (includes the `no-raw-colours` test) — Expected: PASS.
- [ ] **Step 3: Check on the simulator** with a seeded Upper / Core workout (Task 10's helper) that pages, gaps,
  list headings, cards, pick, switch and lock look right; screenshot for the PR.
- [ ] **Step 4: Commit** `feat(mobile): show sections and pick-one cards while logging`

### Task 10: Maestro, e2e helper and final check (lane A, one session)

**Files:**
- Modify: `apps/mobile/scripts/e2e-helper.ts` (action `assign-today-sections`: assigns today the spec's Upper / Core
  workout, exercises looked up by exact built-in name; where a name is missing from the built-in library, use the
  closest built-in exercise and note the swap in a comment), `apps/mobile/.maestro/helpers/call.js` (document it)
- Create: `apps/mobile/.maestro/log-sections.yaml`
- Unchanged but must pass: `log-workout.yaml`, `log-resume.yaml`, `log-unplanned.yaml`, `log-delete-set.yaml`,
  `log-flow.yaml` (from the logging redesign), `calendar.yaml`

- [ ] **Step 1: Write `log-sections.yaml`**: assign → open the workout preview, see "Warm-Up" and "Pick one" → Start →
  see "Warm-Up · 1 of 1" → open the list, see "Core (Activation)" and "Finisher" headings → jump to the finisher →
  see "Finisher · pick one" → tap Medicine Ball Slam → see "Picked from 2 options" → Switch → tap Farmer's Walk → Switch
  → tap Medicine Ball Slam → Done once → Switch is gone → Finish (accept "sets not done") → summary shows → cleanup.
- [ ] **Step 2: Run** `pnpm --filter mobile e2e .maestro/log-sections.yaml .maestro/log-workout.yaml .maestro/log-flow.yaml`
  — Expected: PASS.
- [ ] **Step 3: Full check:** `pnpm check && pnpm db:reset && <re-import exercises> && pnpm db:test && pnpm db:types && git diff --exit-code packages/shared/src/database.types.ts && CI=1 pnpm test:e2e && pnpm --filter mobile e2e`
  — Expected: all PASS; show the output.
- [ ] **Step 4: Commit** `test(mobile): log a workout with sections and a pick-one finisher end to end`

## Self-review

- Spec coverage: builder (T2, T6); phone section line, gaps, grouped list, cards, switch/lock, preview (T8, T9);
  coach calendar and log page (T6, T7); only picked counts (T4); not missed (workout-level, unaffected; T4 counts);
  offline pick (T3 doc field, no sync change); back-compat (T1, T3, T5); real example end to end (T6, T7, T10).
- Names: `sectionRuns`, `sectionPlace`, `needsPick`, `liveExercises`, `isChoiceLocked`, `pickChoice`, `openSetCount`,
  `progressGroups`, `listSections` used consistently from definition onwards.
