# Usage analytics (PostHog)

Spec: `docs/superpowers/specs/2026-11-07-usage-analytics-design.md`. Sign in at https://us.posthog.com → **Dashboards**.

## The four dashboards
- **CalTracker · Activity** — weekly active coaches/clients, "Gone quiet" (no activity 7+ days), last seen for everyone, new/returning/dormant, notifications opened.
- **CalTracker · Tasks** — per job: started, finished, gave up, finished %, typical taps, seconds, back presses and errors; where people give up; taps per set when logging workouts. High taps, many backs or a low finished % mean the job is hard.
- **CalTracker · Friction** — rage taps/clicks, dead clicks, error messages and slow screens over time and by screen; exercise searches that found nothing (add or rename those exercises); quick undos.
- **CalTracker · Join-up** — client: invite opened → joined → first workout; coach: first visit → first client invited; invites per week.

Charts hide internal accounts (person property `internal = true`: the PO's `parvjain2503+…` addresses). Tables filter in their SQL; trend charts use PostHog's "Filter out internal and test users" setting.

## Re-run or change the dashboards
The script finds dashboards and charts by name and updates them, so it is safe to re-run:
```bash
POSTHOG_PERSONAL_API_KEY=$(security find-generic-password -s caltracker-posthog-personal-key -w) \
POSTHOG_PROJECT_ID=719335 pnpm posthog:dashboards
```
The personal key (Keychain `caltracker-posthog-personal-key`) has Product analytics, Events/people and Setup & data management write. It cannot change project settings, so the internal-users filter is set by hand: Settings → Project → Product analytics → **Filter out internal and test users** → person property `internal` is not `true`, tick **Enable by default**.

## Keys
- Project key (public, write-only) in GitHub secret `STAGING_POSTHOG_KEY` (web build) and Keychain `caltracker-posthog-staging-key` (phone build via `pnpm --filter mobile env:staging`).
- Never paste the personal key in chat or commit it.
