# Go-live setup: design

**Status:** approved in conversation on 2026-11-05. Go-live happens when the trainer is ready to add his own clients.
Until then, only the product owner and the trainer test on staging.

**Order:** this is the last build step. It comes after logging, coach home, exercise search, coach profile, messages,
stickers/PRs/streaks (plus strength charts), client home and body scans. It is followed by a dry run.

## Purpose

Real clients start using CalTracker. They need:
- a production system separate from testing, with its own fresh keys and backups;
- the app on their phones without a cable;
- what Apple and privacy rules require;
- a way to get help.

The coach also needs to know quickly when something breaks.

## Decisions (product owner)

- **Account deletion erases everything.** A client can delete their account from inside the app (an Apple
  requirement). The deletion removes:
  - their auth account and profile;
  - workouts and logs;
  - sticker awards and stats;
  - messages and message images;
  - body measurements and attachments;
  - avatar and storage files.

  The coach loses that client's history.
- **No extra vendor for error alerts.** Errors are recorded in our own database, and a daily email summary goes out
  through the existing Resend account.

## Production environment

- **Supabase:**
  - a new project, `caltracker-prod`, in the same organisation;
  - all migrations applied through the existing CI deploy workflow, parameterised by environment;
  - the exercise library imported;
  - the `pg_cron` jobs present (auto-finish, award catch-up, error digest);
  - daily backups (on the Pro plan);
  - auth settings copied from staging: minimum password 8, Resend SMTP, the templates, and redirect URLs for
    `caltracker.app`;
  - fresh anon and service-role keys, stored only in GitHub secrets and the Keychain, never in chat.
- **Web:** the Cloudflare Workers production deployment on `caltracker.app`, with `staging.caltracker.app` unchanged.
  Hosting stays portable under the CLAUDE.md rule.
- **Email:** Resend sends from `caltracker.app`, with SPF, DKIM and DMARC DNS records on Cloudflare. "Forgot password"
  is tested end to end on production. The free plan allows 100 emails a day, so a soft warning is logged above 80 a
  day.
- **Mobile:**
  - a production build of the app pointing at production, with the anon key's role checked by the existing env
    script guard;
  - distributed through **TestFlight** external testing (up to 10,000 testers via a public link, after Apple's beta
    review);
  - needs the paid Apple Developer account, an App Store Connect app record, the privacy "nutrition label" answers and
    a privacy policy URL;
  - once the account exists, push notifications for messages are turned on: `push_tokens` plus an Edge Function.
- **Staging after go-live:** keeps running for testing. Its cost is reviewed at go-live, since a second Pro project adds
  compute cost. Pausing staging between test sessions is an option.

## Moving the trainer's work from staging

The trainer will have built exercises and programs on staging while testing. At go-live, a one-time script copies his
**library** into his production workspace:
- custom exercises;
- workouts;
- programs.

Ids are rewritten. No clients, logs, messages or scans are copied. The script runs with the product owner's OK and
prints a dry-run summary first.

## Account deletion

- **Client app:** Settings → **Delete account** → an explanation of what is erased → type DELETE to confirm →
  "Your account has been deleted" → back to the sign-in screen.
- **Server:** an Edge Function `delete-account` acts on the signed-in caller only. It deletes the caller's storage files
  in every bucket, then the auth user. Database rows cascade from `auth.users`, and every new table's foreign keys are
  checked to do so. The function is idempotent.
- **Coach accounts** are deleted on request by email in Version 1. This is listed in the privacy policy.
- **Tests:**
  - pgTAP or integration tests confirm that, after deletion, no row in any table references the user;
  - storage is empty for that user;
  - Maestro covers the in-app flow.

## Privacy policy and terms

- Pages at `caltracker.app/privacy` and `caltracker.app/terms`, linked from sign-in, the app's Settings and the
  dashboard footer.
- Claude drafts plain-language versions covering:
  - what data is collected (account, workouts, body measurements, messages, photos);
  - why it's collected;
  - who can see it (the client's coach);
  - where it's stored (Supabase, region noted);
  - retention and deletion;
  - contact details.
- The product owner reviews them. This is not legal advice, and a lawyer's review is recommended before wider launch.

## Help and feedback

- **Help & feedback** in the app's Settings and in the dashboard sidebar opens an email to `support@caltracker.app`.
  The email is pre-filled with the app version and device.
- Cloudflare Email Routing forwards `support@` to the product owner's inbox (free).

## Error visibility (no extra vendor)

- **Table:** `app_errors (id, created_at, source web|mobile|edge, release, user_id null, route, message, stack (trimmed),
  count)`.
  - Insert only, through a definer function that rate-limits per user.
  - Readable only by the service role.
  - No personal data beyond the user id.
- **Mobile:** a React error boundary and a global JS error handler report caught crashes and unhandled promise
  rejections. These are JS-level errors; native crashes are not captured.
- **Web:** Next.js `error.tsx` boundaries and a server-action error wrapper report errors.
- **Edge Functions:** a shared catch-all reports errors.
- **Daily digest:**
  - a `pg_cron` job at 08:00 UTC emails the product owner and Claude's monitoring address through Resend, only when
    there were errors in the last 24 h;
  - the email shows counts by message and route, with the top 10;
  - a spike of 20 or more errors in an hour sends an immediate email.

## Go-live checklist (each item checked off before launch)

1. The Apple Developer account is active, and the App Store Connect record and TestFlight beta review are approved.
2. The production Supabase project is created, migrations applied, exercises imported, cron jobs present, backups on.
3. `caltracker.app` serves production, and the staging URL is unchanged.
4. Resend's domain is verified, and invite and reset emails arrive from `caltracker.app`.
5. The privacy and terms pages are live and linked.
6. Account deletion works on production with a test account.
7. The error digest has been received once, triggered by a test error.
8. The trainer's library has been copied from staging to production, and the trainer has checked it.
9. The trainer's production account has been created, with the product owner's details and OK.
10. **Dry run:** for one week, the product owner, the trainer and 2–3 friendly clients use production, with feedback
    fixed.
11. **Launch:** the trainer invites his clients.

## Out of scope

- Public App Store listing. TestFlight is enough for one coach's clients and can move to the App Store later.
- Stripe billing and the admin area. These come before the second coach.
