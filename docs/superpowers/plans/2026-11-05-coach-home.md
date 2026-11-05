# Coach Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the coach a `/home` landing page that shows today's clients and their status, this week's progress, and who needs attention.

**Architecture:**
- A server component loads a fixed set of rows through RLS, wide enough to cover any browser time zone.
- A client component works out "today" in the browser and classifies the rows with pure functions in `packages/shared`.
- Parts that depend on unbuilt features render as one shared "coming soon" component.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase JS, TypeScript strict, Vitest, Playwright, CSS modules with `--ct-*` tokens.

**Spec:** `docs/superpowers/specs/2026-11-05-coach-home-design.md`

**Branch:**
- Build on `feature/coach-home`, created from `feature/phase-3a-logging`, because this plan reads `workout_logs` and the shared `logDurationS`.
- After 3a merges, rebase it onto `main` before its PR.
- Task 1 touches only `packages/shared` and Vitest, so it can run while 3a is still finishing.
- Tasks 2–3 use the shared local Supabase and Playwright. Run them only when no other worktree is running `db:reset`, `db:test` or e2e.

## Global Constraints

- Counts and lists cover the coach's **current** clients only. Past (removed) clients never appear.
- "Today" and "this week" use the **browser's time zone**. Weeks run Monday–Sunday (`startOfWeek`).
- Coming-soon parts are greyed, with a dashed border and the words "coming soon". They are not clickable and are announced as "coming soon". Use the muted token colour, never low opacity on real data.
- Every read goes through the coach's session client (`requireCoach()`) and RLS. The service role is allowed only in e2e helpers.
- Classification logic lives only in `packages/shared` as pure functions with unit tests (CLAUDE.md).
- CSS uses existing `var(--ct-…)` tokens only. The spacing scale has no `--ct-space-5`, and `apps/web/src/styles.test.ts` fails on undefined tokens.
- Rows have a tap height of at least 44 px (`--ct-tap-min`). Below about 1000 px wide, the side column drops under the main list.
- Exact copy:
  - Section and tile titles: "Done this week", "Workouts today", "Missed 2+", "New PRs this week", "Today's clients", "Needs attention", "Missed 2+", "No workout in 5+ days", "Program ending soon", "Body scans 30+ days"
  - Statuses: "Not started", "Training now", "Done ✓ · {duration}"
  - Row text: "Missed {n} in the last 7 days", "{n} days", "30+ days", "Ends in {n} days", "Ends today"
  - Links and empty states: "Show all {n}", "No workouts planned for today.", "Plan workouts in Programs", "Everyone's on track."
  - Greetings: "Good morning" (before 12:00), "Good afternoon" (before 18:00), "Good evening"
- Database changes go only through a migration, if an index proves necessary. None are expected.

## Review Focus

1. **The browser day differs from the UTC day.** For a coach in Los Angeles at 6 pm, the UTC date is already tomorrow. Today's clients, Missed and the week must follow the LA date. Test: Task 1 (a `today` passed in, never derived), and Task 3 (a Playwright `timezoneId` test).
2. **A workout with several logs.** A discarded log followed by a completed one shows Done. An in-progress log alone shows Training now. A discarded log alone shows Not started. Test: Task 1 `workoutStatus`.
3. **A brand-new client with no workouts.** They don't appear as "No workout in 5+ days" until they have been in the workspace for 5 days. Test: Task 1 `quietClients`.
4. **A program that ends today, or one that is cancelled, or one followed by a new one.** "Ends today" shows. Cancelled assignments are ignored. A client with a later assignment that starts after the end is not listed. Test: Task 1 `endingPrograms`.
5. **The first render before the browser date is known.** A skeleton is shown, with no hydration warning, and nothing flashes with UTC data. Test: Task 2 (Playwright asserts the tiles appear and the console has no hydration error).

---

### Task 1: Shared classification functions

**Files:**
- Create: `packages/shared/src/coach-home/home.ts`, `packages/shared/test/coach-home/home.test.ts`
- Modify: `packages/shared/src/index.ts` (export everything below)

**Interfaces:**
- **Consumes:**
  - `IsoDate`, `addDays`, `diffDays(a, b)` (positive when `b` is later), and `startOfWeek` from `dates/dates.ts`
  - `LogStatus` and `logDurationS` from `logs/`
  - `compareByLastName` from `names.ts`
- **Produces** (all pure, with no `Date.now()` inside):
  ```ts
  export type HomeLog = { id: string; status: LogStatus; startedAt: string; finishedAt: string | null; lastActivityAt: string };
  export type HomeWorkout = { id: string; clientId: string; name: string; scheduledOn: IsoDate; logs: HomeLog[] };
  export type HomeClient = { id: string; firstName: string; lastName: string; joinedOn: IsoDate; lastFinishedOn: IsoDate | null };
  export type HomeAssignment = { id: string; clientId: string; startDate: IsoDate; endDate: IsoDate; cancelledOn: IsoDate | null };
  export type WorkoutStatus =
    | { kind: 'not_started' }
    | { kind: 'training'; logId: string }
    | { kind: 'done'; logId: string; durationS: number };
  export type TodayRow = { workout: HomeWorkout; client: HomeClient; status: WorkoutStatus };
  export function workoutStatus(w: HomeWorkout): WorkoutStatus;
  export function todayRows(workouts: HomeWorkout[], clients: HomeClient[], today: IsoDate): TodayRow[];
  export function weekProgress(workouts: HomeWorkout[], today: IsoDate): { done: number; planned: number };
  export function missedClients(workouts: HomeWorkout[], today: IsoDate): Array<{ clientId: string; missed: number }>;
  export function quietClients(clients: HomeClient[], today: IsoDate, exclude: ReadonlySet<string>): Array<{ clientId: string; days: number | '30+' }>;
  export function endingPrograms(assignments: HomeAssignment[], today: IsoDate): Array<{ clientId: string; assignmentId: string; daysLeft: number }>;
  export const QUIET_DAYS = 5;
  export const MISSED_WINDOW_DAYS = 7;
  export const ENDING_WITHIN_DAYS = 7;
  export const LAST_WORKOUT_LOOKBACK_DAYS = 30;
  ```
- **Rules:**
  - `workoutStatus`:
    - If any log is completed, the result is done, using the newest completed log by `finishedAt`. Its `durationS` is `logDurationS` of that log.
    - Otherwise, if any log is `in_progress`, the result is training.
    - Otherwise the result is not started.
  - `todayRows`:
    - Workouts with `scheduledOn === today` whose client is in `clients`. Workouts of unknown or past clients are dropped.
    - Sorted by `compareByLastName` on the client, then by workout name.
  - `weekProgress`: covers workouts scheduled from `startOfWeek(today)` to `+6`. `done` counts the workouts whose status is done.
  - `missedClients`:
    - Counts workouts scheduled in `[today − 7, today − 1]` whose status is not done.
    - Keeps clients with a count of at least 2.
    - Sorted by `missed` descending, then by `clientId`.
  - `quietClients`:
    - Skips any client in `exclude`.
    - Keeps a client only if `diffDays(joinedOn, today) ≥ 5`.
    - `days`:
      - If `lastFinishedOn` is set: `diffDays(lastFinishedOn, today)`.
      - If `lastFinishedOn` is null: `diffDays(joinedOn, today)`, or `'30+'` when that is 30 or more. A null means no completed log in the 30-day lookback.
      - Any number of 30 or more is reported as `'30+'`.
    - Keeps a client when `days` is at least 5 or is `'30+'`.
    - Sorted most days first, with `'30+'` first.
  - `endingPrograms`:
    - Ignores assignments where `cancelledOn !== null`.
    - Keeps an assignment when `today ≤ endDate ≤ today + 7` and the same client has no other non-cancelled assignment with `startDate > endDate`.
    - `daysLeft = diffDays(today, endDate)`. Sorted by `daysLeft` ascending.

- [ ] **Step 1: Write failing tests** in `home.test.ts`. Use a builder like `wk({ scheduledOn, logs })`. The tests:
  - `workoutStatus`:
    - `[]` gives `{kind:'not_started'}`.
    - `[discarded]` gives not_started.
    - `[in_progress]` gives training.
    - `[discarded, completed]` gives done, with the completed log's id.
    - Two completed logs give done with the newer one.
    - `durationS` equals `logDurationS` of that log, for example a 52-minute log gives `3120`.
  - `todayRows`:
    - With `today = '2026-11-05'`, only `scheduledOn === '2026-11-05'` rows appear.
    - A workout of a client not in `clients` is dropped.
    - Two clients sort by last name. One client's two workouts sort by name.
  - `weekProgress`:
    - `today = '2026-11-05'` (a Thursday) counts `2026-11-02`…`2026-11-08` only. `2026-11-01` and `2026-11-09` are excluded.
    - 3 planned, of which 1 is done and 1 is discarded, gives `{done:1, planned:3}`.
    - No workouts gives `{done:0, planned:0}`.
  - `missedClients`:
    - With `today = '2026-11-05'`, two undone workouts on `11-01` and `11-04` give `[{clientId, missed:2}]`.
    - One undone workout gives `[]`.
    - An undone workout on `11-05` (today) or `10-29` (8 days ago) is not counted.
    - A done workout is not counted.
  - `quietClients`:
    - Joined `11-03` and never logged gives `[]`: 2 days is under 5.
    - Joined `10-01` and last finished `10-30` gives `days:6`.
    - Last finished `11-01` gives `[]`: 4 days.
    - Joined `09-01` with `lastFinishedOn: null` gives `'30+'`.
    - A client in `exclude` is skipped.
    - Sort order: `'30+'`, then 12, then 6.
  - `endingPrograms`:
    - `endDate` today gives `daysLeft:0`.
    - `endDate` `today+7` is included; `today+8` is excluded; `today−1` is excluded.
    - A cancelled assignment is excluded.
    - An assignment that ends `11-10` alongside another of the same client starting `11-11` is excluded.
  - **Review Focus 1:** every function takes `today` as an argument. Add one test that calls `todayRows` with `today = '2026-11-05'` on data whose `scheduledOn` is `'2026-11-05'`, and assert that it ignores the real clock by using `vi.setSystemTime('2026-11-06T03:00:00Z')`.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test -- coach-home`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `home.ts` and the exports.
- [ ] **Step 4: Run** `pnpm --filter @caltracker/shared test`, then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): classify today's workouts and clients who need attention`

---

### Task 2: The /home page

**Files:**
- **Create:**
  - `apps/web/src/app/(coach)/home/page.tsx` (server)
  - `apps/web/src/app/(coach)/home/home-view.tsx` (client)
  - `apps/web/src/app/(coach)/home/home.module.css`
  - `apps/web/src/components/coming-soon.tsx` (plus its CSS)
  - `apps/web/src/lib/coach-home.ts` (loader)
  - `apps/web/e2e/home.spec.ts`
- **Modify:**
  - `apps/web/src/app/page.tsx`: redirect to `/home`
  - `apps/web/src/app/(coach)/layout.tsx`: put `{ href: '/home', label: 'Home', icon: 'home' }` first
  - `apps/web/src/app/(coach)/nav-icons.tsx`: add a `home` icon in the existing style
  - The sign-in success redirect, if it targets `/clients`: grep `'/clients'` under `apps/web/src/app/(auth)`
  - `apps/web/e2e/helpers.ts`, if a seeding helper is missing, for example `seedWorkout` and `seedAssignment`

**Interfaces:**
- **Consumes:** Task 1's exports, `requireCoach()` (which returns the workspace id, coach first name and units), `formatLogDuration`, `localToday`, and the browser-date subscription in `apps/web/src/lib/local-today.ts`.
- **Produces:**
  - `loadHomeData(supabase, workspaceId, utcToday: IsoDate): Promise<{ workouts: HomeWorkoutRow[]; clients: HomeClientRow[]; assignments: HomeAssignment[] }>`
    - Rows carry ISO timestamps. `home-view.tsx` turns `finished_at` and `created_at` into browser-local `IsoDate`s before calling Task 1.
  - The loader makes exactly these queries:
    1. Current clients: the client `workspace_members` rows (with `created_at`) joined to `profiles` names. Exclude past clients the way the Clients page does.
    2. Workouts with `scheduled_on` in `[utcToday − 8, utcToday + 8]`, with an embedded `workout_logs(id,status,started_at,finished_at,last_activity_at)`.
    3. Completed logs with `finished_at ≥ now − 31 days`, selecting `client_id` and `finished_at`. Reduce to the latest per client.
    4. Program assignments where `cancelled_on` is null and `end_date ≥ utcToday − 1`.
  - `<ComingSoon label="…" />`: renders the label plus "coming soon", with `aria-disabled="true"` and no link or button behaviour.

**Page behaviour (spec sections "Page and navigation" through "Needs attention"):**
- Until the browser date is known, the page shows a skeleton.
- The header shows the greeting and the date (`Intl.DateTimeFormat` weekday, day and month).
- **Tiles:**
  - Done this week is lime, with a `role="progressbar"` that has `aria-valuenow` and `aria-valuemax`.
  - Workouts today is a link that scrolls to `#today`.
  - Missed 2+ is a link that scrolls to `#missed`.
  - New PRs this week is a `ComingSoon`.
- **Today's clients:**
  - Rows show the status chips.
  - A done row links to `/clients/{clientId}/logs/{logId}`. Every other row links to `/clients/{clientId}`.
  - Not-started rows also show `<ComingSoon label="Log session" />`.
  - When there are no rows, show the empty state, which links to `/programs`.
- **Needs attention:**
  - The groups are Missed (`id="missed"`), No workout (with `<ComingSoon label="Message" />`), Program ending soon and Body scans (`ComingSoon`).
  - Groups with no rows are hidden.
  - Show "Everyone's on track." when the first three groups are all empty.
  - Each group shows 5 rows, then a "Show all {n}" button that expands it in place.
- `quietClients` gets `exclude` = the client ids from `missedClients`.

- [ ] **Step 1: Write failing Playwright tests** in `home.spec.ts`.
  - Seed with the service role, using its own client(s) and `Date.now()`-relative dates. Clean up in `afterAll`. Don't change the shared demo coach's units.
  - Tests:
    - Signing in lands on `/home`, and the "Home" nav item is current.
    - A client with a workout today shows "Not started". After `seedLog` completes it and the page reloads, the row shows "Done ✓", and its link `href` is `/clients/{id}/logs/{logId}`.
    - An `in_progress` log shows "Training now".
    - A client with 2 undone workouts on the last 2 days appears under "Missed 2+" as "Missed 2 in the last 7 days", and the tile shows at least 1.
    - A client that joined 10 days ago with no logs appears under "No workout in 5+ days".
    - An assignment ending in 3 days shows "Ends in 3 days".
    - "New PRs this week", "Message" and "Body scans 30+ days" are visible and have `aria-disabled="true"`.
    - Review Focus 5: the console has no message containing "Hydration".
- [ ] **Step 2: Run** `CI=1 pnpm --filter web exec playwright test e2e/home.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS. Existing specs that expect to land on `/clients` after sign-in are updated to expect `/home`.
- [ ] **Step 5: Commit** `feat(web): add the coach home page with today's clients and who needs attention`

---

### Task 3: Client search and the Assign shortcut

**Files:**
- **Create:** `apps/web/src/app/(coach)/home/client-search.tsx`
- **Modify:**
  - `apps/web/src/app/(coach)/home/home-view.tsx`
  - `apps/web/src/app/(coach)/clients/[clientId]/page.tsx` and `assign-dialog.tsx`: `?assign=1` opens the assign dialog on load
  - `apps/web/e2e/home.spec.ts`

**Interfaces:**
- **Consumes:** the current clients from Task 2's loader.
- **Produces:**
  - `<ClientSearch clients={{id, firstName, lastName}[]} />`
    - **Filtering:** it matches the typed text anywhere in "first last", case- and accent-insensitive (`normalize('NFD')` with the marks stripped).
    - **Keyboard:**
      - ⌘K (or Ctrl+K) focuses the box.
      - ArrowUp and ArrowDown move through the results, and Enter goes to `/clients/{id}`.
      - Escape clears the box.
    - **Results:** at most 8.
    - **Accessibility:** a combobox with a listbox, per the ARIA combobox pattern.
  - The Program ending soon **Assign** button links to `/clients/{clientId}?assign=1`, and the client page passes `initialOpen` to `AssignDialog`.

- [ ] **Step 1: Write failing Playwright tests:**
  - Typing a seeded client's last name with different case shows them. Enter navigates to their page.
  - Pressing `Meta+K` (or `Control+K` on Linux CI) focuses the search box.
  - Clicking Assign on an ending program opens the assign dialog on that client's page.
  - **Review Focus 1:** in a `browser.newContext({ timezoneId: 'America/Los_Angeles' })` context, a workout scheduled on LA's today appears in Today's clients. Seed it while it is evening in LA, so the UTC date is already tomorrow. Do this by computing LA's date with `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` and scheduling on it.
- [ ] **Step 2: Run** `CI=1 pnpm --filter web exec playwright test e2e/home.spec.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): jump to any client from home and assign an ending program in one click`
