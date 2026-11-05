# Coach home ("cockpit") — design

**Status:** approved in conversation on 2026-11-05 (layout A, "Today first"). This is the first version of the
coach home described in the main spec under "Coach home (dashboard and iPad)", built after Phase 3a logging.

**Main spec:** `docs/superpowers/specs/2026-11-03-coaching-app-design.md`
**Depends on:** Phase 3a logging (`workout_logs`), Phase 2 programs (`program_assignments`, `workouts`).

## Purpose

When the coach logs in, one screen answers "what needs me today?" without opening each client. Success means the
coach can see who trains today and how it's going, how the week is going overall, and who is slipping, all in a
few seconds, and get to the right client in one click.

## Decisions (product owner)

- **Layout A, "Today first":** tiles across the top, today's clients as the main list, and Needs attention in a side
  column.
- **Parts that depend on unbuilt features are shown as "coming soon".** They appear greyed, with a dashed outline and
  the words "coming soon". They are not clickable and are announced to screen readers as "coming soon". This covers
  the New PRs tile (Phase 4), the Message button (messaging), the body-scan row (InBody) and Log session (iPad
  sessions, Phase 3b). Each one goes live when its feature ships.

## Page and navigation

- A new **Home** sidebar item at the top, route `/home`. After sign-in, the coach lands here: `/` now redirects to
  `/home` instead of `/clients`.
- **Header:**
  - "Good morning", "Good afternoon" or "Good evening", then the coach's first name. The greeting uses the browser's
    time: before 12:00 is morning, before 18:00 is afternoon, and the rest is evening.
  - Today's date below the greeting, for example "Thursday 5 November".
- **Search clients (⌘K / Ctrl+K):** a search box in the header. The keyboard shortcut focuses it from anywhere on
  the page.
  - Typing filters the coach's current clients by first or last name. Matching ignores case and accents and finds
    matches anywhere in the name.
  - Up and Down move through results, and Enter opens that client's page.
  - Past (removed) clients are not included.

## Tiles

All counts cover the coach's **current** clients only. "Today" and "this week" are worked out in the **browser's time
zone**, with weeks running Monday to Sunday.

| Tile | Shows | Rule |
|---|---|---|
| **Done this week** (lime) | "18 / 29" plus a progress bar | Planned workouts this week that have a completed log, out of all planned workouts this week. 0 planned shows "0 / 0" with an empty bar. |
| **Workouts today** | count | Planned workouts scheduled today. |
| **Missed 2+** | count of clients | Clients with 2 or more planned workouts in the last 7 days (before today) that have no completed log. |
| **New PRs this week** | "—" and "coming soon" | Placeholder until Phase 4. |

Clicking **Workouts today** scrolls to Today's clients. Clicking **Missed 2+** scrolls to the "Missed 2+" group in
Needs attention. Done this week isn't clickable in this version.

## Today's clients (main list)

- One row per planned workout today. A client with two workouts today gets two rows. Rows are sorted by client
  name, then by workout name.
- **Row content:** the client's avatar initial, client name · workout name, and a status chip:
  - **Not started**: no log yet, or only a discarded one.
  - **Training now**: an `in_progress` log for this workout.
  - **Done ✓ · 52 min**: a completed log. Duration comes from the shared `logDurationS` and the existing wording
    helper.
- **Click:** a done row opens the log page `/clients/[clientId]/logs/[logId]`. Any other row opens the client's
  calendar `/clients/[clientId]`.
- **Log session** button: shown "coming soon" on not-started rows until the iPad sessions feature ships.
- **Empty state:** "No workouts planned for today." with a link: "Plan workouts in Programs".
- Unplanned workouts that a client logs today don't appear here. They show in Activity.

## Needs attention (side column)

Groups appear in this order. A group with nothing in it is hidden. If every group is empty, show "Everyone's on
track." The body-scan row is always shown, as "coming soon".

1. **Missed 2+**: clients from the tile, each shown as "Missed {n} in the last 7 days". Clicking a row opens the
   client's calendar.
2. **No workout in 5+ days**: current clients whose last completed log finished 5 or more days ago, and who joined
   the workspace 5 or more days ago. Clients who have never logged count from their join date.
   - Each row shows "{n} days" and a **Message** button, shown "coming soon".
   - A client listed under Missed 2+ isn't repeated here.
3. **Program ending soon**: current clients whose active program assignment (`cancelled_on` null) has an `end_date`
   within today through today + 7, and who have no other assignment starting after it.
   - Each row shows "Ends in {n} days", or "Ends today", and an **Assign** button. The button opens the existing
     assign-program flow for that client.
4. **Body scans 30+ days**: a single "coming soon" row.

Each group shows at most 5 rows. If there are more, a "Show all {n}" link expands the group in place.

## Data

- **Server component:**
  - Calls `requireCoach()`, then loads data with the coach's session client. Reads go through RLS only and never
    use the service role.
  - Loads a window wide enough for any browser time zone: planned workouts with `scheduled_on` from UTC today − 8
    to UTC today + 8, with their logs (`id`, `status`, `started_at`, `finished_at`, `workout_id`); current clients
    (name, `joined_at`); each client's latest completed log time; and active program assignments.
- **Client component:**
  - Computes the browser's today and week, using the same pattern as the calendar's Missed logic
    (`apps/web/src/lib/local-today.ts`), and filters the window into tiles and lists.
  - Before the browser date is known it renders a skeleton, so there is no hydration mismatch.
  - It recomputes at local midnight.
- **Pure logic in `packages/shared`:** the classification functions, with unit tests. Each one takes plain data plus
  `today`, and the app only renders their results.
  - `workoutStatus`: not started, training now or done.
  - `weekProgress`
  - `missedClients`
  - `quietClients`
  - `endingPrograms`
- **Query count:** a fixed handful of queries, never one per client. This matters because the launch coach has
  about 50 clients.
- **No database changes are expected.** If a missing index shows up while building (for example on
  `workout_logs (client_id, finished_at)`), it is added through a migration.

## Design

- Existing tokens and components only. This includes the spacing scale, which has no 5, and the lime accent for the
  Done this week tile.
- Rows have at least a 44 px tap height. The page also works on iPad widths: below about 1000 px, the side column
  drops under the main list.
- Coming-soon parts use the muted token colour and a dashed border, never a low opacity on real data.

## Testing

- Vitest covers the shared classification functions:
  - week boundaries, Monday to Sunday
  - a log finished at 23:30 local time counting for its planned day
  - discarded logs not counting
  - the 5-day and 7-day boundaries
  - a client listed in Missed not repeated in No workout
  - cancelled assignments being ignored
- Playwright:
  - The coach lands on `/home` after sign-in.
  - A seeded client with a workout today appears as Not started. After a seeded completed log it shows "Done ✓", and
    the row links to the log.
  - Missed 2+ and No workout in 5+ days show seeded clients.
  - Program ending soon shows Assign and opens the assign flow.
  - ⌘K search finds a client and Enter opens their page.
  - The coming-soon parts are present and not clickable.
  - One test runs in a `timezoneId: 'America/Los_Angeles'` context.

## Out of scope

- Real PR, messaging, body-scan and Log session behaviour. Each arrives with its own feature.
- Appointment times, notifications and email digests.
- The client app's home screen. It is a separate design, to cover the zoo book, PRs and streak.
