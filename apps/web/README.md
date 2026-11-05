# web (coach dashboard)

First run: `pnpm db:start && pnpm --filter web env:local`, then `pnpm --filter web dev`.

## End-to-end tests

The Playwright tests sign in as the seeded demo users, so reset the local database first:

```
pnpm db:reset
pnpm --filter web exec playwright install chromium   # once
pnpm test:e2e
```

Locally Playwright reuses a running `next dev`; in CI (`CI=true`) it runs `next build && next start`.

## Coach pages for programs

- `/workouts`: the workout library. Build workouts with straight sets, supersets/circuits, warm-ups and drop sets.
- `/programs`: build a multi-week program by drag and drop, then assign it to a client from a start date.
- A client's calendar (from the Clients page) lets the coach add, move, edit and delete single workouts, or remove a program from the calendar.

The e2e tests need the built-in exercises (for example Barbell Squat), so run `pnpm import:exercises` after `pnpm db:reset`.
The import needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the shell:

```
eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm import:exercises
```
The staging smoke test (`pnpm --filter web test:e2e:staging`) also opens `/workouts` and `/programs` when `STAGING_SMOKE_COACH_*` is set.

## Workout logging (coach side)

- `/activity`: recent client workouts. Open one to see planned vs. actual, add a comment, and correct a typo in a logged set.
- Clients log from the phone app. Any workout still open after a long idle time is finished automatically by a `pg_cron` job (migration `20261105000900_log_auto_finish.sql`); check it with `select * from cron.job;`.
- Playwright runs with 2 workers (set in `playwright.config.ts`), because more workers exhaust the local auth container.
- The staging smoke test also opens `/activity` when `STAGING_SMOKE_COACH_*` is set.
