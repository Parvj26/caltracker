# Usage Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send privacy-safe usage, task (taps/time/abandon) and frustration events from the coach website and client phone app to PostHog, and build the PO's PostHog dashboards.

**Architecture:** Pure, tested logic (event catalogue, property allow-list, URL scrubbing, task tracker, rage-tap detector) lives in `packages/shared/src/analytics`. Each app has one thin `track`/`identify` wrapper around its PostHog SDK; app code imports only that wrapper. Dashboards are created by an operator script against the PostHog API.

**Tech Stack:** posthog-js (web, Next 16), posthog-react-native (Expo SDK 58, expo-router), vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-11-07-usage-analytics-design.md`

## Global Constraints

- PostHog Cloud **US**: host `https://us.i.posthog.com`. Staging project key goes in GitHub secret `STAGING_POSTHOG_KEY` and is exposed as `NEXT_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_KEY`; host as `NEXT_PUBLIC_POSTHOG_HOST` / `EXPO_PUBLIC_POSTHOG_HOST`. Document all four in `.env.example`.
- No key → every analytics call is a no-op (tests, CI, local).
- Person = Supabase user id; person props `name, email, role ('coach'|'client'), workspace_id, workspace_name, internal`.
- `internal=true` when email matches `/^parvjain2503(\+[^@]*)?@gmail\.com$/i` or is in `INTERNAL_EMAILS` (shared constant; VK's email to be supplied by PO, leave the list with a `// PO to add VK` entry empty until then).
- Allowed property keys (anything else dropped): `task, taps, duration_ms, screens, back_count, error_count, last_screen, variant, sets_logged, taps_per_set, screen, code, item_type, ms, query, kind, role`. `query` only on `exercise_search_no_results`, max 60 chars.
- Never send: weights, reps values, body data, food values, photos, message/post/note text, other people's names.
- Autocapture on with all element text and attributes masked; session recording off; web heatmaps, `$rageclick`, `$dead_click` on.
- Abandon timeout: 10 min backgrounded. Rage tap: same element ≥ 3 taps within 1000 ms. Quick undo: within 30 000 ms of create. Slow screen: > 2000 ms.
- Analytics never throws into app code (wrappers catch everything).
- `posthog-js` / `posthog-react-native` may be imported only from `apps/web/src/lib/analytics/**` and `apps/mobile/src/lib/analytics/**` (ESLint `no-restricted-imports`).
- Repo rules: work in a fresh `origin/main` worktree, branch `feature/analytics-*`, Conventional Commits, `pnpm check` green before done.

## Review Focus

1. **Secrets in URLs:** `/invite/<token>`, `?code=`, `?token_hash=`, `#access_token=` must never reach PostHog in `$current_url`, `$pathname`, `$referrer` or screen names → scrubbed to `/invite/[token]` and no query/hash. (Task 1 `scrubUrl` tests; Task 3/5 wire it into `before_send`/screen names.)
2. **Masked autocapture actually masked:** a click on a client's name or a weight must not carry `$el_text`/attribute values. (Task 3 `before_send` strips `$el_text` and element `attr__*` except `ph-label`; Task 5 manual check + strip in `beforeSend`.)
3. **Sign-out / account switch on a shared phone:** after sign-out, events must not be attributed to the previous person → `reset()` in sign-out; open tasks dropped. (Tasks 3, 5 tests on wrapper.)
4. **Offline / killed app mid-task:** a task started and the app killed must not later report a bogus `task_completed` with hours of duration → tracker restarts fresh on cold start; >10 min background → `task_abandoned`. (Task 2 tests.)
5. **Double start / nested tasks:** starting `log_workout` twice or a second task while one is open must not double count → re-start of the same task is ignored; different tasks run independently. (Task 2 tests.)

---

### Task 1: Shared catalogue, sanitizer, URL scrubber, internal check

**Files:**
- Create: `packages/shared/src/analytics/events.ts`, `sanitize.ts`, `scrub-url.ts`, `internal.ts`, `index.ts`
- Modify: `packages/shared/src/index.ts` (re-export `./analytics`)
- Test: `packages/shared/src/analytics/sanitize.test.ts`, `scrub-url.test.ts`, `internal.test.ts`

**Interfaces:**
- Produces:
  - `type TaskName = 'join_from_invite'|'find_todays_workout'|'log_workout'|'log_meal'|'message_coach'|'community_post'|'view_progress'|'coach_first_setup'|'invite_client'|'build_program'|'assign_program'|'review_workout'|'reply_message'|'set_food_targets'|'edit_past_workout'`
  - `type EventName = 'task_started'|'task_completed'|'task_abandoned'|'rage_tap'|'error_shown'|'quick_undo'|'slow_screen'|'exercise_search_no_results'|'app_opened'|'notification_opened'|'invite_sent'|'first_workout_logged'`
  - `ALLOWED_KEYS: readonly string[]` (Global Constraints list)
  - `sanitize(event: string, props: Record<string, unknown> | undefined): Record<string, string | number | boolean>`
  - `scrubUrl(url: string): string`
  - `isInternalEmail(email: string | null | undefined): boolean`, `INTERNAL_EMAILS: readonly string[]`

- [ ] **Step 1: Write failing tests**
  - `sanitize('task_completed', {task:'log_meal', taps:4, weight_kg:80, note:'x'})` → `{task:'log_meal', taps:4}`
  - `sanitize('error_shown', {query:'bench'})` → `{}`; `sanitize('exercise_search_no_results', {query:'x'.repeat(80)})` → `query` length 60
  - non-primitive values (objects, arrays, functions) dropped; `undefined` props → `{}`
  - `scrubUrl('https://staging.caltracker.app/invite/abc123?x=1#access_token=t')` → `'https://staging.caltracker.app/invite/[token]'`
  - `scrubUrl('/set-password?code=abc')` → `'/set-password'`; `scrubUrl('caltracker://invite/tok')` → `'caltracker://invite/[token]'`; `scrubUrl('/clients/5f0c…uuid')` unchanged except query/hash removal
  - `isInternalEmail('ParvJain2503+smoke@gmail.com')` true; `'parvjain2503@gmail.com'` true; `'lggbueno23@gmail.com'` false; `null` false
- [ ] **Step 2:** `pnpm --filter @caltracker/shared test -- analytics` → FAIL (modules missing)
- [ ] **Step 3:** Implement. `scrubUrl` keeps relative/absolute/custom-scheme form, drops `?…` and `#…`, replaces the segment after `invite/` with `[token]`.
- [ ] **Step 4:** Tests pass (both TZ runs).
- [ ] **Step 5:** Commit `feat(shared): add analytics catalogue, sanitizer and url scrubber`

### Task 2: Shared task tracker and rage-tap detector

**Files:**
- Create: `packages/shared/src/analytics/task-tracker.ts`, `rage-tap.ts`, `quick-undo.ts`
- Test: matching `*.test.ts`

**Interfaces:**
- Consumes: `TaskName`, `EventName` (Task 1)
- Produces:
  - `type Emit = (event: EventName, props: Record<string, string|number|boolean>) => void`
  - `class TaskTracker { constructor(emit: Emit, now?: () => number); start(task: TaskName, variant?: string): void; tap(): void; back(): void; error(): void; screen(name: string): void; complete(task: TaskName, extra?: { sets_logged?: number; variant?: string }): void; abandon(task: TaskName): void; backgrounded(): void; foregrounded(): void; clear(): void }`
  - `class RageTapDetector { constructor(now?: () => number); tap(elementKey: string): boolean }` (true exactly on the 3rd tap within 1000 ms; resets after firing)
  - `isQuickUndo(createdAtMs: number, nowMs: number): boolean` (≤ 30 000)

- [ ] **Step 1: Failing tests** (fake clock):
  - start → 3 taps, 1 back, 2 screens, 1 error → complete after 4000 ms emits `task_started` then `task_completed {task, taps:3, back_count:1, screens:2, error_count:1, duration_ms:4000}`
  - `complete('log_workout', {sets_logged:6})` with 18 taps → `sets_logged:6, taps_per_set:3`
  - complete for a task never started → emits nothing
  - start twice same task → one `task_started`, counters not reset
  - two open tasks: taps counted in both
  - `backgrounded()` at t, `foregrounded()` at t+600 001 → `task_abandoned {task, last_screen}` for every open task; at t+599 999 → nothing
  - `abandon` emits `task_abandoned` with `last_screen` = last `screen()` name
  - `clear()` drops open tasks silently (sign-out)
  - rage: taps on 'a' at 0, 300, 900 → third returns true; at 0, 600, 1200 → false; 'a','b','a' → false
  - `isQuickUndo(0, 30000)` true, `(0, 30001)` false
- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Pass.
- [ ] **Step 5:** Commit `feat(shared): add analytics task tracker and rage-tap detector`

### Task 3: Web — PostHog wiring, identify, pageviews, masked autocapture

**Files:**
- Create: `apps/web/src/lib/analytics/client.ts`, `apps/web/src/lib/analytics/provider.tsx`, `apps/web/src/lib/analytics/before-send.ts`, `before-send.test.ts`, `client.test.ts`
- Modify: `apps/web/package.json` (add `posthog-js`, exact version), `apps/web/src/app/(coach)/layout.tsx` (wrap children in `<AnalyticsProvider person=…>` from `requireCoach()` data), the web sign-out action (call `resetAnalytics()` client-side before redirect), `apps/web/eslint.config.*` (`no-restricted-imports` for `posthog-js` outside `src/lib/analytics`), `.env.example`, `.github/workflows/deploy-staging.yml` (pass `NEXT_PUBLIC_POSTHOG_KEY: ${{ secrets.STAGING_POSTHOG_KEY }}`, `NEXT_PUBLIC_POSTHOG_HOST: https://us.i.posthog.com` to the build step next to the Supabase vars at line ~123)

**Interfaces:**
- Consumes: `sanitize`, `scrubUrl`, `isInternalEmail`, `TaskTracker`, `EventName` (Tasks 1–2)
- Produces (web app code uses only these):
  - `track(event: EventName, props?: Record<string, unknown>): void`
  - `useTask(): TaskTracker` (singleton bound to `track`; document-level click listener calls `tap()`; `popstate` calls `back()`; route change calls `screen(pathname)`)
  - `resetAnalytics(): void`
  - `<AnalyticsProvider person={{ id, name, email, workspaceId, workspaceName }}>` — role is always `'coach'` on web
  - `beforeSend(event: CaptureResult): CaptureResult | null` (pure)

- [ ] **Step 1: Failing tests**
  - `beforeSend` scrubs `$current_url`, `$pathname`, `$referrer`, `$initial_current_url` via `scrubUrl`
  - `beforeSend` on `$autocapture`: removes `$el_text`, removes every `elements[].attr__*` except `attr__ph-label`, removes `elements[].$el_text`
  - `beforeSend` on custom events: properties not starting with `$` pass through `sanitize`
  - `track` with no `NEXT_PUBLIC_POSTHOG_KEY` does not call posthog and does not throw; `track` when posthog throws does not throw
- [ ] **Step 2:** `pnpm --filter web test -- analytics` → FAIL
- [ ] **Step 3:** Implement. Init options: `api_host` from env, `person_profiles: 'identified_only'`, `autocapture: true`, `mask_all_text: true`, `mask_all_element_attributes: true`, `capture_pageview: 'history_change'`, `disable_session_recording: true`, `enable_heatmaps: true`, `capture_dead_clicks: true`, `before_send: beforeSend`. Provider calls `posthog.identify(id, { name, email, role:'coach', workspace_id, workspace_name, internal: isInternalEmail(email) })` once per id.
- [ ] **Step 4:** Tests pass; `pnpm check` green.
- [ ] **Step 5:** Add `ph-label` attributes to the main nav links and primary buttons on Home, Clients, Programs, Workouts, Messages (stable snake_case, e.g. `ph-label="invite_client"`).
- [ ] **Step 6:** Commit `feat(web): send masked usage analytics to PostHog`

### Task 4: Web — coach tasks and frustration events

**Files:**
- Modify: the coach screens owning each flow (find via the routes in `apps/web/src/app/(coach)/`: `clients` invite window, `programs` builder, `assign`, `workouts/[id]` review, `messages`, client overview food targets, calendar past-day edit, exercise search in `lib/exercise-index.ts` consumers), `apps/web/src/lib/action-errors.ts` (emit `error_shown {code, screen}` where errors are mapped to messages)
- Create: `apps/web/src/lib/analytics/use-slow-screen.ts`

**Interfaces:**
- Consumes: `track`, `useTask` (Task 3), `isQuickUndo` (Task 2)

- [ ] **Step 1:** Wire `start`/`complete` per spec table "Coach (web)". `coach_first_setup`: start on first `$identify` where person has no `invite_sent` before (person property `first_setup_started_at` set once via `$set_once`), complete on first `invite_sent`. `invite_sent` is also tracked as its own event. Leaving a task's route without completing → `abandon`.
- [ ] **Step 2:** `error_shown` from `action-errors.ts` with the error code key only; `quick_undo {item_type}` on delete/edit within 30 s of create for program, workout, invite, message; `slow_screen {screen, ms}` when a page's data fetch exceeds 2000 ms; `exercise_search_no_results {query}` from the exercise picker/search.
- [ ] **Step 3:** Unit-test any new pure helper; existing tests still pass; `pnpm check` green.
- [ ] **Step 4:** Manual on local stack with a throwaway PostHog key or console debug (`posthog.debug()`): run each of the 8 coach tasks once; confirm start/complete events and no text in `$autocapture`.
- [ ] **Step 5:** Commit `feat(web): track coach tasks and friction signals`

### Task 5: Phone — PostHog wiring, identify, screens, masked taps

**Files:**
- Create: `apps/mobile/src/lib/analytics/client.ts`, `provider.tsx`, `before-send.ts`, `before-send.test.ts`, `client.test.ts`
- Modify: `apps/mobile/package.json` (`posthog-react-native` + its Expo peer deps at Expo-SDK-58-compatible versions via `npx expo install`), `apps/mobile/src/app/_layout.tsx` (wrap `RootStack` in `AnalyticsProvider` inside `SessionProvider`), `apps/mobile/src/lib/sign-out.ts` (`resetAnalytics()` in `signOutAndForget`), `apps/mobile/scripts/write-staging-env.sh` (+ `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`; key read from env var `STAGING_POSTHOG_KEY` or macOS Keychain service `caltracker-posthog-staging-key`), mobile ESLint config (`no-restricted-imports`), `.env.example`

**Interfaces:**
- Consumes: Tasks 1–2
- Produces: `track(event, props?)`, `useTask(): TaskTracker`, `resetAnalytics()`, `<AnalyticsProvider>` (identifies from `useSession()`; role `'client'`), `beforeSend` (pure; same scrubbing/stripping rules as web for `$screen_name`, `$touch` element chains)

- [ ] **Step 1: Failing tests** — `beforeSend` scrubs `$screen_name`/`$current_url` (`invite/abc` → `invite/[token]`); strips any text/label values from `$touch` elements except `ph-label`; custom props sanitized; `track` no-op without key, never throws.
- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3:** Implement. Options: `host` from env, `captureAppLifecycleEvents: true`, `enableSessionReplay: false`, autocapture `{ captureTouches: true, captureScreens: false }` (screens sent manually from expo-router `usePathname()` scrubbed), `beforeSend`. Global tap hook feeds `TaskTracker.tap()` and `RageTapDetector` (element key = `ph-label` or component path) → `rage_tap {screen}`. AppState → `backgrounded()/foregrounded()`, `app_opened`. Notification response listener → `notification_opened {kind}`.
- [ ] **Step 4:** Tests pass; `pnpm check` green.
- [ ] **Step 5:** Add `ph-label` to tab bar items and primary buttons (Start workout, Log set, Finish, Add meal, Send, Post).
- [ ] **Step 6:** Commit `feat(mobile): send masked usage analytics to PostHog`

### Task 6: Phone — client tasks and frustration events

**Files:**
- Modify: screens/hooks owning each flow (`invite/[token]` + `lib/join-invite.ts`, Today (`lib/today-logic.ts` consumers), active log (`lib/use-active-log.tsx`), food (`lib/use-food.tsx`), messages (`lib/use-messages.tsx`), community (`lib/use-community.tsx`), Progress/Zoo), `lib/network-failure.ts` consumers for `error_shown`
- Create: `apps/mobile/src/lib/analytics/use-slow-screen.ts`

- [ ] **Step 1:** Wire tasks per spec table "Client (phone)". `log_workout` complete passes `sets_logged`; `log_meal` variant `photo|macros`. Emit `first_workout_logged` once (`$set_once` person prop).
- [ ] **Step 2:** `error_shown {code, screen}`, `quick_undo {item_type}` (set, meal, message, post), `slow_screen`, `exercise_search_no_results`.
- [ ] **Step 3:** Tests pass; `pnpm check` green.
- [ ] **Step 4:** Manual in iOS simulator with staging key (or `posthog.debug`): run each client task, kill app mid-workout, background 10+ min (fake via shortened constant in a debug build only), confirm abandon and no text in `$touch`.
- [ ] **Step 5:** Commit `feat(mobile): track client tasks and friction signals`

### Task 7: Dashboards and internal filter (operator script)

**Files:**
- Create: `scripts/posthog-dashboards.ts`, `docs/runbooks/analytics.md`
- Modify: `package.json` root script `posthog:dashboards`

**Interfaces:**
- Consumes: event/task names (Task 1). Reads PostHog personal API key from env `POSTHOG_PERSONAL_API_KEY` (PO stores it in Keychain `caltracker-posthog-personal-key`; never pasted in chat), project id from `POSTHOG_PROJECT_ID`.

- [ ] **Step 1:** Script is idempotent (find-by-name, update else create) and creates: test-account filter (`internal != true`) set as project default; cohort "Gone quiet" (no event in 7 days); dashboards **Tasks**, **Friction**, **Activity**, **Join-up funnel** (`invite_sent` → `$identify` with role client → `first_workout_logged`) with the insights listed in spec "PostHog setup".
- [ ] **Step 2:** Run against the staging project; open each dashboard and confirm it renders (empty is fine).
- [ ] **Step 3:** Runbook: how to read each dashboard in plain language for the PO; how to rerun the script.
- [ ] **Step 4:** Commit `chore: add PostHog dashboards script and runbook`

## Rollout
- PR A = Tasks 1–4 (shared + web), deploys to staging on merge. Before merge: `gh secret set STAGING_POSTHOG_KEY` (PO-provided key).
- PR B = Tasks 5–6 (phone), needs phone rebuild.
- PR C = Task 7 after PR A has sent events.
