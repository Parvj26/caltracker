# Logging Redesign ("One Exercise at a Time") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the phone's list-style logging screen with one exercise page at a time: big steppers, a Done button
that says what happens next, a rest ring, supersets and drop sets as steps, and a pre-fill that carries the client's
weight changes forward, while keeping offline saving, sync, auto-finish, Resume and the summary untouched.

**Architecture:**
- All rules are pure functions in `packages/shared/src/logs/`: pre-fill (`prefill.ts`), step order and next step
  (`flow.ts`), stepper maths and display text (`steppers.ts`, `format.ts`), plus two op changes in `ops.ts`/`start.ts`
  and the volume change in `summary.ts`.
- The phone turns a log into per-page view models in one pure, tested file (`apps/mobile/src/lib/log-page-model.ts`).
  Components only render those models; the screen wires them to `useActiveLog`.
- The old list (`LogBlock` / `SetRow` / swipe to delete / ⋯ menu) is reused unchanged inside the new **Edit sets**
  sheet.

**Tech Stack:** TypeScript strict, Vitest, Expo SDK 58 (React Native 0.88, expo-router), `react-native-svg` (new,
via `npx expo install`), Maestro.

**Spec:** `docs/superpowers/specs/2026-11-06-logging-redesign-design.md` (read it first; its tables and copy are
binding).

**Branch:** `feature/logging-redesign` from `main`. Prefer starting after `feature/exercise-search-v2` and
`feature/stickers` have merged (both touch the logging flows). If either merges later, whoever rebases second updates
that branch's Maestro flows (Task 9 lists them).

**Shared resources:**
- Tasks 1–8 need no database and no simulator (Vitest, typecheck, lint only), so they can run while other worktrees
  hold lane A.
- Task 9 needs lane A (local Supabase + the iOS simulator + port-free Maestro). Queue it like the other simulator
  work and run all of its flows in one session.

## Global Constraints

- Pre-fill, step order, Done labels, stepper maths, volume and unit rules live only in `packages/shared` as pure
  functions with unit tests (CLAUDE.md). The phone never re-implements them.
- Done label copy, exactly: `Done · straight to drop {n}`, `Done · straight to {A2}`, `Done round {r} · rest {clock}`,
  `Done round {r}`, `Done · start rest {clock}`, `Done · next set`, `Done · next exercise`, `Done · last set`;
  `{clock}` is `formatClock(seconds)` ("1:30", "0:45").
- Other copy: "Set {n} of {m}", "Warm-up {n} of {m}", "Drop {n} of {m}"; "Coach: …"; "Last time: …" (existing
  `formatLastResult`); "Next: {exercise} · {set name in lower case} · {numbers}"; "SUPERSET", "Round {r} of {n}",
  "Rest {clock} after both"; "DROP SET", "No rest between drops", "+ Add another drop"; "All sets done ✓",
  "Next exercise ›", "Finish workout"; "Add your first exercise to start logging."; "Warm-ups don't count towards
  volume or personal bests."; "swipe to move"; "Up next"; "THIS EXERCISE"; "Body".
- Stepper steps: weight 5 lb / 2.5 kg (on the displayed number), reps 1, time 15 s, distance 0.1 mi/km. Floor 0; caps
  1000 kg, 1000 reps, 86,400 s, 1,000,000 m. − on empty stays empty; + on empty gives one step.
- Volume (`logVolumeKg`) counts completed `weight_reps` sets **including drops, excluding warm-ups**.
- Rest: straight = the set's own `restSeconds` (after a drop chain: the chain's main set's); superset round = the
  largest `restSeconds` among that round's main sets; drops never rest; no rest after the workout's last open set.
- Tap targets: ≥ 44 pt everywhere (`tapTarget.min`); Done, stepper − / + and rest buttons ≥ 54 pt
  (`tapTarget.logging`). Colours, sizes and fonts only from `@/theme` (the `no-raw-colours` test enforces colours).
- lb is shown as a whole number via `kgToInput` / `formatWeight` from `@caltracker/shared`.
- No changes to `log-store.ts`, `log-sync.ts`, the database or the web app code (the web changes only through
  `logVolumeKg`).
- The exercise picker is consumed only through its props `{ title, visible, onPick, onClose }`.
- Each task ends with `pnpm check` (typecheck + lint + all tests) green, output shown.

## Review Focus

1. **A set typed into, then Done** — Done must never overwrite a number the client typed a moment earlier, even if the
   screen's pre-fill was stale. Test: Task 2 (`completeSetWith` fills only empty actuals).
2. **Skipping around** — swipe away mid-exercise, tick sets elsewhere, come back: the current set is the first unticked
   one, and carry-forward uses the nearest earlier set *with* a weight (skipped empty sets are passed over). Test:
   Task 1 (`skipped earlier set`) and Task 3 (`currentStep after a skipped set`).
3. **Uneven supersets** — A1 has 3 sets, A2 has 2: round 3 is A1 only, so A1 is the last exercise of round 3 and gets
   the rest. Test: Task 3.
4. **Editing the log mid-page** — removing or adding an exercise, or deleting the current set in Edit sets, while on a
   page: the page index stays in range and the current step is recomputed, no crash. Test: Task 6
   (`pageIndexAfterChange`).
5. **kg users and odd lb values** — 61.25 kg steps to 63.75; a typed 137 lb steps to 142 and back to 137 without
   drifting (stored kg round-trips through whole lb). Test: Task 4.

---

### Task 1: Shared pre-fill rule

**Files:**
- Create: `packages/shared/src/logs/prefill.ts`, `packages/shared/test/logs/prefill.test.ts`
- Modify: `packages/shared/src/index.ts` (export the new names)

**Interfaces:**
- Consumes: `LogExerciseDoc`, `LogSetDoc` (`logs/schema.ts`); `ResultSet` (`logs/format.ts`); `TARGET_FIELDS`
  (`workouts/targets.ts`); `ActualPatch` (`logs/ops.ts`).
- Produces:
  ```ts
  export type SetValues = { reps: number | null; weightKg: number | null; durationS: number | null; distanceM: number | null };
  export const EMPTY_VALUES: SetValues;
  /** The matching set from last time: nth set of the same type, else the last of that type, else null. */
  export function lastTimeFor(sets: readonly LogSetDoc[], setIndex: number, lastTime: readonly ResultSet[]): ResultSet | null;
  /** Spec "Pre-fill" rules 1–7, per field tracked by ex.trackingType; untracked fields are null. Unknown setId → EMPTY_VALUES. */
  export function resolveSetValues(ex: Pick<LogExerciseDoc, 'sets' | 'trackingType'>, setId: string, lastTime: readonly ResultSet[]): SetValues;
  export function valuesToPatch(v: SetValues): ActualPatch; // { actualReps, actualWeightKg, actualDurationS, actualDistanceM }
  ```

- [ ] **Step 1: Write the failing tests** in `prefill.test.ts`. Build exercises directly as `LogExerciseDoc` objects
  with a small local helper `logSet(setType, target, actual?, completed?)`. Cases (kg values):
  - `uses the coach's numbers`: set 1 target 8–10 @ 60 → `{ reps: 10, weightKg: 60, durationS: null, distanceM: null }`.
  - `carries a changed weight forward`: set 1 actual 62.5 (target 60), set 2 target 60 → set 2 weight 62.5, reps 10.
  - `keeps the coach's pyramid`: set 1 target 60 actual 62.5, set 2 target 70 → 70.
  - `blank coach weight carries the earlier set`: targets null, set 1 actual 40 → set 2 weight 40.
  - `blank coach weight uses last time`: targets null, nothing entered, lastTime normal sets 42, 44 → set 1 = 42,
    set 2 = 44, set 3 = 44 (fewer sets last time → last of type).
  - `warm-ups don't carry into working sets`: W actual 20, set 1 target null, lastTime none → set 1 weight null;
    and lastTime warm-up 20 matches the W set, not set 1.
  - `skipped earlier set`: set 1 actual 62.5, set 2 empty and unticked, set 3 target 60 → set 3 = 62.5.
  - `typed value wins`: set 2 actual 55 → 55, whatever set 1 holds.
  - `drop uses coach's drop weight`: main target 60, drop target 40 → drop weight 40.
  - `client-added drop starts at the step above`: main actual 60, drop target null → 60; second drop with null target
    after first drop actual 50 → 50.
  - `reps carry for an unplanned exercise`: targets empty, set 1 actual reps 12 → set 2 reps 12.
  - `untracked fields are null`: `reps` exercise → weightKg null even if a target weight exists.
  - `time exercise`: target durationS 45 → durationS 45, others null.
  - `valuesToPatch` maps names one to one.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared exec vitest run test/logs/prefill.test.ts`. Expected: FAIL
  (module not found).
- [ ] **Step 3: Implement** `prefill.ts`. Rule order exactly as the spec's "Pre-fill" list. "Same type" compares
  `setType`; for drops, "the step above" is the previous set in the array (main or drop) resolved recursively.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `pnpm check`.
- [ ] **Step 5: Commit** `feat(shared): pre-fill each set from the plan, the client's last change, or last time`

### Task 2: Shared ops and the volume rule

**Files:**
- Modify: `packages/shared/src/logs/ops.ts`, `packages/shared/src/logs/start.ts`, `packages/shared/src/logs/summary.ts`,
  `packages/shared/src/index.ts`
- Test: `packages/shared/test/logs/ops.test.ts`, `start.test.ts`, `summary.test.ts` (update and extend);
  `apps/mobile/src/lib/active-log.test.ts` if a volume expectation includes a warm-up.

**Interfaces:**
- Consumes: `SetValues`, `valuesToPatch` (Task 1).
- Produces:
  ```ts
  /** Fills only the actuals that are null from `values`, then completes the set. Same object back if the set is unknown or already completed. Bumps revision and lastActivityAt like completeSet. */
  export function completeSetWith(log: WorkoutLogDoc, setId: string, values: SetValues, nowIso: string): WorkoutLogDoc;
  ```
  - `startLogFromWorkout` leaves every actual null (targets unchanged). `prefillActuals` is deleted with its export
    and tests (nothing else uses it).
  - `addLogSet` copies the last non-drop set's target but leaves actuals null.
  - `logVolumeKg` skips `setType === 'warmup'`; update its doc comment.

- [ ] **Step 1: Write / change the failing tests:**
  - `completeSetWith fills empty actuals and completes`: values `{reps:10, weightKg:60}` on an empty set →
    actuals 10/60, `completedAt === now`, revision +1.
  - `completeSetWith keeps a typed value`: set actualWeightKg 55 → stays 55; reps filled.
  - `completeSetWith refuses an already completed set` and `an unknown set` → `toBe(log)`.
  - `startLogFromWorkout leaves actuals empty` (replace the old prefill expectation) and the result still passes
    `WorkoutLogDoc.parse`.
  - `addLogSet copies the target, not the actuals`.
  - `logVolumeKg skips warm-ups`: W 20 kg × 10 + normal 60 × 8 + drop 40 × 6, all completed → 720.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared exec vitest run test/logs`. Expected: the new/changed cases FAIL.
- [ ] **Step 3: Implement** the four changes.
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS (fix any mobile test that assumed pre-filled actuals).
- [ ] **Step 5: Commit** `feat(shared): save numbers on Done instead of at Start, and leave warm-ups out of volume`

### Task 3: Shared step order and Done label

**Files:**
- Create: `packages/shared/src/logs/flow.ts`, `packages/shared/test/logs/flow.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `groupDropSets` (`workouts/drop-sets.ts`), `formatClock` (`units/units.ts`), log schema types.
- Produces:
  ```ts
  export type StepKind = 'warmup' | 'normal' | 'drop';
  export type Step = { exerciseIndex: number; setIndex: number; setId: string; kind: StepKind; round: number /* 1-based group index in its exercise */; dropNumber: number | null /* 1-based within its group */ };
  export function blockSteps(block: LogBlockDoc): Step[];           // straight: array order; superset: round-robin by group, A1..An
  export function blockRoundCount(block: LogBlockDoc): number;      // max groups over exercises
  export function currentStep(block: LogBlockDoc, preferExerciseIndex?: number): Step | null; // first unticked; with prefer: that exercise's first unticked, else fallback
  export function isBlockDone(block: LogBlockDoc): boolean;         // every set completed
  export function nextOpenBlock(log: WorkoutLogDoc, fromIndex: number): number | null; // forward, then wrap; never fromIndex
  export type AfterDone =
    | { kind: 'drop'; dropNumber: number }
    | { kind: 'superset-next'; exerciseIndex: number }
    | { kind: 'rest'; seconds: number; round: number | null }   // round set on superset pages
    | { kind: 'next'; round: number | null; pageDone: boolean }
    | { kind: 'last' };
  /** What follows once setId (in log.blocks[blockIndex]) is completed. Decided as if it were already ticked. */
  export function afterDone(log: WorkoutLogDoc, blockIndex: number, setId: string): AfterDone;
  /** The spec's label table; `letter` is the superset letter ("A") or null. */
  export function doneLabel(after: AfterDone, letter: string | null): string;
  ```

- [ ] **Step 1: Write the failing tests** using `startLogFromWorkout(fixtureWorkout(), uuid, now)` from
  `test/logs/fixture.ts` (straight: W + 3 × 60 kg rest 90 + drop; superset 2 × 3 rounds rest 90):
  - `straight steps follow set order` (5 steps, kinds W, normal ×3, drop; the drop has `dropNumber 1`, `round 4`).
  - `superset steps go round by round`: exerciseIndex sequence `[0,1,0,1,0,1]`, rounds `[1,1,2,2,3,3]`.
  - `uneven superset`: A1 3 sets, A2 2 sets → sequence `[0,1,0,1,0]`; `afterDone` on A1 round 3 →
    `{ kind: 'rest', seconds: 90, round: 3 }` (or `last` if nothing else is open — tick the straight block first).
  - `currentStep after a skipped set`: tick W and set 2 → current is set 1.
  - `currentStep prefers the tapped superset exercise`.
  - Label table, one test per row, asserting exact strings: `Done · straight to drop 1` (set 3 → drop),
    `Done · straight to A2`, `Done round 1 · rest 1:30`, `Done round 1` (rests 0), `Done · start rest 1:30`,
    `Done · next set` (rest 0), `Done · next exercise` (rest 0, page finished), `Done · last set`.
  - `drop chain rests with the main set's rest`: after the drop → `rest 90`.
  - `superset round uses the longest rest`: A1 rest 0, A2 rest 60 → 60; A1 120, A2 0 → 120.
  - `nextOpenBlock wraps to skipped pages` and returns null when all done.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared exec vitest run test/logs/flow.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `flow.ts`. `afterDone` order of checks: `last` (no other unticked set in the whole log)
  → next step in this group is a drop → superset with another exercise later in this round → rest/next.
- [ ] **Step 4: Run** the test, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): work out the order of sets and what Done does next`

### Task 4: Shared stepper maths and display text

**Files:**
- Create: `packages/shared/src/logs/steppers.ts`, `packages/shared/test/logs/steppers.test.ts`
- Modify: `packages/shared/src/logs/format.ts`, `packages/shared/test/logs/format.test.ts` (create if missing),
  `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `kgToInput`, `toKg`, `fromMeters`, `toMeters`, `distanceUnitFor` (units); `SetValues` (Task 1);
  `formatLogSetTarget` (format.ts).
- Produces:
  ```ts
  export type StepField = 'weight' | 'reps' | 'duration' | 'distance';
  /** One press of − (-1) or + (1). `current` is in stored units (kg, reps, s, m); result too. Null stays null on −. */
  export function stepSetValue(field: StepField, current: number | null, direction: 1 | -1, units: Units): number | null;
  // format.ts
  export function formatResult(v: SetValues, trackingType: TrackingType, units: Units): string | null; // reuses the private resultText: "135 lb × 8", "8 reps", "0:45", "1.5 mi"
  export function stepName(ex: Pick<LogExerciseDoc, 'sets'>, setIndex: number): string;            // "Set 2 of 3" | "Warm-up 1 of 2" | "Drop 1 of 2"
  export function planSummary(ex: Pick<LogExerciseDoc, 'sets' | 'trackingType'>, units: Units): string; // "3 × 10 reps · 50 lb" when working sets share one non-empty target, else "3 sets" ("1 set")
  export function coachLine(ex: Pick<LogExerciseDoc, 'sets' | 'trackingType'>, setIndex: number, units: Units): string | null;
  ```
  `coachLine`: current set is a working set and all working targets match → `Coach: ${planSummary}`; else its own
  target is non-empty → `Coach: ${formatLogSetTarget(target)}`; else null. "Set n of m" counts working sets only;
  "Drop n of m" counts drops in that set's group.

- [ ] **Step 1: Write the failing tests:**
  - `lb steps on whole pounds`: 61.235 kg (135 lb) + → `toKg(140,'lb')`; typed 137 lb (`toKg(137,'lb')`) + → 142 lb,
    then − → exactly `toKg(137,'lb')`.
  - `kg steps by 2.5`: 61.25 + → 63.75; 1 − → 0 (floor); 999 + → 999 (cap 1000 would be passed: unchanged).
  - `empty`: null + weight lb → `toKg(5,'lb')`; null − → null; reps null + → 1.
  - `duration` 30 − → 15, 15 − → 0; `distance` mi 0.1 step round-trips via `toMeters`.
  - `formatResult`: `{weightKg: 61.235, reps: 8}` lb → "135 lb × 8"; reps-only → "8 reps"; all null → null.
  - `stepName` on W, W, 1, 2, 3, ↳, ↳ → "Warm-up 2 of 2" for index 1, "Set 3 of 3" for index 4, "Drop 2 of 2" for 6.
  - `planSummary` uniform → "3 × 8–10 reps · 60 kg"; mixed → "3 sets"; `coachLine` pyramid set → "Coach: 8 reps · 70 kg";
    empty targets → null.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared exec vitest run test/logs/steppers.test.ts test/logs/format.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** Weight works on the displayed number (`kgToInput`), adds `±5` (lb) or `±2.5` (kg),
  floors at 0, returns the input unchanged if `toKg(next) > 1000`.
- [ ] **Step 4: Run** the tests, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): add stepper maths and the logging screen's set names and plan lines`

### Task 5: Active-log additions and the rest panel

**Files:**
- Modify: `apps/mobile/src/lib/use-active-log.tsx`, `apps/mobile/package.json` (+ lockfile via
  `pnpm --filter mobile exec npx expo install react-native-svg`), `apps/mobile/src/theme/theme.ts`
- Create: `apps/mobile/src/components/log/rest-panel.tsx`, `apps/mobile/src/lib/rest-ring.ts`,
  `apps/mobile/src/lib/rest-ring.test.ts`
- Delete (in Task 8, not here): `rest-sheet.tsx`

**Interfaces:**
- Consumes: `completeSetWith`, `SetValues` (Tasks 1–2).
- Produces:
  - `ActiveLog.done: (setId: string, values: SetValues) => Promise<WorkoutLogDoc | null>` — applies
    `completeSetWith` through `op`; returns the stored log when this call completed the set, else null; on success
    re-schedules the reminder exactly like `tick`.
  - `Rest` becomes `{ logId: string; endsAt: number; totalS: number }`; `startRest` sets `totalS = seconds`;
    `adjustRest(+15)` adds 15 to `totalS`, `adjustRest(-15)` leaves `totalS` alone.
  - `ringFraction(endsAt: number, totalS: number, nowMs: number): number` in `rest-ring.ts` — remaining / total,
    clamped to 0..1 (total 0 → 0).
  - `RestPanel({ endsAt, totalS, nextLine, onAdjust, onSkip, onDone })` — ring (svg circle, stroke from `palette`),
    clock in `restClock` style, `rest-minus` / `rest-plus` / `rest-skip` buttons (≥ `tapTarget.logging`), the
    `rest-next` line "Next: …" when `nextLine` is non-null; same tick and `onDone(late)` behaviour as `RestSheet`
    (250 ms tick, late after 2 s). testID `rest-panel`. Accessibility: timer role with "{n} seconds of rest left".
  - Theme: `restRingSize` (e.g. `tapTarget.logging * 4`), `restRingStroke` (`space[2.5]`).

- [ ] **Step 1: Write the failing test** `rest-ring.test.ts`: full at start (1), half at the midpoint (0.5), 0 after
  the end, 0 when total is 0, never above 1 after −15.
- [ ] **Step 2: Run** `pnpm --filter mobile exec vitest run src/lib/rest-ring.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `rest-ring.ts`, the hook additions and `RestPanel`; install `react-native-svg` with
  `npx expo install` so the version matches SDK 58.
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): add Done with pre-filled numbers and a rest panel with a countdown ring`

### Task 6: Page view model

**Files:**
- Create: `apps/mobile/src/lib/log-page-model.ts`, `apps/mobile/src/lib/log-page-model.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `LastResults` (`lib/log-api.ts`); `supersetLetters` (`lib/workouts.ts`);
  `formatLastResult`, `TARGET_FIELDS`, `distanceUnitFor`, `kgToInput`, `fromMeters`, `formatClock`.
- Produces:
  ```ts
  export type StepperModel = { field: StepField; unit: string /* 'lb'|'kg'|'reps'|'m:ss'|'mi'|'km' */; value: number | null; display: string /* '' when null */; lessLabel: string; moreLabel: string };
  export type StepRowModel = { setId: string; exerciseIndex: number; setIndex: number; kind: StepKind; chip: string /* 'W'|'1'|'↳' */; name: string; text: string /* result if done, else plan, else '' */; done: boolean; current: boolean };
  export type ExerciseCardModel = { exerciseIndex: number; logExerciseId: string; exerciseId: string; name: string; label: string | null /* 'A1' */; reference: string | null /* coach · last time */; swapped: boolean; note: string | null; collapsedText: string | null /* superset one-liner */; active: boolean };
  export type PageModel = {
    blockIndex: number; kind: 'straight' | 'superset';
    exercises: ExerciseCardModel[];
    current: null | { step: Step; setName: string; dots: Array<'done' | 'current' | 'todo' | 'warmup-done' | 'warmup-todo'>; values: SetValues; steppers: StepperModel[]; bodyTile: boolean; dropSteps: StepRowModel[] | null; doneLabel: string; after: AfterDone };
    round: null | { current: number; total: number; restText: string | null; chips: Array<'done' | 'current' | 'todo'>; afterRound: string | null };
    steps: StepRowModel[];          // the page's full step list (rest view, all-done view)
    hasWarmups: boolean;
    allDone: boolean;
    nextLine: string | null;        // for the rest panel: "Barbell Squat · set 2 of 3 · 132 lb × 8"
    upNext: string | null;          // next page: "Seated Cable Row · 3 × 12 reps" / "A1 Pull-up + A2 Push-up"
  };
  export function buildPageModel(i: { log: WorkoutLogDoc; blockIndex: number; units: Units; last: LastResults; preferExerciseIndex?: number }): PageModel;
  export function progressStates(log: WorkoutLogDoc, pageIndex: number): Array<'done' | 'current' | 'todo'>;
  export function progressLabel(states: ReadonlyArray<'done' | 'current' | 'todo'>): string; // "Exercise 2 of 5. 1 done."
  export function listRows(log: WorkoutLogDoc): Array<{ title: string; detail: string /* "2 of 3 sets" */; done: boolean }>;
  export function pageIndexAfterChange(prev: { blockIds: string[]; index: number }, nextBlockIds: string[]): number;
  ```
  `pageIndexAfterChange`: keep the same block id if it still exists; else clamp to the last page; 0 for an empty log.
  Steppers follow `TARGET_FIELDS` with weight before reps; `bodyTile` is true for `reps` exercises.

- [ ] **Step 1: Write the failing tests** from `startLogFromWorkout(...)` fixtures built in the test (same shape as
  the shared fixture, plus one `reps` superset):
  - `straight page at start`: setName "Warm-up 1 of 1", doneLabel per Task 3, steppers `['weight','reps']` with
    lb display "132"/"10" (60 kg, 8–10 reps), reference "Coach: … · Last time: …" when `last` has data, else coach only.
  - `carry shows on the next set` after `updateActual` on set 1 + `completeSetWith`.
  - `superset page`: labels A1/A2, round `{ current: 1, total: 3 }`, restText "Rest 1:30 after both", A2 collapsed
    text "Up next · 8–10 reps · 60 kg"-style from `formatLogSetTarget`, `afterRound` "Round 2 · A1 Bench press".
  - `drop page`: on set 3, `dropSteps` lists main + drop; after completing main the current step is the drop with
    `doneLabel` of its row.
  - `allDone page`: `current === null`, `allDone === true`, `steps` all done.
  - `nextLine` for a superset adds "A2 " before the name.
  - `progressStates` / `progressLabel`; `listRows` superset title "A1 Bench press + A2 Bench press".
  - `pageIndexAfterChange`: removed current page → same index clamped; page before removed → index − 1 keeps the
    same block; empty → 0.
- [ ] **Step 2: Run** `pnpm --filter mobile exec vitest run src/lib/log-page-model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** by composing the shared functions only (no rule logic of its own beyond layout choices).
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): describe each logging page as a tested view model`

### Task 7: Page components

**Files:**
- Create in `apps/mobile/src/components/log/`: `stepper.tsx`, `done-button.tsx`, `progress-strip.tsx`,
  `log-top-bar.tsx`, `exercise-photo.tsx`, `step-list.tsx`, `exercise-page.tsx` (straight), `superset-page.tsx`
- Modify: `apps/mobile/src/theme/theme.ts` (constants: `stepperValue` text style ≈ `bigNumber` × 1.6,
  `logPhotoHeight` = `exercisePhotoHeight`), `set-row.tsx` (optional `suggested?: SetValues` shown as placeholders)

**Interfaces:**
- Consumes: Task 6 models; `ExerciseThumb`, `exerciseImageUrl`, `useExerciseDetails`; `parseActualInput`
  (`lib/active-log-logic.ts`).
- Produces (props; `p` = page index, used in every testID inside a page):
  - `Stepper({ model, page, onStep(direction), onType(value: number | null) })` — `stepper-{field}-minus-{p}`,
    `stepper-{field}-value-{p}` (TextInput; keeps the draft while focused, like `ActualInput`),
    `stepper-{field}-plus-{p}`; − / + ≥ `tapTarget.logging`, labelled with `lessLabel` / `moreLabel`.
  - `DoneButton({ label, page, onPress })` — `done-{p}`, full width, ≥ `tapTarget.logging`.
  - `ProgressStrip({ states })` — testID `progress-strip`, `accessibilityLabel` = `progressLabel`.
  - `LogTopBar({ pill: string | null, elapsedS, onBack, onPill, onFinish })` — `log-back`, `log-pill`, `log-timer`,
    `finish-workout`.
  - `ExercisePhoto({ detail, name, page, onHowTo })` — start/end photos side by side or placeholder, `how-to-{p}`.
  - `StepList({ steps, page, showWarmupNote })` — rows `step-row-{p}-{setId-index}` with W rows on `palette.surface`,
    done rows with ✓, current row marked "next"; the warm-up note when `showWarmupNote`.
  - `ExercisePage` / `SupersetPage({ model, page, resting, handlers })` where
    `handlers = { onStep(field, dir), onType(field, value), onDone(), onEditSets(), onNote(exerciseIndex), onSwap(exerciseIndex), onHowTo(exerciseIndex), onAddDrop(), onPrev(), onNext(), onFocusExercise(exerciseIndex), onFinish() }`.
    Layout and copy exactly as the spec's screen list, superset and drop sections; when `resting` show only the
    exercise name and "THIS EXERCISE" `StepList`; when `allDone` show `all-done-{p}` with "Next exercise ›"
    (`next-exercise-{p}`) or "Finish workout". Action row ids `edit-sets-{p}`, `note-{p}`, `swap-{p}`; move row ids
    `prev-{p}`, `next-{p}`; superset cards `superset-ex-{p}-{k}`; `add-drop-{p}`; `step-name-{p}`.

- [ ] **Step 1: Write the failing check:** add a case to `src/theme/typography.test.ts` (or a new
  `log-theme.test.ts`) that `stepperValue.fontSize > typeScale.bigNumber.size.phone` and every new pressable size
  constant ≥ `tapTarget.min`.
- [ ] **Step 2: Run** `pnpm --filter mobile exec vitest run src/theme`. Expected: FAIL.
- [ ] **Step 3: Implement** the components (presentational only: no `useActiveLog`, no shared rule calls beyond
  formatting already in the model).
- [ ] **Step 4: Run** `pnpm check` (includes `no-raw-colours`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): build the one-exercise logging page, superset page and steppers`

### Task 8: Assemble the logging screen

**Files:**
- Modify: `apps/mobile/src/app/(app)/log/[id]/index.tsx` (rewrite the render; keep the loading, "not open" and
  finish/discard logic)
- Create: `apps/mobile/src/components/log/exercise-list-sheet.tsx`, `apps/mobile/src/components/log/edit-sets-sheet.tsx`
- Delete: `apps/mobile/src/components/log/rest-sheet.tsx`

**Interfaces:**
- Consumes: Tasks 5–7; existing `LogBlock`, `ActionMenu`, `NoteSheet`, `ExercisePicker`, `ExerciseInfoSheet`,
  `SyncPill`, shared ops (`updateActual`, `addLogSet`, `addLogDrop`, `removeLogSet`, `removeLogExercise`,
  `swapLogExercise`, `addLogExercise`, `setExerciseNote`), `finishPrompt` / `finishQuestion`.
- Produces:
  - `ExerciseListSheet({ visible, rows, onPick(index), onAdd(), onDiscard(), onClose })` — `exercise-list`,
    `exercise-row-{i}`, `list-add-exercise`, `discard-button`.
  - `EditSetsSheet({ visible, block, firstExerciseIndex, units, details, suggested(setId), handlers: BlockHandlers, onClose, onSwap(ex), onNote(ex) })`
    — page-sheet modal `edit-sets-sheet` with `edit-sets-close`; renders `LogBlock` (existing testIDs kept:
    `set-*`, `tick-*`, `set-more-*`, `set-delete-*`, `add-set-*`, `exercise-menu-*`); hosts its own nested
    `ActionMenu` for set and exercise menus; Swap and Note close the sheet first, then call `onSwap` / `onNote`
    after dismiss (same pending pattern as `ActionMenu`).
  - Screen behaviour:
    - Horizontal `FlatList` (`pagingEnabled`, `getItemLayout` by window width, `initialScrollIndex` = first page with
      open sets via `currentStep`), `onMomentumScrollEnd` sets `pageIndex`; ‹ ›, list rows and auto-advance use
      `scrollToIndex`. `pageIndexAfterChange` on every blocks change.
    - Done: compute `values` and `after` from the page model, `await done(setId, values)`; if non-null → `tapHaptic()`,
      `startRest(log.id, after.seconds)` when `after.kind === 'rest'`, clear the superset preference, and if the
      page is now done jump to `nextOpenBlock` (stay when null).
    - Steppers: `op(l => updateActual(l, setId, patch))` with `stepSetValue` from the shown value.
    - Ticking in Edit sets: completed → `tick` (untick); open → `done(setId, resolved)` without rest.
    - `RestPanel` under the strip while `rest?.logId === log.id`, with `nextLine` of the page on screen; pages get
      `resting`.
    - Empty log: card with `add-exercise`; pill hidden.
    - `+ Add another drop`: `addLogDrop(l, ex.id, mainSetId, randomUUID, now)`.

- [ ] **Step 1: Write the failing test:** extend `log-page-model.test.ts` with
  `doneThenAdvance` — a pure helper `pageAfterDone(log, pageIndex): number` exported from `log-page-model.ts`
  (same page while it has open sets; else `nextOpenBlock ?? pageIndex`), covering the forward, wrap and all-done cases.
- [ ] **Step 2: Run** `pnpm --filter mobile exec vitest run src/lib/log-page-model.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper, the two sheets and the screen; remove `RestSheet` and the old list render.
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS. Then start Metro and load the screen once in a simulator **only
  if lane A is free**; otherwise leave the visual check to Task 9.
- [ ] **Step 5: Commit** `feat(mobile): log one exercise at a time with swipe, Done labels and the rest ring`

### Task 9: Maestro flows, e2e helper and final check (lane A, one simulator session)

**Files:**
- Modify: `apps/mobile/scripts/e2e-helper.ts` (generalise `assignWorkout` to take blocks; add action
  `assign-today-mixed`), `apps/mobile/.maestro/helpers/call.js` (document it)
- Modify flows: `apps/mobile/.maestro/log-workout.yaml`, `log-resume.yaml`, `log-unplanned.yaml`,
  `log-delete-set.yaml`; if present on the rebased branch: `log-add-exercise.yaml` (exercise search),
  `sticker-reveal.yaml`, `zoo-book.yaml` and the reveal step of `log-workout.yaml` (stickers)
- Create: `apps/mobile/.maestro/log-flow.yaml`

**Interfaces:**
- `assign-today-mixed` → "E2E Mixed" today: (1) Barbell Squat: W 20 kg × 10 rest 60, 2 × 8 @ 60 kg rest 90;
  (2) superset Pullups + Pushups (`reps`), 2 rounds of 8, rests A1 0 / A2 60; (3) Dumbbell Bicep Curl 2 × 12 @ 10 kg
  rest 60, the second followed by drops 7.5 kg and 5 kg to failure (rest 0). Clears logs first, like `assign-today`.

- [ ] **Step 1: Update the flows** (ids from Tasks 7–8):
  - `log-workout`: Start → `done-0` visible, "Set 1 of 3", `how-to-0` opens `exercise-sheet-name` "Barbell Squat",
    close; `done-0` text "Done · start rest 1:30" → `rest-panel` and `rest-next` "Next: Barbell Squat · set 2 of 3 ·
    132 lb × 8" → `rest-skip`; Done twice more (third reads "Done · last set", no rest panel) → `all-done-0` →
    `finish-workout` → summary "3 sets completed", "3,175 lb lifted"; the rest of the flow unchanged.
  - `log-resume`: Done set 1, skip rest, restart → Resume → "Set 2 of 3" visible; `edit-sets-0` → `tick-0-0`
    "checkbox, checked", `tick-0-1` "checkbox, unchecked"; close; `log-pill` → `discard-button` → Discard.
  - `log-unplanned`: `add-exercise` from the empty card; search "push"; `stepper-reps-plus-0`; Done; skip rest if
    shown; `finish-workout` → "Finish with 2 sets not done? They won't count." → summary "1 set completed".
  - `log-delete-set`: `edit-sets-0` → `set-more-0-1` → `menu-remove-set` → set-0-2 gone; swipe `set-0-1` left →
    `set-delete-0-1` → gone; screenshot `swipe-delete`.
  - `log-flow` (new, `assign-today-mixed`): W row lighter + "Warm-up 1 of 1"; Done, skip; `stepper-weight-plus-0`
    (132 → 137) then Done, skip; "Set 2 of 2" shows `stepper-weight-value-0` "137" (carry-forward); Done (it reads
    "Done · start rest 1:30": other pages are still open) → `rest-skip` → auto-advanced to page 1 (`log-pill` "2 of 3"); `done-1` reads "Done · straight to A2", tap → no `rest-panel`;
    A2's Done reads "Done round 1 · rest 1:00" → `rest-panel`; skip; swipe left to page 2; finish set 1, skip;
    set 2's Done reads "Done · straight to drop 1"; tap → stepper weight shows "17" (7.5 kg in lb) and no rest;
    `add-drop-2` adds a third drop; `finish-workout` → answer the "not done" question → summary. Screenshots:
    `log-set`, `log-superset`, `log-drop`, `log-rest` (for the PO).
- [ ] **Step 2: Rebuild the app** for the simulator (new native module `react-native-svg`), then run
  `pnpm --filter mobile e2e .maestro/log-workout.yaml .maestro/log-resume.yaml .maestro/log-unplanned.yaml .maestro/log-delete-set.yaml .maestro/log-flow.yaml`.
  Expected: all PASS. A timing-looking failure is rerun alone before believing it.
- [ ] **Step 3: Run the whole Maestro suite once** (`pnpm --filter mobile e2e`) and `pnpm check`. Expected: PASS,
  output shown.
- [ ] **Step 4: Commit** `test(mobile): drive the new logging screen end to end, with supersets, drops and warm-ups`
- [ ] **Step 5: PR notes for the PO** (in the PR description when asked to open it): what to try on the phone — swipe
  between exercises, change a weight and see it carry, a superset round, a drop set, the rest ring, Edit sets →
  swipe to delete; volume now leaves out warm-ups; the phone app needs a fresh build (new ring library).

---

## Self-review

- **Spec coverage:** pages/moving/list/empty → Tasks 3, 6, 8; current step → 3; pre-fill → 1; steppers → 4, 7;
  Done table and rest lengths → 3; superset page → 6, 7; drop sets and + Add another drop → 6, 7, 8; warm-ups and
  volume → 2, 6, 7; rest panel → 5, 8; Edit sets / Note / Swap / How to → 7, 8; things that stay → Global
  Constraints and Task 9 flows; decisions 1–15 → Tasks 6–8 (back button, list sheet, auto-advance, ring library,
  iPad column, accessibility labels in 7). No gaps found.
- **Type consistency:** `SetValues`, `Step`, `AfterDone`, `StepField`, `PageModel`, `Rest.totalS`, `done()` use the
  same names in every task.
- **Review Focus:** each line names its test and owning task.
- **Proportion:** signatures, test names and exact values only; no function bodies apart from the rule orders the
  spec fixes.
