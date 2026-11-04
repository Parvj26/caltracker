# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manually provisioned coach signs in to the web dashboard, invites clients (one at a time or by CSV), browses and customises the exercise library; an invited client signs up in the mobile app and is automatically linked to the coach's workspace.

**Architecture:** pnpm + Turborepo monorepo. Supabase Postgres owns all authorization through RLS, proven by pgTAP tests. Pure logic (CSV parsing, validation, exercise mapping, YouTube helpers) lives in `packages/shared` with Vitest tests. Invite emails are sent by one Supabase Edge Function. Next.js serves the coach dashboard and the public invite page; Expo serves the client sign-up flow.

**Tech Stack:** Node 24 LTS, pnpm 10, Turborepo, TypeScript (strict), Supabase CLI (local stack in Docker), Postgres + pgTAP, Deno (Edge Functions), Next.js (App Router) + `@supabase/ssr`, Expo (Expo Router) + `@supabase/supabase-js`, Zod, Vitest, Playwright, Maestro, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-03-coaching-app-design.md` (Sections 3, 4 "Exercise library", 8, 10, 11, 15 phase 1)

## Global Constraints

- TypeScript `strict: true` in every package; no `any` without an explaining comment.
- Database changes only via files in `supabase/migrations/`; never edit an applied migration, add a new one.
- Every table holding workspace or user data has RLS enabled and a pgTAP test proving cross-workspace and cross-client access fails.
- Hosted projects have "Automatically expose new tables" **off**: every migration explicitly `grant`s the table privileges `anon`/`authenticated` need (and nothing more) and `revoke`s the rest, so behaviour is identical locally and in staging/production. pgTAP tests assert `anon` has no privileges on tables it shouldn't touch.
- Supabase projects: `caltracker-staging` and (later) `caltracker-prod`, same region, chosen at creation (cannot change).
- Pure logic lives only in `packages/shared`; apps and Edge Functions import it, never re-implement it.
- Invites expire **14 days** after they are sent; resending issues a new token and a new 14-day expiry.
- A client belongs to **exactly one** workspace.
- Built-in exercises come from **free-exercise-db** (github.com/yuhonas/free-exercise-db), pinned to one commit SHA, license verified as Unlicense before import.
- Exercise tracking types are exactly: `weight_reps`, `reps`, `time`, `distance`.
- "Watch form on YouTube" opens `https://www.youtube.com/results?search_query=<exercise name> form` (URL-encoded).
- Pinned exercise videos are YouTube URLs only; no video uploads anywhere.
- Sign-in in this phase: email + password with email confirmation required. Sign in with Apple/Google is deferred to the phase that sets up store accounts (spec Section 3 still requires it before launch).
- Real client data never goes into local or staging.
- Git: work on a `feature/phase-1-foundation` branch (local hooks block commits on `main`); Conventional Commits; end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Email case and whitespace** — a coach invites `Sam@Gmail.com ` and the client signs up as `sam@gmail.com`; the invite must still be claimed. (Test in Task 3.)
2. **Client already linked to another workspace** — coach B invites a client who already belongs to coach A; claiming must not create a second membership, and coach B's dashboard must show the invite as "already with another coach". (Tests in Tasks 3 and 5.)
3. **Expired or resent invites** — claiming with only an expired invite links nothing; after a resend, the old token's preview page says "not found" (its hash was replaced) and the new one works. (Tests in Tasks 3 and 10.)
4. **Messy CSV files** — Excel exports with a BOM, `Name,Email` vs `email,full name` headers, blank lines, duplicate emails and invalid emails must give clear per-row errors, not a crash or silent skip. (Test in Task 4.)
5. **Coach acting on another coach's workspace** — calling the invite function or writing an exercise override with another workspace's id must be rejected. (Tests in Tasks 2, 5 and 7.)

---

## File Structure

```
.github/workflows/ci.yml            CI: typecheck, lint, unit, db tests, web e2e
.nvmrc                               24
package.json                         root scripts (check, test, db:*), packageManager pnpm@10
pnpm-workspace.yaml                  apps/*, packages/*
turbo.json                           pipeline: build, typecheck, lint, test
tsconfig.base.json                   strict shared compiler options
eslint.config.mjs, .prettierrc       lint/format
.env.example                         every env var, documented

packages/shared/
  src/index.ts                       re-exports
  src/database.types.ts              GENERATED by `supabase gen types` — never hand-edit
  src/invites/schema.ts              Zod: InviteInput, SendInvitesRequest/Response
  src/invites/csv.ts                 parseClientCsv
  src/exercises/tracking.ts          TrackingType, inferTrackingType
  src/exercises/free-exercise-db.ts  FreeExercise type, mapFreeExercise
  src/exercises/youtube.ts           youtubeFormSearchUrl, parseYoutubeUrl
  test/**/*.test.ts                  Vitest

supabase/
  config.toml                        local stack config (email confirm on, site_url)
  migrations/
    20261103000100_core.sql          profiles, workspaces, workspace_members, helpers, RLS
    20261103000200_invites.sql       client_invites, claim_invites, get_invite_preview, RLS
    20261103000300_exercises.sql     exercises, exercise_overrides, storage bucket, RLS
  tests/
    00_helpers.sql                   test user/workspace factory functions
    core_rls.test.sql
    invites.test.sql
    exercises_rls.test.sql
  functions/
    send-invite/index.ts             HTTP handler
    send-invite/mailer.ts            Mailer interface: SMTP (local) / Resend (staging, prod)
    send-invite/email.ts             renderInviteEmail
    send-invite/index.test.ts        Deno tests
  seed.sql                           local only: demo coach + workspace
scripts/
  provision-coach.ts                 creates coach user + workspace (service role)
  import-exercises.ts                imports free-exercise-db + images

apps/web/                            Next.js coach dashboard + public invite page
  src/lib/supabase/{server,client,middleware}.ts
  src/middleware.ts
  src/app/(auth)/sign-in/page.tsx
  src/app/(coach)/layout.tsx         requires coach role
  src/app/(coach)/clients/page.tsx
  src/app/(coach)/clients/add-client-form.tsx
  src/app/(coach)/clients/csv-upload.tsx
  src/app/(coach)/exercises/page.tsx
  src/app/(coach)/exercises/[id]/page.tsx
  src/app/(coach)/exercises/new/page.tsx
  src/app/invite/[token]/page.tsx    public
  e2e/*.spec.ts                      Playwright

apps/mobile/                         Expo client app
  app/_layout.tsx                    auth gate
  app/(auth)/sign-in.tsx
  app/(auth)/sign-up.tsx
  app/(auth)/check-email.tsx
  app/(app)/index.tsx                welcome / no-invite screen
  src/lib/supabase.ts
  src/lib/claim.ts
  .maestro/sign-up-and-claim.yaml
```

---

### Task 0: Developer machine setup (product owner + developer)

**Files:** none (machine setup).

- [ ] **Step 1: Product owner starts Docker Desktop** and turns on "Start Docker Desktop when you sign in".
Verify: `docker info --format '{{.ServerVersion}}'` prints a version.

- [ ] **Step 2: Install Node 24 LTS alongside Node 25 and pnpm**

Run: `brew install fnm && fnm install 24 && fnm use 24 && npm install -g pnpm@10`
Verify: `node -v` → `v24.x`, `pnpm -v` → `10.x`

- [ ] **Step 3: Install Deno and Maestro**

Run: `brew install deno && curl -fsSL "https://get.maestro.mobile.dev" | bash`
Verify: `deno --version` and `maestro --version` print versions.

- [ ] **Step 4: Product owner installs Xcode from the Mac App Store** (needed for the iOS simulator in Task 12), opens it once to accept the license, then runs `xcodebuild -runFirstLaunch`.
Verify: `xcrun simctl list runtimes | grep iOS` lists a runtime.

---

### Task 1: Monorepo, tooling and CI skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.nvmrc`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/smoke.test.ts`

**Interfaces:**
- Produces: root scripts `pnpm check` (= `turbo typecheck lint test`), `pnpm test`, `pnpm typecheck`, `pnpm lint`; workspace package name `@caltracker/shared` with `exports` `"."` → `src/index.ts`.

- [ ] **Step 1: Create branch** — `git switch -c feature/phase-1-foundation`

- [ ] **Step 2: Write a smoke test** in `packages/shared/test/smoke.test.ts` asserting `import * as shared from '../src'` resolves and `typeof shared === 'object'`.

- [ ] **Step 3: Run it to verify it fails** — `pnpm --filter @caltracker/shared test` → FAIL (no package / no src).

- [ ] **Step 4: Add the workspace config files.** Root `package.json`: `"private": true`, `"packageManager": "pnpm@10.<current>"`, `"engines": {"node": ">=24 <25"}`. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`, `target: "ES2022"`. ESLint flat config with `typescript-eslint` recommended-type-checked; Prettier defaults with `singleQuote: true`.

- [ ] **Step 5: Run checks** — `pnpm install && pnpm check` → typecheck, lint and the smoke test all pass.

- [ ] **Step 6: Add CI** `.github/workflows/ci.yml`: on `pull_request` and `push` to `main`; job `check` on `ubuntu-latest`: checkout, `pnpm/action-setup`, `actions/setup-node` with `node-version-file: .nvmrc` and pnpm cache, `pnpm install --frozen-lockfile`, `pnpm check`. (Jobs for db and e2e are added in Tasks 2 and 8.)

- [ ] **Step 7: Commit** — `chore: scaffold pnpm/turbo monorepo with shared package and CI`

---

### Task 2: Core schema — profiles, workspaces, members — with RLS tests

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/20261103000100_core.sql`, `supabase/tests/00_helpers.sql`, `supabase/tests/core_rls.test.sql`, `supabase/seed.sql`
- Create (generated): `packages/shared/src/database.types.ts`
- Modify: root `package.json` (scripts), `.github/workflows/ci.yml` (db job)

**Interfaces:**
- Produces (SQL):
  - `create type member_role as enum ('owner','staff','client')`
  - `profiles(id uuid pk references auth.users on delete cascade, full_name text not null default '', units text not null default 'kg' check (units in ('kg','lb')), avatar_path text, created_at timestamptz default now())`, auto-created by trigger `on_auth_user_created` from `raw_user_meta_data->>'full_name'`.
  - `workspaces(id uuid pk default gen_random_uuid(), name text not null, badge_style text not null default 'animals' check (badge_style in ('animals','plain')), created_at timestamptz default now())`
  - `workspace_members(workspace_id uuid references workspaces on delete cascade, user_id uuid references auth.users on delete cascade, role member_role not null, created_at timestamptz default now(), primary key (workspace_id, user_id))` + unique index `one_workspace_per_client on workspace_members(user_id) where role = 'client'`.
  - Helpers (`security definer`, `stable`, `set search_path = ''`): `public.is_coach_of(ws uuid) returns boolean` (role in owner/staff for `auth.uid()`), `public.is_member_of(ws uuid) returns boolean`.
  - `supabase/tests/00_helpers.sql`: `tests.create_user(email text, full_name text) returns uuid`, `tests.create_workspace(name text, owner uuid) returns uuid`, `tests.add_client(ws uuid, client uuid)`, `tests.act_as(user_id uuid)` (sets `request.jwt.claims` and `role authenticated`), `tests.act_as_anon()`.
- Produces (scripts): `pnpm db:start`, `pnpm db:reset`, `pnpm db:test` (= `supabase test db`), `pnpm db:types` (= `supabase gen types typescript --local > packages/shared/src/database.types.ts`).

- [ ] **Step 1: `supabase init`**, then in `config.toml` set `[auth.email] enable_confirmations = true` and `[auth] site_url = "http://localhost:3000"`; add `"http://localhost:3000/**"` and `"caltracker://**"` to `additional_redirect_urls`. Enable the `pgtap` extension in a first migration line.

- [ ] **Step 2: Write failing pgTAP tests** in `core_rls.test.sql` (fixtures: coach A + workspace A + client A1, A2; coach B + workspace B + client B1):
  - `profiles`: A1 can select and update own row; A1 can select A2's `full_name` (same workspace); A1 cannot select B1; coach A can select A1; coach A cannot select B1; anon selects 0 rows.
  - `workspaces`: coach A and A1 see exactly workspace A; coach A can update A's `name`; A1 cannot update A; coach A cannot update B.
  - `workspace_members`: coach A sees all 3 rows of A; A1 sees only own row; nobody can insert/update/delete rows through the API (`throws_ok` or 0 rows affected).
  - `one_workspace_per_client`: inserting B-client membership for A1 (as postgres) throws `23505`.
  - `profiles` row is created automatically with `full_name` from metadata on `auth.users` insert.

- [ ] **Step 3: Run tests to verify they fail** — `pnpm db:start && pnpm db:test` → FAIL (relations do not exist).

- [ ] **Step 4: Write `20261103000100_core.sql`** — tables, trigger, helpers, `alter table … enable row level security` on all three tables, policies exactly matching Step 2. Revoke `insert, update, delete` on `workspace_members` from `authenticated` and `anon` (memberships are created only by `claim_invites()` and `provision-coach`).

- [ ] **Step 5: Run tests to verify they pass** — `pnpm db:reset && pnpm db:test` → all pass.

- [ ] **Step 6: Seed + types.** `seed.sql` creates demo coach `coach@demo.local` / password `demo-password-123` (confirmed, profile `full_name` = `Demo Coach`), workspace "Demo Coaching", owner membership; and demo client `client@demo.local` / password `demo-password-123` (confirmed, `full_name` = `Demo Client`) with a `client` membership in "Demo Coaching". Run `pnpm db:types`; `pnpm typecheck` passes.

- [ ] **Step 7: CI db job** — new job `db`: checkout, `supabase/setup-cli` action, `supabase db start`, `supabase test db`, then `supabase gen types typescript --local | diff - packages/shared/src/database.types.ts` (fails if types are stale).

- [ ] **Step 8: Commit** — `feat(db): add profiles, workspaces and members with RLS tests`

---

### Task 3: Client invites — table, claim and preview functions

**Files:**
- Create: `supabase/migrations/20261103000200_invites.sql`, `supabase/tests/invites.test.sql`
- Modify: `packages/shared/src/database.types.ts` (regenerate)

**Interfaces:**
- Consumes: Task 2 tables and helpers.
- Produces (SQL):
  - `client_invites(id uuid pk default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade, email citext not null, full_name text not null, token_hash text not null unique, expires_at timestamptz not null, sent_at timestamptz not null default now(), accepted_at timestamptz, accepted_by uuid references auth.users, created_by uuid not null references auth.users, created_at timestamptz default now())` + unique index `one_open_invite on client_invites(workspace_id, email) where accepted_at is null`.
  - `public.claim_invites() returns table(workspace_id uuid, workspace_name text)` — `security definer`; for `auth.uid()` with a **confirmed** email (`auth.users.email_confirmed_at is not null`): if the user already has a client membership, mark matching open invites for *that* workspace accepted and return that workspace; otherwise take the most recently sent unexpired open invite matching `lower(trim(email))`, insert a `client` membership, mark it accepted, and return it. Never creates a second client membership. Never links a user who is owner/staff of any workspace.
  - `public.get_invite_preview(token text) returns table(status text, workspace_name text, email citext, full_name text)` — callable by `anon`; hashes `token` with `encode(extensions.digest(token,'sha256'),'hex')`; `status` is one of `'valid' | 'expired' | 'accepted' | 'not_found'` (`not_found` returns null other fields).
  - Token storage rule: only the SHA-256 hex hash is stored; the raw token exists only in the email link.

- [ ] **Step 1: Write failing pgTAP tests** in `invites.test.sql`:
  - RLS: coach A can select/insert/update/delete A's invites; coach A cannot see B's invites; clients and anon see 0 rows.
  - `claim_invites`: unconfirmed user → returns 0 rows, no membership; confirmed user with valid invite → 1 membership of role `client`, invite `accepted_at` set, `accepted_by` = user.
  - Invite stored as `'Sam@Gmail.com '` (trimmed on insert by a `before insert` trigger that sets `email = lower(trim(email))`) is claimed by user `sam@gmail.com`.
  - Expired invite (`expires_at = now() - interval '1 second'`) → 0 rows, no membership.
  - User already client of A with open invite from B → still exactly one membership (A); B's invite stays open (`accepted_at is null`).
  - Two open invites from A and B for the same email, B sent later → user joins B only.
  - Coach email invited as client → 0 rows, no client membership.
  - Calling `claim_invites()` twice → second call returns the same workspace, membership count still 1.
  - `get_invite_preview`: valid → `'valid'` + workspace name; expired → `'expired'`; accepted → `'accepted'`; random token → `'not_found'`; anon can execute it; anon cannot select `client_invites` directly.

- [ ] **Step 2: Run tests to verify they fail** — `pnpm db:test` → FAIL.

- [ ] **Step 3: Write `20261103000200_invites.sql`** (enable `citext`, table, trigger, index, RLS policies for coaches via `is_coach_of`, both functions with `set search_path = ''`, `grant execute on function get_invite_preview to anon, authenticated`, `grant execute on function claim_invites to authenticated`).

- [ ] **Step 4: Run tests to verify they pass** — `pnpm db:reset && pnpm db:test` → all pass.

- [ ] **Step 5: Regenerate types** — `pnpm db:types && pnpm typecheck` → pass.

- [ ] **Step 6: Commit** — `feat(db): add client invites with claim and preview functions`

---

### Task 4: Shared invite validation and CSV parsing

**Files:**
- Create: `packages/shared/src/invites/schema.ts`, `packages/shared/src/invites/csv.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/invites/schema.test.ts`, `packages/shared/test/invites/csv.test.ts`

**Interfaces:**
- Produces:
  - `InviteInput = z.object({ email: z.string().trim().toLowerCase().email(), fullName: z.string().trim().min(1).max(100) })`
  - `SendInvitesRequest = z.object({ workspaceId: z.string().uuid(), invites: z.array(InviteInput).min(1).max(200) })`
  - `type InviteResultStatus = 'sent' | 'resent' | 'already_member' | 'with_another_coach' | 'is_coach' | 'error'`
  - `SendInvitesResponse = z.object({ results: z.array(z.object({ email: z.string(), status: z.enum([...InviteResultStatus]), message: z.string().optional() })) })`
  - `parseClientCsv(text: string): { rows: InviteInput[]; errors: { line: number; message: string }[] }`

- [ ] **Step 1: Write failing tests.**
  - schema: `' Sam@Gmail.com '` parses to `'sam@gmail.com'`; empty name rejected; 201 invites rejected; non-uuid workspace rejected.
  - csv:
    - `"Name,Email\nSam Lee,sam@x.com"` → 1 row `{ fullName: 'Sam Lee', email: 'sam@x.com' }`, 0 errors.
    - Header variants accepted case-insensitively: `name|full name|full_name|client name` and `email|e-mail|email address`; column order either way.
    - Leading BOM `﻿` and `\r\n` line endings handled.
    - Blank lines skipped without errors.
    - Quoted field `"Lee, Sam"` keeps the comma.
    - Invalid email on line 3 → error `{ line: 3, message: 'Invalid email: not-an-email' }`, other rows still returned.
    - Duplicate email on line 4 (same as line 2) → error `{ line: 4, message: 'Duplicate email: sam@x.com (also on line 2)' }`.
    - Missing email column → single error `{ line: 1, message: 'Could not find an email column. Expected a header like "Email".' }`, 0 rows.
    - More than 200 data rows → error `{ line: 202, message: 'Maximum 200 clients per upload.' }` and only the first 200 rows returned.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @caltracker/shared test` → FAIL.

- [ ] **Step 3: Implement** `schema.ts` and `csv.ts`. Use `papaparse` for CSV tokenising (`header: false`, `skipEmptyLines: 'greedy'`); header matching and row validation are ours, validating each row with `InviteInput.safeParse`. Line numbers are 1-based file lines including the header.

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @caltracker/shared test` → PASS.

- [ ] **Step 5: Commit** — `feat(shared): add invite schemas and client CSV parser`

---

### Task 5: `send-invite` Edge Function

**Files:**
- Create: `supabase/functions/send-invite/index.ts`, `supabase/functions/send-invite/mailer.ts`, `supabase/functions/send-invite/email.ts`, `supabase/functions/send-invite/index.test.ts`, `supabase/functions/deno.json` (import map: `@caltracker/shared` → `../../packages/shared/src/index.ts`, `zod`, `@supabase/supabase-js`)
- Modify: `.env.example`, `supabase/config.toml` (`[functions.send-invite] verify_jwt = true`)

**Interfaces:**
- Consumes: `SendInvitesRequest`, `SendInvitesResponse`, `InviteResultStatus` (Task 4); `client_invites`, `workspace_members`, `is_coach_of` (Tasks 2–3).
- Produces:
  - `POST /functions/v1/send-invite`, body `SendInvitesRequest`, response `SendInvitesResponse` (HTTP 200 even with per-row errors; 400 invalid body; 401 no JWT; 403 caller not coach of `workspaceId`).
  - `interface Mailer { send(msg: { to: string; subject: string; html: string; text: string }): Promise<void> }`; `createMailer(env): Mailer` — `RESEND_API_KEY` set → Resend HTTP API (`from: INVITE_FROM_EMAIL`); otherwise SMTP to the local Supabase mail catcher (`SMTP_HOST=host.docker.internal`, `SMTP_PORT=54325`).
  - `renderInviteEmail(p: { clientName: string; coachName: string; workspaceName: string; acceptUrl: string; expiresAt: Date }): { subject: string; html: string; text: string }` — subject exactly `` `${coachName} invited you to CalTracker` ``.
  - Accept URL: `` `${PUBLIC_SITE_URL}/invite/${token}` ``; token = 32 random bytes, base64url.
  - Per-row behaviour: existing open invite in this workspace → new token + `expires_at = now() + 14 days`, `sent_at = now()`, status `resent`; email belongs to a client of this workspace → `already_member`; client of another workspace → invite still created, status `with_another_coach` with message `'This person already trains with another coach on CalTracker. They'll need to leave that coach first.'`; owner/staff of any workspace → `is_coach`, no invite; otherwise new invite, `sent`. Email-send failure → status `error`, invite row kept so "Resend" works.
- Env vars (add to `.env.example` with comments): `PUBLIC_SITE_URL`, `RESEND_API_KEY`, `INVITE_FROM_EMAIL`, `SMTP_HOST`, `SMTP_PORT`.

- [ ] **Step 1: Write failing Deno tests** (run against the local stack with `supabase functions serve`; fixtures created with the service-role client; the mailer is replaced with an in-memory fake via a `createHandler({ mailer, supabaseAdmin })` factory exported from `index.ts`):
  - Coach A sends `[{ email: 'new@x.com', fullName: 'New' }]` → `sent`, one row in `client_invites` with `expires_at` 14 days ± 1 minute from now, fake mailer received 1 email whose `text` contains `/invite/` and whose subject is `'Demo Coach invited you to CalTracker'`.
  - Same email again → `resent`, still one open row, `token_hash` changed.
  - Coach A with `workspaceId` of B → HTTP 403, no rows written, no emails.
  - No Authorization header → 401.
  - Body with 0 invites → 400.
  - Email of a client of A → `already_member`, no email.
  - Email of a client of B → `with_another_coach`, invite row created, email sent.
  - Email of coach B → `is_coach`, no row, no email.
  - Fake mailer throws for one of two rows → that row `error`, other row `sent`, both rows exist.

- [ ] **Step 2: Run to verify failure** — `deno test --allow-all supabase/functions/send-invite/` → FAIL.

- [ ] **Step 3: Implement** `email.ts`, `mailer.ts`, `index.ts`. Caller identity from the request JWT via `supabase.auth.getUser()`; authorization by calling `is_coach_of` as the caller (user-scoped client); writes with the service-role client only after that check.

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Manual check** — with `supabase functions serve`, send an invite from `curl` as the demo coach and open the local mail catcher at `http://localhost:54324`; the invite email is there with a working link format.

- [ ] **Step 6: Add Deno tests to CI** `db` job: `supabase functions serve &` then `deno test --allow-all supabase/functions/`.

- [ ] **Step 7: Commit** — `feat(functions): add send-invite edge function with mailer`

---

### Task 6: Coach provisioning script

**Files:**
- Create: `scripts/provision-coach.ts`, `scripts/provision-coach.test.ts`, `scripts/package.json` (`@caltracker/scripts`, runs with `tsx`)

**Interfaces:**
- Consumes: Task 2 tables.
- Produces: `pnpm provision:coach --email <email> --name "<full name>" --workspace "<workspace name>"` using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env. Exported `provisionCoach(admin: SupabaseClient, input: { email: string; fullName: string; workspaceName: string }): Promise<{ userId: string; workspaceId: string; created: boolean }>`. Sends a Supabase Auth invite (`auth.admin.inviteUserByEmail`, redirect `${PUBLIC_SITE_URL}/sign-in`) so the coach sets their own password. Idempotent: an existing user with an owner membership returns `created: false` and changes nothing. Refuses (throws `'User is a client of another workspace'`) if the email is a client.

- [ ] **Step 1: Write failing Vitest tests** against the local stack: new email → user + workspace + `owner` membership, `created: true`; second run → same ids, `created: false`, still one workspace; email of an existing client → throws with the exact message above.
- [ ] **Step 2: Run to verify failure** — `pnpm --filter @caltracker/scripts test` → FAIL.
- [ ] **Step 3: Implement** `provision-coach.ts` (argument parsing with `node:util` `parseArgs`).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat(scripts): add coach provisioning script`

---

### Task 7: Exercise library — schema, mapping and import

**Files:**
- Create: `supabase/migrations/20261103000300_exercises.sql`, `supabase/tests/exercises_rls.test.sql`
- Create: `packages/shared/src/exercises/tracking.ts`, `packages/shared/src/exercises/free-exercise-db.ts`, `packages/shared/src/exercises/youtube.ts`
- Create: `scripts/import-exercises.ts`, `scripts/import-exercises.test.ts`, `scripts/exercise-tracking-overrides.json`
- Test: `packages/shared/test/exercises/*.test.ts`

**Interfaces:**
- Produces (SQL):
  - `create type tracking_type as enum ('weight_reps','reps','time','distance')`
  - `exercises(id uuid pk default gen_random_uuid(), workspace_id uuid references workspaces on delete cascade` (null = built-in)`, source text not null check (source in ('builtin','custom')), external_id text unique` (free-exercise-db `id`)`, name text not null, tracking_type tracking_type not null, primary_muscles text[] not null default '{}', secondary_muscles text[] not null default '{}', equipment text, category text, instructions text[] not null default '{}', image_paths text[] not null default '{}', youtube_url text, created_by uuid references auth.users, created_at timestamptz default now(), check ((source = 'builtin') = (workspace_id is null)))` + trigram index on `name` (`pg_trgm`).
  - `exercise_overrides(workspace_id uuid references workspaces on delete cascade, exercise_id uuid references exercises on delete cascade, youtube_url text, coach_notes text, updated_at timestamptz default now(), primary key (workspace_id, exercise_id))`
  - Public storage bucket `exercise-images`; objects writable only by service role.
  - RLS: built-ins readable by any `authenticated`; custom readable by `is_member_of(workspace_id)`, insert/update/delete by `is_coach_of(workspace_id)` with `source = 'custom'`; nobody can write built-ins via the API. Overrides: select by members, write by coaches of that workspace.
- Produces (TS):
  - `type TrackingType = 'weight_reps' | 'reps' | 'time' | 'distance'`
  - `inferTrackingType(e: { category: string; equipment: string | null }): TrackingType` — `category === 'cardio'` → `distance`; `category === 'stretching'` → `time`; `equipment` null or `'body only'` → `reps`; else `weight_reps`.
  - `type FreeExercise` (fields of free-exercise-db `dist/exercises.json`: `id, name, force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, instructions, category, images`)
  - `mapFreeExercise(e: FreeExercise, overrides: Record<string, TrackingType>): ExerciseInsert` — `ExerciseInsert` is the generated `Database['public']['Tables']['exercises']['Insert']`; `image_paths` = `e.images` prefixed `free-exercise-db/`; `overrides[e.id]` wins over `inferTrackingType`.
  - `youtubeFormSearchUrl(name: string): string`
  - `parseYoutubeUrl(url: string): { videoId: string } | null` — accepts `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `m.youtube.com`, with or without `www.`/`https`; rejects anything else.
- Produces (script): `pnpm import:exercises` — downloads `https://raw.githubusercontent.com/yuhonas/free-exercise-db/<PINNED_SHA>/dist/exercises.json` and the referenced images, upserts by `external_id`, uploads images to `exercise-images/free-exercise-db/<path>` skipping existing objects. Idempotent. Option `--fixture <dir>` reads `exercises.json` and images from a local directory instead of downloading; commit a 20-exercise fixture at `scripts/fixtures/free-exercise-db/` (must include `Barbell_Squat` and `Plank`) for Task 11's e2e tests.

- [ ] **Step 1: Verify the license.** Open `https://github.com/yuhonas/free-exercise-db/blob/<PINNED_SHA>/LICENSE` (pick the latest commit on `main` and record its SHA in `scripts/import-exercises.ts` as `PINNED_SHA`). Confirm it is the Unlicense. If it is not, stop and tell the product owner.

- [ ] **Step 2: Write failing shared tests:**
  - `inferTrackingType({category:'cardio', equipment:'machine'})` → `'distance'`; `({category:'stretching', equipment:null})` → `'time'`; `({category:'strength', equipment:'body only'})` → `'reps'`; `({category:'strength', equipment:'barbell'})` → `'weight_reps'`.
  - `mapFreeExercise` on a fixture of `Barbell_Squat` → `source 'builtin'`, `workspace_id` absent/null, `external_id 'Barbell_Squat'`, `image_paths[0]` starts with `'free-exercise-db/Barbell_Squat/'`; with `overrides {Plank: 'time'}` a `Plank` fixture becomes `'time'`.
  - `youtubeFormSearchUrl('Barbell Squat')` → `'https://www.youtube.com/results?search_query=Barbell%20Squat%20form'`.
  - `parseYoutubeUrl` returns `{ videoId: 'dQw4w9WgXcQ' }` for `https://youtu.be/dQw4w9WgXcQ`, `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10`, `https://youtube.com/shorts/dQw4w9WgXcQ`, `m.youtube.com/watch?v=dQw4w9WgXcQ`; returns `null` for `https://vimeo.com/1`, `https://evil.com/?v=dQw4w9WgXcQ`, `not a url`.

- [ ] **Step 3: Write failing pgTAP tests** (`exercises_rls.test.sql`): any authenticated user reads a built-in; client A1 reads A's custom exercise but not B's; coach A creates/updates/deletes A's custom exercise; coach A cannot insert a custom exercise with `workspace_id` = B; coach A cannot update a built-in; inserting `source 'custom'` with null workspace throws (check constraint); coach A upserts an override for a built-in in A; coach A cannot write an override for workspace B; A1 reads A's override; B1 cannot read A's override; anon reads nothing.

- [ ] **Step 4: Run both to verify failure** — `pnpm --filter @caltracker/shared test && pnpm db:test` → FAIL.

- [ ] **Step 5: Implement** migration, shared modules, and `scripts/import-exercises.ts`. Seed `exercise-tracking-overrides.json` with corrections for obvious mismatches found by reviewing the mapped output (e.g. `Plank` → `time`, `Rope_Jumping` → `time`); keep the file small and commented in the PR.

- [ ] **Step 6: Run to verify pass** — `pnpm db:reset && pnpm db:types && pnpm check && pnpm db:test` → PASS.

- [ ] **Step 7: Import test** (Vitest, local stack, with `fetch` pointed at a 3-exercise fixture server): running the import twice yields 3 rows and 3 × images objects, no duplicates.

- [ ] **Step 8: Real import locally** — `pnpm import:exercises` → logs ~870 exercises imported; `select count(*) from exercises where source='builtin'` matches the JSON length.

- [ ] **Step 9: Commit** — `feat: add exercise library schema, free-exercise-db import and YouTube helpers`

---

### Task 8: Web app scaffold, coach sign-in and role guard

**Files:**
- Create: `apps/web/` (via `pnpm create next-app@latest apps/web --ts --app --src-dir --eslint --no-tailwind --import-alias "@/*"`; then add `@supabase/ssr`, `@supabase/supabase-js`, `@caltracker/shared`), `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/middleware.ts`, `src/middleware.ts`, `src/app/(auth)/sign-in/page.tsx`, `src/app/(coach)/layout.tsx`, `src/lib/auth.ts`
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/sign-in.spec.ts`
- Modify: `.github/workflows/ci.yml` (e2e job)

**Interfaces:**
- Consumes: `Database` types, seed demo coach.
- Produces:
  - `createServerSupabase(): SupabaseClient<Database>` (server components / actions), `createBrowserSupabase(): SupabaseClient<Database>`.
  - `requireCoach(): Promise<{ userId: string; workspaceId: string; workspaceName: string }>` in `src/lib/auth.ts` — redirects to `/sign-in` if signed out; renders a "This dashboard is for coaches. Clients use the CalTracker app." page if the user has no owner/staff membership.
  - Routes: `/sign-in` (email + password, error message on failure), `/` → redirect to `/clients`, `(coach)` layout with nav: Clients, Exercises, Sign out.
  - UI: plain CSS modules in this phase; the design system comes with the frontend-design pass in a later phase.

- [ ] **Step 1: Write failing Playwright tests** (`sign-in.spec.ts`): demo coach signs in → lands on `/clients` and sees "Demo Coaching"; wrong password → sees "Incorrect email or password"; visiting `/clients` signed out → redirected to `/sign-in`; a seeded confirmed client signs in → sees "This dashboard is for coaches".
- [ ] **Step 2: Run to verify failure** — `pnpm --filter web exec playwright test` → FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run to verify pass** → PASS; `pnpm check` passes.
- [ ] **Step 5: CI e2e job** — start Supabase, `pnpm db:reset`, `pnpm --filter web build`, run Playwright against `next start`; upload the report on failure.
- [ ] **Step 6: Commit** — `feat(web): scaffold coach dashboard with sign-in and coach guard`

---

### Task 9: Web — Clients page (add, CSV upload, resend)

**Files:**
- Create: `apps/web/src/app/(coach)/clients/page.tsx`, `add-client-form.tsx`, `csv-upload.tsx`, `actions.ts`, `apps/web/e2e/clients.spec.ts`

**Interfaces:**
- Consumes: `requireCoach` (Task 8), `parseClientCsv`, `SendInvitesRequest/Response` (Task 4), `send-invite` function (Task 5).
- Produces:
  - Server action `sendInvites(invites: InviteInput[]): Promise<SendInvitesResponse>` — calls the Edge Function with the coach's session.
  - Page sections: **Clients** table (name, email, joined date) from `workspace_members` + `profiles`; **Pending invites** table (name, email, sent date, "Expires in N days" or "Expired", Resend button); **Add client** form; **Upload CSV** with a preview table of parsed rows and per-line errors before "Send N invites".
  - Status copy shown after sending, per row: `sent` "Invite sent", `resent` "Invite re-sent", `already_member` "Already your client", `with_another_coach` the message from Task 5, `is_coach` "This email belongs to a coach account", `error` "Couldn't send — try Resend".

- [ ] **Step 1: Write failing Playwright tests:** add one client → appears under Pending invites with "Expires in 14 days" and "Invite sent"; Resend → "Invite re-sent"; upload a CSV fixture with 3 valid rows, 1 invalid email and 1 duplicate → preview shows 3 rows and both line errors; send → 3 new pending invites; empty name → inline validation error, nothing sent.
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** the page, components and action.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat(web): add clients page with invites, CSV upload and resend`

---

### Task 10: Web — public invite page

**Files:**
- Create: `apps/web/src/app/invite/[token]/page.tsx`, `apps/web/e2e/invite-page.spec.ts`

**Interfaces:**
- Consumes: `get_invite_preview(token)` (Task 3), called with the anon key.
- Produces: `/invite/[token]` (no auth). Copy by status:
  - `valid`: heading `` `${workspaceName} invited you to CalTracker` ``, text "Download the CalTracker app and sign up with **{email}**.", App Store and Google Play buttons (URLs from env `NEXT_PUBLIC_APP_STORE_URL`, `NEXT_PUBLIC_PLAY_STORE_URL`; when unset, the buttons show "Coming soon").
  - `expired`: "This invite has expired. Ask your coach to send a new one."
  - `accepted`: "This invite has already been used. Open the CalTracker app and sign in."
  - `not_found`: "This invite link isn't valid. Check the link in your email or ask your coach to send a new one."

- [ ] **Step 1: Write failing Playwright tests:** one test per status, creating fixtures through the service-role client (expired by updating `expires_at`; after a resend, the old token shows `not_found` because its hash was replaced).
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** the page; `export const dynamic = 'force-dynamic'`; `<meta name="robots" content="noindex">`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat(web): add public invite landing page`

---

### Task 11: Web — Exercise library

**Files:**
- Create: `apps/web/src/app/(coach)/exercises/page.tsx`, `[id]/page.tsx`, `[id]/override-form.tsx`, `new/page.tsx`, `actions.ts`, `apps/web/e2e/exercises.spec.ts`

**Interfaces:**
- Consumes: `exercises`, `exercise_overrides` (Task 7), `youtubeFormSearchUrl`, `parseYoutubeUrl`, `TrackingType` (Task 7), `requireCoach`.
- Produces:
  - `/exercises`: search box (trigram `ilike` on name), filters for muscle, equipment, tracking type, and "Built-in / My exercises"; 50 per page; each card shows first image, name, primary muscles.
  - `/exercises/[id]`: images, instructions, muscles, equipment, tracking type; video area shows the pinned YouTube embed (`https://www.youtube-nocookie.com/embed/<videoId>`) if an override or custom `youtube_url` exists, otherwise a "Watch form on YouTube" link to `youtubeFormSearchUrl(name)`; override form with "Pinned YouTube video" and "Coaching notes" (built-ins); full edit form (custom).
  - `/exercises/new`: name, tracking type (required), primary muscles, equipment, instructions, YouTube URL (optional).
  - Server actions: `saveOverride(exerciseId: string, input: { youtubeUrl: string | null; coachNotes: string | null }): Promise<{ ok: true } | { ok: false; error: string }>`, `createCustomExercise(input: CustomExerciseInput): Promise<{ id: string }>`, `updateCustomExercise(id: string, input: CustomExerciseInput): Promise<void>`. `CustomExerciseInput` is a Zod schema added to `packages/shared/src/exercises/schema.ts` (name 1–100 chars, `tracking_type` enum, muscles/equipment optional, `youtubeUrl` must pass `parseYoutubeUrl` or be empty) with its own Vitest test.
  - Invalid YouTube URL error copy: "Paste a YouTube link (youtube.com or youtu.be)."

- [ ] **Step 1: Write failing tests:** Vitest for `CustomExerciseInput` (valid, empty name, vimeo URL rejected); Playwright: search "squat" shows "Barbell Squat"; built-in detail shows "Watch form on YouTube" with the exact search URL; pinning `https://youtu.be/dQw4w9WgXcQ` replaces it with an embed; invalid URL shows the error copy; creating custom "Sled Push" (`distance`) appears under "My exercises".
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.** Playwright runs against a DB seeded with a 20-exercise fixture via `scripts/import-exercises.ts --fixture`, not the full download.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat(web): add exercise library with overrides and custom exercises`

---

### Task 12: Mobile — client sign-up and automatic linking

**Files:**
- Create: `apps/mobile/` (via `pnpm create expo-app@latest apps/mobile --template default`; add `@supabase/supabase-js`, `expo-secure-store`, `@caltracker/shared`), `app/_layout.tsx`, `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/(auth)/check-email.tsx`, `app/(app)/index.tsx`, `src/lib/supabase.ts`, `src/lib/claim.ts`, `.maestro/sign-up-and-claim.yaml`, `.maestro/no-invite.yaml`
- Modify: `apps/mobile/app.json` (`scheme: "caltracker"`, name "CalTracker", bundle id `app.caltracker.client`, iOS `supportsTablet: true`)

**Interfaces:**
- Consumes: `claim_invites()` (Task 3).
- Produces:
  - `supabase` client using `expo-secure-store` for session storage, `detectSessionInUrl: false`.
  - `claimWorkspace(): Promise<{ workspaceId: string; workspaceName: string } | null>` in `src/lib/claim.ts` — calls `rpc('claim_invites')`, returns the first row or null.
  - Sign-up: name, email, password (min 8), `emailRedirectTo: 'caltracker://auth/confirmed'`; on success → `check-email` screen ("We sent a link to {email}. Tap it, then come back and sign in.").
  - Deep link `caltracker://auth/confirmed` exchanges the session and runs `claimWorkspace()`.
  - `(app)/index.tsx`: linked → "Welcome to {workspaceName}" + "Your coach will add your workouts here soon."; not linked → "Ask your coach for an invite" + "Check again" button (re-runs `claimWorkspace()`) + Sign out.
  - `_layout.tsx`: signed out → `(auth)`; signed in → run `claimWorkspace()` once, then `(app)`.

- [ ] **Step 1: Write failing Maestro flows** (iOS simulator, local Supabase; the confirm step is done by a helper script `pnpm --filter mobile e2e:confirm <email>` that marks the user confirmed via the service role, because the simulator can't open the local mail catcher link):
  - `sign-up-and-claim.yaml`: seed an invite for `e2e-client@x.com` → sign up → see check-email copy → confirm via helper → sign in → see "Welcome to Demo Coaching".
  - `no-invite.yaml`: sign up as `nobody@x.com` → confirm → sign in → see "Ask your coach for an invite" → seed an invite → tap "Check again" → see "Welcome to Demo Coaching".
- [ ] **Step 2: Run to verify failure** — `pnpm --filter mobile e2e` (= `maestro test .maestro/`) → FAIL.
- [ ] **Step 3: Implement** the screens and libs.
- [ ] **Step 4: Run to verify pass** → PASS; `pnpm check` passes.
- [ ] **Step 5: Product owner test on a real phone** via Expo Go (`pnpm --filter mobile start`, scan the QR code) against the local stack on the same wifi: sign up with an invited email and see the welcome screen.
- [ ] **Step 6: Commit** — `feat(mobile): add client sign-up, sign-in and automatic workspace linking`

---

### Task 13: Staging environment (needs product owner accounts)

**Files:**
- Create: `docs/runbooks/staging.md`
- Modify: `.github/workflows/ci.yml` (deploy job on push to `main`), `.env.example`

**Interfaces:**
- Consumes: everything above.
- Produces: staging at `https://staging.caltracker.app` (Vercel) backed by Supabase project `caltracker-staging`; migrations and functions deployed by CI on merge to `main`; invite emails sent from `invites@caltracker.app` via Resend.

- [ ] **Step 1: Product owner creates accounts** (in their own name): Supabase (project `caltracker-staging`), Vercel (connected to `Parvj26/caltracker`, root `apps/web`), Resend (add domain `caltracker.app` and the DNS records Resend lists at the domain registrar). Shares the keys by adding them as GitHub Actions secrets and Vercel env vars — never in chat or in files.
- [ ] **Step 2: Write `docs/runbooks/staging.md`:** every secret name and where it lives, how to deploy, how to provision the coach with `pnpm provision:coach`, how to roll back a migration (forward-fix migration only).
- [ ] **Step 3: CI deploy job** on push to `main` after all checks pass: `supabase link --project-ref $STAGING_REF`, `supabase db push`, `supabase functions deploy send-invite`, set function secrets.
- [ ] **Step 4: Verify** — merge to `main`; CI deploy is green; run `pnpm import:exercises` against staging; provision the product owner as a test coach; invite the product owner's own second email; receive the email; open the invite page on `staging.caltracker.app`; sign up in Expo Go pointed at staging; see "Welcome to …".
- [ ] **Step 5: Commit** — `chore: add staging deploy pipeline and runbook`

---

## Done when

- `pnpm check`, `pnpm db:test`, Deno function tests, Playwright and Maestro all pass locally and in CI (Maestro locally only in this phase).
- On staging, the product owner can: sign in as coach, invite a client by form and by CSV, resend, browse/search ~870 exercises, pin a YouTube video, create a custom exercise; and as the invited client, sign up in the app and land on "Welcome to {workspace}".
