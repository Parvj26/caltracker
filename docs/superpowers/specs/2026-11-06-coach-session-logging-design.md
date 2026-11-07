# Coach session logging — design note (2026-11-06)

Version 1 scope from the main spec (`2026-11-03-coaching-app-design.md`): "Coach session logging (iPad)" and
"Single active logger". The coach logs a client's workout live during an in-person session, from the coach website
on the iPad or laptop.

## What the coach sees

- **Home → Today's clients:** every row has its actions, and the whole row opens the first one: not started →
  **Log session**; my own session in progress → **Continue session**; training now → **Watch live** (the workout in progress; it updates live once PR #34 merges) and
  **Take over** (the session page, which offers it); done → **View log**. All at least 44 px.
- **Entry points:** Home → Today's clients → **Log session** on a row; the client calendar's item menu →
  **Log session** on today's workout or a missed (past, not done) one. Logging an unplanned workout is not built.
- **Page:** `/clients/[clientId]/log/[workoutId]`. Before anything is saved it shows the workout and
  **Start session**. Once started:
  - left column (from 760 px wide, so iPad portrait too): the pages list grouped by section, a ✓ on finished pages; right column: the current
    page. Narrower screens stack them.
  - a page is a straight exercise, a superset (rounds, exercises lettered A, B…) or a pick-one group (pick first,
    "Change pick" until a set is done).
  - each exercise: "Coach: 3 × 8 reps · 60 kg", "Last time: …" (the client's last results), and a table
    **SET | LB/KG | REPS | ✓**. The boxes show the pre-filled number greyed (coach target → last time, the same
    `resolveSetValues` rules as the phone); a tick saves those numbers. Numbers stay editable after a tick.
    **+ Add set**, **Mark all**, a note per exercise, a session note (saved when the box is left),
    **Finish session**, **Hand back to {client}**, **Cancel session** (after a take over it warns that the sets
    already logged, including the client's own from the phone, are thrown away).
  - The page says who logs it: "Logged by you"; "Parv is logging this now on their phone"; "Alex (coach) is
    logging this session" (another coach of the workspace, who can be taken over the same way).
  - No rest timer. Tap targets are at least 44 px (the tick and boxes slightly bigger).
- **Saving:** every change is made with the shared log operations (`packages/shared/src/logs`) and the whole doc is
  saved (debounced) through `coach_save_workout_log`, the same document and rules as the phone's
  `save_workout_log`. A failed save retries every 3 s. The website needs a connection (the phone app is the offline
  logger).
- **Finish:** the log is saved as completed and the finished log opens at once (`?award=1`); that page then asks
  `award-workout` for the award, so a slow award never holds the coach up (the coach path
  already allowed for corrections; for a log with no award yet it is the full award, stickers and rolls included). If
  that call fails, the 15-minute catch-up job awards it. The client sees the stickers in their album next time they
  open the app (the phone's "Surprise!" reveal queue only holds awards the phone itself asked for).

## Single active logger

| Situation | Coach website | Client phone |
| --- | --- | --- |
| Nobody logging | Start session | Start as usual |
| Client logging this workout | "Parv is logging this now on their phone", progress (sets done, last update), live over Realtime; **Take over**, **View only**, Refresh | Logs as usual |
| Coach logging (started or took over) | The logging page | Opening the workout shows "Your coach is logging this session" (read only); saves from the phone are refused and the phone takes the coach's copy |
| Coach handed back | Back to the calendar | Logs as usual from the server copy |
| Coach stopped (20 min without activity) or is no longer a coach | — | "Your coach stopped logging N min ago" · **Continue on my phone** |
| Client has a different workout in progress | "They need to finish it first" (one workout in progress per client, a database rule) | — |
| Finished | Opens the finished log | — |

"Back to the calendar" is the client's Training tab (`/clients/[clientId]/training`). Once finished, the workout's
plan is locked like any done workout (`20261106009000_done_workout_plan_lock`): the coach fixes what was logged with
**Edit results** on the log (`correct_workout_log`), which works the same for a session the coach logged.

Live progress uses Realtime (PR #34): the page re-renders whenever the log row changes.

## Data and security

No new tables. `workout_logs.logged_by` (already there) is who logs the workout: the client on the phone, or the
coach. The log's `client_id` is always the client, so history, charts, PRs, streaks and stickers count it the same.

Migration `20261106012000_coach_session_logging.sql`:

- `private.save_workout_log_as(doc, client, logger)`: the body of `save_workout_log`, unchanged except that it takes
  the client and the logger as arguments, requires a coach logger to coach the client's workspace, stores
  `logged_by = logger` on insert, and refuses (`applied: false, loggedByOther: true`, not an error) a change from
  anyone but the stored `logged_by`. It lives in a `private` schema nobody can call over the API.
- `save_workout_log(doc)` (phone) and `coach_save_workout_log(client_id, doc)` (website) are thin wrappers.
- `take_over_workout_log(log_id)`: a coach of the workspace, a current client, an in-progress log (held by the
  client or another coach). Sets `logged_by` to the coach; the revision stays. The phone's next save is answered
  `loggedByOther` and it adopts the server copy without pushing, whatever its revision.
- `hand_back_workout_log(log_id)`: only the coach holding it. `logged_by` goes back to the client and the revision
  jumps by 1000, so a phone that was offline with older edits queued adopts the coach's sets instead of overwriting
  them (its own copy is kept as a rejected copy, as for any refusal).
- `workout_log_logger(log_id)` (the client's own log only): `{ status, heldByOther, lastActivityAt, canReclaim }`.
  `reclaim_workout_log(log_id)`: the client takes it back when the coach has had no activity for 20 minutes, or
  at once when the holder is no longer a coach of the workspace (a removed staff coach). Like hand back it raises
  the revision by 1000, so the phone's older queued copy is refused and it adopts the coach's sets.
- Activity is the server's clock: every coach save (typing included) sets `last_activity_at = now()`, so the 20
  minutes count from the coach's last save, whatever the coach's browser clock says.
- The trigger that froze `logged_by` now allows it to change only while the log is in progress, to a coach of the
  workspace or back to its client (or to null when the account is deleted).
- `coach_last_results(client_id, exercise_ids)`: `last_results` for one client, security invoker, so RLS limits it
  to the coach's own workspace.

pgTAP (`supabase/tests/coach_session_logging.test.sql`) proves: a coach logs only clients of their workspace; another
workspace's coach is refused (save, start, unplanned start, take over, read, last results); a client can't log as a
coach for themselves or another client, nor take over; the phone's saves are refused while the coach logs and the
coach's while the client logs; take over; removed clients; the logged_by trigger; the finished session counts in the
client's last results and award history.

## Phone (minimal, isolated)

How the phone learns the coach holds its workout: instantly from a save's answer (`loggedByOther`: log-sync adopts
the server copy, never pushes, and use-active-log sets `heldByOther`, refuses edits and cancels the reminder), and
over Realtime (the log row is published; RLS lets a client hear only their own rows), and by asking
`workout_log_logger` when the workout opens, when the app returns to the foreground and once a minute while Realtime
is not connected. When the server and phone disagree (taken over, handed back, finished elsewhere) the phone
takes the server's copy, and Start first asks again before resuming a held workout.

Another branch (`feature/simple-logging`) is rewriting the phone's logging screens, so the phone change is small:

- `apps/mobile/src/lib/coach-logging.ts`: `useCoachLogging(logId)` (the checks above, plus `reclaim`).
- `apps/mobile/src/lib/log-sync.ts`, `log-api.ts`, `use-active-log.tsx`, `active-log-logic.ts`: `loggedByOther`,
  `heldByOther`, `refreshFromServer`, and the pure decisions (`needsServerCopy`, `parseLoggerState`).
- `apps/mobile/src/components/log/coach-logging-banner.tsx`: `CoachLoggingBanner` (full-screen, read only) and
  `LoggedByCoachPill`.
- `app/(app)/log/[id]/index.tsx`: three lines; while the coach logs, the screen returns the banner instead of the
  editor. When the client taps Start while the coach logs, the phone resumes the server's in-progress log (existing
  behaviour) and so lands on the banner. `app/(app)/log/[id]/summary.tsx`: the "Logged by coach" pill.

Whoever rewrites the logging screens: keep calling `useCoachLogging(id)` before the screen's early returns and render
`CoachLoggingBanner` when `byCoach` is true.

## Known limits

- The client receives no push notification yet (notifications are a later phase).
- If the client starts the same workout on a phone with no signal while the coach logs it, the phone's upload is
  refused by the one-in-progress rule and keeps retrying until the coach finishes; the spec's "save it as a separate
  workout and show the coach both" is not built.
