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
The staging smoke test (`pnpm --filter web test:e2e:staging`) also opens `/workouts` and `/programs` when `STAGING_SMOKE_COACH_*` is set.
