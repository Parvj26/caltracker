# Body scans (InBody) and progress: design

**Status:** approved in conversation on 2026-11-05.

**Main spec:** `docs/superpowers/specs/2026-11-03-coaching-app-design.md` §6 "Progress tracking". This document turns that
section into a buildable design.

**Open input:** the trainer's answer on which InBody numbers he tracks only decides which fields show first. It does not
change this design.

## Purpose

The coach tracks clients' body composition from InBody scans, and the clients want to see their progress. Success looks
like this:
- The coach enters a scan from the printout in about a minute.
- The coach and the client can see each measure change over time.
- Clients who haven't been scanned for a while surface on the coach home.

## Coach dashboard: client page, new "Progress" section

- **Add scan** opens a form:
  - **Date:** defaults to today and can't be in the future.
  - **Standard measures, all optional:**
    - weight, in the coach's units
    - body fat %
    - skeletal muscle mass, in the coach's units
    - lean body mass, in the coach's units
    - BMI
    - visceral fat level, 1–20
    - BMR, in kcal
  - **Custom measures:**
    - The workspace defines them once, for example "Waist (in)", with a name, a unit label and a number range.
    - They appear on every scan form after that.
    - They're managed through "Manage custom measures" on the same form.
  - **Printout attachment:** one image or PDF, at most 5 MB. Images are compressed in the browser. PDFs are stored as
    they are, which is the one allowed exception to the image rule (InBody printouts only, per the main spec).
  - **Rules:** at least one value is required. Each value has a sensible range check, for example body fat between 2 and 75.
- **Charts:** one small line chart per measure that has at least 2 values. The x axis is time; the y axis uses the
  coach's units. Hover shows the date and the value.
  - **Ranges:** 3 months, 1 year and all time.
- **Scan history:** a table of scans with newest first. It shows the date, the entered values, who entered the scan, a
  link to the printout, and Edit and Delete.
  - Edit and Delete belong to the coach, and Delete asks for confirmation.
  - A client's self-logged weight appears here too, marked "Logged by client".
- **Coach home:** the "Body scans 30+ days" group goes live.
  - It lists current clients whose latest coach-entered scan is 30 or more days old, or who have never been scanned
    and joined 30 or more days ago.
  - Each row has an **Add scan** button that opens the form for that client.

## Client app: Progress

- **Entry point:** a "Progress" card on the home screen, below the coach card. It opens the Progress screen.
- **Charts:** the client's own charts, in the client's units.
- **Latest scan summary:** for example, "Body fat 18.2% · −1.4 since 6 Oct".
- **Log weight:** the client enters their body weight with today's date (or an earlier one). It's stored as a measurement
  entered by the client, and the client can edit or delete only their own entries.
- **Printouts:** the client can view the printouts attached to their own scans.

## Data

- **`body_measurements`:**
  - Columns: `id`, `workspace_id`, `client_id`, `measured_on` (date), `entered_by`, `source` (`coach` | `client`),
    `attachment_path`, `created_at`.
  - Values are stored as rows in `body_measurement_values` (`measurement_id`, `metric_key`, `value numeric`).
  - Built-in `metric_key`s: `weight_kg`, `body_fat_pct`, `smm_kg`, `lbm_kg`, `bmi`, `visceral_fat`, `bmr_kcal`.
  - Custom metrics use `custom:<uuid>`.
  - All mass values are stored in kg and converted for display with the shared unit helpers.
- **`custom_metrics`:**
  - Columns: `id`, `workspace_id`, `name` (1–40 characters), `unit_label` (0–10 characters), `min`, `max`,
    `archived_at`.
  - An archived metric keeps its history but disappears from the form.
- **RLS:**
  - The workspace coach reads and writes everything for their clients.
  - A client reads their own measurements and writes only rows that have `source = 'client'` and contain only the
    `weight_kg` metric.
  - Other clients, other coaches and anonymous users get nothing.
  - pgTAP covers every case, including a client trying to write a body-fat value or edit a coach-entered scan.
- **Storage:** a private bucket `scan-attachments`, with paths `{workspace_id}/{client_id}/{uuid}.{webp|pdf}`.
  - The coach and that client can read.
  - Only the coach can write.
  - Files are served through short-lived signed URLs.
  - Policy tests cover these rules.
- **Shared pure logic,** with unit tests:
  - metric definitions, ranges and units
  - conversion for display
  - chart series building
  - "change since" wording
  - the coach-home "due" rule

## Testing

- **Vitest:** the shared logic listed above, including unit conversion round trips and the 30-day due rule.
- **pgTAP:**
  - RLS on all three tables
  - the client-only-weight rule
  - range checks
- **Storage policy tests.**
- **Playwright:**
  - add a scan with values and a printout, then see the history row and the chart
  - edit and delete a scan
  - add a custom measure and see it on the form
  - the coach home "Body scans 30+ days" group lists a seeded overdue client, and Add scan opens the form
- **Maestro:** the client opens Progress and sees the chart, then logs a weight and sees it appear.

## Out of scope

- Automatic InBody sync, file import and photo reading of printouts (not in Version 1).
- Strength charts are not in this phase. They are approved for go-live (PO, 2026-11-05) and are built right after stickers/PRs, reusing this chart component:
  - Each exercise gets a per-exercise line of estimated 1RM (Epley, warm-ups excluded) over time, with the best set ("145 lb × 6") as a second series.
  - The coach picks the exercise from a dropdown on the client's Progress section, and the client sees the same chart in the app's Progress screen.
  - The series is built by a shared pure function from `personal_records` and the logs, with unit tests.
- Progress photos (not in Version 1).
