# Food Tab Redesign and Coach Meals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the phone Food tab and Log a meal screen, and add coach-shared meals (web editor, phone grid + detail, one-tap logging with a link back for "logged N×").

**Architecture:** One migration adds `coach_meals`, its storage bucket, `meals.coach_meal_id` and a counts RPC. A generic smart-search engine is extracted from exercise search into `packages/shared/src/search/`; meal search, chip filters, "log again" and the kcal card are pure functions in `packages/shared/src/food/`. The phone keeps its offline queue (`food-queue.ts`) and adds a light 90-day history fetch and a cached coach-meal list; the web gets a `/meals` section modelled on `/exercises`.

**Tech Stack:** Supabase (Postgres 15+, RLS, pgTAP, Storage), TypeScript strict, vitest, Expo / expo-router, Next 16 (OpenNext on Workers), Playwright, Maestro.

**Spec:** `docs/superpowers/specs/2026-11-09-food-and-coach-meals-design.md` (read with `2026-11-07-food-design.md`).

## Global Constraints

- Migration file: `supabase/migrations/20261109000500_coach_meals.sql`; any extra migration uses `20261109000600`+ (an unmerged branch owns `20261109000100`–`300`). Re-check `origin/main` for newer timestamps before merging.
- Every new table: RLS enabled, `revoke all` then explicit column grants, pgTAP proving cross-workspace and cross-client failure; coach-only write; no delete privilege on `coach_meals` (soft delete via `deleted_at`).
- Limits: coach meal `name` 1–40 trimmed; `ingredients` ≤ 2000; `how_to` ≤ 4000; calories 0–10000 whole; protein/carbs/fat 0–1000, one decimal; photo width/height 1–1600.
- Coach photo paths: `{workspace_id}/{coach_meal_id}-{photo_uuid}.{webp|jpg}` and `…-thumb.{ext}`; bucket `coach-meal-photos`, private, 3145728 bytes, `image/webp`, `image/jpeg`.
- Images compressed before upload: phone `compressPhoto` (`apps/mobile/src/lib/compress-photo.ts`), web `compressPhoto` (`apps/web/src/lib/image-resize.ts`): 1600 px long edge + 320 px thumbnail.
- Filter chips (Meals from <coach> only): High protein = protein ≥ 30; Under 500 kcal = calories ≤ 500; Low carb = carbs ≤ 20; AND-combined; a missing number never matches. Log a meal has no chips.
- "Log again": last 28 days, max 3, named meals with ≥ 1 macro, grouped by normalised name + all four macros. Own-meal search history: last 90 days. Search results on Log a meal: max 8.
- Copy is verbatim from the spec (e.g. "N kcal left today", "Targets set by <coach>", "Your coach hasn't set targets yet", "Log again in one tap", "From <coach>", "logged N×", "not yet").
- Exercise search behaviour must not change: `packages/shared/test/exercises/search.test.ts` passes with zero edits.
- No host-specific APIs; all files through Supabase Storage.
- Conflicts: `apps/mobile/src/app/(app)/(tabs)/coach.tsx` is being redesigned elsewhere — only Task 10 touches it; do not touch `today-header` or Settings (push-notifications branch).
- Repo rules: Conventional Commits, `pnpm check` (prefix `eval "$(fnm env)" && fnm use 24`) and `pnpm db:test` green before done; regenerate types with `pnpm db:types` after the migration.

## Review Focus

1. **Old queued meals after the update:** a save queued by the previous app version has no `coachMealId`; it must still parse, send (with `coach_meal_id: null`) and show. (Task 4: `parseFoodQueue` test with a legacy op.)
2. **Coach removes a meal while a client is offline with it prefilled:** the queued save must still succeed (soft delete keeps the FK target) and the meal must vanish from the grid on next load. (Task 1 pgTAP: a client meal linked to a removed coach meal inserts fine, and the removed meal is invisible to the client; Task 7 Maestro reloads the grid.)
3. **Linking across workspaces:** a client of A setting `coach_meal_id` to a B coach meal must fail (FK 23503), also via update. (Task 1 pgTAP.)
4. **Odd search input:** emoji, only punctuation, "Crème brûlée" vs "creme brulee", 60-char strings, a single letter — no throw, sensible results, empty query lists nothing on Log a meal. (Task 3 tests.)
5. **Midnight and day strip:** the strip must roll to the new day like the current screen does (today last, no future day), and a queued meal shows its ● before it reaches the server. (Task 3 `dayStrip` tests; Task 5 keeps the existing `rollOver` wiring.)

---

### Task 1: Database — coach meals, link column, storage, counts

**Files:**
- Create: `supabase/migrations/20261109000500_coach_meals.sql`
- Create: `supabase/tests/coach_meals.test.sql`
- Modify: `supabase/tests/service_role_grants.test.sql` (add `coach_meals`, bump `plan(n)`)
- Modify: `supabase/tests/food.test.sql` (column grant for `coach_meal_id`, bump `plan(n)`)
- Modify: `packages/shared/src/database.types.ts` (regenerated)

**Interfaces:**
- Produces: table `public.coach_meals` (columns per spec), `public.meals.coach_meal_id`, function `public.coach_meal_log_counts(p_workspace_id uuid) returns table (coach_meal_id uuid, logged bigint)`, function `public.can_access_coach_meal_photo(p_name text, p_write boolean) returns boolean`, bucket `coach-meal-photos`.

- [ ] **Step 1: Write the failing pgTAP file** with fixtures like `food.test.sql` (coach A, clients A1/A2, coach B, client B1, a removed-client fixture via the existing remove-client helper). Assertions:
  - RLS enabled on `coach_meals`; bucket private with the two MIME types and 3145728 limit; anon has no select.
  - coach A inserts a meal in A → ok; coach A inserts into B → `42501`; client A1 insert/update → `42501` / 0 rows.
  - client A1 sees A's live meals; does not see a meal with `deleted_at` set; sees none of B's; coach B sees none of A's.
  - a past (removed) client of A sees none.
  - `delete from coach_meals` as coach A → permission denied (`42501`).
  - coach cannot update `workspace_id` or `created_by` (column privileges).
  - checks: name `''`, `' x'`, 41 chars → `23514`; `ingredients` 2001 chars → `23514`; photo path in wrong folder → `23514`.
  - client A1 inserts a meal with `coach_meal_id` = an A meal → ok; = a B meal → `23503`; updating an own meal to a B coach meal → `23503`; linking to a removed A meal → ok.
  - `coach_meal_log_counts(ws_a)` as coach A returns the right count; as client A1 counts only A1's meals; as coach B for `ws_a` returns no rows.
  - storage: client A1 can read `{ws_a}/{id}-{uuid}.webp`, cannot insert it; coach A can insert/delete it; coach B cannot read; `can_access_coach_meal_photo('../x', false)` is false.
- [ ] **Step 2:** `pnpm db:test` → FAIL (`relation "public.coach_meals" does not exist`).
- [ ] **Step 3: Write the migration.** Follow `20261107012000_food.sql` style: table + checks (photo path regex built from `workspace_id`/`id`, thumb = regexp_replace), `unique (workspace_id, id)`, `before write` trigger stamping `updated_at`, `revoke all`, grants (`select` to authenticated; insert columns `id, workspace_id, name, calories, protein_g, carbs_g, fat_g, ingredients, how_to, photo_*`; update the same minus `id, workspace_id`, plus `deleted_at`; full to service_role). Policies: select `is_coach_of(workspace_id) or (deleted_at is null and is_client_in(workspace_id, auth.uid()))`; insert/update `is_coach_of(workspace_id)`. `alter table meals add column coach_meal_id uuid`, FK `(workspace_id, coach_meal_id) references coach_meals (workspace_id, id) on delete set null (coach_meal_id)`, index, grant insert/update `(coach_meal_id)`. Counts RPC security invoker, `stable`, grouped `count(*)`. Storage function security definer (pattern of `can_access_meal_photo`: read = `is_member_of`, write = `is_coach_of`), bucket upsert, three storage policies.
- [ ] **Step 4:** `pnpm db:reset && pnpm db:test` → all pass. `pnpm db:types`.
- [ ] **Step 5: Commit** `feat: add coach meals table, photo bucket and meal link`.

### Task 2: Shared — extract the smart-search engine

**Files:**
- Create: `packages/shared/src/search/smart-search.ts`, `packages/shared/src/search/index.ts`
- Modify: `packages/shared/src/exercises/search.ts` (import the primitives; public API unchanged), `packages/shared/src/index.ts`
- Test: `packages/shared/test/search/smart-search.test.ts`; `packages/shared/test/exercises/search.test.ts` (no edits)

**Interfaces:**
- Produces:
  - `normalizeSearchText(s: string): string` (moved; still re-exported from `exercises/search.ts`)
  - `type SmartDoc = { name: string; extraWords?: readonly string[]; synonyms?: Readonly<Record<string, string>> }`
  - `type SmartIndex<T> = { items: T[]; entries: SmartEntry<T>[]; vocab: string[] }` (`SmartEntry` opaque; carries `words`, `nameNorm`, `joined`, `joinedWord`, `other`)
  - `buildSmartIndex<T>(items: readonly T[], doc: (item: T) => SmartDoc): SmartIndex<T>`
  - `type SmartHit<T> = { item: T; tier: 1 | 2 | 3 | 4 | 5; highlight: Array<[number, number]> }`
  - `smartMatch<T>(index: SmartIndex<T>, query: string): SmartHit<T>[]` — unordered beyond tier; callers sort with their own boosts.
  - Lower-level exports used by exercises: `formsOf`, `tokenizeWithRanges`, `buildQueryTable`, `matchWordIn`, the kind constants `EXACT | PREFIX | TYPO | OTHER`.

- [ ] **Step 1: Write failing tests** `smart-search.test.ts` over plain items `{ name }`:
  - `'chiken'` finds "Chicken & rice" (typo, tier 4); `'rice chicken'` finds it (word order); `'eggs'` finds "Egg white wrap" (stem); `'creme brulee'` finds "Crème brûlée" (accent); `'oat'` finds "Protein oats" (prefix, tier 3) and "Oat bowl" ranks tier 2; exact name tier 1; `'xyz'` → `[]`; `'🍕'` and `'!!!'` → `[]` without throwing; highlight ranges for "Protein oats" with `'oat'` = `[[8, 12]]`.
- [ ] **Step 2:** `pnpm --filter @caltracker/shared test -- search` → new file FAILS, exercise file passes.
- [ ] **Step 3: Implement** by moving `normalizeSearchText`, `stem`, `formsOf`, `tokenizeWithRanges`, `withinEdits`, `typoBudget`, `buildTable`, `matchWord` and the per-group tier logic out of `exercises/search.ts` unchanged in behaviour; `exercises/search.ts` keeps its own aliases, equipment plain-name, popularity, filters and sort, and builds its `IndexEntry` from the shared entry builder.
- [ ] **Step 4:** `pnpm --filter @caltracker/shared test` → all pass, `git diff --stat packages/shared/test/exercises` empty.
- [ ] **Step 5: Commit** `refactor: extract generic smart search from exercise search`.

### Task 3: Shared — meal search, chips, log again, kcal card, day strip, coach-meal rules

**Files:**
- Create: `packages/shared/src/food/meal-search.ts`, `packages/shared/src/food/coach-meals.ts`
- Modify: `packages/shared/src/food/food.ts` (add `kcalCard`, `dayStrip`), `packages/shared/src/index.ts`
- Test: `packages/shared/test/food/meal-search.test.ts`, `packages/shared/test/food/coach-meals.test.ts`, `packages/shared/test/food/food.test.ts`

**Interfaces:**
- Consumes: `buildSmartIndex`, `smartMatch`, `normalizeSearchText` (Task 2); `MealMacros`, `MacroTargets`, `dailyTotals` (existing).
- Produces:
  - `type HistoryMeal = { id: string; eatenOn: IsoDate; eatenAt: string; name: string | null; macros: MealMacros; hasPhoto: boolean; coachMealId: string | null }`
  - `type CoachMeal = { id: string; name: string; macros: MealMacros; ingredients: string; howTo: string; photo: { path: string; thumbPath: string; width: number; height: number } | null; updatedAt: string }`
  - `type MealSearchItem = { key: string; source: 'own' | 'coach'; name: string; macros: MealMacros; coachMealId: string | null; count: number; lastEatenAt: string | null }`
  - `frequentMeals(history: readonly HistoryMeal[], today: IsoDate, opts?: { days?: number; limit?: number }): MealSearchItem[]` (defaults 28, 3)
  - `mealSearchItems(history: readonly HistoryMeal[], coach: readonly CoachMeal[], today: IsoDate): MealSearchItem[]` (own groups over 90 days; own groups whose `coachMealId` is a listed coach meal fold into it)
  - `searchMeals(items: readonly MealSearchItem[], query: string, limit?: number): MealSearchItem[]` (default 8; empty query → `[]`)
  - `type CoachMealChip = 'highProtein' | 'under500' | 'lowCarb'`; `COACH_MEAL_CHIPS: readonly { id: CoachMealChip; label: string }[]`
  - `filterCoachMeals(meals: readonly CoachMeal[], query: string, chips: ReadonlySet<CoachMealChip>): CoachMeal[]` (empty query → A–Z)
  - `mealSearchMeta(item: MealSearchItem, today: IsoDate): string`
  - `compactMacroLine(m: MealMacros): string` → `"610 kcal · 48 P · 62 C · 14 F"` (only entered macros)
  - `chipMacroLine(m: MealMacros): string` → `"320 kcal · 28 g P"`
  - `kcalCard(totals: DailyTotals, targets: MacroTargets | null, day: IsoDate, today: IsoDate): { headline: string; caption: string; bars: Array<{ key: 'protein' | 'carbs' | 'fat'; text: string; fraction: number | null }>; hasTargets: boolean }` (caption is the text after the number, e.g. `"kcal left today"`; footer chosen by the screen)
  - `dayStrip(today: IsoDate, mealDays: ReadonlySet<IsoDate>): Array<{ day: IsoDate; dow: string; num: number; hasMeals: boolean; isToday: boolean }>` (7 items, today last)
  - `COACH_MEAL_LIMITS = { name: 40, ingredients: 2000, howTo: 4000 }`, `COACH_MEAL_PHOTO_BUCKET = 'coach-meal-photos'`
  - `coachMealProblems(draft: { name: string; ingredients: string; howTo: string }): string[]`
  - `coachMealPhotoPaths(workspaceId: string, mealId: string, photoId: string, ext: MealPhotoExt): { path: string; thumbPath: string }`

- [ ] **Step 1: Write failing tests** (exact values):
  - `frequentMeals`: 3× "Greek yogurt bowl" {320,28,null,null} + 2× "Chicken & rice" + 1× "Protein shake" + 4× photo-only + 5× unnamed → names in that order, length 3; a "Breakfast" logged with two different calorie values → two separate groups each count 1; a meal 29 days back excluded; "greek  Yogurt Bowl" groups with "Greek yogurt bowl" (display name = most recent spelling); ties broken by most recent `eatenAt`; result carries `coachMealId` of the group.
  - `mealSearchItems` + `searchMeals`: own "Chicken & rice" (6×) and "Chicken wrap" (1×) and coach "Chicken burrito bowl" with `'chicken'` → order Chicken & rice, Chicken wrap, Chicken burrito bowl; `'chiken bowl'` finds the coach meal; `''` → `[]`; 20 matches → 8; own meals logged from coach meal X are absent as own items and X has `count` = their number.
  - `filterCoachMeals`: protein 35 matches highProtein, 29.9 doesn't, null doesn't; calories 500 matches under500, 501 doesn't; carbs 20 matches lowCarb; highProtein+under500 AND; `'oats'` + highProtein combines; empty query + no chips → A–Z ignoring accents.
  - `mealSearchMeta`: own count 6 → `"610 kcal · 48 P · 62 C · 14 F · logged 6 times"`; own count 1 last Thu → `"… · last Thu"`; coach → `"… · recipe"`.
  - `kcalCard`: total 1240 target 2100 today → headline `"860"`, caption `"kcal left today"`; total 2220 → `"120"`, `"kcal over today"`; earlier day → `"kcal left on Tue 3 Nov"`; protein 96/170 → `"96 / 170 g · 74 left"`, fraction ≈ 0.565; no targets → headline `"1,240"`, caption `"kcal today"`, bar text `"96 g"`, fraction null, `hasTargets` false; protein target only → caption `"kcal today"`.
  - `dayStrip('2026-11-09', {'2026-11-03','2026-11-08'})` → first `{day:'2026-11-03', dow:'Tue', num:3, hasMeals:true}`, last `{isToday:true, dow:'Mon', num:9}`, length 7; across a month and year boundary.
  - `coachMealProblems`: `''` → `["Give the meal a name."]`; 41 chars → `["Keep the name to 40 characters."]`; ingredients 2001 → `["Keep the ingredients to 2,000 characters."]`; how-to 4001 → `["Keep how to make it to 4,000 characters."]`.
  - `coachMealPhotoPaths('w','m','p','webp')` → `{ path: 'w/m-p.webp', thumbPath: 'w/m-p-thumb.webp' }`.
- [ ] **Step 2:** `pnpm --filter @caltracker/shared test -- food` → FAIL.
- [ ] **Step 3: Implement.** `searchMeals` sorts `tier`, then own before coach, own by `count` desc then `lastEatenAt` desc, coach A–Z (shared collator).
- [ ] **Step 4:** shared tests pass (both time zones, the package script runs both).
- [ ] **Step 5: Commit** `feat: add meal search, coach meal filters and food card logic`.

### Task 4: Phone data — coach link, history, coach meals

**Files:**
- Modify: `apps/mobile/src/lib/food-queue.ts` (`MealRecord.coachMealId: string | null`; parse defaults missing to `null`), `food-send.ts` (`MealFields.coach_meal_id`), `food-logic.ts` (`MealDraft.coachMealId`, `buildSaveOp` carries it; `logAgainOp`), `food-api.ts` (`MEAL_COLUMNS` + `coach_meal_id`; `fetchMealHistory`; cache), `use-food.tsx` (expose history, coach meals, `logAgain`)
- Create: `apps/mobile/src/lib/coach-meals-api.ts`
- Test: `food-queue.test.ts`, `food-send.test.ts`, `food-logic.test.ts`, `apps/mobile/src/lib/coach-meals-api.test.ts` (mapping only)

**Interfaces:**
- Consumes: `HistoryMeal`, `CoachMeal`, `MealSearchItem` (Task 3); `coach_meals` table (Task 1).
- Produces:
  - `fetchMealHistory(userId: string, workspaceId: string, since: IsoDate): Promise<HistoryMeal[]>` (columns `id, eaten_on, eaten_at, name, calories, protein_g, carbs_g, fat_g, photo_path, coach_meal_id`, limit 1000, cached in `FoodCache.history`)
  - `fetchCoachMeals(workspaceId: string): Promise<CoachMeal[]>` (live rows only by RLS; cached under `caltracker.coachMeals.{userId}.{workspaceId}`), `coachMealPhotoUrls(paths: string[]): Promise<Record<string, string>>`
  - `logAgainOp(item: MealSearchItem, ids: OpIds, today: IsoDate, now: Date): FoodOp & { kind: 'save' }` (name, macros, `coachMealId`, note `''`, no photo, `eatenOn` = today, time = now)
  - `useFood()` gains `history: HistoryMeal[]` (server history + queued ops applied), `coachMeals: CoachMeal[]`, `coachName: string | null` (first name), `logAgain(item: MealSearchItem): Promise<void>`, `loadCoachMeals(): Promise<void>`

- [ ] **Step 1: Failing tests:** legacy queued save JSON without `coachMealId` parses and `mealFields` gives `coach_meal_id: null`; `buildSaveOp` with `draft.coachMealId = 'c1'` → `meal.coachMealId === 'c1'`; editing a meal keeps its `coachMealId` when the draft passes it through; `logAgainOp` → no photo, today, `coachMealId` copied, `name` exact; history with a queued save on `2026-11-08` reports that day in the set used for the strip.
- [ ] **Step 2:** `pnpm --filter mobile test -- food` → FAIL.
- [ ] **Step 3: Implement.** History loads with the day on focus and after each sent op; coach name comes from `fetchCoachRecord()` (`coach-profile-api.ts`).
- [ ] **Step 4:** mobile tests + typecheck pass.
- [ ] **Step 5: Commit** `feat: carry coach meal link and meal history on the phone`.

### Task 5: Phone — Food tab redesign

**Files:**
- Modify: `apps/mobile/src/app/(app)/(tabs)/food.tsx`
- Create: `apps/mobile/src/components/food/day-strip.tsx`, `kcal-card.tsx`, `log-again-chips.tsx`, `meal-card.tsx`
- Delete when unused: `components/food/log-meal-sheet.tsx`, `macro-bars.tsx`, `meal-row.tsx` (check `today-food.tsx` and other imports first)
- Test: `apps/mobile/.maestro/food.yaml`

**Interfaces:**
- Consumes: `dayStrip`, `kcalCard`, `frequentMeals`, `chipMacroLine`, `compactMacroLine` (Task 3); `useFood().history | logAgain | coachName` (Task 4); `pickMealPhoto`, `photoParams` (existing).

- [ ] **Step 1: Update `food.yaml` first** to the new flow: see "kcal today" / "kcal left today", tap "Type it in", save "Maestro toast" with 300 kcal, back on Food the card shows it under "Today's meals", tap the chip "+ Maestro toast" and expect two cards; tap yesterday in the strip and see "Meals on …".
- [ ] **Step 2: Build the screen** per the Main mockup and spec Decision 5–6: strip buttons with accessibility labels `"Tue 3, meals logged"` / `"Mon 9, today"`; Snap a photo = camera via `pickMealPhoto('camera')` then `router.push('/food/meal', photoParams(...))`; Type it in = `/food/meal?day=…`; chips hidden with none; cards open the edit screen; keep `rollOver`, pull to refresh, failed Retry/Discard.
- [ ] **Step 3:** `pnpm --filter mobile typecheck && pnpm --filter mobile lint && pnpm --filter mobile test`; run Maestro `food.yaml` on the simulator → passes.
- [ ] **Step 4: Commit** `feat: redesign the food tab`.

### Task 6: Phone — Log a meal screen

**Files:**
- Modify: `apps/mobile/src/app/(app)/food/meal.tsx`
- Create: `apps/mobile/src/components/food/meal-search.tsx`, `apps/mobile/src/lib/meal-prefill.ts`
- Test: `apps/mobile/src/lib/meal-prefill.test.ts`, `apps/mobile/.maestro/food.yaml`

**Interfaces:**
- Consumes: `mealSearchItems`, `searchMeals`, `mealSearchMeta` (Task 3); `useFood().history | coachMeals | coachName`; `MealDraft.coachMealId` (Task 4).
- Produces: route params `/food/meal?coachMealId=<id>` (prefill from the cached coach meal); `prefillParams(item: MealSearchItem): Record<string, string>` and `draftFromParams(params, coachMeals, today, now): Partial<MealDraft>` in `meal-prefill.ts`; `presetName(current: string, preset: string): string` (returns `preset` only when `current.trim() === ''`).

- [ ] **Step 1: Failing tests:** `presetName('', 'Lunch') === 'Lunch'`; `presetName('Chicken wrap', 'Lunch') === 'Chicken wrap'`; `draftFromParams({coachMealId:'c1'}, [c1], …)` → name/macros of c1, `coachMealId 'c1'`; unknown id → `{}` (falls back to an empty form, no crash).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement and lay out per the Log mockup (search hidden in edit mode; Use fills name/macros/link and scrolls to the form; "or fill it in" divider; existing time stepper as "Time: 12:30 PM · Change"; kcal hint; optional photo). Extend `food.yaml`: type "toa" in search, see "Maestro toast", tap Use, Save.
- [ ] **Step 4:** mobile typecheck/lint/test + Maestro pass.
- [ ] **Step 5: Commit** `feat: add meal search and presets to log a meal`.

### Task 7: Phone — Meals from coach grid and detail

**Files:**
- Create: `apps/mobile/src/app/(app)/coach-meals/index.tsx`, `apps/mobile/src/app/(app)/coach-meals/[id].tsx`, `apps/mobile/src/components/food/coach-meal-tile.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx` (register routes if the stack lists them)
- Create: `apps/mobile/.maestro/coach-meals.yaml`

**Interfaces:**
- Consumes: `filterCoachMeals`, `COACH_MEAL_CHIPS`, `chipMacroLine` (Task 3); `useFood().coachMeals | loadCoachMeals | coachName`, `coachMealPhotoUrls` (Task 4); `/food/meal?coachMealId=` (Task 6).
- Produces: route `/coach-meals` (Task 10 links to it), `/coach-meals/[id]`.

- [ ] **Step 1: Write `coach-meals.yaml`** (needs a seeded coach meal "Protein oats" 450/35/52/11, added to the seed script used by Maestro): open `/coach-meals` by deep link, see "Meals from", type "oat" → "Protein oats"; tap "High protein" still shows it; tap "Under 500 kcal" still shows it; tap the tile → "Ingredients", tap "Log this meal" → Log a meal shows "Protein oats" and 450; Save → Food shows it.
- [ ] **Step 2: Build** per CoachMeals and MealDetail mockups: header "Meals from <name>", subtitle "N meals · tap one to log it", search placeholder "Search <name>'s meals", chip toggles (`accessibilityState.selected`), 2-column grid, empty "No meals match. Try fewer filters."; detail with "—" for blank macros, sections hidden when empty, sticky Log this meal; works from cache offline.
- [ ] **Step 3:** typecheck/lint/test + Maestro pass.
- [ ] **Step 4: Commit** `feat: add meals from coach screens on the phone`.

### Task 8: Web — Meals list and nav

**Files:**
- Create: `apps/web/src/app/(coach)/meals/page.tsx`, `apps/web/src/app/(coach)/meals/meals.module.css`, `apps/web/src/lib/coach-meals.ts` (server reads)
- Modify: `apps/web/src/app/(coach)/layout.tsx` (nav `{ href: '/meals', label: 'Meals', icon: 'meals' }` after Exercises), `apps/web/src/app/(coach)/nav-icons.tsx`
- Test: `apps/web/e2e/coach-meals.spec.ts`

**Interfaces:**
- Consumes: `coach_meals`, `coach_meal_log_counts` (Task 1); `compactMacroLine` (Task 3).
- Produces: `listCoachMeals(workspaceId: string): Promise<Array<CoachMeal & { logged: number; thumbUrl: string | null }>>` (live only, `updated_at desc`).

- [ ] **Step 1: Failing Playwright test:** coach signs in, clicks nav "Meals", sees "Shared with all your clients. They can log any of these in one tap." and a seeded meal with "logged 1×" (seed one linked client meal) and another with "not yet".
- [ ] **Step 2:** `pnpm --filter web e2e -- coach-meals` → FAIL. **Step 3:** implement per WebMeals mockup. **Step 4:** pass + web typecheck/lint/unit.
- [ ] **Step 5: Commit** `feat: add meals page to the coach website`.

### Task 9: Web — create, edit, photo, remove

**Files:**
- Create: `apps/web/src/app/(coach)/meals/new/page.tsx`, `apps/web/src/app/(coach)/meals/[id]/page.tsx`, `apps/web/src/app/(coach)/meals/meal-form.tsx`, `apps/web/src/app/(coach)/meals/actions.ts`
- Test: `apps/web/src/app/(coach)/meals/actions.test.ts`, `apps/web/e2e/coach-meals.spec.ts`

**Interfaces:**
- Consumes: `coachMealProblems`, `coachMealPhotoPaths`, `COACH_MEAL_PHOTO_BUCKET`, `parseMacroInput` (shared); web `compressPhoto` (`image-resize.ts`).
- Produces: server actions `saveCoachMeal(input: { id: string; name: string; calories: string; protein: string; carbs: string; fat: string; ingredients: string; howTo: string; photo: { path: string; thumbPath: string; width: number; height: number } | null; dropPaths: string[] }): Promise<{ error: string } | { ok: true }>` and `removeCoachMeal(id: string): Promise<{ error: string } | { ok: true }>`.

- [ ] **Step 1: Failing tests:** `saveCoachMeal` rejects a 41-char name with "Keep the name to 40 characters." and `"abc"` calories with "Enter calories as a number."; rejects a photo path not under `{workspace}/{id}-`; `removeCoachMeal` sets `deleted_at` (mock client). Playwright: + New meal → name "Turkey chili", 490/45/38/14, upload `e2e/fixtures/meal.jpg`, Save → in list; Edit → change kcal to 500 → list shows "500 kcal"; Remove meal → confirm text from the spec → gone.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Browser makes the id (`crypto.randomUUID()`), compresses, uploads both files with `upsert: false` (409 = done) to the coach-meal path, then calls `saveCoachMeal` (insert, 23505 → update, like `food-send.ts`); replaced/removed photo files deleted after save, best effort.
- [ ] **Step 4:** web typecheck/lint/unit + e2e pass.
- [ ] **Step 5: Commit** `feat: let coaches create, edit and remove shared meals`.

### Task 10: Phone — Coach tab button (separate PR, after the Coach tab redesign merges)

**Files:**
- Modify: `apps/mobile/src/app/(app)/(tabs)/coach.tsx` (rebase onto the redesigned file first)
- Create: `apps/mobile/src/components/coach/coach-meals-button.tsx`

**Interfaces:**
- Consumes: `useFood().coachMeals | coachName | loadCoachMeals` (Task 4); route `/coach-meals` (Task 7).

- [ ] **Step 1:** Extend `coach-meals.yaml` to start from the Coach tab: tap "Meals from" → grid.
- [ ] **Step 2:** Add the button between Message and Community: label "Meals from <first name>", count badge N, `accessibilityLabel` `"Meals from Luis, 12 meals"`; hidden when N is 0. All logic in the component so the `coach.tsx` change is one import and one line.
- [ ] **Step 3:** typecheck/lint/test + Maestro pass.
- [ ] **Step 4: Commit** `feat: add meals from coach button to the coach tab`.

### Task 11: Docs and final check

**Files:**
- Modify: `docs/superpowers/specs/2026-11-03-coaching-app-design.md` (item 15: add "and coach shared meals (2026-11-09; see `2026-11-09-food-and-coach-meals-design.md`). Not meal plans: no schedules."), `docs/superpowers/specs/2026-11-07-food-design.md` ("Not in this version": strike "food search", point to the new spec)

- [ ] **Step 1:** Edit both docs.
- [ ] **Step 2:** `pnpm check && pnpm db:test` → all green; paste output in the PR.
- [ ] **Step 3: Commit** `docs: record coach shared meals in the main spec`.
