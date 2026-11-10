# Admin site runbook

The admin site is at **https://admin.caltracker.app** (Cloudflare Worker `caltracker-admin`, app `apps/admin`). Until
go-live it uses the **staging** database, and the header shows a yellow **STAGING** tag. At go-live it switches to
production (see the last section).

It deploys with the web app, from `.github/workflows/deploy-staging.yml`, after CI passes on `main`. It uses the
GitHub secrets the web app already uses (`STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`), so **no new GitHub secrets or variables are needed**. The site holds only the public anon key,
never the service-role key. Every page and every database call checks that the person is an admin and has signed in
with two-step.

Do the steps below in order, once, after the first deploy has finished.

## 1. Turn on two-step sign-in (TOTP) for the staging project

Supabase Dashboard -> project `caltracker-staging` -> Authentication -> Multi-Factor (MFA): turn on
**TOTP (authenticator app)**, so it allows both setting up a factor and verifying one. Save.

Without this, admins can't finish signing in. They get stuck on the "Set up two-step sign-in" page.

## 2. Set the PostHog settings on the Worker (optional, but the Timeline needs them)

The client page's Timeline reads app events from PostHog on the server. Without these settings the page still works,
but the timeline shows database events only, with the note "Tracking timeline unavailable".

Both settings are stored as Worker secrets, so a deploy never blanks them. Run these on your own computer, in
`apps/admin`, signed in to Cloudflare (`pnpm exec wrangler login`):

```
pnpm exec wrangler secret put POSTHOG_PERSONAL_KEY --name caltracker-admin
pnpm exec wrangler secret put POSTHOG_PROJECT_ID --name caltracker-admin
```

Each command asks you to type the value at a hidden prompt.

- The key is a PostHog **personal API key**: PostHog -> your avatar -> Personal API keys. Give it only "Query: read".
- The project ID is the number in your PostHog project's URL.
- **Never paste the key into chat, a file, a GitHub issue or a commit.** Type it only at the wrangler prompt.

**Rotating the key:**
1. Create a new personal key in PostHog.
2. Run the first command again with the new key.
3. Delete the old key in PostHog.

## 3. Make the product owner the first owner

The first owner can't be added from the site, because adding admins needs an owner. So it's one SQL statement, run
once.

1. Make sure `pajain2503@gmail.com` has a **confirmed** CalTracker account on staging. If not, sign up in the app and
   confirm the email first.
2. Supabase Dashboard -> project `caltracker-staging` -> SQL Editor -> run:

   ```sql
   insert into public.admin_users (user_id, role)
   select id, 'owner' from auth.users
   where lower(email) = lower('pajain2503@gmail.com') and email_confirmed_at is not null;
   ```

   It should say "1 row". "0 rows" means the account doesn't exist or isn't confirmed yet.

## 4. The owner sets up the authenticator app

1. Open https://admin.caltracker.app and sign in with the CalTracker email and password.
2. The site shows "Set up two-step sign-in" with a QR code. Scan it with an authenticator app (Google Authenticator,
   1Password, Authy…), or type in the key shown under it.
3. Enter the 6-digit code and press **Verify**. You land on Overview. From then on, every sign-in asks for a code from
   the app.

If you lose the phone with the authenticator app, another owner (or the SQL Editor) has to help. Ask a developer to
remove your factor in Supabase -> Authentication -> Users -> your user -> MFA factors. You can then set it up again.

## 5. Adding other admins

Add someone **only right before they set up their authenticator app**. Until they do, their account is an admin that
is protected by a password alone (the site still refuses it everything until two-step is done).

1. They need a confirmed CalTracker account.
2. Owner: Admins page -> enter their email, pick a role -> **Add admin** -> confirm. The roles:
   - **Support**: can see everything and run support actions (resend invites, password reset, move a client, test
     notification, View as).
   - **Readonly**: can see the pages, with emails hidden. Can't run actions.
   - **Owner**: everything, including managing admins.
3. They sign in and set up their authenticator app (step 4).
4. Afterwards, check the **Audit log** page: their actions show up there.

To change a role, add the same email again with the new role. To remove someone, use **Remove**. The site never lets
you remove or demote the last owner.

## 6. Adding and deleting coaches (owners only)

Both live on the **Coaches** page and are shown only to owners. Support and readonly don't see them, and the database
and the `admin-coach` Edge Function refuse them anyway. Both go in the **Audit log** (`Added a coach`, `Deleted a coach`).

**Add a coach:** enter first name, last name, email and workspace name, then press **Add coach**. CalTracker creates
their account and workspace, and Supabase sends them the "You have been invited" email with a link to set a password
(the same email as `pnpm provision:coach`). Their workspace starts with the standard exercise library. An email that
already belongs to a coach, staff member, admin or client is refused with a message saying so.

**Delete a coach:** press **Delete coach** on the coach's row. The dialog shows what goes. Type the workspace name
exactly (same capitals and spaces), then press **Delete coach**. This can't be undone:

- It deletes the workspace and everything in it: programs, workouts, logs, messages, community, meals, custom exercises
  and their files.
- It deletes the coach's account, and any staff account that isn't in another workspace. A coach who also coaches in
  another workspace keeps their account.
- **Clients keep their accounts.** Each gets the email "Your coach has closed their CalTracker workspace". They show
  under **No coach** on the Clients page, and another coach can invite them.
- You can't delete a workspace you belong to, or one whose coach is an admin (remove them on the Admins page first).

If the done message says an email couldn't be sent or a coach account couldn't be removed, the workspace is still
gone. Ask a developer to check the `admin-coach` function logs (Supabase Dashboard -> Edge Functions -> admin-coach ->
Logs).

**Setup:** none. The `admin-coach` function deploys with the others, and it uses secrets the project already has for
`send-invite` (`RESEND_API_KEY`, `PUBLIC_SITE_URL`). The client email comes from `CalTracker <hello@caltracker.app>`. To
use another sender, set the function secret `NOTICE_FROM_EMAIL`.

## 7. Switching to production (at go-live)

When the production Supabase project exists:

1. Turn on TOTP in the production project (step 1, on production).
2. Change the admin build in the production deploy so it uses production's `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_APP_ENV=production`. That last one hides the STAGING tag.
3. Remove the admin build and deploy steps from the staging workflow, so staging stops overwriting the site.
4. Bootstrap the owner in production (step 3, on production) and set up two-step again. Admin rows don't copy over
   between projects.
5. Point the PostHog secrets at the production PostHog project, if it is a different one (step 2).
