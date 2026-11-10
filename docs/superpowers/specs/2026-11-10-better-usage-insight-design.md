# Better usage insight (recordings, labels, error codes, server errors) — design

Status: direction approved in chat by PO 2026-11-10 ("Option B"), awaiting written-spec review.
Amends: `2026-11-07-usage-analytics-design.md` (everything there still holds unless changed below).

## Goal

When the PO looks at a coach's PostHog data he should **see what happened instead of guessing**. On Luis's first sessions we could only tell that he rage-clicked and gave up on "assign program" (`/clients/[clientId]/training`), gave up on "build program", and that an invite showed an error recorded as code `alert`. After this work the PO can watch the session, read which button was clicked, read which error was shown, and see any server failure next to the click that caused it.

Not in scope: recordings in the client phone app, recordings in the admin app, AI summaries of sessions, any change to what is stored in our own database.

## Changes to the base spec

| Base spec said | Now |
|---|---|
| Session recording off on both apps | **On for the coach website only**, signed-in coach pages, privacy-first masking (section 1) |
| Important buttons get a stable label (phone only, loosely) | Every key control on the core tasks gets a label, web and phone, fixed naming rule (section 2) |
| `error_shown.code` e.g. `otp_expired` | Every on-screen error has a code from a fixed list; the `alert` fallback is gone; lint fails without a code (section 3) |
| Browser `$exception` events dropped | Still dropped in the browser. **Server** failures are sent as `$exception` with fixed fields only (section 4) |
| Privacy page mentions usage tracking | One added sentence about website recordings (section 5) |

## 1. Session recordings (coach website)

**Where:** only pages under the `(coach)` route group of `apps/web` (home, clients, programs, workouts, messages, etc.). Not recorded: sign-in/sign-up/password pages, `/invite`, `/not-a-coach`, the privacy page, the phone app, the admin app.

**How it is switched on:** `posthog.init` keeps `disable_session_recording: true`. A small client component `SessionReplayGate` in `(coach)/layout.tsx` calls `posthog.startSessionRecording()` on mount and `posthog.stopSessionRecording()` on unmount and on sign-out (`resetAnalytics`). It is called **without** override arguments, so PostHog's remote settings (the linked flag in the kill switch below) still decide whether anything is recorded. All of this lives in `apps/web/src/lib/analytics/` (the only module allowed to import posthog-js).

**Masking — "hide everything, show only what we mark safe".** Checked against the PostHog privacy docs (https://posthog.com/docs/session-replay/privacy): CSS `:not()` exclusions do not work because masking applies to children, so the documented way is mask-all text plus a `maskTextFn` that lets marked elements through. Config:

```ts
session_recording: {
  maskAllInputs: true,                 // every input, textarea, select: always masked, no exceptions
  maskTextSelector: '*',               // all page text masked by default
  maskTextFn: (text, el) => (el?.closest('[data-ph-safe]') ? text : '*'.repeat(text.length)),
  blockSelector: 'img, picture, video, canvas, [data-ph-block]', // photos, avatars, charts drawn on canvas: grey box
  recordHeaders: false,
  recordBody: false,
  recordCrossOriginIframes: false,
  maskCapturedNetworkRequestFn: (req) => ({ ...req, name: scrubUrl(req.name) }), // also scrubs the page URL in the player
},
capture_performance: { network_timing: false },
enable_recording_console_log: false,
```

- `data-ph-safe` is our marker. It goes **only** on elements whose text is fixed product copy: buttons, nav items, tab names, dialog titles, form labels, empty-state text, help text, and `ErrorText` (section 3). It never goes on anything that can show a name, email, note, message, food, number or date the user entered. A heading like "Luis's clients" or a client's name in a page title is **not** marked.
- If the installed posthog-js does not accept `blockSelector`, the shared avatar/photo components get the `ph-no-capture` class instead (documented: replaced by a same-size block). Avatars drawn as CSS background images get `data-ph-block`.
- Network and console recording are **off**. Request URLs to Supabase can carry search words and record ids, and console messages can carry error text; neither is needed for this goal.
- `beforeSend` must pass `$snapshot` (recording) events through unchanged; a unit test covers it.

**PostHog plan facts** (free plan, check https://posthog.com/pricing during setup): 5,000 web recordings per month free; recordings kept **up to 30 days** on the free plan (https://posthog.com/docs/session-replay/data-retention). One coach today is far below the limit. The project stays on the free plan with no card (or a $0 recordings billing limit if a card is ever added), so PostHog stops recording at the limit instead of charging.

**Kill switch (no deploy needed):** PostHog feature flag `coach-session-replay`, linked to recordings in Replay settings → triggers. Recording happens only for people the flag is on for. Turning the flag off (or setting the trigger sample rate to 0%) stops new recordings from the next page load. Second, build-time switch: `NEXT_PUBLIC_SESSION_REPLAY` must be `on` for the gate to call `startSessionRecording` at all; default off (tests, CI, local).

## 2. Clear button names

Web: `data-ph-capture-attribute-label="…"` (already used in `coach-sidebar.tsx`, `nav-link.tsx`). Phone: `ph-label="…"` (already set as `customLabelProp`). Labels also get `data-ph-safe` where the button text is fixed copy.

**Naming rule:** `<area>_<action>[_<thing>]`, lowercase snake_case, matching `^[a-z]+(_[a-z0-9]+)+$`. Never an id, name, or anything typed. Same label for the same control on web and phone. `sanitize`/`beforeSend` drop labels that do not match the pattern.

Controls labelled in this work (core tasks):

| Task | Labels |
|---|---|
| invite client | `invite_open`, `invite_send`, `invite_cancel`, `invite_csv_open`, `invite_csv_upload` |
| assign program | `assign_open`, `assign_pick_program`, `assign_pick_client`, `assign_pick_date`, `assign_save`, `assign_cancel` |
| build program | `program_new`, `program_name_save`, `program_add_week`, `program_add_workout`, `program_copy_week`, `program_save` |
| workout editor | `workout_add_exercise`, `workout_exercise_search`, `workout_exercise_pick`, `workout_add_set`, `workout_remove_set`, `workout_save` |
| phone logging | `log_start_workout`, `log_set_done`, `log_add_set`, `log_finish_workout`, `log_add_meal`, `log_meal_save` |

The implementation plan maps each label to its file; any new key control on these flows gets a label in the same PR.

## 3. Specific error reasons

- New `packages/shared/src/analytics/error-codes.ts`: a fixed list of codes, each with the message shown to the user. Starting list: `invite_email_invalid`, `invite_already_client`, `invite_send_failed`, `csv_bad_format`, `assign_none_selected`, `assign_date_invalid`, `assign_save_failed`, `program_name_required`, `program_save_failed`, `workout_save_failed`, `exercise_not_found`, `upload_too_large`, `upload_failed`, `sign_in_failed`, `otp_expired`, `session_expired`, `permission_denied`, `network_offline`, `server_error`, `field_required`, `field_format`. Adding a code = one line in this file.
- `ErrorText` (web `components/ui/text-field.tsx`, phone `components/ui/text-field.tsx`) takes a **required** `code: ErrorCode` prop, renders `data-error-code`, `data-ph-safe`, and the catalogue message. A caller may pass its own text only for fixed copy; raw server/database messages are never shown (they can contain user data).
- Server actions return `{ ok: false, code }` instead of a free-text `error`, so the screen shows the right message and code.
- The web provider stops falling back to `'alert'`: an alert without a known code is reported as `code: 'missing_code'` (so we notice), and `sanitize` replaces any code not in the list with `missing_code`.
- **Lint:** an ESLint `no-restricted-syntax` rule fails any JSX `role="alert"` outside `ErrorText`; the ~9 current `role="alert"` sites (csv-upload, messages, copy-week dialog, live-view, etc.) move to `ErrorText`. TypeScript makes `code` mandatory.

## 4. Server error tracking

- Shared builder `packages/shared/src/analytics/server-error.ts` makes the event; two thin senders post it to PostHog's capture API with `fetch`, without delaying the response:
  - web server actions (Cloudflare Worker): `apps/web/src/lib/analytics/server.ts`, using Next's `after()` (portable; no Cloudflare-specific API, per CLAUDE.md);
  - Edge Functions (Deno): `supabase/functions/_shared/report-error.ts`, using `EdgeRuntime.waitUntil`.
- Event `$exception` with **only**: `$exception_list: [{ type, value: <code> }]` (type = error class name, e.g. `PostgrestError`, or `ActionFailed`), `code`, `where` (e.g. `action:assign.assignProgram`, `fn:send-invite`), `distinct_id` = signed-in Supabase user id, `$session_id` when the browser sent one. **No** error message, stack trace, request body, query, or user content.
- What is reported: any thrown error in a server action or Edge Function, and any `{ ok: false }` with `server_error`/`*_failed` codes. Validation mistakes (`field_required` etc.) are not server errors; they already show up as `error_shown`.
- Linking to the session: posthog-js tracing headers (`__add_tracing_headers` for our own host and the Supabase host; confirm the option name in the installed version) add `X-POSTHOG-SESSION-ID` to requests, so the server error appears **inside the recording** and on the person's timeline. Edge Function CORS allows that header. Without the header, it still shows on the person's timeline by time.
- `beforeSend` keeps dropping browser `$exception` events (they carry raw text). The admin app's per-person timeline (`apps/admin/src/lib/posthog.ts`, `posthogEventLabel`) shows server errors as "Server error: <code> (<where>)".
- Server key: the same public project key, as a Worker secret and a Supabase function secret. No key = no-op.

## 5. Privacy policy

One sentence added to `apps/web/src/app/(legal)/privacy/page.tsx`, next to the PostHog line:
"On the coach website we also record how pages are used (clicks, scrolling, page changes) so we can find and fix problems; everything typed, client details and photos are hidden in these recordings, and recordings are deleted after 30 days. The client app is not recorded."
Text-only; PO approves the wording before merge.

## How the PO finds sessions

In PostHog → Replay, saved filters (set up via API with the rest of the dashboards):
- **Coach friction:** sessions with `$rageclick` or `$dead_click`, internal accounts excluded.
- **Coach errors:** sessions with `error_shown` or `$exception`; the event list shows the code and where.
- **Gave up:** sessions with `task_abandoned`, filterable by `task` (e.g. `assign_program`).
Each recording's side panel lists clicks by label (e.g. `assign_save`) and errors by code, so the PO can jump to the moment.

## Staging verification (before Luis)

1. Flag `coach-session-replay` on for internal test coach accounts only.
2. A test coach with fixture client "Zebracanary Testperson" runs invite, assign, build program and the workout editor, and triggers one known error.
3. Claude and the PO watch the recording together: no names, emails, typed values or photos visible; buttons, labels, headings and error messages readable; the error and its code visible.
4. Only after the PO says OK: add Luis to the flag.

## Testing

- Unit: the recording config (inputs masked, `maskTextSelector: '*'`, `maskTextFn` shows text only under `data-ph-safe`, images blocked, network/console off); gate starts only inside `(coach)` and when the env switch is on; `sanitize` drops bad labels and unknown codes; `beforeSend` passes `$snapshot`, still drops browser `$exception`; server-error builder outputs only the allowed fields (a payload with message/stack/body comes out without them); senders are no-ops without a key and never throw.
- Lint: `role="alert"` outside `ErrorText` fails; `code` is required by type.
- e2e (Playwright, `apps/web/e2e`): each labelled control on the four coach tasks is present with its exact label; triggering an invalid invite shows `[role=alert][data-error-code="invite_email_invalid"]`; every `[role=alert]` seen during the run has a code from the list. Masking canary: with PostHog requests intercepted, the recorded payload does not contain "Zebracanary".
- Phone: unit test that the logging buttons carry their `ph-label`s and that phone `ErrorText` sends its code.

## Rollout

1. PR 1: error codes + `ErrorText` + lint, web and phone.
2. PR 2: button labels, web and phone (phone needs an app rebuild).
3. PR 3: server error reporting (actions + Edge Functions).
4. PR 4: recordings gate + masking + privacy sentence; flag created off; staging verification; then Luis.

## Decisions for the PO to confirm

- Network and console recording stay **off** (safer; we lose request timings in the player).
- Server errors carry **no stack trace** (only type, code and where); developers find the line from `where`.
- Recordings kept the free plan's 30 days; PostHog stops at the free limit rather than charging.
- Kill switch is the PostHog flag (instant, no deploy); the env switch is a second, deploy-time off.
