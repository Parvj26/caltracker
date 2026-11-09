# Staging runbook

Staging lives at https://staging.caltracker.app. Web app: Cloudflare Workers (OpenNext adapter). Backend: Supabase project `caltracker-staging` (ref `vfjnnofocxbpnhwpvkva`). Invite emails: Resend, from `invites@caltracker.app`.

Pipeline: `.github/workflows/deploy-staging.yml`. GitHub Environments are not available (private repo, free plan), so everything uses repository secrets: Settings -> Secrets and variables -> Actions.

## Secrets

| Secret | Where it comes from | Used by | Rotate |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare -> My Profile -> API Tokens (Workers deploy permissions, zone `caltracker.app` for the custom domain) | deploy | Create a new token, update the secret, delete the old token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard, Workers overview | deploy | Does not change |
| `RESEND_API_KEY` | Resend -> API Keys | deploy (copied into the Edge Function secrets on every deploy) | Create a new key in Resend, update the GitHub secret, run Deploy staging, delete the old key. If it is also used for Auth SMTP, update it there too |
| `SUPABASE_ACCESS_TOKEN` | Supabase -> Account -> Access Tokens | deploy | Generate a new token, update the secret, revoke the old one |
| `STAGING_SUPABASE_PROJECT_REF` | Supabase project settings (`vfjnnofocxbpnhwpvkva`) | deploy | Only if the project is recreated |
| `STAGING_SUPABASE_URL` | Supabase -> Project Settings -> API | web build (`NEXT_PUBLIC_SUPABASE_URL`), seed | Only if the project is recreated |
| `STAGING_SUPABASE_ANON_KEY` | Supabase -> Project Settings -> API (public by design, protected by RLS) | web build | When the JWT secret is rotated; then redeploy |
| `STAGING_SUPABASE_DB_PASSWORD` | Set when the project was created | `supabase link` / `db push` | Supabase -> Project Settings -> Database -> Reset password, update the secret |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` (new) | Supabase -> Project Settings -> API -> `service_role` | seed-staging job only | Rotating the JWT secret changes it; copy the new key into the secret. Never put it in chat or files |
| `STAGING_SMOKE_COACH_EMAIL` (new) | Email of a staging coach used only by the smoke test | smoke job | Change the coach, update the secret |
| `STAGING_SMOKE_COACH_PASSWORD` (new) | That coach's password, chosen on the `/set-password` page (see "Create the smoke coach" below) | smoke job | Set a new password via the reset email, update the secret |

Both `STAGING_SMOKE_*` secrets are required for automatic runs: if either is missing the smoke job fails with an `::error::` (the session-refresh check must never be skipped silently). Only a manual "Run workflow" run may continue without them, and it prints a `::warning::`. Use a dedicated test coach, not a real person's account.

## One-time product owner setup

1. Add the new secrets above (`STAGING_SUPABASE_SERVICE_ROLE_KEY` first; the two smoke ones after the first deploy, see "Create the smoke coach").
2. Supabase Dashboard -> Authentication -> URL Configuration:
   - Site URL: `https://staging.caltracker.app`
   - Redirect URLs: `https://staging.caltracker.app/**` and `caltracker://**`
3. Supabase Dashboard -> Authentication -> SMTP (custom SMTP, so confirmation emails reach real inboxes; the built-in service is heavily rate-limited):
   - Host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key
   - Sender email `invites@caltracker.app`, sender name `CalTracker`
   - This is done by hand in the dashboard, it is not automated.
4. Supabase Dashboard -> Authentication -> Email Templates. The invite link must go through the web app, which verifies the token and lets the new coach set a password. Without this, invited coaches cannot get in.
   - **Invite user**: set the message body to the contents of `supabase/templates/invite.html`. The link is `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password`.
   - **Reset password** (recommended): the same with `supabase/templates/recovery.html`, link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password`.
   - Local development applies these files automatically through `supabase/config.toml`; the hosted project does not read them, so paste them by hand. Check `Site URL` (step 2) is `https://staging.caltracker.app`, because the link is built from it.
   - The link only shows a **Continue** button; the one-time token is spent when the coach presses it. Email scanners (Outlook Safe Links and similar) open links but do not click, so they can no longer use the link up. The link format in the templates did not change.
5. Supabase Dashboard -> Authentication -> Providers (Email) / Policies: set **Minimum password length** to **8**. Local config already says 8 (`minimum_password_length` in `supabase/config.toml`); the hosted project does not read it. The web and mobile apps also require 8.
6. Cloudflare: `caltracker.app` must be an active zone on the account the API token belongs to. The first deploy creates the `staging.caltracker.app` DNS record and certificate automatically (custom domain in `apps/web/wrangler.jsonc`).
7. **Sticker catch-up job** (once per project, staging and production each with their own value). Every 15 minutes the database awards stickers for finished workouts the phone never reported, by calling the `award-workout` Edge Function with a shared secret. Until these are set, every run of the job fails (shown in `cron.job_run_details`) and only the phone's own call awards stickers.
   - Make a long random secret on your computer, for example `openssl rand -hex 32`. Do not paste it into chat, files or GitHub.
   - Give it to the function: `supabase secrets set --project-ref <ref> AWARD_WORKOUT_SECRET=<secret>`. (Deploys do not overwrite it: the workflow only sets the invite secrets.)
   - Store the same secret, and the function URL, in Vault. Supabase Dashboard -> SQL Editor, run:
     ```sql
     select vault.create_secret('<secret>', 'award_workout_secret', 'Shared secret the catch-up job sends to award-workout');
     select vault.create_secret('https://<ref>.supabase.co/functions/v1/award-workout', 'award_workout_url', 'award-workout URL for the catch-up job');
     ```
   - Rotate: `supabase secrets set` the new value, then in the SQL Editor `select vault.update_secret(id, '<new secret>') from vault.secrets where name = 'award_workout_secret';`. Calls made between the two steps are refused and retried 15 minutes later.
   - Check the runs: `select status, return_message, start_time from cron.job_run_details where command like '%award_catchup%' order by start_time desc limit 5;`
   - Check the function's answers: `select status_code, content, created from net._http_response order by created desc limit 20;` (200 = awarded; 401 = the two secrets differ; 403 = a removed client's workout). pg_net keeps these for about 6 hours.
   - A workout the job could not award is tried at most 8 times: `select * from public.award_catchup_attempts where attempts >= 8;` lists the ones it gave up on.
8. **Client push notifications** (once per project; spec `docs/superpowers/specs/2026-11-09-client-push-notifications-design.md`). The `send-push` Edge Function sends straight to Apple (APNs). pg_cron calls it every minute (`push-send`) and every 15 minutes (`push-reminders`, the daily workout reminder). Until the Vault secrets exist every run fails (shown in `cron.job_run_details`); until the APNs secrets exist the function answers 503 and the notifications wait in `push_outbox` (sent once the key is in; "Today's workout changed" and the daily reminder are dropped once their day has passed).
   - **Apple Push key** (once, shared by staging and production): Apple Developer -> Certificates, Identifiers & Profiles -> **Keys -> +** -> name it, tick **Apple Push Notifications service (APNs)** -> Continue -> Register -> **Download** the `.p8` (Apple lets you download it only once; keep it somewhere safe, never in the repo or chat). Note the **Key ID** shown next to it.
   - Give the function its secrets (from a terminal; the key file is read straight from disk so it never appears on screen):
     ```sh
     supabase secrets set --project-ref <ref> APNS_KEY_P8="$(cat /path/to/AuthKey_<KEYID>.p8)" APNS_KEY_ID=<KEYID> \
       APNS_TEAM_ID=88L5M6CC34 APNS_TOPIC=app.caltracker.client APNS_ENV=production
     supabase secrets set --project-ref <ref> SEND_PUSH_SECRET=<secret>   # make it with: openssl rand -hex 32
     ```
     `APNS_ENV=production` because the phone is tested with **TestFlight builds** (they get production tokens). A locally built Debug app gets *sandbox* tokens: Apple rejects them with `BadDeviceToken` on a production sender and the function deletes that device row, logging `APNs (production) rejected device token …: BadDeviceToken` (Supabase Dashboard -> Edge Functions -> send-push -> Logs). To test a Debug build, use a separate project with `APNS_ENV=sandbox`. Deploys do not overwrite these secrets.
   - Store the same `SEND_PUSH_SECRET`, and the function URL, in Vault. Supabase Dashboard -> SQL Editor, run:
     ```sql
     select vault.create_secret('<secret>', 'send_push_secret', 'Shared secret the push cron jobs send to send-push');
     select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-push', 'send_push_url', 'send-push URL for the push cron jobs');
     ```
   - The app needs the Push Notifications capability: build with the paid team (the entitlement is no longer stripped) and test with a TestFlight build.
   - Check the runs: `select status, return_message, start_time from cron.job_run_details where command like '%push_dispatch%' order by start_time desc limit 5;` and the answers: `select status_code, content, created from net._http_response order by created desc limit 20;` (200 `{"sent":…}` = fine; 401 = the two secrets differ; 503 = APNs secrets missing).
   - What happened to a client's notifications: `select type, outcome, title, body, attempts, last_error, not_before, sent_at from public.push_outbox where user_id = '<client id>' order by created_at desc limit 20;` (`outcome`: sent, disabled = switched off, no_device = no registered iPhone, expired = a day-bound one quiet hours pushed to the next day, failed = 5 tries; no outcome yet = waiting, e.g. quiet hours). Devices: `select user_id, app_version, updated_at from public.push_devices;`
   - Rotate the shared secret like the award one: `supabase secrets set SEND_PUSH_SECRET=…`, then `select vault.update_secret(id, '<new secret>') from vault.secrets where name = 'send_push_secret';`. Rotate the Apple key: make a new key, set `APNS_KEY_P8` and `APNS_KEY_ID`, then revoke the old key in Apple Developer.

## Deploy

- Merge a pull request to `main`: the CI workflow runs on the push, and when it finishes green the Deploy staging workflow starts by itself (`workflow_run` trigger, checking out the exact commit CI passed on). If CI is red, nothing is deployed and staging is not migrated. Fix forward with a new pull request.
- Or GitHub -> Actions -> Deploy staging -> Run workflow, branch `main`, action `deploy`. This skips the CI gate, so use it only for re-running a deploy of a commit you know is good. If you start it from any other branch the run fails immediately with `Run this workflow from main`.

The deploy job first compares the checked-out commit with the tip of `main` (`git ls-remote`). On automatic runs, if a newer commit has been merged meanwhile, it skips with a notice ("a newer commit will deploy") so an older queued deploy never overwrites a newer one. It also fails with an error if the `RESEND_API_KEY` secret is empty, before touching any Edge Function secret.

The `deploy` job: build the web app (`cf:build`) first, so a failed build stops before anything on staging changes; then link the Supabase project, `supabase db push`, set Edge Function secrets (`PUBLIC_SITE_URL`, `RESEND_API_KEY`, `INVITE_FROM_EMAIL`), `pnpm functions:deploy` and deploy the already-built web app (`cf:deploy`). Only one deploy runs at a time. The `smoke` job then tests the live site.

### Short invite gap during a deploy

Between `supabase db push` and the end of `pnpm functions:deploy` (about 1 minute) the database is already new but the OLD send-invite function is still live. Invites sent in that window can fail with "Something went wrong" (the old function writes the old name column); the coach adds those clients again a minute later. (The other direction is covered: the new function still accepts the old dashboard's `fullName` invites for one release, so the few seconds before the new web app is live are fine.) For production deploys, either accept this one-minute gap or deploy during quiet hours.

## Create the smoke coach (after the first deploy)

The smoke job needs a real staging coach who has a password.

1. Actions -> Deploy staging -> Run workflow (branch `main`), `action = provision-coach`, with a mailbox you control (for example `smoke@caltracker.app` forwarding to you), a first name (last name optional) and a workspace name such as `Smoke Test`.
2. Open the invite email, follow the link (it lands on `/set-password` on staging) and choose a password.
3. Add the secrets `STAGING_SMOKE_COACH_EMAIL` (that email) and `STAGING_SMOKE_COACH_PASSWORD` (that password).
4. Re-run Deploy staging (or merge the next change). Until the secrets exist, the automatic smoke job fails by design.

## A coach cannot get in (expired or used-up invite link)

Invite and reset links are valid for 1 hour (`otp_expiry`) and work once. Ways back in, in order of preference:

1. **Self-service**: the coach opens `https://staging.caltracker.app/sign-in`, clicks "Forgot password?", enters their email and follows the emailed link (Continue, then choose a password). The page always says "If that email has an account, we've sent a link", whether or not the account exists. Supabase limits how often an address can be emailed.
2. **From us**: Actions -> Deploy staging -> `provision-coach` again with the same email. If that coach owns a workspace but has never signed in, a new set-password email is sent (the run says so). Nothing else changes. If they have signed in before, nothing is sent: use option 1.
3. **Fallback in the dashboard**: Supabase Dashboard -> Authentication -> Users -> the user -> **Send password recovery**.

## Edge Function checks

`pnpm functions:check` syncs the shared code and type-checks every Edge Function's `index.ts` with Deno (`pnpm functions:test` runs the tests). Run it before `pnpm functions:deploy`.

Invite sending limits: the dashboard sends 20 invites per call, one call after another (a CSV can hold 200 rows). The function stops after 120 s and reports the rows it did not reach as "Not sent yet — use Resend" without changing them. A Resend click within 2 minutes of the last send changes nothing and sends no email (the earlier link still works); after 2 minutes it sends a new link and the old one stops working.

## Seed

Actions -> Deploy staging -> Run workflow (branch `main`):

- `action = import-exercises`: loads the exercise library (876 free-exercise-db exercises plus 10 CalTracker extras) and its pictures. Each source picture is downloaded from the pinned free-exercise-db commit, checked against the sha256 in `scripts/exercise-images-manifest.json`, and stored as a WebP (at most 1600 px) plus a 320 px `-thumb.webp`. Safe to repeat: pictures already in the bucket are skipped. Which exercise gets which picture, and which have none, is in `scripts/exercise-image-match-report.md`.
- `action = provision-coach`: fill `coach_email`, `coach_first_name`, `coach_last_name` (optional) and `workspace_name`. Creates the coach, the workspace and sends the invite email (the link opens `/set-password`). Safe to repeat: an existing owner is left unchanged, except that one who has never signed in gets a new set-password email.

These use `STAGING_SUPABASE_SERVICE_ROLE_KEY`. The values are passed as environment variables and the key is never printed.

## Roll back

- Web app and functions: revert the bad commit in a pull request and merge it (once CI is green it redeploys the previous behaviour). Alternatively check out the previous good commit locally and run `pnpm --filter web cf:build && pnpm --filter web cf:deploy` with the Cloudflare variables set; Cloudflare dashboard -> Workers -> `caltracker-web-staging` -> Deployments also lets you roll back to the previous version in one click.
- Database: forward-fix only. Never edit or delete an applied migration; add a new migration that undoes or corrects the change.

## If the Cloudflare proxy session refresh fails

`apps/web/src/proxy.ts` (Next 16 Node.js middleware) refreshes the Supabase session cookies. OpenNext on Cloudflare marks Node.js middleware support as experimental. The smoke test expires the stored session (sets `expires_at` in the past while keeping the refresh token), reloads `/clients`, and checks the user stays signed in and the cookies were rewritten.

If that check fails on staging, fallback (a deliberate deviation, record it in the plan):

1. Remove `src/proxy.ts`.
2. Refresh the session in the browser with the browser Supabase client (`createBrowserClient`, which auto-refreshes and writes the cookies) from a small client component in the root layout.
3. Keep `requireCoach()` as the server-side gate for every coach page, so unauthenticated users are still redirected to `/sign-in`.
4. Redeploy and re-run the smoke test.

## Moving hosts

App code uses no Cloudflare APIs. Moving to Vercel means deleting `wrangler.jsonc`/`open-next.config.ts`, deploying with Vercel's Next.js support and changing DNS.
