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
- While on, any change to the program reaches every **active** assignment of it, **from the client's today onwards**:
  - a workout added to, moved within, or removed from the program;
  - a week copied ("Copy week 1 to week 2");
  - the program made longer or shorter (the assignment's end date follows), or renamed;
  - a library workout the program uses edited and saved.
- Turning the switch on runs one **catch-up sync**, so clients get every change made while it was off.
- The program page shows a status line: "Live Sync on · 3 clients · last synced 2 min ago · 1 customised workout
  skipped".
- On a client's calendar, a workout that Live Sync still keeps up to date shows a small **Live** tag next to the
  program name.

## What Live Sync never touches

- **Past days** (before the client's today).
- **A workout the client has started or finished** (an in-progress or completed log). A discarded log doesn't count.
- **A workout the coach edited for that one client** since it was assigned ("customised"): saved in the builder or
  moved to another day. It stays exactly as the coach left it. If the program differs from it, the status line counts
  it as skipped, so the coach knows.
- **Removed clients**, **assignments that have ended** (end date before the client's today) and **days on or after an
  assignment's cancel date** ("Remove from calendar" from a date).
- **Deleted programs**: deleting a program never changes clients' calendars (as before).

One consequence to know: deleting a library workout removes it from the programs that use it (as before). With Live
Sync on, that is a program change, so clients' untouched upcoming copies of it are removed too. The delete dialog says
so.

## "Today"

Live Sync uses **each client's own today**, from the time zone on their profile (`profiles.time_zone`, the same zone
streaks and stickers use; unknown zones count as UTC). The server can't use the coach's browser here: syncs also run
when nobody is looking at a calendar (a library workout saved from another page). Today itself counts as upcoming: an
untouched workout for today is updated.

## How it works (database)

Migration `supabase/migrations/20261106004000_live_sync.sql`.

### New columns

| Table | Column | Meaning |
| --- | --- | --- |
| `programs` | `live_sync` | The switch (existing rows false, default true for new rows). Coaches can insert and update it. |
| `programs` | `live_synced_at`, `live_sync_skipped` | When the last sync ran and how many customised copies it skipped. Written only by the sync. |
| `workouts` | `revision` | A library workout's save counter: +1 on every update of the row (`save_workout` always stamps it). |
| `workouts` | `source_revision` | On a client copy: the library revision it was copied from. Null for copies made before Live Sync, so the catch-up refreshes them. |
| `workouts` | `customised_at` | When the coach last edited this client copy by hand. |

`revision`, `source_revision` and `customised_at` are kept by a `before update` trigger (`mark_workout_changed`) and
by `copy_workout`; nobody signed in can write them. Live Sync itself only inserts and deletes client copies, never
updates them, so any update of a client copy is a hand edit. (The trigger also checks a transaction setting the sync
raises while it runs, as a second guard.)

### When the sync runs: a queue drained at commit

The simplest reliable design is database triggers, because the program is edited along many paths: plain inserts,
updates and deletes of slots from the website, `set_program_weeks`, `copy_program_week`, `duplicate_program` and
`save_workout`. Changing each of those (and remembering to change future ones) is easy to get wrong; triggers catch
them all, and the sync runs in the **same transaction** as the edit: if it fails, the edit fails and the coach sees
the usual "couldn't save" message.

1. Something that matters happens, and its trigger puts the program id in `program_live_sync_queue` (only if the
   program has Live Sync on; repeated changes to one program in one transaction add it once):
   - a slot inserted, updated or deleted (`program_workouts_live_sync`);
   - a program's `weeks`, `name` or `live_sync` changed while on (`programs_live_sync`: turning it on is the catch-up);
   - a library workout row updated (`workouts_live_sync`): every live program using it is queued.
2. A **deferred constraint trigger** on the queue (`program_live_sync_queue_run`) runs at commit, after every write of
   the transaction (so `save_workout`'s new blocks and sets are all in place), takes the program off the queue and
   calls `live_sync_program`.

The queue never holds a committed row. It has RLS on with no policies and no grants: only the definer trigger
functions use it.

### What one sync does (`live_sync_program`, security definer, internal)

For each assignment of the program whose client is still a client, that hasn't ended before the client's today and
isn't cancelled from today or earlier:

- **Window**: from the client's today (or the start date, if later) to the day before the cancel date (no end if not
  cancelled).
- **Wanted**: each slot inside the program's length lands on `start_date + (week - 1) * 7 + (day - 1)` (the same rule
  as assigning); only those inside the window count.
- **Existing**: the assignment's workouts inside the window.
- Pair them by (date, library workout, n-th of that pair), protected copies (logged or customised) first. Then:
  - wanted with no copy → copy the library workout in;
  - copy with nothing wanted → delete it, unless protected;
  - paired copy with an old `source_revision` → replace it with the library workout's current content, **keeping
    the same id**, unless protected.
- Update the assignment's snapshot name and length (so the calendar's end date follows the program).
- Record `live_synced_at` and `live_sync_skipped` on the program.

`packages/shared/src/programs/live-sync.ts` has the same rule as pure functions (`liveSyncWindow`, `planLiveSync`),
with unit tests, plus `isLiveWorkout` (the Live tag rule) and `liveSyncStatus` (the status line).

### Security

- Nothing new is callable: `live_sync_program`, `queue_live_sync` and the trigger functions are revoked from
  everyone signed in. A sync can only be caused by a change the caller was already allowed to make under RLS (a coach
  of the program's workspace editing it), so a client or another workspace's coach can't trigger one, and coach B's
  syncs only ever touch B's program's assignments.
- Coaches can write only `programs.live_sync`; the status columns and the workout tracking columns aren't writable.

## Web

- Program page: `LiveSyncPanel` at the top of the builder (switch with `role="switch"`, explanation, status line).
  The switch calls `setProgramLiveSync`, which updates the column; the catch-up runs at commit and the action reads
  the status back. After each saved grid change the panel asks `getLiveSyncStatus` again, so "last synced" follows
  the edits without reloading the page. The copy-week note ("clients already on this program keep their current
  workouts") says what happens when Live Sync is on.
- Client calendar: the "Live" tag on workouts of live programs that are today or later, not done and not customised.

## Tests

- pgTAP `supabase/tests/live_sync.test.sql`: off does nothing; turning on catches up; adding, moving and removing
  slots; library edits refresh untouched copies with the same id; past, completed, in-progress and customised copies
  are never touched (and customised ones are reported); longer and shorter programs; copying a week; a cancelled
  assignment respects its cancel date; removed clients are left alone; new and duplicated programs default to on;
  another workspace's coach and a client can't switch, edit, run or read anything that syncs, and B's syncs don't
  reach A's clients. Tests fire the commit-time trigger with `SET CONSTRAINTS ... IMMEDIATE`.
- Unit tests for the shared functions.
- e2e `apps/web/e2e/live-sync.spec.ts`: switch off, assign, edit (no change), switch on (catch-up, Live tag, status
  line), edit again (reaches the calendar).

## Not in this change

- No notification to the client when their calendar changes.
- No "un-customise" (re-sync one edited copy): the coach can delete it and it comes back on the next program change.
- The phone app doesn't show the Live tag (clients don't need to manage it).
