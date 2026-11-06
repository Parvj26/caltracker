# Client Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone's Today tab leads with today's workout, followed by the week strip, streak, zoo book, latest PR and the coach's latest word. On a rest day, the streak card moves up.

**Architecture:** Pure state builders in `packages/shared` produce a `HomeModel` from cached data. The screen only renders the model. Cards for features that aren't merged yet (zoo, PRs, messages) render only when their data source exists. Each one is guarded by a capability check, so nothing half-built is ever shown.

**Tech Stack:** TypeScript strict, Vitest, Expo SDK 58, Maestro.

**Spec:** `docs/superpowers/specs/2026-11-05-client-home-design.md`

**Branch:** `feature/client-home`, from `main`, after stickers (Phase 4) and messages merge. The streak, zoo and PR cards need stickers; the coach-message card needs messages.

## Global Constraints
- Card order on a training day:
  1. greeting
  2. today's workout card(s)
  3. week strip
  4. streak card
  5. zoo card
  6. latest PR (only from the last 14 days)
  7. coach card
- On a rest day the order is the same, except the streak card sits above a "Rest day" card that reads "Next: {workout} on {weekday}".
- Copy:
  - "Hey {first name} 👋"
  - "Start workout", "Resume {name}", "Done ✓ · {duration}", "View"
  - "Rest day", "Next: {name} on {weekday}", "Log a workout"
  - "🔥 {n}-week streak", "next: {landmark}", "Train this week to keep your streak", "Train this week to start your journey"
  - "Zoo book · {n} of 30", "Latest: {name} ×{n}"
  - "PR · {exercise} {weight} × {reps} · {weekday}"
  - Coach card: "{coach} on {workout}: "{comment}"" or "{coach}: "{message}""
- The week strip runs Mon–Sun in the client's time zone. It shows ✓ for a day with a completed workout, today is outlined, and a past planned day that wasn't completed gets a soft dot. Never show the word "missed".
- The first-time state stays as built (Meet your coach). The streak and zoo cards show their empty versions.
- Use tokens only. The cards are tappable and at least 44 px tall.

## Review Focus
1. **Two workouts today**: two cards, each with its own Start. Test: Task 1.
2. **Today's workout already done and a second one planned**: the done card shows "Done ✓" and the second shows Start. Test: Task 1.
3. **No coach comment or message yet**: the coach card is hidden and nothing is empty. Test: Task 1.
4. **Offline cold start**: the home screen draws from the cache. Test: Task 2 (Vitest, model from cache).
5. **Time zone at midnight Sunday**: the week strip changes to the new week. Test: Task 1.

---

### Task 1: Shared home model
**Files:**
- Create: `packages/shared/src/client-home/model.ts` and its test.

**Produces:** `buildClientHome(input: { today: IsoDate; timeZone: string; todaysWorkouts; weekWorkouts; weekLogs; nextPlanned; stats: ClientStats | null; latestSticker; recentPrs; latestComment; latestMessage }): HomeModel`
- `HomeModel` is `{ cards: Array<{ kind: 'workout' | 'rest' | 'week' | 'streak' | 'zoo' | 'pr' | 'coach'; ... }> }`, in render order.
- [ ] **Step 1: Write failing tests** for all five Review Focus cases, plus:
  - the rest-day ordering
  - the empty-streak copy
  - PR older than 14 days is hidden
  - the newer of a comment or a message wins
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the shared tests and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): decide what the client home screen shows`

### Task 2: Phone home screen
**Files:**
- Modify: `apps/mobile/src/app/(app)/(tabs)/today.tsx`
- Create: `apps/mobile/src/components/home/*`, `apps/mobile/src/lib/home-data.ts` (gathers the inputs and caches them) and `.maestro/client-home.yaml`

**Interfaces:**
- Consumes: Task 1, the logging provider, stickers data (`client_stats`, `sticker_awards`, `personal_records`), comments, messages and `useCoachProfile`.
- [ ] **Step 1: Write failing tests:**
  - Vitest: `home-data` builds from the cache when fetch fails.
  - Maestro:
    - On a training day, the first card is Start, and Start opens logging.
    - After finishing, the strip shows today ✓ and the zoo card shows the new sticker.
    - On a rest day (helper: no workout today), the streak card is above the Rest day card.
    - A seeded coach comment appears on the coach card.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check`, rebuild, and run all Maestro flows. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): give clients a home screen that leads with today's workout`
