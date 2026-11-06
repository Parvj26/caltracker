# Workout logging redesign ("one exercise at a time"): design

**Status:** approved by the product owner from mockups on 2026-11-06 (design B, "one exercise at a time").

**Mockups (visual source of truth for layout, not colours or fonts):** `Main.dc.html` (logging a set), `Superset.dc.html`,
`DropSet.dc.html`, `Rest.dc.html`, plus the rules note in `canvas.json`. Published artifact:
https://claude.ai/artifact/TiSHmXevFpwLR2dAd5nRS3. The app uses its own theme tokens (`apps/mobile/src/theme`), never the
mockups' colours or fonts.

**Replaces:** the list layout of the client logging screen built in Phase 3a and polished in PR #18 (photos, swipe to
delete). Everything else from 3a stays: saving on the phone, the upload engine, auto-finish, Resume, the sync pill, the
summary.

## In plain words (for the product owner)

- The logging screen now shows **one exercise at a time**, like a card. Swipe left or right (or tap "‹ previous" /
  "next ›") to move between exercises. A strip at the top shows which exercises are done, which one you're on and
  which are still to do. Tap "2 of 5" to see the whole list and jump anywhere. **Finish** is always at the top.
- Logging a set is two big **+ / −** buttons for weight and reps (tap the number to type instead) and one big
  **Done** button that says what happens next: "Done · start rest 1:30", "Done · straight to drop 2",
  "Done round 2 · rest 1:30".
- The numbers start as **the coach's plan**. If you change the weight on one set, the next set **remembers your
  change**, unless the coach planned different weights per set (like a pyramid). If the coach left the weight blank, it
  uses **what you lifted last time**. "Last time" is always shown underneath as a reminder.
- **Supersets** show both exercises together (A1, A2). Done on A1 goes straight to A2; the rest timer only starts after
  the last exercise of the round. **Drop sets** show the drops as steps under the main set, with no rest between them
  and the weight already lowered. **Warm-ups** are marked W, look lighter, and **no longer count towards volume** (or
  personal bests, which already ignored them).
- While resting, a **big countdown ring** fills the top of the screen with −15 / +15 / Skip and "Next: Barbell Squat ·
  set 2 of 3 · 135 lb × 8". The old list is still one tap away under **Edit sets**, where you can untick, delete
  (swipe or ⋯), add sets and add drops exactly as today.

**One rule change to know about:** volume ("8,420 lb lifted") will no longer include warm-up sets. This applies
everywhere volume shows: the phone summary, the coach's Activity page and workout page, and the volume animal sticker.
Volume is worked out when it's shown, so older workouts that had warm-ups will show a slightly lower number from now
on. Stickers already awarded don't change.

## Scope

**In:** the client's logging screen (`apps/mobile/src/app/(app)/log/[id]/index.tsx`) and its components, the pre-fill
rule, the step order for supersets and drops, the Done label, the rest panel, the volume rule change, and updated
Maestro flows.

**Out (unchanged):** the summary screen (and the sticker reveal from the stickers branch), Today/Resume banner, the
log store and sync engine (`log-store.ts`, `log-sync.ts`), auto-finish and reminders, the coach dashboard pages
(they only change through `logVolumeKg`), the database (no migration), the iPad coach logging (3b).

## The screen, top to bottom (logging a set)

1. **Top bar:** "‹" back to Today (44 pt) · the **"2 of 5" pill** (opens the exercise list) · the elapsed workout
   timer · **Finish**. Finish asks the same questions as today ("Complete at least one set to finish." /
   "Finish with N sets not done? They won't count.").
2. **Sync pill** ("Not synced yet") under the top bar, only while changes wait to upload, as today.
3. **Progress strip:** one segment per exercise page: done (every set ticked), current (the page on screen), to-do.
4. **Exercise photo** area: the exercise's start/end photos from the existing exercise details (cached for offline),
   with a **How to** button that opens the existing info sheet (photos, muscles, steps, Watch demo). Custom exercises
   show the existing placeholder.
5. **Name and reference line:** the exercise name, then "Coach: 3 × 10 reps · 50 lb · Last time: 45 lb × 10". Either
   half is left out when there's nothing to show. "Swapped in for this workout" and the client's note show under it,
   as today.
6. **Set heading:** "Set 2 of 3" with one dot per set (done / current / to-do; warm-up dots lighter). Warm-ups read
   "Warm-up 1 of 2" with a W chip.
7. **Steppers:** for weight-and-reps exercises, weight (lb or kg) and reps side by side, each "−  number  +".
   Tapping the number opens the keyboard to type, saved as typed (same parsing as today).
8. **Done** button (full width, at least 54 pt tall) with the next-step label.
9. **Action row:** Edit sets · Note · Swap.
10. **Move row:** "‹ previous exercise name" · "swipe to move" · "next exercise name ›" (each 44 pt). Hidden at the
    ends.
11. **Up next** card: the next page's exercise name with its plan ("Seated Cable Row · 3 × 12 reps"). Hidden on the last
    page.

## Behaviour rules

### Pages and moving
- **One page per block:** a straight exercise is one page; a superset (A1, A2 …) is one page.
- Swipe, the ‹ › buttons and the list all move pages **without ticking anything**. Skipped sets stay unticked and are
  counted by Finish's "N sets not done" question, as today.
- On opening (start or resume), the screen shows the **first page with an unticked set**.
- After **Done on the last open set of a page**, the screen moves on its own to the next page that still has open sets
  (looking forward first, then wrapping round to skipped pages). If nothing is left anywhere, the page shows an
  "All sets done ✓" card with a big **Finish workout** button.
- A page whose sets are all ticked, visited by swiping, shows the same "All sets done ✓" card with a "Next exercise ›"
  button (or Finish when nothing is left), plus the step list so the client can see what they did.
- **Exercise list** (from the pill): one row per page ("Barbell Squat · 2 of 3 sets", supersets as
  "A1 Pull-up + A2 Push-up"), a ✓ on finished pages; tapping a row jumps there. At the bottom: **+ Add exercise**
  (existing picker; the new exercise becomes the last page and the screen jumps to it) and **Discard workout** (same
  confirmation as today).
- A workout with no exercises (unplanned, just started) shows a card "Add your first exercise to start logging." with
  **+ Add exercise**; the pill is hidden.

### Which set is "current"
- Straight page: the first unticked set in order (warm-ups, then working sets, each followed by its drops).
- Superset page: rounds in order; within a round, each exercise's set (and its drops) in A1, A2 … order. Exercises with
  fewer sets simply drop out of later rounds. The current step is the first unticked step in that order.
- In a superset, tapping the other exercise's card makes it the active one (its first unticked set), so the client
  can log out of order or use Note/Swap on it. The choice is forgotten after the next Done.

### Pre-fill (shared rule, `resolveSetValues`)
What the steppers show for a set that the client hasn't typed into. Worked out for each field the exercise tracks;
untracked fields are empty.
1. A value the client already entered on this set (typed, stepped, or saved by Done) always wins.
2. **Weight** of a warm-up or working set: find the nearest earlier set of the **same type** in this exercise that has
   a weight. If there is one, and the coach either left this set's weight blank or planned the **same** weight as that
   earlier set, use the earlier set's weight (this is how a change carries forward). If the coach planned a
   **different** weight for this set (pyramid), use the coach's number.
3. **Weight** of a drop: the coach's drop weight; if blank, the weight of the step above it (the main set or previous
   drop), which the client then lowers with −.
4. Otherwise the coach's number for this set (reps use the top of a range: "8–10" starts at 10, as today).
5. Otherwise the same field from the nearest earlier set of the same type in this exercise (so an unplanned exercise
   repeats the client's own numbers).
6. Otherwise **last time**: the matching set from the client's most recent finished log of this exercise (the nth
   working set matches the nth working set; warm-ups match warm-ups; if last time had fewer sets of that type, the
   last one of that type).
7. Otherwise empty.

The numbers are saved onto the set when the client presses Done (only into fields still empty, so a value typed a
moment earlier is never overwritten). Unticked sets keep empty actuals, which is why a new workout no longer copies
the plan into every set at Start.

### Steppers
- Weight: ±5 lb or ±2.5 kg, on the number as shown (lb is always a whole number, via the shared units rules).
- Reps: ±1. Time: ±15 s (shown m:ss). Distance: ±0.1 mi or km.
- Never below 0; never above today's limits (1000 kg, 1000 reps, 24 h, 1,000 km). − on an empty field leaves it
  empty; + on an empty field starts at one step (5 lb, 2.5 kg, 1 rep, 0:15, 0.1).
- Reps-only exercises show a "Body" tile in place of the weight stepper (as in the superset mockup). Time and distance
  exercises show their one stepper.
- No press-and-hold repeat in this version (typing covers big jumps).

### Done and what happens next (shared rule, `afterDone` + `doneLabel`)
Exact labels (`{clock}` is m:ss, e.g. 1:30):

| Situation after this step | Label | Then |
|---|---|---|
| The next step is a drop of this set | `Done · straight to drop {n}` | no rest; drop n is current, weight pre-lowered |
| Superset, another exercise follows in this round | `Done · straight to {A2}` | no rest |
| Superset, last exercise of the round, rest > 0 | `Done round {r} · rest {clock}` | rest starts |
| Superset, last exercise of the round, no rest | `Done round {r}` | next round |
| Straight, rest > 0 | `Done · start rest {clock}` | rest starts |
| Straight, no rest, more sets on this page | `Done · next set` | |
| Straight, no rest, page finished | `Done · next exercise` | moves page |
| This is the last unticked set of the whole workout | `Done · last set` | no rest; "All sets done ✓" card |

- **Rest length:** straight pages use the set's own planned rest; after a drop chain, the rest of the chain's main
  set. Superset rounds use the **longest** planned rest among that round's sets (coaches often put the rest only on
  A2 or only on A1). Drops never rest.
- Done never unticks. Unticking happens in Edit sets (tap the ✓ again), as today.
- Done is allowed with empty numbers (as ticking is today); the set is saved with what it has.
- Done gives the existing light haptic and re-schedules the "Still training?" reminder, like a tick today.

### Superset page (mockup `Superset.dc.html`)
- Header: "SUPERSET · Round 2 of 3 · Rest 1:30 after both" (rest part hidden when 0).
- One card per exercise labelled A1, A2 … The active one is expanded (photo thumb, name, reference line, steppers);
  the others are one line: "Done · 60 lb × 8" for this round's ticked set, or "Up next · 8 reps" for an unticked one.
- Below Done: round chips "Rounds 1 2 3" (done / current / to-do) and "After this round: Round 3 · A1 Pull-up" (or the
  next page's name after the last round).

### Drop sets (mockup `DropSet.dc.html`)
- When the current set has drops (or is a drop), the set heading adds a "DROP SET" chip and "No rest between drops".
- The main set and its drops are listed as steps: ticked ones show their result ("20 lb × 12 ✓"), the current one
  holds the steppers, later ones show the coach's plan ("Drop 2 · 10 lb × to failure").
- **+ Add another drop** under the steps adds a drop after the last one (shared `addLogDrop`, parent = the main set).
  Adding the first drop to a set stays in Edit sets (⋯ → + Drop).

### Warm-ups
- W chip, lighter surface, "Warm-up 1 of 2". Under the step list on an exercise with warm-ups:
  "Warm-ups don't count towards volume or personal bests."
- Volume: the shared `logVolumeKg` now skips warm-up sets (it still counts drops). This amends main spec §6 "Volume and
  comparisons" and the stickers spec's restated rule; both are updated in the same commit as this spec. PRs already
  skip warm-ups in the shared PR rules on `feature/stickers`; nothing is duplicated.

### Rest (mockup `Rest.dc.html`)
- While a rest runs, a **rest panel** sits under the progress strip on every page: a large ring that empties as time
  passes, the countdown in the existing big rest-clock style, and −15 / +15 / Skip (each at least 54 pt).
- Under the ring: "Next: {exercise} · {set name} · {numbers}", e.g. "Next: Barbell Squat · set 2 of 3 · 135 lb × 8",
  for the **page on screen** (with "A2 " before the name inside a superset). Numbers come from the pre-fill rule.
- The page below shows "THIS EXERCISE": the step list (W rows lighter, ticked rows with their result and ✓, the next
  one marked "next"). The photo, steppers and Done are hidden until the rest ends.
- Swiping still works during a rest; the panel stays and the "Next" line follows the page on screen.
- At zero: the existing buzz (and notification when the app is in the background), the panel closes and the steppers
  come back. −15 can't take the rest below 1 s left (existing rule). The ring's full length grows when +15 is used.
- The rest stays in memory only, as today (leaving the screen and coming back keeps it; closing the app drops it).

### Edit sets, Note, Swap, How to
- **Edit sets** opens a sheet with today's list for this page (all its exercises): the existing set rows with the W/1/↳
  labels, ✓ to tick or untick, number boxes, **swipe left to delete**, the **⋯ set menu** (+ Drop, Remove set),
  **+ Set**, and the exercise ••• menu (Swap, Add/Edit note, Remove exercise). Unticked sets show their pre-filled
  numbers as grey placeholders; ticking an unticked set here saves those numbers (like Done) but doesn't start a rest.
- **Note** opens the existing note sheet for the active exercise. **Swap** opens the existing exercise picker in swap
  mode (the picker is being replaced on `feature/exercise-search-v2`; this screen only uses its props `title`,
  `visible`, `onPick`, `onClose`).
- **How to** (and tapping the photo or name) opens the existing exercise info sheet with Watch demo.
- Menus inside the Edit sets sheet open on top of it; actions that need another full sheet (Swap, Note) close Edit
  sets first.

### Things that stay exactly as they are
- Saving on the phone after every change, upload retry, the "Not synced yet" pill, the server-wins rules
  (`log-store.ts`, `log-sync.ts`, `use-active-log.tsx` apart from the two additions below).
- Auto-finish after 3 h idle, the 20-minute reminder, Resume banner on Today and Workouts, the summary screen and
  "Add missed sets".
- Tap targets: at least 44 pt everywhere, 54 pt for Done, the steppers' − and + and the rest buttons.
- lb shown as whole numbers through `kgToInput` / `formatWeight` in `packages/shared`.
- Back swipe from the screen edge stays disabled on this screen (`gestureEnabled: false`), so it never fights the page
  swipe.

## Decisions the mockups don't cover

1. **Getting back to Today:** a "‹" button at the far left of the top bar (the mockups have no way out).
2. **Discard and + Add exercise** live at the bottom of the exercise list sheet (the old ••• menu is gone).
3. **Remove exercise, untick and delete set** live in Edit sets (as today's list).
4. **Partly done exercises** show as to-do in the strip; the list says "2 of 3 sets".
5. **Auto-advance** after a page's last open set, forward first, then back to skipped pages.
6. **Rest after the very last set:** none; the "All sets done ✓" card with Finish appears instead.
7. **Superset rest:** the longest planned rest in the round.
8. **Client-added drops** start at the weight of the step above.
9. **Stepper sizes** 5 lb / 2.5 kg / 1 rep / 15 s / 0.1 distance; no hold-to-repeat.
10. **Time and distance exercises** get one stepper each; reps-only show a "Body" tile.
11. **Last-time matching** by set position within its type.
12. **The ring** is drawn with `react-native-svg` (Expo's standard, free library). It needs a fresh phone build.
13. **Workouts already in progress** when the update lands keep the numbers that the old version copied in at Start;
    carry-forward applies to sets that are still empty.
14. **iPad:** the page keeps the 480 pt content column, centred.
15. **Screen readers:** steppers are "Less weight" / "More weight" (reps: "Fewer reps" / "More reps") with the value
    read out; the strip reads "Exercise 2 of 5. 1 done."; the Done label is read as shown.

## Testing

- **Shared (Vitest, TDD):** `resolveSetValues` (every rule above, pyramid, blank coach weight, last-time matching,
  drops, warm-ups kept apart from working sets), `completeSetWith`, `afterDone`/`doneLabel` for every row of the
  table, the superset step order with uneven set counts, stepper maths in lb and kg, `logVolumeKg` skipping warm-ups.
- **Phone (Vitest):** the page model (what each page shows) and the progress strip, from fixture logs.
- **Maestro:** updated `log-workout`, `log-resume`, `log-unplanned`, `log-delete-set` (and, when those branches have
  merged first, `log-add-exercise` from exercise search and `sticker-reveal` / `zoo-book` from stickers), plus a new
  `log-flow` covering warm-ups, carry-forward, superset A1 → A2 → rest, and a drop chain.
