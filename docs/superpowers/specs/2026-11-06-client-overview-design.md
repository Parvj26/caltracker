# Client page tabs and Overview: design

**Status:** approved by the product owner on 2026-11-06. The trainer's annotated Everfit screenshots marked these
parts green: Training, Highlights, Body Metrics, Profile, Updates, Goal & Countdown, Notes, Limitations/Injuries and
Documents. His words: "The body metrics (body fat, weight, muscle mass) mostly results from the InBody test, notes and
limitations there are very useful."

**Main spec:** `2026-11-03-coaching-app-design.md` (§6 Progress tracking, §8 Media). **Body scans:**
`2026-11-05-body-scans-design.md`, merged into this work.

**Not built (marked red, or not in Version 1):** sessions and booking, meal plans, automation, on-demand content and
payments.

## Tabs

The client page becomes five tabs. Each tab is its own address, so the browser's back button, reloads and shared links
all work:

| Tab | Address | What's on it |
|---|---|---|
| **Overview** (default) | `/clients/{id}` | the cards below |
| **Training** | `/clients/{id}/training` | the existing calendar, then Streak & stickers, Personal bests and Strength, as before |
| **Body** | `/clients/{id}/body` | the body-scan section: Add scan, charts and scan history |
| **Documents** | `/clients/{id}/documents` | files the coach keeps for this client |
| **Settings** | `/clients/{id}/settings` | Remove client |

- **Header:** the client's name and the tab bar sit above every tab. The tab bar is a row of links marked with
  `aria-current="page"`, at least 44 px tall, and it scrolls sideways on a narrow screen.
- **Old links still work:** `?assign=1` and `?month=` go to Training, and `?scan=1` goes to Body. Home's
  "Body scans 30+ days" rows open Body.
- **The calendar component** stays at `clients/[clientId]/client-calendar.tsx`. Its heading now reads "Training",
  because the page header shows the client's name.

## Overview cards

On a screen 1024 px or wider (iPad landscape, laptop), the cards sit in three columns: Training & Highlights, Body
metrics & Updates, and the coach's side panel (Profile, Goal, Limitations, Notes). Between 700 and 1023 px they sit in
two columns, and below 700 px in one.

- **Training:** three figures.
  - **Last 7 days, x of y tracked.** y is the workouts planned from 6 days ago up to today. A workout planned for
    today counts only once it's done, because today isn't over. x is how many of those are done. A workout the client
    added themselves adds a "+n added by the client" line and doesn't change x or y.
  - **Last 30 days:** the same count, from 29 days ago up to today.
  - **Next week:** workouts planned Monday to Sunday of next week, or "Not assigned yet".
  - **Shared logic:** in `packages/shared/src/coach-home/client-overview.ts`. "Today" and "done" match Home: the
    coach's browser today, and a completed log of the planned workout.
- **Highlights:** all-time figures, with a link to Training for the details.
  - stickers collected
  - total weight lifted, in the coach's units
  - personal bests
- **Body metrics:** the latest weight, body fat % and skeletal muscle mass.
  - Each figure shows its change over the chosen period: Last 4 weeks (the default), 3 months, 1 year or All time.
  - Picking a figure shows its trend chart. The chart is the same one the Body tab uses.
  - The client's own weigh-ins count for weight.
  - "Add scan" opens the Body tab with the form.
  - The rules live in `packages/shared/src/body/overview.ts`.
- **Updates:** the newest 8 events, newest first, with their age, for example
  "Sam logged a workout for Sat 31 Oct · 6d".
  - workouts completed, by the client or by the coach for them
  - body scans added and weigh-ins
  - stickers earned
  - Age labels and the order come from the shared logic.
- **Profile:**
  - **Email:** from the accepted invite, or the past-client record.
  - **Local time:** the client's time and time zone (`profiles.time_zone`), with a note when it matches the coach's.
    When the zone is unknown, the card says "Time zone not set".
  - **Joined date.**
  - **Community:** no link yet. The line appears once a community exists.
- **Goal & countdown:** shared with the client, and editable inline by the coach.
  - The goal text is 1–200 characters, for example "Run the Dubai half marathon".
  - An optional target date shows as "42 days to go", "Today" or "Passed 3 days ago".
  - The phone shows it in a later pass.
- **Limitations / injuries:** private to the coach. One free-text field of up to 2,000 characters, edited inline.
  When it has text, the client page header shows a gentle "Injury notes" chip that links to it.
- **Notes:** private to the coach. Many per client, newest first, each up to 2,000 characters, with their date. The coach
  can add, edit and delete them.

## Documents tab

- **Upload:** the coach uploads a PDF or an image for the client, for example a medical clearance, a plan or a
  questionnaire.
  - PDFs are at most 5 MB and kept as they are.
  - Images are shrunk on the device to a 1600 px long edge and stored as WebP, or as JPEG where WebP isn't available.
    This is the same code as the scan printouts.
  - Video and any other file type are refused, both in the browser and by the storage bucket.
- **Each file has:** a name of 1–120 characters, its size, its date, and a "Shared with client" switch that is off by
  default.
- **Actions:** open the file through a link that lasts 1 hour, rename it, share or unshare it, and delete it after
  confirming.
- **Scope:** PDFs on the Documents tab go beyond the main spec's "PDFs for InBody only". The product owner approved
  this on 2026-11-06 as part of the trainer's list.

## Data

All four tables have `workspace_id`, RLS enabled and nothing granted to `anon`. Coaches write directly under RLS, with
column-level grants so `workspace_id` and `client_id` can't change after insert. A coach adds and edits only for a current
client (`is_client_in`). A removed client's records stay readable for the coach, who can still delete them but
not add to or edit them.

| Table | Rows | Coach of the workspace | The client | Others |
|---|---|---|---|---|
| `client_notes` | many per client | read, add, edit, delete | nothing | nothing |
| `client_limitations` | one per client (primary key: workspace and client) | read, add, edit, delete | nothing | nothing |
| `client_goals` | one per client | read, add, edit, delete | reads their own while still a client | nothing |
| `client_documents` | many per client | read, add, edit (name, shared), delete | reads their own rows marked shared | nothing |

- **Storage bucket:** `client-documents`.
  - It's private, takes files of at most 5 MB, and accepts only `application/pdf`, `image/webp` and `image/jpeg`.
  - Paths are `{workspace}/{client}/{uuid}.{pdf|webp|jpg}`.
  - The coach of the workspace reads and writes.
  - The client reads a file only while a shared document row of theirs points at it.
  - Files are removed through the Storage API whenever a document is deleted.
- **pgTAP (`client_overview.test.sql`):** for every table, it proves:
  - the coach of the workspace can do what the table above allows
  - the other workspace's coach, another client of the same workspace and anonymous users get nothing, and their
    writes are refused
  - the client can't read notes or limitations, and can't write anything
  - the client sees only shared documents and their files
  - the length checks hold, and a removed client can't be written for

## Follow-ups (not in this change)

- **Phone:** show the goal and countdown on Today, and the shared documents on Progress.
- **Coach session logger:** show a gentle "Coach notes on injuries" banner from `client_limitations`. The data and the
  RLS are ready; the logger lives in the phone app.
- **Body:** the Body tab and the Overview card use the body-scans chart. Strength keeps its own chart from main.
  Merging the two charts is a later cleanup.
