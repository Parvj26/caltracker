# Exercise Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One smart, on-device exercise search with aliases, word endings, typo tolerance, ranking and filters, used
in the builder picker (layout A, list and preview), on the Exercises page, and in the phone's + Exercise. Coaches can
star favourites, and recent exercises come first.

**Architecture:**
- A pure `searchExercises` in `packages/shared` runs over an in-memory index of about 900 rows.
- The web and the phone load the index once (the phone caches it).
- Favourites go in a new RLS table.
- Recents come from definer functions scoped to the caller.

**Tech Stack:** TypeScript strict, Vitest, Postgres/pgTAP, Next.js 16, Expo SDK 58, Playwright, Maestro.

**Spec:** `docs/superpowers/specs/2026-11-05-exercise-search-design.md`

**Branch:**
- Use `feature/exercise-search`, branched from `feature/phase-3a-logging`. The phone picker
  `apps/mobile/src/components/log/exercise-picker.tsx` only exists there.
- Rebase onto `main` once 3a has merged.
- Task 1 is Vitest-only, so it can run while other worktrees use the local database.
- Tasks 2–5 need the shared local Supabase and simulator. Run them only while no other worktree is running
  db/e2e/Maestro.

## Global Constraints
- The search logic lives only in `packages/shared`, as pure functions with unit tests. The apps don't re-implement
  any matching.
- Typo tolerance:
  - query words of 5 or more letters may be 1 edit away (Damerau-Levenshtein);
  - query words of 8 or more letters may be 2 edits away;
  - shorter words must match exactly or as a prefix.
- Rank tiers, highest first:
  1. exact full name
  2. name starts with the query
  3. every word matches a name word (exactly or as a prefix)
  4. a typo match
  5. a match through muscle, equipment or category only

  Within a tier, order by favourite, then recent, then shorter name, then A to Z.
- When the query is empty, show favourites, then the 20 most recent, then everything A to Z.
- Show 50 results, with "Show more".
- Filter chips:
  - Muscles: Chest, Back, Shoulders, Arms, Legs, Glutes, Core, Full body
  - Equipment: Barbell, Dumbbell, Cable, Machine, Kettlebell, Bodyweight, Band, Other
  - Custom only

  Chips in different groups combine with AND; chips in the same group combine with OR.
- Index fields: `id`, `name`, `primary_muscles`, `secondary_muscles`, `equipment`, `category`, `tracking_type`,
  `source`, and the first image path. Instructions and photos load for the preview only.
- Use CSS tokens only (there is no `--ct-space-5`). Rows are at least 44 px tall. The picker follows the ARIA combobox
  and listbox pattern.
- Below about 900 px wide, the preview opens over the list with a Back button.
- `exercise_favorites` needs RLS plus pgTAP covering cross-coach, client and anonymous access.
- Existing behaviour stays: superset multi-pick mode, swap mode on the phone, and custom exercises.

## Review Focus
1. **Short queries ("bb", "db", "kb", "ab").** They expand as aliases and never fuzzy-match noise. "ab" means abs,
   and must not match "lat pulldown". Test: Task 1.
2. **A query that matches nothing.** The empty state reads "No exercises match "{query}"" and offers to clear the
   filters, or to create a custom exercise on the web. Test: Tasks 3 and 5.
3. **Accents, hyphens and joined words.** "t-bar row", "tbar row" and "T Bar Row" all find the same exercise, and
   "benchpress" finds bench press. Test: Task 1.
4. **Performance.** Searching 900 rows per keystroke must stay under 16 ms, so precompute normalised tokens once in
   `buildExerciseIndex`. Test: Task 1 has a benchmark-style test asserting under 30 ms for 1,000 rows over 50 queries
   in total, with generous CI headroom.
5. **The phone offline.** + Exercise works from the cached index with no network, and shows a quiet "Using saved
   library" note. Test: Task 5.

---

### Task 1: Shared search engine

**Files:**
- Create: `packages/shared/src/exercises/search.ts`, `packages/shared/src/exercises/aliases.ts`,
  `packages/shared/test/exercises/search.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- **Produces:**
  ```ts
  export type ExerciseIndexRow = { id: string; name: string; primaryMuscles: string[]; secondaryMuscles: string[]; equipment: string | null; category: string | null; trackingType: TrackingType; source: 'builtin' | 'custom'; imagePath: string | null };
  export type ExerciseIndex = { rows: ExerciseIndexRow[] /* plus precomputed tokens, opaque */ };
  export type MuscleChip = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Legs' | 'Glutes' | 'Core' | 'Full body';
  export type EquipmentChip = 'Barbell' | 'Dumbbell' | 'Cable' | 'Machine' | 'Kettlebell' | 'Bodyweight' | 'Band' | 'Other';
  export type SearchFilters = { muscles: MuscleChip[]; equipment: EquipmentChip[]; customOnly: boolean };
  export type SearchBoosts = { favourites: ReadonlySet<string>; recent: readonly string[] /* newest first */ };
  export type SearchHit = { row: ExerciseIndexRow; tier: 1 | 2 | 3 | 4 | 5 | 0 /* 0 = empty-query listing */; highlight: Array<[start: number, end: number]> /* ranges in row.name */ };
  export function buildExerciseIndex(rows: ExerciseIndexRow[]): ExerciseIndex;
  export function searchExercises(index: ExerciseIndex, query: string, filters: SearchFilters, boosts: SearchBoosts): SearchHit[];
  export function normalizeSearchText(s: string): string;
  export const EXERCISE_ALIASES: Readonly<Record<string, string>>;
  export const MUSCLE_CHIP_MUSCLES: Readonly<Record<MuscleChip, readonly string[]>>;
  export function equipmentChipOf(equipment: string | null): EquipmentChip;
  ```
- **Aliases** (about 40), written as `alias → expansion`:
  - Equipment: `db→dumbbell`, `dbs→dumbbell`, `bb→barbell`, `kb→kettlebell`, `ez→ez bar`, `smith→smith machine`,
    `bw→bodyweight`.
  - Lifts: `ohp→overhead press`, `rdl→romanian deadlift`, `sldl→stiff legged deadlift`, `bss→bulgarian split squat`,
    `pullup→pull up`, `chinup→chin up`, `pushup→push up`, `situp→sit up`, `tbar→t bar`.
  - Muscles: `sl→single leg`, `lat→latissimus`, `lats→latissimus`, `tri→triceps`, `tris→triceps`, `bi→biceps`,
    `bis→biceps`, `quad→quadriceps`, `quads→quadriceps`, `ham→hamstrings`, `hammy→hamstrings`, `glute→glutes`,
    `delt→shoulders`, `delts→shoulders`, `trap→traps`, `pec→chest`, `pecs→chest`, `ab→abdominals`,
    `abs→abdominals`, `calf→calves`.
  - Movements: `inc→incline`, `dec→decline`, `ext→extension`, `ext.→extension`.
- **Muscle chip map:**
  - Chest: chest
  - Back: lats, middle back, lower back, traps
  - Shoulders: shoulders
  - Arms: biceps, triceps, forearms
  - Legs: quadriceps, hamstrings, calves, adductors, abductors
  - Glutes: glutes
  - Core: abdominals
  - Full body: rows whose category is `strongman`, or that have 4 or more primary and secondary muscles

  Read the actual muscle vocabulary from `supabase/seed` and the importer `packages/shared/src/exercises/free-exercise-db.ts`.
  Map every value that appears; an unmapped value should fail a test.

- [ ] **Step 1: Write failing tests.** Build a fixture index of about 15 real names: Dumbbell Incline Bench Press,
  Incline Dumbbell Fly, Barbell Bench Press - Medium Grip, Standing Military Press, Seated Barbell Military Press,
  Romanian Deadlift, Barbell Curl, Hammer Curls, T-Bar Row, Lat Pulldown, Crunches, Barbell Squat, Bodyweight Squat,
  Cable Crossover, plus one custom "Low-Incline DB Press". Assert the following:
  - Aliases and word order:
    - `'db incline'` ranks Dumbbell Incline Bench Press first.
    - `'press incline dumbbell'` returns the same first hit.
    - `'ohp'` returns the military presses, not Bench Press.
    - `'rdl'` returns Romanian Deadlift first.
  - Word endings: `'curls'` matches Barbell Curl.
  - Typos:
    - `'dumbel incline'` still matches through tier 4.
    - `'cul'` does not match Barbell Curl (it's under 5 letters and not a prefix of a name word).
  - Joined and punctuated forms:
    - `'t-bar row'`, `'tbar row'` and `'T Bar Row'` all give T-Bar Row first.
    - `'benchpress'` matches Bench Press.
  - Short aliases:
    - `'ab'` matches Crunches through abdominals (tier 5).
    - `'ab'` does not match Lat Pulldown.
  - Muscle-only matches: `'glutes'` returns muscle matches only at tier 5, after any name match.
  - Empty query:
    - The order is favourites, then recents, then A to Z.
    - Filters: `{muscles:['Chest'], equipment:['Dumbbell']}` gives only dumbbell chest rows.
    - `customOnly` gives only "Low-Incline DB Press".
  - Ties go to the favourite first, then the recent one.
  - Highlight ranges cover the matched name words.
  - `normalizeSearchText('Crème  Brûlée-Press')` returns `'creme brulee press'`.
  - Every muscle in the real library maps to some chip.
  - Performance: 1,000 synthetic rows and 50 queries run in under 30 ms in total.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test -- exercises/search`. Expected: FAIL.
- [ ] **Step 3: Implement.** Build the index once:
  - normalised name tokens, with stems from a light suffix strip (`ies→y`, `es`, `s`, `ing`, `ed`, keeping 3 or more
    letters);
  - a joined-name string for "benchpress" matching;
  - muscle, equipment and category tokens.

  At query time:
  1. Normalise the query and expand aliases (a multi-word expansion replaces the token).
  2. Match each query token against name tokens (exact, prefix, then typo), then against the other tokens.
  3. Assign the tier, then sort.
- [ ] **Step 4: Run** the shared tests, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): search exercises by shorthand, any word order and typos`

### Task 2: Favourites and recents in the database

**Files:**
- Create: `supabase/migrations/<next>_exercise_favorites.sql`, `supabase/tests/exercise_favorites.test.sql`
- Modify: `packages/shared/src/database.types.ts` (generated)

**Interfaces:**
- **Produces:**
  - The table `public.exercise_favorites (coach_id uuid default auth.uid() references auth.users on delete cascade,
    exercise_id uuid references public.exercises on delete cascade, created_at timestamptz default now(),
    primary key (coach_id, exercise_id))`.
  - RLS: select, insert and delete are allowed only where `coach_id = auth.uid()` and the caller is a coach. A client
    can't insert.
  - `public.recent_exercises_for_coach(p_limit int default 20) returns table(exercise_id uuid, last_used timestamptz)`
    (definer, pinned search_path): the distinct exercises from workouts in the caller's workspaces created by the
    caller, newest first.
  - `public.recent_exercises_for_client(p_limit int default 20)` (definer): the distinct exercises from the caller's
    completed log exercises, newest first.
- [ ] **Step 1: Write failing pgTAP.**
  - A coach stars, lists and unstars an exercise.
  - Another coach sees none of the first coach's favourites and can't delete them.
  - A client can't insert.
  - An anonymous caller gets nothing.
  - Deleting a custom exercise cascades its favourites.
  - The recents functions return only the caller's own items, newest first, limited to `p_limit`.
  - Another workspace's workouts never appear.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm db:reset` (then re-import), `pnpm db:test`, `pnpm db:types` and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): let coaches star exercises and fetch recently used ones`

### Task 3: Web picker (layout A)

**Files:**
- Create: `apps/web/src/lib/exercise-index.ts` (loader), `apps/web/src/components/exercise-search/{search-panel.tsx,result-list.tsx,preview.tsx,filter-chips.tsx,favourite-button.tsx,exercise-search.module.css}`, `apps/web/e2e/exercise-search.spec.ts`
- Modify: `apps/web/src/components/workout-builder/exercise-picker.tsx`. It keeps its `Props` and its multiple mode,
  but its body is replaced with `SearchPanel`.
- Modify: `apps/web/src/app/(coach)/workouts/actions.ts`. Remove the old server-side `searchExercises` once nothing
  uses it. Add `toggleFavourite(exerciseId)`.

**Interfaces:**
- **Consumes:** everything Task 1 produces, plus Task 2's table and `recent_exercises_for_coach`.
- **Produces:**
  - `loadExerciseIndex(supabase): Promise<{ index: ExerciseIndexRow[]; favourites: string[]; recent: string[] }>`
    (one select over `exercises` and one each for favourites and recents).
  - `<SearchPanel mode="pick-one" | "pick-many" | "browse" onPick? onOpen? />`, which renders layout A.
- **Preview pane:** shows two photos (start/end, through the existing storage URL helper), every muscle, equipment,
  and the instructions collapsed after 2 lines with "more". The primary action is **Add to workout** in pick modes, or
  **Edit** for custom exercises in browse mode.
  - In multi-pick mode, rows have checkboxes and the footer shows "Add {n}", keeping the existing "Pick at least 2
    exercises" rule for supersets.
- **Keyboard:** Up and Down move the highlight, Enter picks or adds, and Escape closes.
- [ ] **Step 1: Write failing Playwright tests:**
  - In the builder, + Exercise, type "db incline", and the first row is Dumbbell Incline Bench Press.
  - The preview shows its name, a "Chest" tag and two images.
  - Clicking "Add to workout" adds it to the builder.
  - Star it, reopen with an empty query, and it's the first row.
  - The Chest and Dumbbell chips narrow the list to dumbbell chest exercises.
  - "zzzz" shows the empty state from Review Focus 2.
  - Superset mode: picking 1 keeps Add disabled with the hint; picking 2 adds both.
- [ ] **Step 2: Run** `CI=1 pnpm --filter web exec playwright test e2e/exercise-search.spec.ts`. Expected: FAIL.
  **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS, with the existing builder specs still green.
- [ ] **Step 5: Commit** `feat(web): find exercises by shorthand with a photo preview and favourites`

### Task 4: Exercises page

**Files:**
- Modify: `apps/web/src/app/(coach)/exercises/page.tsx` (plus its CSS, and `filters.ts` if superseded)
- Modify: `apps/web/e2e/exercises.spec.ts`

**Interfaces:**
- **Consumes:** `SearchPanel mode="browse"` from Task 3.
- **Produces:**
  - The page renders `SearchPanel` full-page, with a "+ New exercise" button.
  - The preview's Edit opens the existing custom-exercise form.
  - Built-in exercises have no Edit, as today.
  - Existing tracking-type chips that the new filters don't cover stay as an extra chip group, if the current page has
    them. Check `tracking-chips.tsx` and keep the behaviour the current e2e asserts.
- [ ] **Step 1: Update and add Playwright tests:**
  - Searching "ohp" on the Exercises page shows military presses.
  - Starring there is reflected in the builder picker.
  - Existing create and edit custom exercise tests still pass.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): use the smarter search on the Exercises page`

### Task 5: Phone + Exercise

**Files:**
- Create: `apps/mobile/src/lib/exercise-index.ts` (fetch plus AsyncStorage cache under
  `caltracker.exerciseIndex.v1`, refreshed in the background at most once every 24 h), and
  `apps/mobile/.maestro/log-add-exercise.yaml`
- Modify: `apps/mobile/src/components/log/exercise-picker.tsx`. It uses `searchExercises`. With an empty query it shows
  the client's recents from `recent_exercises_for_client`. It keeps swap and add modes. It has filter chips (muscle
  and equipment only, horizontally scrollable).

**Interfaces:**
- **Consumes:** Task 1, plus Task 2's `recent_exercises_for_client`.
- **Produces:** `loadExerciseIndexCached(): Promise<{ rows: ExerciseIndexRow[]; fromCache: boolean }>`. When
  `fromCache` is true and the refresh failed, the picker shows "Using saved library" (Review Focus 5).
- [ ] **Step 1: Write the failing Maestro flow and unit tests:**
  - Maestro: start a seeded workout, tap + Exercise, type "db incline", and see "Dumbbell Incline Bench Press" as
    the first result. Tap it, and it's added to the log.
  - Vitest: the cache returns the stored index when fetch rejects, and refreshes when it's older than 24 h.
- [ ] **Step 2: Run** the mobile tests and the new flow (rebuild the Release simulator app first). Expected: FAIL.
  **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check`, then rebuild, then all Maestro flows. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): find exercises by shorthand while logging, even offline`
