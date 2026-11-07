# CalTracker

Coaching platform: coaches build and assign workout programs, log in-person sessions, track client progress (InBody), message clients and run a private community. Clients log workouts, earn badges and share them.

- **Design spec (source of truth):** `docs/superpowers/specs/2026-11-03-coaching-app-design.md`
- **Domain:** caltracker.app
- **Product owner** is not a developer: explain decisions in plain language, and ask before anything hard to reverse or outward-facing.

## Git and GitHub
- `main` is protected. Never commit or push directly to `main`; all work goes through a pull request.
- Branch names: `feature/<short-name>`, `fix/<short-name>`, `chore/<short-name>`, `docs/<short-name>`.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), imperative mood, one logical change per commit.
- Only commit, push or open PRs when the product owner has asked for it in the current task.
- PR description: what changed, why, how it was tested, and anything the product owner should try on their phone.
- Never force-push to `main`. Never commit secrets: use `.env.local` (git-ignored) and document variables in `.env.example`.

## Engineering rules
- TypeScript `strict`; no `any` without a comment explaining why.
- Database changes only through versioned migrations in `supabase/migrations/`.
- Every table holding workspace data has RLS enabled, and every RLS policy has a pgTAP test proving cross-workspace and cross-client access fails.
- Badge, volume, PR, streak and unit logic lives only in `packages/shared` as pure functions with unit tests. Don't duplicate it in the apps.
- Test-driven development for shared logic and database policies.
- Before saying work is done: run typecheck, lint and all tests, and show the output.
- Scope discipline: anything listed as "not in Version 1" in the spec needs product owner approval before building.
- Hosting stays portable: the web app runs on Cloudflare Workers via OpenNext, but app code must not use host-specific APIs (Cloudflare KV/R2/D1/bindings, Vercel KV/Blob/Cron, edge-only runtimes). Data, files and background jobs go through Supabase. Moving to Vercel must stay a config + DNS change.
- Media: no video uploads. Images are compressed on the device (max 1600 px long edge, plus thumbnail) before upload.

## Working with Claude Code
- `.claude/agents/reviewer.md`: read-only reviewer (its Bash is limited to read-only git/gh by a hook). Checks a branch against `origin/main`, the spec and this file: data safety, RLS/pgTAP, migrations clashing with other open PRs, shared-logic placement. Skips style.
- `.claude/agents/implementer.md`: does one task in its own worktree from fresh `origin/main`, test-first, runs `pnpm check`; never merges, force-pushes or commits to `main`.
- Hook (`.claude/settings.json`): after Claude edits a `.ts`/`.tsx` file, `eslint --fix` runs on that file only. Silent and never blocks. No prettier: most files aren't prettier-formatted, so it would rewrite whole files.
- Permissions: routine read-only commands (git status/log/diff/show, gh pr view/list/diff/checks, gh run view/list, `pnpm check`/test/typecheck/lint) run without asking. Force-pushes and pushes to `main` are denied. Everything else still asks.
- `.worktreeinclude` copies `supabase/functions/.env` (local, no keys) into new worktrees. Never add files that can hold keys; run `pnpm --filter web env:local` / `pnpm --filter mobile env:local` in the worktree instead.
- Personal overrides go in `.claude/settings.local.json` (git-ignored).
