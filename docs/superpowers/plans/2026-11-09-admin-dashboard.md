# Admin Dashboard V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate admin website (`admin.caltracker.app`; PO decision 2026-11-10: on the staging database with a STAGING tag until go-live, then switched to production) where admins see:
- business totals;
- coaches and clients, with account health;
- notification and invite logs;
- a client's timeline;
- a read-only "View as".

Admins can also run audited support actions, under owner/support/readonly roles with two-step sign-in.

**Architecture:**
- New `apps/admin` Next.js 16 app on Cloudflare Workers via OpenNext, set up like `apps/web`.
- It reads and writes only through `public.admin_*` SECURITY DEFINER functions. Each function calls `private.admin_require(min_role)`, which checks the `admin_users` row **and** `aal2`. Functions that change data write one `admin_audit_log` row in the same transaction.
- The admin site holds no service-role key.
- The PostHog timeline is queried on the server with a Worker secret, only after an audited `admin_log_timeline_view` call.

**Tech Stack:** Postgres (Supabase migrations, pgTAP), Deno Edge Functions, Next.js 16 + `@supabase/ssr`, OpenNext Cloudflare, TypeScript `packages/shared` (vitest), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-admin-dashboard-design.md`. Mockups: `https://claude.ai/artifact/5qsVrqWF3r45j7567Qrtdv` (boards Overview, Coaches, Client). The PO approved V1 exactly as specified, with no additions.

## Global Constraints

- **Commands:** every node/pnpm command runs as `eval "$(fnm env)" && fnm use 24 && <command>`, inside the task's own worktree, created from fresh `origin/main`.
- **Migrations:** database changes only in new migrations whose timestamps sort after every existing one (`scripts/check-migrations.sh`). After each migration, regenerate types with `pnpm db:types` into `packages/shared/src/database.types.ts`; CI diffs it.
- **New tables:** `admin_users` and `admin_audit_log` have RLS on and **no policies**; access is only through functions. pgTAP proves an authenticated non-admin can't select from or insert into either.
- **Role order:** `owner` > `support` > `readonly`. `private.admin_require(min admin_role)` raises SQLSTATE `42501` with the message `admin: not authorised` unless both of these hold:
  - an `admin_users` row with role ≥ min;
  - `(auth.jwt()->>'aal') = 'aal2'`.
- **Function settings:** every `admin_*` function is `security definer`, `set search_path = ''`, `revoke all from public, anon`, `grant execute to authenticated`, and calls `admin_require` as its first statement.
- **Audit:** every data-changing admin function, plus `admin_view_as_snapshot` and `admin_log_timeline_view`, inserts exactly one `admin_audit_log` row: `admin_id = auth.uid()`, `action` = the function name without the `admin_` prefix, `target_user_id`, and `details` jsonb. The audit table refuses UPDATE and DELETE via a trigger raising `admin: audit log is append-only`.
- **Readonly role:** readonly callers get emails masked as the first 2 characters + `…@` + the domain (`pa…@gmail.com`). The masking happens in SQL, through `private.admin_mask_email(text)`, so it can't be skipped.
- **No new secrets in the repo.** `POSTHOG_PERSONAL_KEY` (Worker secret) and `POSTHOG_PROJECT_ID` (plain var) are documented in `apps/admin/.env.example` and `docs/runbooks/admin.md`.
- **Portable hosting:** no Cloudflare bindings in app code.
- **Smart search:** the admin search box uses `packages/shared/src/search/smart-search.ts`.
- **Look:** the coach website's look (Bricolage Grotesque, lime `#C8F169`, ink `#121212` borders), using `@caltracker/design-tokens`. Copy is taken from the mockups. At phone width the side menu stacks.
- **TDD:** failing test first. Before a task is done, run `pnpm check` plus that task's db, functions or e2e tests, and show the output.
- **Not in V1 (refuse scope creep):** billing and client limits (show "No plan yet"), activation and retention metrics, at-risk scoring, CSV export, the system-health page, the moderation queue.

## Review Focus

1. **`aal1` session with a valid admin row.** Someone who knows the password but skipped two-step must get nothing: pages redirect to `/mfa`, and RPCs raise 42501. (Task 1 pgTAP `aal1 admin is denied`; Task 6 e2e `password only lands on /mfa`.)
2. **Removing or demoting the last owner** must be refused, including an owner demoting themself. (Task 1 pgTAP `cannot remove or demote the last owner`.)
3. **Readonly leaks email through another path**, such as search results, logs or the coach list. Every function returning an email must mask it for readonly. (Task 2 pgTAP `readonly sees masked emails everywhere`, looping over every email-returning function.)
4. **PostHog key missing or the API down.** The client page must still render, with DB-only timeline events and the note "Tracking timeline unavailable". (Task 7 vitest `mergeTimeline with posthog error`.)
5. **"View as" for a user with no coach or no data** (new client, removed client) must render empty states, not crash. (Task 8 e2e `view as a removed client`.)

---

### Task 1: Admin roles, audit log and the admin-management functions

**Files:**
- Create `supabase/migrations/<ts>_admin_core.sql`
- Create `supabase/tests/admin_core.test.sql`
- Modify `supabase/config.toml` (`[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true`)
- Modify `packages/shared/src/database.types.ts`

**Interfaces:** Produces:
- `admin_role` enum;
- tables `admin_users(user_id uuid pk → auth.users on delete cascade, role admin_role not null, created_at timestamptz default now(), created_by uuid)` and `admin_audit_log(id bigint generated always as identity pk, at timestamptz default now() not null, admin_id uuid not null, action text not null, target_user_id uuid, details jsonb not null default '{}')`;
- `private.admin_require(admin_role) returns admin_role` (the caller's role);
- `private.admin_audit(action text, target uuid, details jsonb) returns void`;
- `private.admin_mask_email(text) returns text`;
- `public.admin_me() returns table(role admin_role, email text)`: needs only aal1 (the sign-in page uses it to decide between "Not authorised" and `/mfa`); returns no rows for non-admins;
- `public.admin_list_admins() returns table(user_id uuid, email text, first_name text, last_name text, role admin_role, created_at timestamptz)`: owner only;
- `public.admin_set_admin(p_email text, p_role admin_role) returns uuid`: owner only. Upserts by auth.users email (case-insensitive). Raises `admin: no account with that email` if not found. Audited as `set_admin`;
- `public.admin_remove_admin(p_user_id uuid) returns void`: owner only. Audited.

- [ ] **Step 1: Write the pgTAP tests in `admin_core.test.sql`.** Use the helpers in `supabase/tests/00_helpers.sql`, and set `request.jwt.claims` with `aal`. Tests:
  - `non-admin is denied` (each function raises 42501);
  - `aal1 admin is denied`, but `admin_me` works at aal1;
  - `readonly and support cannot manage admins`;
  - `owner adds a support admin and one audit row is written`;
  - `cannot remove or demote the last owner` (raises `admin: at least one owner is required`);
  - `audit log refuses update and delete`;
  - `authenticated cannot select or insert admin_users or admin_audit_log directly`;
  - `admin_mask_email('parv@gmail.com') = 'pa…@gmail.com'`.
- [ ] **Step 2:** Run `pnpm db:test` (or `supabase test db`). Expected: FAIL, because the functions don't exist.
- [ ] **Step 3:** Write the migration (constraints above). Enable TOTP in `config.toml`.
- [ ] **Step 4:** Run `pnpm db:reset && pnpm db:test`. Expected: all pass. Then run `pnpm db:types` and `pnpm check`.
- [ ] **Step 5:** Commit `feat(db): admin roles, audit log and admin management`.

### Task 2: Read functions for the Overview, Coaches, Clients and Logs pages

**Files:**
- Create `supabase/migrations/<ts>_admin_reads.sql`
- Create `supabase/tests/admin_reads.test.sql`
- Modify the types file

**Interfaces:** Consumes Task 1. All functions need `readonly`. Produces:
- `admin_overview() returns jsonb`. Keys:
  - `coaches {total, active7, new7}`: active = a `workspace_members` owner/staff with any program assignment, message or log in 7 days;
  - `clients {total, active7, new7}`: active = a workout log or meal in 7 days;
  - `workouts {this_week, last_week}` and `meals {this_week, last_week}`: Monday-start weeks in UTC;
  - `system {last_push_run_at, last_push_status, push_failed_24h, invites_sent_today, app_versions: [{version, devices}]}`.
- `admin_needs_attention() returns table(kind text, user_id uuid, name text, since timestamptz, action text)`. `kind` ∈ `invite_expired | no_signin_7d | notifications_off | push_failed | coach_inactive_14d | coach_no_meals`; `action` ∈ `resend_invite | open`. Ordered by `since`.
- `admin_people() returns table(user_id uuid, kind text /*coach|client*/, name text, email text, coach_name text)`: the source for smart search; emails masked for readonly.
- `admin_coaches() returns table(user_id, name, workspace_id, workspace_name, created_at, clients int, last_active timestamptz, programs_assigned_7d int, messages_7d int, health text /*good|quiet|inactive*/)`:
  - `good` = active within 3 days;
  - `quiet` = active within 14 days;
  - `inactive` = otherwise.
- `admin_coach(p_user_id uuid) returns jsonb`: `clients[] {user_id, name}`, `programs[] {id, name, weeks}`, `meals_shared int`, `median_reply_minutes_30d int|null`.
- `admin_client(p_user_id uuid) returns jsonb`: `name, email, coach {user_id, name}, joined_at, email_confirmed bool, last_sign_in_at, devices [{app_version, last_seen_at}], notifications_on bool, last_sync_at` (latest of the user's log, meal or push-device update), plus `push_errors [{at, type, error}]` for the last 7 days.
- `admin_push_log(p_user_id uuid default null, p_limit int default 100) returns table(id, at, user_id, name, type, outcome, attempts, last_error, sent_at)`.
- `admin_invite_log(p_user_id uuid default null, p_limit int default 100) returns table(id, email, workspace_name, created_at, expires_at, accepted_at, status text /*pending|expired|accepted|cancelled*/)`.
- `admin_audit(p_limit int default 200) returns table(id, at, admin_name, action, target_name, details)`: owner sees all rows; support sees only their own; readonly is denied (needs `support`).

- [ ] **Step 1: Write the pgTAP tests**, seeding two workspaces, three clients, invites, push rows and logs. Tests:
  - each function's denial for a non-admin and for aal1;
  - `overview counts` with exact numbers from the seed;
  - one row per `kind` in `needs attention`;
  - `coach health tags`;
  - `admin_client fields`;
  - `readonly sees masked emails everywhere` (loop over `admin_people`, `admin_client`, `admin_invite_log`, `admin_list_admins`);
  - `support sees only own audit rows`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** Run `pnpm db:test`, then types, then `pnpm check`. Expected: pass.
- [ ] **Step 5:** Commit `feat(db): admin read functions`.

### Task 3: Support actions, the test notification and "View as" data

**Files:**
- Create `supabase/migrations/<ts>_admin_actions.sql`
- Create `supabase/tests/admin_actions.test.sql`
- Modify `supabase/functions/send-push/` so type `test` uses title "CalTracker" and body "Test notification from CalTracker support", with a test.
- Modify the types file.

**Interfaces:** Consumes Tasks 1–2. All functions need `support` and are audited. Produces:
- `admin_cancel_invite(p_invite_id uuid) returns void`: pending invites only, otherwise `admin: invite is not pending`;
- `admin_remove_client(p_user_id uuid) returns void`: the same effect as `public.remove_client`, run as that client's workspace owner. Extract the body into `private.remove_client_core(workspace_id, user_id, removed_by)` and have both functions call it;
- `admin_log_action(p_action text, p_target uuid, p_details jsonb) returns void`, for actions done outside SQL (`password_reset`, `resend_invite`). `p_action` must be in that allow-list;
- `admin_send_test_push(p_user_id uuid) returns uuid`: inserts a `push_outbox` row with `type = 'test'` (extend the check constraint);
- `admin_view_as_snapshot(p_user_id uuid) returns jsonb`. Keys:
  - `profile {name, units}` and `coach {name} | null`;
  - `today` (the same shape `public.client_today` returns, evaluated for that user);
  - `week {done, planned}`;
  - `recent_logs [≤10 {id, title, finished_at, duration_s, volume}]`;
  - `meals_today [{name, kcal, protein_g}]` and `targets {kcal, protein_g} | null`;
  - `goal | null`, `coach_meals int`, `bests [≤5 {exercise, weight, reps, at}]`.
- `admin_log_timeline_view(p_user_id uuid) returns void`.

"Move client to another coach" = `admin_remove_client`, then a resend-invite from the new coach's workspace (Task 4). The UI runs the two in order behind one confirm. "Restore a removed client" = a resend-invite to the `past_clients` email.

- [ ] **Step 1: Write the pgTAP tests:**
  - readonly is denied for every action;
  - each action writes one audit row with the right `action`;
  - `admin_remove_client` leaves a `past_clients` row identical to a coach removal (compare with `remove_client` on a twin seed);
  - `cancel only pending`;
  - `test push row inserted`;
  - `view as snapshot keys` for a client with data and for a removed client with no coach (`coach` null, empty arrays);
  - `log_action rejects unknown action`.

  Plus a Deno test `send-push renders the test type`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep `public.remove_client`'s behaviour unchanged; its existing tests must still pass.
- [ ] **Step 4:** Run `pnpm db:test && pnpm functions:test && pnpm check`. Expected: pass.
- [ ] **Step 5:** Commit `feat(db): admin support actions and view-as snapshot`.

### Task 4: `send-invite` accepts admin callers

**Files:**
- Modify `supabase/functions/send-invite/index.ts` and its test file.
- Create `supabase/migrations/<ts>_admin_invite_check.sql` (adds `public.admin_can_invite(p_workspace_id uuid) returns boolean`: true when the caller is support or above at aal2; audited as `resend_invite` with details `{workspace_id, email}`).

**Interfaces:** Consumes Task 1. The function's existing coach check gets one alternative: if the caller isn't a coach of the workspace, it calls `admin_can_invite(workspace_id)` with the caller's JWT. If that returns true, it proceeds with the same send and resend logic, including the 2-minute cooldown and 24 h expiry. The request body is unchanged.

- [ ] **Step 1: Write the Deno tests** with the RPC mocked:
  - `admin caller can resend for any workspace`;
  - `aal1 admin is refused 403`;
  - `non-coach non-admin still refused 403`.

  Plus pgTAP for `admin_can_invite` (denials, audit row).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm functions:test && pnpm db:test && pnpm check`. Expected: pass.
- [ ] **Step 5:** Commit `feat(functions): let admins resend invites`.

### Task 5: Shared admin logic

**Files:**
- Create `packages/shared/src/admin/{timeline.ts,attention-copy.ts,index.ts}` and tests.
- Modify `packages/shared/src/index.ts` (`export * from './admin/index';`).

**Interfaces:** Produces:
- `type TimelineEvent = { at: string; source: 'app' | 'db'; label: string; status?: 'delivered' | 'failed' }`;
- `mergeTimeline(db: TimelineEvent[], posthog: TimelineEvent[] | Error): { events: TimelineEvent[]; trackingUnavailable: boolean }`: newest first, deduplicated by `at` + `label`, capped at 50;
- `posthogEventLabel(event: string, props: Record<string, unknown>): string | null`: maps the tracked event names in `packages/shared/src/analytics` to plain labels ("Opened the app (1.0.0 build 2)", "Logged a meal") and returns null for noise;
- `attentionCopy(kind): { problem: string; actionLabel: string }`, with the mockup copy ("Invite expired" / "Resend invite", "Notifications off" / "Open", "No meals shared" / "Open", and so on).

- [ ] **Step 1: Write the vitest tests:**
  - `mergeTimeline orders and caps`;
  - `mergeTimeline with posthog error` (returns DB events with `trackingUnavailable` true);
  - `posthogEventLabel` maps every event in the analytics catalogue or returns null;
  - `attentionCopy` covers all 6 kinds.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter @caltracker/shared test && pnpm check`. Expected: pass.
- [ ] **Step 5:** Commit `feat(shared): admin timeline and attention copy`.

### Task 6: `apps/admin` scaffold, sign-in, two-step and the role gate

**Files:**
- Create `apps/admin/`: `package.json` (name `admin`, scripts like web's), `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc` (`name: caltracker-admin`, route `admin.caltracker.app` custom domain, no `vars`: the PostHog settings are Worker secrets so a deploy can't blank them; STAGING tag while `NEXT_PUBLIC_APP_ENV` is not `production`), `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `scripts/write-local-env.sh`.
- Create `src/proxy.ts`, `src/lib/supabase/{client,server,middleware}.ts` (copied from web, not imported).
- Create `src/lib/admin.ts`.
- Create routes `src/app/{layout.tsx,page.tsx,sign-in/,mfa/,not-authorised/}`.
- Create `src/components/admin-shell.tsx` (side menu: Overview, Coaches, Clients, Logs, Audit log, plus Admins for owner; "Signed in as <name> · 2-step on").
- Create `e2e/auth.spec.ts` and `e2e/helpers.ts`.

**Interfaces:** Produces `requireAdmin(min: 'readonly'|'support'|'owner' = 'readonly'): Promise<{ userId: string; name: string; role: AdminRole }>`, wrapped in React `cache()`:
- no session → `/sign-in`;
- `admin_me()` empty → `/not-authorised`, which signs out;
- `aal` below aal2 → `/mfa`;
- role below `min` → `/not-authorised`.

The `/mfa` page enrolls TOTP when no factor exists (QR code + 6-digit code), otherwise asks for a challenge and verifies it.

- [ ] **Step 1: Write the Playwright tests** (local stack; seed an owner, a readonly admin and a coach with TOTP secrets in `e2e/helpers.ts`, generating codes with `otpauth`, version pinned):
  - `non-admin sees Not authorised`;
  - `password only lands on /mfa`;
  - `first sign-in enrolls two-step then reaches Overview`;
  - `readonly has no Admins menu`.
- [ ] **Step 2:** Run `pnpm --filter admin test:e2e`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add the `admin` workspace to turbo's pipeline if it isn't picked up automatically.
- [ ] **Step 4:** Run `pnpm --filter admin test:e2e && pnpm check`. Expected: pass.
- [ ] **Step 5:** Commit `feat(admin): scaffold admin site with two-step sign-in`.

### Task 7: Admin pages: Overview, Coaches, Clients, Logs, Audit log, Admins

**Files:**
- Create `apps/admin/src/app/(admin)/{overview,coaches,coaches/[id],clients,clients/[id],logs,audit,admins}/page.tsx`, plus `actions.ts` per page that has actions.
- Create `src/lib/posthog.ts`, `src/components/{kpi-tile,pill,confirm-dialog,people-search}.tsx`, `e2e/pages.spec.ts`, and vitest tests for `posthog.ts`.

**Interfaces:** Consumes Tasks 2–6.
- `fetchPosthogTimeline(distinctId: string): Promise<TimelineEvent[] | Error>`. Server-only. Calls `https://us.posthog.com/api/projects/${POSTHOG_PROJECT_ID}/query/` with HogQL for the last 30 days of that person's events and maps them with `posthogEventLabel`. If the key is missing it returns an `Error` and never throws. It runs only after `admin_log_timeline_view` succeeds.
- **Pages match the mockups.**
  - Overview: KPI tiles, the "Needs attention" table with row actions, and the System box.
  - Coaches: table plus detail page.
  - Client page: Account health, "Fix it" (Send password reset → `admin_log_action('password_reset')`, then `supabase.auth.resetPasswordForEmail`; Move to another coach…; Send test notification), Recent errors, Timeline, and a "View as <first name> (read-only)" link.
  - Logs: notifications and invites tabs, filtered by person.
  - Audit log.
  - Admins (owner only: list, add by email with a role, remove).
- Every action uses `confirm-dialog`. Readonly sees no action buttons. The search box uses the shared smart search over `admin_people()`.

- [ ] **Step 1: Write the tests.**
  - vitest `fetchPosthogTimeline` with mocked fetch: success, 401, and missing key, each returning an Error.
  - Playwright: `search finds a client with a typo` → `open client page shows health` → `resend invite from Needs attention writes an audit row` → `owner adds a support admin` → `readonly sees masked emails and no Fix it buttons`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter admin test && pnpm --filter admin test:e2e && pnpm check`. Expected: pass.
- [ ] **Step 5:** Commit `feat(admin): overview, coaches, clients, logs, audit and admins pages`.

### Task 8: "View as" (read-only)

**Files:**
- Create `apps/admin/src/app/(admin)/clients/[id]/view-as/page.tsx`
- Create `src/components/view-as/{today,workouts,food,progress}.tsx`
- Create `e2e/view-as.spec.ts`

**Interfaces:** Consumes `admin_view_as_snapshot` (Task 3).
- Needs `support`.
- A fixed banner reads `Viewing as <full name> · read-only · logged`, with an "Exit" link back to the client page.
- Four tabs (Today, Workouts, Food, Progress) render the snapshot inside a phone-width (390 px) frame, with no buttons that change anything.

- [ ] **Step 1: Write the Playwright tests:**
  - `view as shows banner and no edit controls` (no enabled `button` inside the frame except tabs);
  - `opening view as writes one audit row`;
  - `view as a removed client` (empty states, no crash).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter admin test:e2e && pnpm check`. Expected: pass.
- [ ] **Step 5:** Commit `feat(admin): read-only view as`.

### Task 9: CI, staging deploy and runbook

**Files:**
- Modify `.github/workflows/ci.yml`: add `apps/admin/**` to the e2e path filter, plus an `admin-e2e` job, single shard, that the required `e2e` job waits for.
- Modify `.github/workflows/deploy-staging.yml`: build `pnpm --filter admin cf:build` next to web's build (same `NEXT_PUBLIC_SUPABASE_*` secrets, plus `NEXT_PUBLIC_APP_ENV=staging`), then deploy with the same 5-try retry loop after web's deploy.
- Create `docs/runbooks/admin.md`, covering:
  - turning on TOTP on the staging project (Auth → MFA);
  - setting the Worker secrets: `wrangler secret put POSTHOG_PERSONAL_KEY --name caltracker-admin` (and `POSTHOG_PROJECT_ID`);
  - bootstrapping the owner: `insert into public.admin_users (user_id, role) select id, 'owner' from auth.users where lower(email) = lower('<PO email>');`;
  - adding staff through the Admins page;
  - rotating the PostHog key.
- Modify `docs/runbooks/staging.md` to link it.

- [ ] **Step 1:** Run `actionlint` on both workflows (or the repo's workflow check). Expected: clean.
- [ ] **Step 2:** Open the PR. Expected: `check`, `db` and `e2e` (including `admin-e2e`) are green.
- [ ] **Step 3:** Commit `ci: build, test and deploy the admin site to staging` and `docs: admin runbook`.

**After merge (coordinator, with the PO's OK for each outward step):**
1. Turn on TOTP for the staging project.
2. Set the Worker secret.
3. Confirm the deploy reached `https://admin.caltracker.app` (staging database, STAGING tag).
4. Bootstrap the PO as owner.
5. The PO signs in and enrolls two-step.
