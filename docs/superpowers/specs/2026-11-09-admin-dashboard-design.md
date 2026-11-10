# Admin dashboard (V1): design

Date: 2026-11-09 · Status: approved by the PO in chat (scope, architecture option A, screens). Mockups: https://claude.ai/artifact/5qsVrqWF3r45j7567Qrtdv

## Why

The company (today just the PO) needs to see how the business is doing: coaches, clients and activity. It also needs to fix people's problems without SQL: expired invites, password resets, moving a client, checking notifications. And it needs to look at exactly what a user sees when they report a problem. Every admin action must be traceable.

## Scope

**V1 (this spec):** Overview, Coaches, Clients (search plus a client page), support actions, logs (notifications, invites/emails, activity timeline), read-only "View as", admin roles and the audit log.

**Later, not in this spec:**
- V2: system health page; cross-coach community moderation queue.
- V3: billing, built together with coach billing ($29/$39/$49 tiers). The client limit shown on Coaches comes from billing, so V1 shows the client count with "No plan yet".

## Architecture (option A)

- **New app, `apps/admin`:** Next.js 16 on Cloudflare Workers via OpenNext, set up like `apps/web` and sharing `packages/shared` and `packages/design-tokens`. It never imports from `apps/web`.
- **Domain (PO decision, 2026-11-10, overrides the earlier two-domain plan):** one admin site, `admin.caltracker.app` (Worker `caltracker-admin`). Until go-live it uses the **staging** database and shows a STAGING tag in the header (`NEXT_PUBLIC_APP_ENV` is not `production`); at go-live it is rebuilt against production and the tag goes away. There is no `admin-staging` site. It deploys with the staging deploy workflow.
- **Database:** the same Supabase project as the rest of the environment. The admin site uses the anon key plus the signed-in admin's session. **No service-role key in the admin site.**
- **All reads and writes go through `public.admin_*` SECURITY DEFINER functions** (RPC). There are no direct table reads from the admin site. Every function:
  1. calls `private.admin_require(min_role)`, which raises `42501` unless the caller has a row in `admin_users` with a role at or above `min_role` **and** the JWT `aal` claim is `aal2` (two-step done);
  2. for anything that changes data, or opens "View as" or a timeline, inserts one `admin_audit_log` row in the same transaction.
- **PostHog timeline:** the admin site calls PostHog's query API on the server with the personal API key. The key is a Worker secret, `POSTHOG_PERSONAL_KEY`, and is never sent to the browser. A request runs only after `admin_require('support')` succeeds through an `admin_log_timeline_view(user_id)` call, which also writes the audit row.

## Data model (one migration, timestamp sorting last)

- `admin_role` enum: `owner` > `support` > `readonly`.
- `admin_users`:
  - columns: `user_id uuid pk references auth.users`, `role admin_role not null`, `created_at`, `created_by uuid`;
  - RLS on, no policies (access only through functions).
- `admin_audit_log`:
  - columns: `id bigint identity`, `at timestamptz default now()`, `admin_id uuid`, `action text`, `target_user_id uuid null`, `details jsonb`;
  - RLS on, no policies;
  - append-only: a trigger refuses update and delete.
- No changes to existing tables.
- Bootstrap: the PO's account becomes `owner` through a SQL insert documented in `docs/runbooks/admin.md`. Never seeded by a migration.

## Roles

| | owner | support | readonly |
|---|---|---|---|
| Overview, Coaches, Clients, logs | ✓ | ✓ | ✓ (emails masked: `pa…@gmail.com`) |
| Support actions | ✓ | ✓ | — |
| View as, PostHog timeline | ✓ | ✓ | — |
| Audit log | all rows | own rows | — |
| Add, remove or change admins | ✓ | — | — |

V1 has only the PO as owner; the admin-management screen is a simple list (add by email, pick a role, remove).

## Screens (match the mockups)

1. **Overview:**
   - KPI tiles: coaches (total, active in 7 days, new in 7 days); clients (total, active, new); workouts logged this week vs last; meals logged this week vs last.
   - **Needs attention** list, each row with a one-click action or Open:
     - invite expired and not accepted;
     - client not signed in for 7+ days;
     - client with notifications off or no push device;
     - push failures in the last 24 h;
     - coach with no activity for 14 days;
     - coach with no meals shared.
   - **System** box: last `push-send` cron run and status; invites sent today and failed; app versions in use; push failures in 24 h.
   - Global search box (smart search, `packages/shared/src/search/smart-search.ts`) for anyone by name or email.
2. **Coaches:**
   - table: name and workspace, clients (with "No plan yet"), last active, this week (programs assigned, messages sent), health tag (Good / Quiet / Inactive);
   - coach summary: clients list, programs, meals shared, median reply time over 30 days.
3. **Client page:**
   - **Account health:** email confirmed, last sign-in, app version and device, notifications on/off, last sync.
   - **Fix it** buttons (see Support actions).
   - **Recent errors:** push failures for this user, plus PostHog `$exception` events if any.
   - **Timeline:** PostHog events merged with DB events (workouts finished, meals logged, notifications sent with delivery status), newest first, 50 at a time.
   - **"View as <name> (read-only)"** button.
4. **Logs:** notifications (`push_outbox`: status, sent and failed, error text), invites (`client_invites`: sent, expires, accepted), filterable by person.
5. **Audit log:** who, what, when and target, filterable.
6. **Admins** (owner only).

The design matches the coach website: Bricolage Grotesque, lime accent, ink borders. The side menu stacks at phone width.

## Support actions (each needs a confirm dialog and writes an audit row)

- **Resend invite:** the same path as the coach's resend (new token, 24 h expiry).
- **Cancel invite.**
- **Send password reset:** Supabase `resetPasswordForEmail` from the server. This uses no admin key; the audit row is written first through `admin_log_action`.
- **Move client to another coach:** `admin_move_client(client_id, to_workspace_id)` uses the same steps as the coach-side remove plus invite-accept, so it keeps history. Both coaches are notified via a message.
- **Restore a removed client:** from `past_clients`.
- **Send test notification:** inserts a `push_outbox` row of kind `test` for that user.

## Add and delete coaches (PO decision, 2026-11-10)

Owner only, at aal2. Mockups: Coaches, DeleteCoach and ClientEmail (admin-coach canvas).

- The admin site still has no service-role key. Both actions go through the `admin-coach` Edge Function with the
  admin's JWT. It checks `public.admin_require_owner()` (that is, `private.admin_require('owner')`), then uses the
  service role for the Auth admin API, Storage, and the service-role-only `admin_*coach*` functions, which write the
  audit row (`add_coach`, `delete_coach`).
- **Add:** first name, last name, email and workspace name. Supabase Auth invites the account (set-password email),
  then a new workspace and an owner membership are created. The exercise library is global, so there is nothing to
  copy. Emails that belong to a coach, staff member, admin or any existing account (a client) are refused.
- **Delete (decision A):** the dialog shows counts. The workspace name must be typed exactly. Files are removed first,
  then the workspace in one transaction, then the coach and staff accounts that are in no other workspace, then one
  email per client via Resend. A failed email is logged and never fails the delete. Clients keep their accounts and
  get a `closed_workspace_clients` record, so they count as removed clients (Clients "No coach", `admin_can_invite`,
  `my_removal`). It is refused for a workspace the caller belongs to, or one whose coach is an admin.

## View as (read-only)

`admin_view_as_snapshot(user_id)` returns one JSON document holding what the client's Today, Workouts, Food and Progress screens read: today's workout, this week, recent logs, meals, targets, goals, coach meals and bests.

The admin site renders it with simple read-only versions of those screens under a fixed banner: "Viewing as Parv Jain · read-only · logged". There are no session tokens, no impersonation and no write path. Every open is audited.

## Errors and edge cases

- Not an admin, or not `aal2`: the site shows "Not authorised" and signs out. A direct RPC call gets `42501`.
- **Two-step sign-in:** Supabase TOTP MFA. An admin's first sign-in forces setup, and the site refuses `aal1` sessions.
- **Removing the last owner** is refused by the function.
- **Readonly:** action buttons are hidden, and the functions refuse anyway.
- **PostHog down or key missing:** the timeline shows DB events only, with a "Tracking timeline unavailable" note.

## Testing

- **pgTAP, for every `admin_*` function:**
  - a non-admin is denied;
  - an `aal1` admin is denied;
  - readonly can't mutate;
  - support can't manage admins;
  - mutations write exactly one audit row;
  - the audit log refuses update and delete;
  - the last owner can't be removed.
- **vitest:** Needs-attention rules, email masking, timeline merge and order.
- **Playwright** (admin app, local stack):
  - sign in with MFA;
  - non-admin sees "Not authorised";
  - search, then open a client, then resend an invite, then see it in the audit log;
  - View as shows the banner and no edit controls.
- CI: the generated types check covers the new tables and functions.

## Rollout

1. Staging database first: migration, then deploy `admin.caltracker.app` (DNS route like the web Worker) built against staging, set the PostHog Worker secrets, then bootstrap the PO as owner.
2. The PO tries it.
3. Production when production exists.

Runbook: `docs/runbooks/admin.md` covers bootstrap, adding staff and rotating the PostHog key.
