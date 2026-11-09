# Food tab redesign and coach shared meals

Approved by the product owner on 2026-11-09 from the mockups (food canvas: Main, Log, CoachMeals, MealDetail,
WebMeals; coach canvas: Profile, "Meals from <coach> · N" button). Builds on `2026-11-07-food-design.md`; everything
there still holds unless changed here.

**Scope note.** "Meal plans" stays out of Version 1 (main spec, "Explicitly not in Version 1"). Coach shared meals
are **not** meal plans: they are a recipe list the coach shares with every client, with no schedule, no days, no
assignment to a client and no targets attached. The product owner confirmed this on 2026-11-09. Food databases,
barcodes and photo calorie estimates also stay out.

## Decisions

1. **Smart search everywhere.** Every meal search (Log a meal, Meals from <coach>) uses the same engine as exercise
   search: typo-tolerant, partial words, any word order, light stemming ("eggs" finds "Egg"), accents and case
   ignored, ranked exact → starts-with → contains → typo. The engine is extracted from
   `packages/shared/src/exercises/search.ts` into `packages/shared/src/search/` with exercise behaviour unchanged
   (the existing exercise search tests pass untouched).
2. **Meal search ranking.** Within a match tier: the client's own meals by how often they logged them (last 90
   days), then how recently; then coach meals A–Z. An own meal that was logged from a coach meal is not listed
   twice: it folds into that coach meal's entry (its count and recency boost the coach meal).
3. **"Log again in one tap".** Up to 3 chips: the client's own most-logged meals in the last 28 days. A meal counts
   when it has a name and at least one macro (photo-only meals are left out). Meals are the same "kind" when the
   name (normalised: case, accents, spacing) and all four macros are equal, so a "Breakfast" logged with different
   numbers each day never collapses into one chip. Most logged first, then most recent. **PO ruling 2026-11-09:** a meal logged once qualifies; the top 3 show. One tap creates a new meal
   now (today, current time) with that name, macros and coach link; the photo and note are not copied. Hidden
   when there are none.
4. **Meal-name presets stay buttons, no schema change.** Breakfast / Lunch / Dinner / Snack fill the name only when
   the name box is empty; tapping one when a name is typed does nothing to the name (the button still shows as
   chosen only when the name equals it).
5. **Day strip.** Seven days ending today (today last, dark). A ● under a day with at least one meal (server or
   queued). Tap a day to view it. No future day is ever shown. **PO ruling 2026-11-09:** ‹ › week arrows above the
   strip page back a week at a time (and forward again up to the week ending today; future days stay unreachable).
   The title reads "Last 7 days", or the range ("Tue 27 Oct – Mon 2 Nov") on an earlier week. Paging stops 12 weeks
   back; the phone keeps 91 days of meals so every reachable day gets its dot.
6. **Kcal card.** With a calorie target: "860 kcal left today" (or "120 kcal over today"; on an earlier day "… left
   on Tue 3 Nov"). Bars for protein, carbs, fat: "96 / 170 g · 74 left" (a macro with no target shows "96 g").
   Footer "Targets set by <coach first name>". With no targets at all (**PO ruling 2026-11-09**): totals only,
   "1,240 kcal today", each bar shows its grams ("96 g") with no fill, footer "Your coach hasn't set targets yet". With a protein/carbs/fat target but no calorie target: "1,240 kcal today".
7. **Coach meals visible to all current clients** of the workspace; only coaches of the workspace write them.
   Removing is a soft delete (`deleted_at`): the meal disappears for clients and from the coach list, but meals
   already logged from it keep their link and their own copied numbers.
8. **Logging from a coach meal copies, never references, the numbers.** The client's meal gets the coach meal's
   name and macros at the time of logging plus `coach_meal_id`. A later coach edit never changes past logs. The
   link is kept even if the client edits the copied numbers before saving.
9. **"Logged N×"** on the web counts all client meals (any client, current or past, in the workspace) whose
   `coach_meal_id` is that meal. "not yet" at 0.
10. **Filter chips only on Meals from <coach>:** High protein (protein ≥ 30 g), Under 500 kcal (calories ≤ 500),
    Low carb (carbs ≤ 20 g). Any number on at once (AND), combined with the text search. A meal missing the number
    a chip needs does not match that chip. Log a meal has no chips; coach results there carry the tag
    "From <coach first name>".
11. **Coach tab button** "Meals from <coach first name> · N" between Message and Community, N = live coach meals.
    Hidden when N is 0. Built as its own small step because the Coach tab is being redesigned on another branch.

## Data model (migration `20261109000500_coach_meals.sql`)

`coach_meals`
| column | rule |
|---|---|
| `id uuid pk` | made in the browser (photo paths include it) |
| `workspace_id uuid` | references workspaces, cascade; `unique (workspace_id, id)` for the meals FK |
| `name text` | 1–40 chars, trimmed (same limit as `meals.name`, since it is copied there) |
| `calories numeric(5,0)`, `protein_g`, `carbs_g`, `fat_g numeric(5,1)` | nullable, same ranges as `meals` |
| `ingredients text` | default `''`, ≤ 2000 chars |
| `how_to text` | default `''`, ≤ 4000 chars |
| `photo_path`, `photo_thumb_path`, `photo_width`, `photo_height` | optional, both-or-neither; path `{workspace_id}/{id}-{photo uuid}.{webp|jpg}`, thumb `…-thumb.{ext}`; width/height 1–1600 |
| `created_by uuid` | default `auth.uid()`, set null on user delete |
| `created_at`, `updated_at` | trigger stamps `updated_at` |
| `deleted_at timestamptz` | null = live |

`meals.coach_meal_id uuid null`, composite FK `(workspace_id, coach_meal_id)` → `coach_meals (workspace_id, id)`
`on delete set null (coach_meal_id)`, so a client can only link a coach meal of the same workspace. Index on
`coach_meal_id`. Column insert/update granted to `authenticated`.

`coach_meal_log_counts(p_workspace_id uuid) returns table (coach_meal_id uuid, logged bigint)`, security invoker
(coach RLS on `meals` already sees every meal in the workspace; a client sees only their own counts).

**Access (RLS)**
- Select: a coach of the workspace sees all rows (also removed ones); a current client of the workspace sees rows
  with `deleted_at is null`. Nobody else.
- Insert / update: coach of the workspace only (`is_coach_of`). Column grants exclude `workspace_id` on update and
  `created_by`. No delete privilege (remove = set `deleted_at`).
- Storage bucket `coach-meal-photos`: private, 3 MB, WebP/JPEG. Read: any member of the workspace (coach or current
  client); write/delete: coach of the workspace. `can_access_coach_meal_photo(name, write)` returns false for any
  malformed name.

## Screens

**Phone, Food tab** (Main mockup): header "Food"; day strip; lime kcal card with bars; two big buttons **Snap a
photo** (camera, then Log a meal with the photo) and **Type it in** (Log a meal); "Log again in one tap" chips
("+ Greek yogurt bowl", "320 kcal · 28 g P"); "Today's meals" (or "Meals on Tue 3 Nov") as cards: 64 px thumbnail
(or a "kcal" tile when typed in), name (or "Meal"), time, "450 kcal · 32 P · 48 C · 14 F". Pending/failed states,
Retry/Discard, pull to refresh and offline cache as today.

**Phone, Log a meal** (Log mockup): Cancel · "Log a meal"; search box "Search your meals"; up to 8 results, each
name, optional "From <coach>" tag, "610 kcal · 48 P · 62 C · 14 F · logged 6 times" (own, count ≥ 2), "· last Thu"
(own, once), "· recipe" (coach), and **Use** (fills name, macros, coach link; keeps time and photo). Nothing listed
until something is typed. "or fill it in": name box "What did you eat?", Breakfast/Lunch/Dinner/Snack, "Time: 12:30
PM · Change", 4 macro boxes, the kcal hint, "Add a photo (optional)", **Save meal**. Edit mode is the same screen
without the search. Saves go through the existing queue.

**Phone, Meals from <coach>** (CoachMeals): back to Coach; "Meals from Luis", "12 meals · tap one to log it";
search "Search Luis's meals"; chips High protein / Under 500 kcal / Low carb; two-column grid (photo or colour
tile, name, "450 kcal · 35 g P"). Empty: "No meals match. Try fewer filters." Offline: last loaded list.

**Phone, coach meal detail** (MealDetail): photo; "From Luis"; name; four boxes (kcal, protein, carbs, fat; "—"
when blank); Ingredients and How to make it (hidden when empty, line breaks kept); sticky **Log this meal** →
Log a meal prefilled (today, now, no photo).

**Web, Meals** (WebMeals): nav item "Meals" after Exercises. Title "Meals", "Shared with all your clients. They can
log any of these in one tap."; **+ New meal**; list (thumbnail, name, "450 kcal · 35 P · 52 C · 11 F", "logged 9×"
/ "not yet"), newest edited first. Edit form: Name, photo (Add/Change/Remove photo; compressed in the browser with
the existing `compressPhoto`, 1600 px + 320 px thumbnail), kcal/Protein g/Carbs g/Fat g, Ingredients, How to make
it, **Save**, **Remove meal** (confirm: "Remove this meal? Clients won't see it any more. Meals they already
logged stay.").

## Shared logic (`packages/shared`)

- `search/smart-search.ts`: the generic engine (normalise, stem, tokenise with ranges, typo distance, vocabulary,
  per-query tables, tiering). `exercises/search.ts` keeps its public API and is built on it.
- `food/meal-search.ts`: building search items from own meals + coach meals, `searchMeals`, `filterMeals`
  (chips), `frequentMeals`.
- `food/coach-meals.ts`: limits, `coachMealProblems`, `coachMealPhotoPaths`, `compactMacroLine`.
- `food/food.ts` additions: `kcalCard`, `dayStrip`.

## Testing

- pgTAP `supabase/tests/coach_meals.test.sql`: RLS on; client of A reads live A meals, not removed ones, not B's;
  coach of B can't read or write A's; client can't insert/update; coach can't delete; past client can't read;
  storage read/write per role and malformed names; a client can't link a meal to another workspace's coach meal
  (FK); counts RPC; `service_role_grants.test.sql` and `food.test.sql` updated for the new table and column.
- Vitest: unchanged exercise search suite plus new smart-search, meal search/filter/frequent, kcal card, day strip
  and coach-meal tests; mobile queue/send/logic tests for `coachMealId` (and old queued items without it).
- Playwright `apps/web/e2e/coach-meals.spec.ts`; Maestro `food.yaml` updated and `coach-meals.yaml` added.

## Build notes (2026-11-09)

- The Coach tab button (decision 11) is built separately once the Coach tab redesign lands. Until then the phone's
  Meals from <coach> screens exist (`/coach-meals`) but are reached only by link; coach meals still show in Log a
  meal search with the "From <coach>" tag.
- The phone keeps the 91-day meal history and the coach meal list inside its saved food copy (cleared on Sign out
  with the rest of the food log), so search, "log again" and Meals from <coach> work with no signal.
- Log a meal keeps the optional note field from the first food version (not in the mockup), so nothing a client
  could already do goes away.
