# Program Live Sync — design

Approved by the product owner (from their trainer's Everfit habit: "Enable Live Sync — update the calendar of any
client that has been assigned the program with all changes that have been made to the program, and continue
automated syncing").

## The problem

Assigning a program copies its workouts onto the client's calendar. Those copies are independent, so when the coach
later fixes or improves the program (adds a day, swaps a workout, edits a library workout), clients already on it keep
the old version. The coach has to fix every client by hand.

## What the coach gets

- A **Live Sync** switch on each program page.
  - **Existing programs: off** (nothing changes for clients already assigned until the coach chooses).
  - **New programs, including duplicates: on.**
- While on, any change to the program reaches every **active** assignment of it:
  - a workout added to, moved within, or removed from the program;
  - a week copied ("Copy week 1 to week 2");
  - the program made longer or shorter (the assignment's end date follows), or renamed;
  - a library workout the program uses edited and saved (a save that changes nothing changes nothing), or deleted.
- **New workouts are added from the client's today on; changed or removed ones only from tomorrow on.** Today's
  workout is never pulled away or rewritten under a client who may be about to start it.
- Turning the switch on runs one **catch-up sync**, so clients get every change made while it was off.
- The program page shows a status line: "Live Sync on · 3 clients · last synced 2 min ago · 1 customised workout
  skipped".
- On a client's calendar, a workout that Live Sync still keeps up to date (after today, not started, not edited for
  that client) shows a small **Live** tag next to the program name.

## What Live Sync never touches

- **Past days**, and **today's existing workouts** (only additions happen today).
- **A workout the client has started or finished** (an in-progress or completed log; a discarded log doesn't count).
  Before Live Sync changes or removes a copy it locks it and checks for a log again, so a log saved at the same moment
  wins. No workout is added on a day the client already worked out: a started or done copy on that day (by its
  program day or the day it is on), or any started or done log of theirs dated that day, planned or not.
- **A workout the coach edited for that one client** ("customised"): its name, notes or day changed, or one of its
  blocks, exercises, sets or substitutes written by hand. A save that changes nothing, and updates that only change
  links (for example the library workout being deleted), don't count. Moved copies stay customised and are never
  touched, and they still stand for the program day they came from, so moving one never creates a duplicate. If the
  program differs from a customised copy, the status line counts it as skipped.
- **A program day the coach deleted from a client's calendar**: it isn't added back (a tombstone remembers it).
- **Removed clients**, **assignments that have ended** (end date before the client's today) and **days on or after an
  assignment's cancel date** ("Remove from calendar" from a date).
- **Deleted programs**: deleting a program never changes clients' calendars (as before).

Deleting a library workout removes it from the programs that use it (as before). With Live Sync on that is a program
change: clients' untouched copies of it from tomorrow on are removed; past, started, done and customised copies stay.
The delete dialog says so.

## "Today"

Live Sync uses **each client's own today**, from the time zone on their profile (`profiles.time_zone`, the same zone
streaks and stickers use). `UTC` is that column's default, so it counts as "not set": then the workspace coach's zone
is used (owner first), and with no known zone at all, today is taken as **the day after UTC's today**, the latest date
that can be today anywhere, so Live Sync never changes a day that might be the client's today. The server can't use
the coach's browser here: syncs also run when nobody is looking at a calendar (a library workout saved from another
page). The web "Live" tag uses the browser's today.

## How it works (database)

Migration `supabase/migrations/20261106011000_live_sync.sql`.

### New columns and table

| Table | Column | Meaning |
| --- | --- | --- |
| `programs` | `live_sync` | The switch (existing rows false, default true for new rows). Coaches can insert and update it. |
| `programs` | `live_synced_at`, `live_sync_skipped` | When the last sync ran and how many customised copies it skipped. Written only by the sync. |
| `workouts` | `planned_on` | On a program copy: the program day it was made for. Moving the copy never changes it; Live Sync pairs by it. |
| `workouts` | `source_hash` | On a program copy: `workout_content_hash` of the library workout when it was copied (name, notes and ordered blocks, exercises, sets, substitutes). Null for copies made before Live Sync, so the catch-up refreshes untouched ones. |
| `workouts` | `customised_at` | When the coach last edited this copy by hand. |
| `live_sync_tombstones` | `(assignment_id, planned_on, source_workout_id)` | A program day the coach deleted from a client's calendar. RLS: coaches of the workspace read; nobody signed in writes. |

**Copies made before Live Sync** (`live_sync_backfill_copies`, run by the migration): their history isn't known, so
a copy counts as untouched only if its content equals its library workout's content now **and** it is on a slot day
of that workout in the assigned program; it then gets that `source_hash`. Anything else is marked customised and left
alone. `planned_on` is the copy's day, or for a copy moved off its slot day, the nearest slot day of its workout with no
copy of it (the day it most likely left), so that day isn't filled twice.

The three workout columns are kept by triggers (`mark_workout_changed` on the workout row, `mark_parent_customised`
on blocks, exercises, sets and substitutes) and by definer functions; nobody signed in can write them. System writes
(`copy_workout` and the sync) set the transaction setting `caltracker.system_write`, which those triggers and the
tombstone trigger ignore.

### When the sync runs: a queue drained at commit

The simplest reliable design is database triggers, because the program is edited along many paths: plain inserts,
updates and deletes of slots from the website, `set_program_weeks`, `copy_program_week`, `duplicate_program`,
`save_workout` and deleting a library workout. Triggers catch them all, and the sync runs in the **same transaction**
as the edit: if it fails, the edit fails and the coach sees the usual "couldn't save" message.

1. Something that matters happens, and its trigger puts the program id in `program_live_sync_queue` (only if the
   program has Live Sync on; repeated changes to one program in one transaction add it once):
   - a slot inserted, updated or deleted (`program_workouts_live_sync`; deleting a library workout deletes its slots);
   - a program's `weeks`, `name` or `live_sync` changed while on (`programs_live_sync`: turning it on is the catch-up);
   - a library workout row updated (`workouts_live_sync`): every live program using it is queued.
2. A **deferred constraint trigger** on the queue (`program_live_sync_queue_run`) runs at commit, after every write of
   the transaction (so `save_workout`'s new blocks and sets are all in place), and syncs every program this
   transaction queued, in program id order.

The queue is keyed by (transaction, program), so two transactions queueing the same programs never wait on each other
there (no deadlock between queue inserts); they meet only in the sync, which locks programs' assignments in program,
then assignment id order. The queue never holds a committed row. It has RLS on with no policies and no grants.

### What one sync does (`live_sync_program`, security definer, internal)

For each assignment of the program (locked in id order) whose client is still a client, that hasn't ended before the
client's today and isn't cancelled from today or earlier:

- **Window**: from the client's today (or the start date, if later) to the day before the cancel date (no end if not
  cancelled).
- **Wanted**: each slot inside the program's length lands on `start_date + (week - 1) * 7 + (day - 1)` (the same rule
  as assigning); only those inside the window count.
- **Copies**: the assignment's workouts whose `planned_on` is inside the window.
- Pair them by (program day, library workout, n-th of that pair), protected copies (logged or customised) first. Then:
  - wanted with no copy → copy the library workout in, unless tombstoned or the client already worked out that day;
  - copy with nothing wanted → delete it, if unprotected and both its days are after today;
  - paired copy whose `source_hash` differs from the library's hash now → refresh it **in place** (same row and id:
    its blocks are deleted and copied in again; name, notes and hash updated), if unprotected and after today.
  - Before a delete or refresh the copy is locked (`for update`) and checked again for an in-progress or completed log.
- Update the assignment's snapshot name and length (so the calendar's end date follows the program).
- Record `live_synced_at` and `live_sync_skipped` on the program.

`packages/shared/src/programs/live-sync.ts` has the same rule as pure functions (`liveSyncWindow`, `planLiveSync`),
with unit tests, plus `isLiveWorkout` (the Live tag rule) and `liveSyncStatus` (the status line).

### Cost

Rough local benchmark (`scratchpad/live-sync-bench`): 30 clients on a 12-week program using one 6-exercise library
workout twice a week (720 copies). Editing that workout makes the save's commit take about 1.3-1.9 s on a loaded
laptop (every copy refreshed); a save that changes nothing takes about 10 ms. If big programs make saves slow, the
next step is running the sync in the background (not built).

### Security

- Nothing new is callable: `live_sync_program`, `queue_live_sync`, `copy_workout_children`, `workout_content_hash` and
  the trigger functions are revoked from everyone signed in (`is_system_write` only reads a transaction setting the
  API can't set). A sync can only be caused by a change the caller was already allowed to make under RLS, so a client
  or another workspace's coach can't trigger one, and coach B's syncs only ever touch B's program's assignments.
- Coaches can write only `programs.live_sync`; the status columns, the workout tracking columns and tombstones aren't
  writable.

## Web

- Program page: `LiveSyncPanel` at the top of the builder (switch with `role="switch"`, explanation, status line).
  The switch calls `setProgramLiveSync`, which updates the column; the catch-up runs at commit and the action reads
  the status back. After each saved grid change the panel asks `getLiveSyncStatus` again, so "last synced" follows
  the edits without reloading the page. The copy-week note says what happens when Live Sync is on.
- Client calendar: the "Live" tag on workouts of live programs that are after today, not started or done (in-progress
  or completed log; discarded logs ignored) and not customised.

## Tests

- pgTAP `supabase/tests/live_sync.test.sql`: off does nothing; turning on catches up; a moved copy is not duplicated
  or reported; deleted days stay deleted (tombstones); adding, moving and removing slots; library edits refresh
  untouched copies in place (logs stay linked, a copy with only a discarded log is refreshed and keeps its id); a save
  without changes refreshes nothing; today's copy is never refreshed or removed; past, completed, in-progress and
  customised copies are never touched (customised ones are reported); a swapped-in workout isn't added on a done day;
  deleting a library workout; what customises a copy and what doesn't; longer and shorter programs; copying a week; a
  cancelled assignment respects its cancel date; removed clients are left alone; new and duplicated programs default
  to on; another workspace's coach and a client can't switch, edit, run, read or write anything that syncs (queue and
  tombstones included), and B's syncs don't reach A's clients; copies made before Live Sync (identical, edited,
  moved); no adds on days already worked out (moved done copy, unplanned log); the per-transaction queue key; the
  time-zone fallbacks. Tests fire the commit-time trigger with
  `SET CONSTRAINTS ... IMMEDIATE`.
- Unit tests for the shared functions.
- e2e `apps/web/e2e/live-sync.spec.ts`: switch off, assign, edit (no change), switch on (catch-up, Live tag, status
  line), edit again (reaches the calendar).

## Not in this change

- No notification to the client when their calendar changes.
- No "un-customise" (re-sync one edited copy). Deleting a copy leaves a tombstone, so it doesn't come back either.
- Tombstones are per (day, workout): deleting one of two identical workouts on the same day stops both being re-added.
- The phone app doesn't show the Live tag (clients don't need to manage it).
