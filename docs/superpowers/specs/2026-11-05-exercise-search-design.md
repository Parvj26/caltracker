# Smarter exercise search and picker: design

**Status:** approved in conversation on 2026-11-05.
**Main spec:** `docs/superpowers/specs/2026-11-03-coaching-app-design.md` (exercise library).

## Purpose

The coach builds every program from the exercise library (about 900 exercises, built-in and custom). Today the
search only matches name text, so finding "Dumbbell Incline Bench Press" by typing "db incline" fails. Success means:
- the coach types the way people talk in a gym and the right exercise is in the top few results;
- the coach sees a photo and the muscles worked before adding an exercise.

The trainer is about to re-create his Everfit programs here, so this has to be fast.

## Decisions (product owner)

- **Picker layout A, "List + preview".** A large dialog with these parts:
  - the search box and filter chips at the top;
  - the results list on the left, with a small photo, name and muscle/equipment tags;
  - a preview pane on the right for the highlighted result, showing the start and end photos, all muscles,
    equipment, the instructions (collapsed after two lines, with "more") and an **Add to workout** button.
- **Empty search box:** the coach's **favourites ★** come first, then their **20 most recently used** exercises,
  then the whole library A to Z.
- **The same search everywhere:**
  - the workout builder picker;
  - the **Exercises page**, which uses the same list and preview layout;
  - the phone's **+ Exercise** while logging (the phone uses its own compact layout).

## Search behaviour

The search is a pure function in `packages/shared`, `searchExercises(index, query, filters, boosts)`, with unit
tests. It runs on the device: the web app and the phone load the exercise index once and search it locally.
Results update on every keystroke, with no server round trip, and the phone search works with poor signal.

- **Normalising** (applied to both the query and the exercise text):
  - lower case;
  - accents stripped;
  - hyphens and punctuation turned into spaces;
  - "benchpress" style joins matched against "bench press" too.
- **Words in any order:** every query word must match somewhere in the exercise's searchable text, which is its
  name, muscles, equipment and category.
- **Shorthand (aliases)**, expanded before matching:
  - db = dumbbell, bb = barbell, kb = kettlebell
  - ohp = overhead press, rdl = Romanian deadlift
  - bw = bodyweight, sl = single-leg
  - ez = ez-bar, smith = smith machine
  - lat = latissimus, tri = triceps, bi = biceps
  - plus the rest of a list of about 40 entries in `packages/shared/src/exercises/aliases.ts`. The list is plain data,
    so adding to it is a one-line change.
- **Word endings:** a light suffix stripper removes plural and verb endings (s, es, ing, ed), so "curls" matches
  "curl" and "squatting" matches "squat".
- **Typos:** a query word of 5 or more letters may be 1 edit away from a word in the exercise (Damerau-Levenshtein).
  A word of 8 or more letters may be 2 edits away. Shorter words must match exactly or as a prefix.
- **Ranking** (higher tiers first):
  1. exact full name match;
  2. the name starts with the query;
  3. every query word matches a name word, exactly or as a prefix;
  4. a match that needs typo tolerance;
  5. a match only through muscles, equipment or category.

  Inside a tier, favourites come first, then recently used exercises, then shorter names, then A to Z.
- **Filters**, combined with AND between groups and OR within a group:
  - muscle chips (Chest, Back, Shoulders, Arms, Legs, Glutes, Core, Full body), mapped to the library's muscle
    names;
  - equipment chips (Barbell, Dumbbell, Cable, Machine, Kettlebell, Bodyweight, Band, Other);
  - a "Custom only" chip.

  The filters apply both with and without a query.
- **Limits:** the picker shows 50 results with "Show more". The match is highlighted in each result name.

## Favourites and recents

- **Favourites:** each coach stars exercises (☆ / ★) in the picker and on the Exercises page.
  - They are stored in a new table, `exercise_favorites (coach_id, exercise_id, created_at)`.
  - RLS: only the coach themselves can read or write their own rows.
  - Rows are deleted when the exercise is deleted.
  - pgTAP proves that another coach, and any client, cannot read or write them.
- **Recently used (coach):** the 20 most recent distinct exercises in the coach's workspace workouts, taken from the
  workout exercises of workouts the coach created, newest first.
- **Phone + Exercise (client):** shows the client's own recently logged exercises when the box is empty. There are no
  favourites on the phone in this version.

## Data loading

- **Index fields:** `id`, `name`, `primary_muscles`, `secondary_muscles`, `equipment`, `category`,
  `tracking_type`, `source` and the first image path. Instructions and the remaining photos load only for the
  previewed exercise.
- **Index scope:** the built-in exercises plus the workspace's custom ones, through the existing RLS.
- **Size:** about 150 KB.
- **Web:** loaded once per page and kept in memory.
- **Phone:** cached in AsyncStorage and refreshed in the background, so + Exercise works offline.
- **Thumbnails:** use the existing public storage URLs at a small rendered size. Each dialog lazy-loads its images.

## Accessibility and design

- The picker follows the ARIA combobox and listbox pattern.
  - Up and Down move through the results.
  - Enter adds the highlighted exercise.
  - Escape closes the picker.
  - The preview pane follows the highlighted result.
- Use the existing tokens and components only. Rows are at least 44 px tall.
- **Narrow widths:**
  - Below about 900 px the preview opens as a panel over the list, with a Back button.
  - Filter chips wrap.

## Testing

- **Vitest, shared `searchExercises`:**
  - "db incline" ranks Dumbbell Incline Bench Press first;
  - "press incline dumbbell" gives the same result;
  - "ohp" finds overhead presses;
  - "curls" matches curl;
  - "dumbel" matches dumbbell, and a short typo like "cul" does not match curl through typo tolerance;
  - "glutes" matches exercises by muscle, ranked below name matches;
  - filters, including an empty query;
  - favourites and recents break ties;
  - normalising handles accents and hyphens.
- **pgTAP:** `exercise_favorites` RLS, covering cross-coach, client and anonymous access.
- **Playwright:**
  - the builder picker finds "db incline", the preview shows photos and muscles, and Add puts the exercise in the
    workout;
  - starring an exercise moves it to the top of the empty-search list;
  - the Exercises page uses the same search.
- **Maestro:** the phone's + Exercise finds "db incline" while logging.

## Out of scope

- Editing the alias list from the UI.
- Video previews (there are no video uploads in Version 1).
- Exercise substitutions or "similar exercises" suggestions.
