# Food tab

Approved by the product owner on 2026-11-07 (Wave 3). This moves "Meal plans / nutrition" partly into Version 1:
**food logging and coach-set daily targets only**. Meal plans, food databases, barcode scanning and calorie
estimation from photos stay out.

## What the client does (phone)

- The tab bar becomes **Today, Workouts, Coach, Food, Progress**. Food replaces Zoo; the Zoo book moves to its
  own screen (`/zoo`), opened from a "Zoo book" card at the top of Progress and from anything else that linked
  to it. Every Zoo link goes through one helper, `zooHref()` (`apps/mobile/src/lib/zoo-href.ts`).
- The Food screen shows, for one day (‹ day ›, Today by default, no future days):
  - totals against the coach's targets as bars for kcal, protein, carbs and fat, or "Your coach hasn't set
    targets yet" with plain totals;
  - the day's meals, newest last, with a photo thumbnail, name, time, note and macros;
  - a big **Log a meal** button opening a sheet: Take photo, Choose photo, Enter macros.
- A meal is a photo (with an optional note), macros (any of calories, protein, carbs, fat), or both. It has a
  time (defaults to now; on an earlier day, 12:00), an optional name (Breakfast, Lunch, Dinner, Snack chips or
  free text) and can be edited and deleted by the client.
- When calories are blank but other macros are filled, the form shows "≈ 520 kcal from macros" (4/4/9 kcal per
  gram). It is only a hint; it is never saved as the calories.

### Offline

Same pattern as messages (`outbox.ts`): every save and delete goes into an on-device queue (AsyncStorage, photos
copied to the documents folder), shown at once, and sent oldest first with the same backoff when there is signal.
A meal's id is made on the phone, so a repeated save is an insert that finds the row already there and updates it
instead; a repeated delete deletes nothing. Photos upload first (a repeated upload, 409, counts as done). A save
the server refuses shows "Didn't save · Retry / Discard". The day's meals and the targets last loaded are kept on
the phone, so the tab opens with no signal.

## What the coach does (web)

- A **Food** tab on the client page (after Body). It shows one week (Mon–Sun, ‹ week ›):
  - each day's totals against targets;
  - each day's meals with photos shown whole and sharp (the shared `SharpPhoto`);
  - the targets editor (calories, protein, carbs, fat; any may be blank).
- **Reply about this meal** opens Messages with the box pre-filled with "About your Lunch on Tue 5 Nov (8:10 am): ".
  It is an ordinary text message; there are no meal comments.

## Data

`meals` (one row per meal, the client's own):
`id` (made on the phone), `workspace_id`, `client_id` (always the caller), `eaten_at` (instant), `eaten_on` (the
client's local day, set by the phone, within a day of `eaten_at`), `name` (1–40 chars or null), `note` (≤ 500),
`calories` (0–10000), `protein_g`, `carbs_g`, `fat_g` (0–1000 each, one decimal), `photo_path`,
`photo_thumb_path`, `photo_width`, `photo_height`, `created_at`, `updated_at`.
A meal needs a photo or at least one macro. The photo paths must be
`{workspace_id}/{client_id}/{meal_id}-{photo_id}.{webp|jpg}` and `…-thumb.{ext}` (checked in the table). The photo's
own id means a replaced photo gets new files (uploads never overwrite); the old files are deleted after the save.

`nutrition_targets` (one row per client): `workspace_id`, `client_id`, `calories`, `protein_g`, `carbs_g`, `fat_g`,
`updated_at`, `updated_by`. Written through `set_nutrition_targets` (runs as the caller, so RLS applies).

Access (RLS, pgTAP in `supabase/tests/food.test.sql`):
- A client reads, adds, edits and deletes only their own meals, and only while a client of that workspace.
- The coach reads every meal in the workspace (also a past client's), never writes meals.
- The coach reads and writes targets for their own clients; a client reads only their own.
- Nobody reaches another workspace or another client.

Storage bucket `meal-photos` (private, 3 MB, WebP or JPEG): the client uploads and deletes inside
`{workspace}/{own id}/`; the coach of the workspace and the client read. Photos are shrunk on the phone to 1600 px
on the long edge plus a 320 px thumbnail (the existing `compressPhoto`). Editing out a photo or deleting a meal
deletes its files (best effort; a file left behind is harmless and private).

## Shared logic (`packages/shared/src/food/`)

`dailyTotals`, `macroProgress`, `kcalFromMacros`, `kcalHint`, `parseMacroInput`, `mealProblems`,
`mealPhotoPaths`, `formatMacro`, `foodDayLabel`, `weekDays`, `mealsByDay`, `mealReference`. Pure, unit-tested.

## Today screen

The goal card's `foodSlot` (from the Today cards work) shows today's kcal and protein against target once both
are on main.

## Not in this version

Meal comments (use Reply about this meal), ~~food search~~ (searching your own and your coach's meals added on
2026-11-09, see `2026-11-09-food-and-coach-meals-design.md`; a food database stays out), barcodes, photo calorie estimates, water, coach editing
a client's meals, notifications about meals, a coach-wide food overview.
