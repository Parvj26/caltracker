# Better usage insight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the PO see what a coach did (recordings on the coach website, readable button labels, a fixed code for every error on screen, server failures next to the click that caused them) without any user content leaving the app.

**Architecture:** Three independent streams, each its own branch from fresh `origin/main` and its own draft PR. They touch disjoint files; the only shared file is `packages/shared/src/analytics/index.ts` (stream B appends at the bottom, stream C inserts at the top, so git merges them). One small hook (C5) waits until stream B is on main.

**Tech Stack:** Next.js 16 (OpenNext on Cloudflare Workers), posthog-js 1.447.3, Expo / posthog-react-native, Supabase Edge Functions (Deno), Vitest, Playwright, ESLint flat config.

**Spec:** `docs/superpowers/specs/2026-11-10-better-usage-insight-design.md`

## Global Constraints

- Only `apps/web/src/lib/analytics/` may import `posthog-js` (existing ESLint rule; keep it).
- Label rule: `<area>_<action>[_<thing>]`, regex `^[a-z]+(_[a-z0-9]+)+$`; never an id, name or typed value; same label web and phone.
- Web label attribute `data-ph-capture-attribute-label="…"`; phone `ph-label="…"`.
- `data-ph-safe` only on fixed product copy: never on anything that can show a name, email, note, message, food, number or date a user entered.
- Server `$exception` events carry only `$exception_list: [{ type, value: <code> }]`, `code`, `where`, `distinct_id`, optional `$session_id`. No message, stack, body, query or user content.
- No key configured = every sender is a no-op; analytics code never throws.
- Session recording only under `apps/web/src/app/(coach)`; `NEXT_PUBLIC_SESSION_REPLAY` must equal `on` (default off); `posthog.init` keeps `disable_session_recording: true`; `startSessionRecording()` is called with no arguments.
- PostHog flag `coach-session-replay` stays off. Do not enable recordings for real coaches. Do not merge.
- Node: prefix commands with `eval "$(fnm env)" && fnm use 24`. Every worktree: `pnpm install`, then `pnpm check` before pushing.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR bodies are plain words and end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Temp files are uniquely named (`insight-a-pr.md`, `insight-b-pr.md`, `insight-c-pr.md`).
- Local Supabase: lane A (default stack) is in use by another agent. Only stream B needs a database (web e2e); it uses lane B (`project_id = "fitness-tracker-b"`, ports 544xx in its own `supabase/config.toml`, marked `git update-index --skip-worktree`, never committed). One web e2e at a time on the machine: check `lsof -i :3000` first and wait if busy.

## Review Focus

1. A heading or button that shows a client's name (e.g. "Remove Luis", "Luis's clients") wrongly marked `data-ph-safe` — the masking canary test in A3 renders such text unmarked and asserts it is masked; reviewers grep every new `data-ph-safe` for `{` interpolation.
2. The gate mounting before PostHog is initialised (child effects run before the provider's) — A2 test: `startReplay()` before `initAnalytics()` still starts once init happens.
3. Sign-out while recording — A2 test: `resetAnalytics()` calls `stopSessionRecording`.
4. An action that throws a Supabase error object whose `message` holds user data — C1 test feeds `{ message: 'luis@example.com', stack, body }` and asserts the output has none of it.
5. A thrown error inside the reporter itself (fetch rejects, no key, bad host) — C2/C3 tests assert the sender resolves and the user-facing response is unchanged.

---

## Stream A — recordings (branch `feature/insight-replay`, worktree `.worktrees/insight-a`)

Files owned: `apps/web/src/lib/analytics/client.ts`, new `apps/web/src/lib/analytics/replay-config.ts`, new `apps/web/src/lib/analytics/session-replay-gate.tsx`, `apps/web/src/app/(coach)/layout.tsx`, shared chrome (`apps/web/src/app/(coach)/nav-link.tsx`, `coach-sidebar.tsx`, `help-nav-link.tsx`, `apps/web/src/components/ui/button.tsx`, `card.tsx`, `chip.tsx`, `tile.tsx`, `apps/web/src/components/empty-library.tsx`, `coming-soon.tsx`, `coach-avatar.tsx`, `sharp-photo.tsx`, `stable-img.tsx`), `apps/web/src/app/(legal)/privacy/page.tsx`, `scripts/posthog-dashboards.ts`, new test `packages/shared/src/analytics/before-send-snapshot.test.ts`. Must NOT touch `components/ui/text-field.tsx`, `provider.tsx`, feature pages, eslint config.

### Task A1: Recording config

**Files:** Create `apps/web/src/lib/analytics/replay-config.ts`, test `replay-config.test.ts` next to it.

**Interfaces:** Produces `export const RECORDING_CONFIG` (object spread into `posthog.init`: keys `session_recording`, `capture_performance`, `enable_recording_console_log`) and `export function maskText(text: string, el?: HTMLElement | null): string`.

- [ ] Write failing tests: `session_recording.maskAllInputs === true`; `maskTextSelector === '*'`; `blockSelector` contains `img`, `picture`, `video`, `canvas`, `[data-ph-block]`; `recordHeaders`, `recordBody`, `recordCrossOriginIframes` are `false`; `capture_performance.network_timing === false`; `enable_recording_console_log === false`; `maskText('Luis', divNotMarked) === '****'`; `maskText('Save', buttonInside[data-ph-safe]) === 'Save'`; `maskText('x', undefined) === '*'`; `maskCapturedNetworkRequestFn({ name: 'https://x/invite/abc123token' })` returns the `scrubUrl` result.
- [ ] Run `pnpm --filter web exec vitest run src/lib/analytics/replay-config.test.ts` → FAIL.
- [ ] Implement exactly the spec's config block (section 1). Values typed against posthog-js `PostHogConfig` (all option names exist in 1.447.3).
- [ ] Run → PASS. Commit `feat(web): privacy-first session recording config`.

### Task A2: Gate, env switch, tracing header, stop on sign-out

**Files:** Modify `apps/web/src/lib/analytics/client.ts`; create `session-replay-gate.tsx`; modify `(coach)/layout.tsx`; tests in `client.test.ts` (existing, mocks posthog-js) and `session-replay-gate.test.tsx`.

**Interfaces:** Produces `startReplay(): void`, `stopReplay(): void` in `client.ts`; `export function SessionReplayGate(): null`.

- [ ] Failing tests: with `NEXT_PUBLIC_SESSION_REPLAY` unset, `startReplay()` never calls `posthog.startSessionRecording`; with `on`, calling `startReplay()` BEFORE `initAnalytics()` results in exactly one `startSessionRecording()` call (no arguments) once init runs; `stopReplay()` calls `stopSessionRecording`; `resetAnalytics()` calls `stopSessionRecording`; `posthog.init` receives `disable_session_recording: true`, the `RECORDING_CONFIG` keys, and `addTracingHeaders: [window.location.host]`; gate mount calls `startReplay`, unmount calls `stopReplay`.
- [ ] Run → FAIL.
- [ ] Implement: a module-level `wantReplay` flag; `startReplay` sets it and starts if ready; `initAnalytics` starts after init when wanted. `addTracingHeaders` lists only our own host (ruling: the browser never calls Edge Functions, and adding a custom header to Supabase REST calls would trigger CORS preflights). Render `<SessionReplayGate />` inside `AnalyticsProvider` in `(coach)/layout.tsx`.
- [ ] Run → PASS. Commit `feat(web): start recordings only on coach pages behind NEXT_PUBLIC_SESSION_REPLAY`.

### Task A3: Mark fixed chrome safe, block photos, masking canary

**Files:** the shared chrome files listed above; `packages/shared/src/analytics/before-send-snapshot.test.ts`; canary test `apps/web/src/lib/analytics/masking-canary.test.tsx`.

- [ ] Failing tests: `beforeSend({ event: '$snapshot', properties: { $snapshot_data: X, $session_id: 's' } })` returns properties deep-equal to input; masking canary renders (jsdom) a page with an unmarked `<h1>Zebracanary Testperson</h1>`, `<input value="Zebracanary">`, `<img alt="Zebracanary">`, and `<button data-ph-safe>Save</button>`, snapshots it with the rrweb `snapshot()` bundled in posthog-js (or `rrweb-snapshot` as a dev dependency if the bundle is not importable) using `RECORDING_CONFIG.session_recording` options, and asserts `JSON.stringify(result)` does not contain `Zebracanary` and does contain `Save`.
- [ ] Run → FAIL (canary fails until options are mapped correctly).
- [ ] Implement: `data-ph-safe` on nav labels, sidebar, help, sign-out, and an opt-in `phSafe?: boolean` prop on `Button`/`Chip`/`Tile`/`Card` title that renders `data-ph-safe` (no default — callers opt in, so dynamic button text stays masked). `EmptyLibrary` and `ComingSoon` copy is fixed: mark it. Avatar/photo components get `data-ph-block` (CSS background avatars) — `<img>` is already blocked by selector.
- [ ] Run tests → PASS. Commit `feat(web): mark fixed coach chrome as safe to show in recordings`.

### Task A4: Saved replay filters + privacy sentence (PO approval needed)

**Files:** `scripts/posthog-dashboards.ts`; `apps/web/src/app/(legal)/privacy/page.tsx`; existing `apps/web/e2e/legal.spec.ts` if it pins privacy text.

- [ ] Add to the dashboards script (idempotent, by name) three saved replay filters: "Coach friction" (`$rageclick` or `$dead_click`), "Coach errors" (`error_shown` or `$exception`), "Gave up" (`task_abandoned`), internal accounts excluded. Do not run it against PostHog.
- [ ] Separate commit: add after the PostHog line: "On the coach website we also record how pages are used (clicks, scrolling, page changes) so we can find and fix problems; everything typed, client details and photos are hidden in these recordings, and recordings are deleted after 30 days. The client app is not recorded." Commit `docs(privacy): mention coach website recordings (PO to approve wording)`.
- [ ] `pnpm check`, push, draft PR. PR body says the privacy sentence awaits PO approval.

---

## Stream B — error codes, ErrorText, lint, button labels (branch `feature/insight-errors-labels`, worktree `.worktrees/insight-b`)

Files owned: new `packages/shared/src/analytics/error-codes.ts`, `sanitize.ts`, `before-send.ts` (+ their tests), `packages/shared/src/analytics/index.ts` (append at bottom), `apps/web/src/components/ui/text-field.tsx`, `apps/web/src/lib/analytics/provider.tsx`, new `apps/web/src/lib/action-result.ts`, every `apps/web/src/app/**/actions.ts` and its callers, feature components with `role="alert"`, the labelled controls' files, `apps/mobile/src/components/ui/text-field.tsx`, mobile error callers and logging/meal controls, `eslint.config.mjs`, new `apps/web/e2e/insight-labels.spec.ts`. Must NOT touch `client.ts`, layout, shared chrome from stream A, `supabase/functions`.

### Task B1: Error code catalogue + sanitize/beforeSend guards

**Interfaces:** Produces in `error-codes.ts`: `export const ERROR_CODES` (`as const` object code → message), `export type ErrorCode = keyof typeof ERROR_CODES`, `export function isErrorCode(v: unknown): v is ErrorCode`, `export function errorMessage(code: ErrorCode): string`, `export const LABEL_PATTERN = /^[a-z]+(_[a-z0-9]+)+$/`. `missing_code` is a code in the list (message = `server_error`'s).

Starting messages (fixed copy):

| code | message |
|---|---|
| invite_email_invalid | Check the name and email, then try again. |
| invite_already_client | This person is already one of your clients. |
| invite_send_failed | Couldn't send the invite. Please try again. |
| csv_bad_format | Some rows couldn't be read. Fix them and upload again. |
| assign_none_selected | Pick at least one client. |
| assign_date_invalid | Pick a valid start date. |
| assign_save_failed | Couldn't assign this. Please try again. |
| program_name_required | Give the program a name. |
| program_save_failed | Couldn't save the program. Please try again. |
| workout_save_failed | Couldn't save the workout. Please try again. |
| exercise_not_found | That exercise is no longer in your library. |
| upload_too_large | That file is too large. |
| upload_failed | Couldn't upload the file. Please try again. |
| sign_in_failed | Wrong email or password. |
| otp_expired | This link has expired. Ask for a new one. |
| session_expired | You were signed out. Please sign in again. |
| permission_denied | You don't have access to this. |
| network_offline | You're offline. Check your connection and try again. |
| server_error | Something went wrong. Please try again. |
| field_required | Fill in this field. |
| field_format | Check this field and try again. |

Add a code (one line) whenever a screen needs one the list lacks; server failures end in `_failed`.

- [ ] Failing tests: every key matches `^[a-z]+(_[a-z0-9]+)*$`; `sanitize('error_shown', { code: 'nope' }).code === 'missing_code'`; known codes pass through; `beforeSend` on `$autocapture` drops `label: 'Save button'` and `label: 'client_[id]'`, keeps `label: 'assign_save'`; `$elements` `attr__ph-label` not matching the pattern is removed; `$elements_chain` `attr__ph-label="Bad Label"` is removed. Before changing `sanitize`, grep events using `code` and add any other legitimate values to the list.
- [ ] Run `pnpm --filter @caltracker/shared test` → FAIL; implement; → PASS. Commit.

### Task B2: Web `ErrorText` with required code, actions return codes, provider fallback

**Interfaces:** `ErrorText({ code, children?, className?, id? })` renders `role="alert"`, `data-error-code={code}`, `data-ph-safe`, and `children ?? errorMessage(code)` (children only fixed copy). `TextField` `error` becomes `error?: { code: ErrorCode; text?: string }` (or a separate `errorCode` prop — pick one, keep it typed). `apps/web/src/lib/action-result.ts`: `export type ActionFailure = { ok: false; code: ErrorCode }`, `export function fail(code: ErrorCode, where: string): ActionFailure` (`where` like `action:assign.assignProgram`; unused for now, stream C hooks it). Also mark `TextField`/`SelectField`/`TextAreaField` label and hint `data-ph-safe`.

- [ ] Failing tests: `ErrorText` without children shows the catalogue message and `data-error-code`; provider reports `code: 'missing_code'` for a `[role=alert]` with no `data-error-code` (replace the `'alert'` fallback); existing `actions.test.ts` files expect `{ ok: false, code }`.
- [ ] Convert every `{ ok: false, error: string }` in `apps/web/src/app/**/actions.ts` to `fail(code, where)`; callers show `<ErrorText code={…} />` (keep existing fixed copy as children where it is better than the catalogue). Never render a raw Supabase/database message. Move the ~9 `role="alert"` sites (csv-upload, messages conversation/composer/error, copy-week-dialog, live-view) to `ErrorText`.
- [ ] `pnpm --filter web test` → PASS; `pnpm --filter web typecheck` → PASS. Commit.

### Task B3: Lint guard

- [ ] In `eslint.config.mjs` add `no-restricted-syntax` for `JSXAttribute[name.name='role'][value.value='alert']` (web) and `JSXAttribute[name.name='accessibilityRole'][value.value='alert']` (mobile), message "Use ErrorText with a code"; disable it only inside the two `text-field.tsx` files. Prove it: a temporary file with `role="alert"` makes `pnpm lint` fail (then delete it). Commit.

### Task B4: Phone `ErrorText`

- [ ] Failing test (mobile vitest): `ErrorText code="sign_in_failed"` tracks `error_shown` with `code: 'sign_in_failed'` (not `'alert'`) and shows the catalogue message; `children` optional.
- [ ] Make `code: ErrorCode` required; update every mobile caller (home, today, workouts, invite, workout/[id], first-time-welcome, log summary, sign-up, sign-in, auth/confirmed, messages composer). Raw `error.message` from Supabase is replaced by a code. → PASS. Commit.

### Task B5: Button labels, web and phone

Labels (spec section 2) and where they live:

| Labels | Files |
|---|---|
| `invite_open`, `invite_send`, `invite_cancel`, `invite_csv_open`, `invite_csv_upload` | `(coach)/clients/client-directory.tsx` or `page.tsx` (open), `invite-dialog.tsx`, `csv-upload.tsx` |
| `assign_open`, `assign_pick_program`, `assign_pick_client`, `assign_pick_date`, `assign_save`, `assign_cancel` | `(coach)/clients/[clientId]/assign-dialog.tsx`, `assignments-panel.tsx`, `components/assign/assign-to-clients.tsx` |
| `program_new`, `program_name_save`, `program_add_week`, `program_add_workout`, `program_copy_week`, `program_save` | `(coach)/programs/page.tsx`, `programs/new/page.tsx`, `programs/[id]/program-details.tsx`, `program-grid.tsx`, `copy-week-dialog.tsx` |
| `workout_add_exercise`, `workout_exercise_search`, `workout_exercise_pick`, `workout_add_set`, `workout_remove_set`, `workout_save` | `components/workout-builder/workout-builder.tsx`, `components/exercise-search/*` |
| `log_start_workout`, `log_set_done`, `log_add_set`, `log_finish_workout`, `log_add_meal`, `log_meal_save` | mobile `components/today/today-cards.tsx`, `app/(app)/(tabs)/workouts.tsx`, `app/(app)/plan/[id].tsx`, `components/log/set-table.tsx`, `log-pages.tsx`, `app/(app)/log/[id]/index.tsx`, meal sheet |

If a control does not exist under that exact name, label the nearest equivalent and note it in the PR. Fixed-copy label text also gets `data-ph-safe`; fixed dialog titles in these files too. `feature/program-builder` (another agent) is editing program files: keep edits to one attribute per element so rebases stay trivial.

- [ ] Failing e2e `apps/web/e2e/insight-labels.spec.ts`: each web label above is present with its exact value on its flow; an invalid invite email shows `[role=alert][data-error-code="invite_email_invalid"]`; a page listener collects every `[role=alert]` seen in the run and asserts each `data-error-code` is in `ERROR_CODES`. Failing mobile unit test: logging buttons carry their `ph-label`s.
- [ ] Implement; run the new spec alone on lane B (`pnpm --filter web exec playwright test e2e/insight-labels.spec.ts`), then the specs for the touched flows (clients, programs, workout-editor, assign-from-library, messages, copy-workout). `pnpm check`. Push; draft PR (note: phone needs an app rebuild).

---

## Stream C — server error reporting (branch `feature/insight-server-errors`, worktree `.worktrees/insight-c`)

Files owned: new `packages/shared/src/analytics/server-error.ts` (+ test), `packages/shared/src/analytics/index.ts` (insert export at the TOP), `packages/shared/src/admin/timeline.ts` (+ test), new `apps/web/src/lib/analytics/server.ts` (+ test), new `apps/web/src/instrumentation.ts`, new `supabase/functions/_shared/report-error.ts` (+ Deno test), each `supabase/functions/*/index.ts`, `package.json` `functions:*` scripts only if needed, `.env.example` files. Must NOT touch `actions.ts`, `error-codes.ts`, `sanitize.ts`, `client.ts`.

### Task C1: Event builder

**Interfaces:** `buildServerErrorEvent(input: { error?: unknown; code: string; where: string; distinctId?: string | null; sessionId?: string | null }): ServerErrorEvent` where `ServerErrorEvent = { event: '$exception'; distinct_id: string; properties: { $exception_list: [{ type: string; value: string }]; code: string; where: string; $session_id?: string; $process_person_profile?: false } }`; `isServerFailureCode(code: string): boolean` (`server_error` or ends with `_failed`).

Rules: `type` = error's constructor name if it matches `^[A-Za-z][A-Za-z0-9_]{0,40}$`, `'ActionFailed'` when no error given, else `'Error'`. `code` must match `^[a-z]+(_[a-z0-9]+)*$` and ≤ 40 chars, else `server_error` (pattern, not the stream-B list, so streams stay independent). `where` must match `^(action|fn):[A-Za-z0-9_./\[\]-]{1,80}$`, else `unknown`. `distinct_id` = user id if it is a UUID, else `'server'` with `$process_person_profile: false`. `$session_id` only if it matches `^[A-Za-z0-9-]{1,64}$`.

- [ ] Failing tests: an error `{ message: 'luis@example.com', stack: '…', body: { name: 'Luis' } }` → `JSON.stringify(event)` contains none of `luis`, `stack`, `Luis`; output property keys are exactly the allowed set; `value === code`; bad code/where/session fall back as above.
- [ ] → FAIL; implement; → PASS. Commit.

### Task C2: Web sender + thrown action errors

**Interfaces:** `apps/web/src/lib/analytics/server.ts`: `reportServerError(input: { error?: unknown; code: string; where: string }): void` — reads user id from the Supabase server client (`getClaims`/`getUser`, whichever `lib/supabase/server.ts` already uses; failure → null) and `x-posthog-session-id` from `headers()`, then `after(() => send(event))`. `send(event, opts?: { key?: string; host?: string; fetchImpl?: typeof fetch }): Promise<void>` posts `{ api_key, ...event }` to `${host}/i/v0/e/` with a 3 s `AbortSignal.timeout`; key from `POSTHOG_SERVER_KEY`, host from `POSTHOG_HOST` (default `https://us.i.posthog.com`). `apps/web/src/instrumentation.ts`: `onRequestError(err, request, context)` → when `context.routeType === 'action'` report `{ error: err, code: 'server_error', where: 'action:' + scrubbed context.routePath }` (send directly, not via `after()`).

- [ ] First verify OpenNext Cloudflare 1.20.16 calls `onRequestError` (search `node_modules/@opennextjs` for it). If not, stop and report; do not improvise a per-action wrapper (it would collide with stream B).
- [ ] Failing tests: no key → `fetch` never called; `fetch` rejects → `send` resolves; posted body has only builder fields; `reportServerError` schedules via `after` (mock `next/server`).
- [ ] → FAIL; implement; → PASS. Commit.

### Task C3: Edge Function sender + wrapping

**Interfaces:** `supabase/functions/_shared/report-error.ts`: `withErrorReporting(where: string, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response>` — on throw, reports `server_error` and returns the same 500 the function returns today (keep each function's existing error body); on a response with status ≥ 500, reports `server_error`. Never awaits the send: `EdgeRuntime.waitUntil(p)` when defined, else `p.catch(() => {})`. `distinct_id` from the bearer JWT `sub` (decoded, not verified — attribution only); session from `x-posthog-session-id`. Imports the builder from `./caltracker/analytics/server-error.ts` (synced copy). Key `POSTHOG_SERVER_KEY`, host `POSTHOG_HOST`.

- [ ] Failing Deno tests (`pnpm functions:test`): throwing handler → 500 and one captured send with `where: 'fn:send-invite'`; 200 handler → no send; no key → no fetch; fetch rejects → response unaffected.
- [ ] Wrap `Deno.serve` handlers in all six functions (`fn:<name>`). If a function answers browser CORS preflights, add `x-posthog-session-id` to its allowed headers. `pnpm functions:check` and `pnpm functions:test` → PASS. Commit.

### Task C4: Admin timeline label

- [ ] Failing test in `packages/shared/src/admin/timeline.test.ts`: `posthogEventLabel('$exception', { code: 'assign_save_failed', where: 'action:assign.assignProgram' })` → `'Server error: assign_save_failed (action:assign.assignProgram)'`; a code/where failing the C1 patterns → `'Server error'` with no raw text.
- [ ] Implement; check `apps/admin/src/lib/posthog.ts` query does not filter `$exception` out. → PASS. `pnpm check`, push, draft PR (lists the secrets `POSTHOG_SERVER_KEY` to add to the Worker and Supabase functions, and the C5 follow-up).

### Task C5 (after stream B is on main): report returned failures

- [ ] Rebase on main; in `apps/web/src/lib/action-result.ts` `fail()` call `reportServerError({ code, where })` when `isServerFailureCode(code)`. Test: `fail('assign_save_failed', …)` reports once; `fail('field_required', …)` never. Push to the same PR.

---

## After all streams

PO staging check (spec "Staging verification"): set secrets, set `NEXT_PUBLIC_SESSION_REPLAY=on` for the staging build, enable recordings in PostHog project settings with `coach-session-replay` as the linked flag, turn the flag on for internal test coaches only, run the four flows with fixture client "Zebracanary Testperson", watch the recording together, then (only on PO OK) add Luis.
