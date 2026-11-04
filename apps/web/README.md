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
