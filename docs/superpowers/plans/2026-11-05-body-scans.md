# Body Scans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coaches enter InBody scans (standard and custom measures, plus an optional printout). Coaches and clients see charts and history, and clients log their own weight. The coach home's "Body scans 30+ days" group goes live.

**Architecture:**
- Measurements are stored as a header row with one value row per metric (EAV), and all masses are stored in kg.
- Custom metrics are defined per workspace.
- Attachments go in a private bucket.
- Pure shared logic covers metric definitions, range checks, conversion, chart series, "change since" wording and the "due" rule.
- The chart component is the one built by the stickers plan's Task 8. If that hasn't merged yet, build it here and the stickers plan will reuse it.

**Tech Stack:** Postgres/pgTAP, Storage, Next.js 16, Expo SDK 58, Vitest, Playwright, Maestro.

**Spec:** `docs/superpowers/specs/2026-11-05-body-scans-design.md`

**Branch:** `feature/body-scans` from `main`. It comes after coach home, since it fills the "Body scans" coming-soon row.

## Global Constraints
- **Built-in metric keys and ranges:**

  | Key | Range |
  |---|---|
  | `weight_kg` | 20–400 |
  | `body_fat_pct` | 2–75 |
  | `smm_kg` | 5–120 |
  | `lbm_kg` | 10–250 |
  | `bmi` | 10–80 |
  | `visceral_fat` | 1–20 |
  | `bmr_kcal` | 500–5000 |

- **Custom metrics** use the key `custom:<uuid>` and carry their own `min` and `max`.
- **Each measurement** needs at least one value. `measured_on` can't be in the future (browser-local today).
- **Clients** may insert, update and delete only rows they entered themselves (`source='client'`), and those rows may contain only `weight_kg`.
- **Attachments:** one image or PDF per measurement, at most 5 MB.
  - Images are compressed to 1600 px WebP.
  - A PDF is stored as-is. This is the spec's one exception, for InBody printouts.
  - Paths are `scan-attachments/{workspace_id}/{client_id}/{uuid}.{webp|pdf}`.
  - The coach of the workspace and that client can read. Only the coach can write.
- **Due rule:** a current client is due when their latest coach-entered scan is 30 or more days old, or when they have never had one and joined 30 or more days ago.
- **Chart ranges:** "3 months", "1 year" and "All". A series needs at least 2 points before it's drawn.
- **Copy:**
  - "Progress", "Add scan", "Manage custom measures", "Logged by client", "Log weight"
  - "{metric} {value} · {+/-change} since {date}"
- **Styling:** tokens only; there is no space-5.

## Review Focus
1. **Client trying to log body fat, or edit a coach-entered scan.** Refused. Test: Task 1.
2. **A mix of lb and kg viewers.** A coach in lb and a client in kg see the same mass converted correctly, with no drift on round trip. Test: Task 2.
3. **An archived custom metric.** Its history still shows, but it no longer appears on the form. Test: Tasks 1 and 3.
4. **A PDF over 5 MB, or a non-PDF disguised as one.** Rejected with "Printouts must be an image or a PDF under 5 MB." Test: Task 3.
5. **A client with only one scan.** No chart; a "Add another scan to see a trend" note instead. Test: Task 2 (series logic) and Task 3.

---

### Task 1: Data and policies
**Files:** `supabase/migrations/<next>_body_scans.sql`, `supabase/tests/body_scans.test.sql`, and the generated types.

**Produces:**
- **Tables:**
  - `body_measurements (id, workspace_id, client_id, measured_on date, entered_by default auth.uid(), source 'coach'|'client', attachment_path, created_at)`
  - `body_measurement_values (measurement_id, metric_key, value numeric, pk (measurement_id, metric_key))`
  - `custom_metrics (id, workspace_id, name 1–40, unit_label 0–10, min, max, archived_at)`
- **A definer function** `save_body_measurement(p jsonb) returns uuid`. It validates the ranges (built-in and custom) and the client-only-weight rule, then upserts the header and values in one transaction.
- **RLS, the bucket and its policies.**
- **The workspace-delete cascade.**

- [ ] **Step 1: Write failing pgTAP** covering:
  - Coach create, edit and delete.
  - A client logs weight; a client's attempt to log body fat is refused; a client's attempt to edit a coach scan is refused.
  - Cross-client and cross-workspace reads are denied.
  - Out-of-range values give 23514.
  - An archived metric stays readable.
  - Storage policies.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `db:reset` (plus import), `db:test`, `db:types` and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): store body scans and custom measures`

### Task 2: Shared logic
**Files:** `packages/shared/src/body/{metrics.ts,series.ts,due.ts}` and their tests.

**Produces:**
- `METRICS`, with labels, units (mass vs other) and ranges.
- `toInputValue(metricKey, value, units)` and `fromDisplay(...)` for input boxes, `formatMetric(key, stored, units, customDef?)` for read-only text, `isInRange(key, value, customDef?)`. These reuse `fromKg` and `toKg`.
- `measurementSeries(rows, range, today)`: rows are one metric's `{measured_on, value, createdAt?}`; keeps the latest value per date; returns `[]` under 2 points.
- `changeSince(series, metricKey, units, today)`, which converts stored values the way `formatMetric` shows them and returns wording such as "−1.4 since 6 Oct".
- `isScanDue(client, latestCoachScanOn, today)`.

- [ ] **Step 1: Write failing tests:**
  - Conversions, including the lb/kg round trip with no drift.
  - Series sorted by date and filtered by range.
  - A single point gives no series.
  - The 30-day due boundary.
  - The never-scanned and joined-recently case.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the shared tests and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): turn body scans into charts and due reminders`

### Task 3: Coach web
**Files:**
- The Progress section on `apps/web/src/app/(coach)/clients/[clientId]/page.tsx`.
- `apps/web/src/app/(coach)/clients/[clientId]/progress/*`: the scan form, custom measures, charts and history.
- The coach home "Body scans 30+ days" group goes live, with Add scan opening the form at `?scan=1`.
- `apps/web/e2e/body-scans.spec.ts`.

- [ ] **Step 1: Write failing Playwright tests:**
  - Add a scan with values and a PDF; it shows in history and on the chart.
  - Edit and delete a scan.
  - Add a custom measure; it appears on the form. Archive it; it's gone from the form and stays in history.
  - A 6 MB PDF shows the exact error.
  - Coach home lists a seeded overdue client, and Add scan opens the form.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): record InBody scans and chart client progress`

### Task 4: Client app
**Files:**
- `apps/mobile/src/app/(app)/progress.tsx`, which extends the placeholder from stickers Task 8 if it exists.
- The Progress card on home.
- `apps/mobile/src/lib/body-api.ts`.
- `.maestro/progress.yaml`.

- [ ] **Step 1: Write failing tests:**
  - Vitest: the cached progress model.
  - Maestro: open Progress and see the seeded chart. Log a weight and see it in the list, plus a chart point if the series has 2 or more.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check`, rebuild, then all Maestro flows. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): show clients their progress and let them log weight`
