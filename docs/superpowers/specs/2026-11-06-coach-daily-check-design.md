# Coach daily check: Needs attention with reasons, and a useful Clients list

Date: 2026-11-06 · Status: approved by the product owner as "Batch 2" of the coach audit · Website only

## What

A solo coach with 10–30 clients should be able to answer "who do I need to deal with today?" in one look, on a laptop
or an iPad, without opening every client's calendar (the audit took 13 clicks and 7 page loads to find who missed a
workout this week).

1. **Home, Needs attention.** Clients are grouped by reason. Each group heading shows its count, each row says why
   the client is listed and offers actions. With no problems it says "Everyone's on track."
2. **Clients list.** One row per client: name (avatar, email), status chip with the reason underneath, last workout,
   this week done / planned, current program and its end date, Remove. Search (filters as you type), status filter
   chips with counts, and sort by name, last workout or program end date. Below about 900 px of list width the rows
   become two-line cards.

Both pages use the same rules (`checkClients` in `packages/shared/src/coach-home/daily-check.ts`), so a client who
"needs attention" on Home always has that status on the Clients list.

## Rules for each reason

All dates are the coach's own calendar dates (the browser's time zone). Planned workouts carry plain dates. "Done"
means the workout has a completed log; a discarded log or one still in progress is not done.

| Reason (Home group) | Rule | Row says | Actions |
|---|---|---|---|
| Missed 2+ in a row | The latest 2 or more past planned workouts were all not done, followed back up to 14 days, and the latest miss is within the last 7 days | "Missed 3 in a row · latest yesterday" | Open |
| Missed a workout (last 7 days) | At least one planned workout from 7 days ago to yesterday was not done, and it is not a run of 2+ | "Missed 1 · Wed 4 Nov" / "Missed 2 · latest Tue 3 Nov" | Open |
| Program ending soon | A program (not cancelled) ends today or within 7 days and no later program follows it | "Ends in 3 days · Sun 8 Nov" | Open, Assign |
| Nothing planned | Nothing still to do today and nothing planned for the next 7 days; includes clients with no plan at all | "Nothing in the next 7 days" | Open, Assign |
| No workout in 5+ days | No finished workout for 5+ days (counted from joining if they never trained; not for clients who joined under 5 days ago), and no missed-workout or nothing-planned reason already explains it | "No workout in 8 days" | Open |
| New personal bests this week | Lifts improved Monday to Sunday of this week (each lift counted once per workout, the same count as the "New PRs this week" tile) | "2 lifts improved" | Open |

- A workout planned for **today** is never missed while today is still going. It becomes missed after midnight.
- **Program ending replaces Nothing planned** for the same client, so they are listed once, with Assign.
- A client can be in more than one group (e.g. missed 2 in a row and their program ends this week).
- Within a group: longest run / most misses first, soonest end first, longest quiet first, most bests first.

**Status on the Clients list** (one chip per client, first that applies): Needs attention (any missed reason or
no workout in 5+ days) → Program ending → Nothing planned → On track. Pending invites show "Invited". New personal
bests never change the status. The reasons are shown in small text under the chip.

## Decisions

- **"Last 7 days", not "this calendar week", for misses.** On a Monday morning a calendar week would hide the
  weekend's misses, which is when a coach most wants to see them. "This week" on the Clients list (done / planned)
  and the PR count stay Monday to Sunday, matching the existing Home tiles.
- **"No workout in 5+ days" stays** because the main design spec lists it (Needs attention section). It is left out
  when a missed workout or an empty plan already explains the quiet, so the list does not repeat itself.
- **The pink tile is now "Missed a workout"**: the number of clients in either missed group, linking to the first of
  those groups. It used to be "Missed 2+" (two or more misses in 7 days), which hid single misses.
- **No Message button yet.** Messages are not on main. `messageHref` in `home-view.tsx` is the one place to switch it
  on; until then there is no Message action at all (the old disabled "Message, coming soon" note is gone).
- **No snooze or dismiss.** Doing it properly needs a new table (the coach uses a laptop and an iPad, so browser
  storage would disagree between them). Left for later.
- **Add client stays above the list** (an earlier decision, so the invite form is above the fold on a laptop); the search, filters and list follow it.
- **Last workout lookback:** the Clients list reads finished workouts from the last 90 days (Home: 30). With none in
  that time it says "None yet" for a client who joined within it, otherwise "Over 90 days ago".
- **Search and filter are not saved in the URL.** Simple to add later if the coach wants to bookmark a view.
- No database changes: everything is read with the coach's own session through the existing RLS policies.

## Tests

- Unit (shared, written first): `packages/shared/test/coach-home/daily-check.test.ts` — every reason's edges,
  the time-zone rule (today not missed until it is over), discarded and in-progress logs not done, grouping, order,
  status, sort, last-workout wording. Runs in UTC and Pacific/Auckland.
- Unit (web): `apps/web/src/lib/daily-check.test.ts` — the words for each reason.
- End to end: `apps/web/e2e/daily-check.spec.ts` (own coach and workspace: every Home group and action, the empty
  state, Clients columns, search, filters, sort, narrow cards) and the updated `apps/web/e2e/home.spec.ts`.
