# Simpler workout logging (Everfit-style)

Approved by the product owner on 2026-11-06 (mock-ups "simple-logging": Main, SecWarm, Warmup, Section, Superset,
SS3, SubSheet, SS3Sub, FinStart, FinPick, Finish, Summary). Replaces the one-set-at-a-time stepper pages, the rest
timer and the Edit sets sheet of the logging redesign. Why: the product owner's wife found the old screen too
complicated.

## Flow

1. **Overview** (inside the log): the workout name, Start workout / Continue, the equipment, each section with
   its exercises (photo, name, the coach's targets in one line, ×N, "⇄ or: X" when there is a substitute).
   Also + Add exercise, Finish workout and Discard workout. ✕ goes back to Today; the workout keeps going.
2. **Start section** page for each section ("Section 2 of 4", the name, "3 supersets · 6 exercises" or "Pick one
   of 3 · swipe to choose", Start section / Continue section, the list). A workout without sections is one section
   named after the workout. ⌄ goes back to the overview.
3. **Pages**, swiped left and right, with dots (tap to jump), Mark all and Done fixed at the bottom:
   - a straight exercise: big demo photo (tap: the exercise sheet with Watch demo), name, the coach's rest as
     text ("Rest 1:00"), the tools row (↺ last time, ✉ note for the coach, ⇄ substitute or swap, ••• more: note,
     how to, swap, add a drop set, remove), and the set table SET | LB | REPS | ✓ (columns follow the tracking
     type: reps only, time, distance, weight + reps). W = warm-up, D = drop (indented), F = drop to failure; the
     tag opens a short explanation.
   - a superset: "Superset N · Round r of R", every round stacked; the current round shows each exercise with a
     96 pt photo and its tools. An exercise with no set in a round is left out of it.
   - a pick-one group: one page per option. Logging an option (a typed number or ✓) picks it; switching is
     possible until a set is ticked, then the other options say which one is being done.
   Done goes to the next page, after the section's last page to the next section's start page, and after the last
   section to the finish sheet. ✕ goes back to the section start page.
4. **Finish workout?**: "N of M sets done", which sets aren't ticked (saved as not done), How did it feel?
   (Easy / OK / Good / Hard / Max), a note for the coach, Keep going / Finish. Then the sticker reveal and the
   summary, which now lists **Changes from the plan** (substitutes and swaps, the picked option of each pick-one
   group).

## Rules

- No rest timer, no rest ring, no elapsed clock: ✓ only completes the set.
- Every number can be changed at any time, also after ticking (the set stays ticked); ✓ again unticks. + Add set;
  swipe a row left (or the VoiceOver action) to delete it. Pre-fill is unchanged (shared `resolveSetValues`):
  what was typed, a changed weight carried forward unless the coach planned per-set numbers, the coach's numbers,
  then last time. Mark all ticks every open set with its pre-fill, one after the other.
- "How did it feel?" has no column of its own: it is saved as the first line of the workout note ("Felt: Good"),
  followed by the note (shared `composeFinishNotes` / `readFinishNotes`, op `setLogNotes`).
- "Not synced yet" only shows once changes have waited more than 4 seconds to upload.
- Substitutes use the shared ops from `2026-11-06-substitutes-design.md` (`chooseSubstitute`).

The page model (sections → pages → rows) is `apps/mobile/src/lib/log-flow-model.ts`, tested in
`log-flow-model.test.ts`; it only lays out what the shared rules decide.
