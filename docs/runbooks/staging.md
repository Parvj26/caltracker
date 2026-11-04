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
5. Cloudflare: `caltracker.app` must be an active zone on the account the API token belongs to. The first deploy creates the `staging.caltracker.app` DNS record and certificate automatically (custom domain in `apps/web/wrangler.jsonc`).

## Deploy

- Merge a pull request to `main`: the CI workflow runs on the push, and when it finishes green the Deploy staging workflow starts by itself (`workflow_run` trigger, checking out the exact commit CI passed on). If CI is red, nothing is deployed and staging is not migrated. Fix forward with a new pull request.
- Or GitHub -> Actions -> Deploy staging -> Run workflow, branch `main`, action `deploy`. This skips the CI gate, so use it only for re-running a deploy of a commit you know is good. If you start it from any other branch the run fails immediately with `Run this workflow from main`.

The `deploy` job: link the Supabase project, `supabase db push`, set Edge Function secrets (`PUBLIC_SITE_URL`, `RESEND_API_KEY`, `INVITE_FROM_EMAIL`), `pnpm functions:deploy`, build and deploy the web app. Only one deploy runs at a time. The `smoke` job then tests the live site.

## Create the smoke coach (after the first deploy)

The smoke job needs a real staging coach who has a password.

1. Actions -> Deploy staging -> Run workflow (branch `main`), `action = provision-coach`, with a mailbox you control (for example `smoke@caltracker.app` forwarding to you), a name and a workspace name such as `Smoke Test`.
2. Open the invite email, follow the link (it lands on `/set-password` on staging) and choose a password.
3. Add the secrets `STAGING_SMOKE_COACH_EMAIL` (that email) and `STAGING_SMOKE_COACH_PASSWORD` (that password).
4. Re-run Deploy staging (or merge the next change). Until the secrets exist, the automatic smoke job fails by design.

## Seed

Actions -> Deploy staging -> Run workflow (branch `main`):

- `action = import-exercises`: loads the ~870 exercise library.
- `action = provision-coach`: fill `coach_email`, `coach_name`, `workspace_name`. Creates the coach, the workspace and sends the invite email (the link opens `/set-password`). Safe to repeat: an existing owner is left unchanged.

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
