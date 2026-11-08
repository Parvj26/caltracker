# Usage analytics (UX + activity) — design

Status: approved in chat by PO 2026-11-07, awaiting written-spec review.

## Goal

Let the PO see **what is working and what is not** in CalTracker, and **how active** each coach and client is. The main question is UX friction: how many taps and how much time each job takes, where people give up, and where they get frustrated.

Not in scope: session recordings, reading any content people enter, billing analytics, an in-app analytics screen.

## Decisions (PO)

- Tool: **PostHog Cloud (US), free tier**. The PO creates the account; the project API key is a public write-only key and goes into env/secrets.
- People are identified **by name**: PostHog person = Supabase user id, with `name`, `email`, `role` (coach | client), `workspace_id`, `workspace_name`.
- Taps/clicks are captured, **with all on-screen text masked**.
- Staging first. Production gets its own PostHog project when production exists.

## Architecture

```
packages/shared/src/analytics/
  events.ts      typed catalogue: event names, task names, allowed property keys per event
  sanitize.ts    drops any property not on the allow-list (the privacy guard)
  task.ts        task tracker: start/complete/abandon, counts taps, backs, errors, screens, ms
apps/web    -> posthog-js       (provider in root layout; identify after auth; reset on sign-out)
apps/mobile -> posthog-react-native (provider in root layout; expo-router screen tracking; same identify/reset)
```

- One `track(event, props)` entry point per app wraps PostHog and always runs `sanitize`. App code never calls PostHog directly (lint rule: no import of `posthog-*` outside the analytics module).
- No key set (tests, CI, local) → analytics is a no-op.
- Internal accounts (`parvjain2503+*@gmail.com`, PO, VK) get person property `internal=true`; all PostHog insights filter it out.

## What is captured

### 1. Screens and taps
- Web: `$pageview` per route (route pattern, e.g. `/clients/[id]`, never the raw id list in titles). Autocapture clicks **on**, with `mask_all_text: true` and `mask_all_element_attributes: true`. Heatmaps on. Native `$rageclick` and `$dead_click` on.
- Phone: screen event per expo-router route. Touch autocapture on, text masked. Important buttons get a stable `ph-label` (e.g. `start_workout`, `add_meal`) so reports read cleanly.
- Session recording: **off** on both.

### 2. Tasks (the core UX measure)
Each task emits `task_started`, then `task_completed` or `task_abandoned`, with:
`task`, `taps`, `duration_ms`, `screens` (count), `back_count`, `error_count`, `last_screen` (abandon only), `variant` (e.g. meal `photo|macros`).

Abandon = user leaves the task's screens without finishing, or the app is backgrounded/closed for > 10 min mid-task.

Client (phone):
| task | start | complete |
|---|---|---|
| join_from_invite | invite link opened | first Today screen shown |
| find_todays_workout | app foregrounded | a workout screen opened |
| log_workout | workout started | workout finished (+ `sets_logged`, `taps_per_set`) |
| log_meal | add meal opened | meal saved |
| message_coach | compose focused | message sent |
| community_post | new post opened | post published |
| view_progress | Progress tab opened | Zoo or a chart viewed |

Coach (web):
| task | start | complete |
|---|---|---|
| coach_first_setup | first sign-in | first client invited |
| invite_client | invite window opened | invite sent |
| build_program | new program | saved with ≥ 1 workout |
| assign_program | assign opened | assignment saved |
| review_workout | finished workout opened | marked reviewed / commented |
| reply_message | thread opened | reply sent |
| set_food_targets | targets opened | targets saved |
| edit_past_workout | past day opened on calendar | change saved |

### 3. Frustration signals (anywhere)
- `rage_tap` (phone; same element ≥ 3 taps within 1 s). Web uses `$rageclick`.
- `dead_click` web only (PostHog built-in).
- `error_shown`: `code`, `screen` (e.g. `otp_expired`, `save_failed`, form validation key). Never the error text if it could contain user input.
- `quick_undo`: delete/edit of an item within 30 s of creating it (`item_type`).
- `slow_screen`: screen load > 2 s (`screen`, `ms`).
- `exercise_search_no_results`: `query` (allowed — exercise names are not personal; capped at 60 chars).

### 4. Activity
- `app_opened` (phone), session length (PostHog sessions), active days/week.
- `notification_opened` (`kind`).
- Time-to-value: `invite_sent` → `first_workout_logged` (person property timestamps).
- Device model, OS, screen size, app version: PostHog defaults.

### Privacy allow-list
Allowed property keys only: `task, taps, duration_ms, screens, back_count, error_count, last_screen, variant, sets_logged, taps_per_set, screen, code, item_type, ms, query (exercise search only), kind, role`. Everything else is dropped by `sanitize` before sending. Never sent: weights, reps values, body data, food values, photos, message/post/note text, client names (except the signed-in user's own identity).

## PostHog setup (dashboards)
1. **Tasks**: per task — completion %, median taps, median time, median backs/errors, top abandon screens.
2. **Friction**: rage taps, dead clicks, errors, slow screens, no-result searches — by screen.
3. **Activity**: weekly active coaches/clients, active days, "gone quiet" cohort (no event in 7 days).
4. **Join-up funnel**: invited → joined → first workout logged.
5. Heatmaps for key web pages.
I set these up via the PostHog API once the PO shares a personal API key (Keychain, never pasted in chat).

## Error handling
Analytics must never break the app: all calls are fire-and-forget inside try/catch; PostHog SDK queues offline and flushes later. A failure to load PostHog = silent no-op.

## Testing
- Unit: `sanitize` drops unknown keys and non-exercise `query`; task tracker counts taps/backs/errors, completes, abandons on leave and on 10-min background.
- Unit: `track` is a no-op without a key.
- Lint: no `posthog-*` imports outside analytics modules.
- Manual on staging: run each task once on phone + web, confirm events and no text in captured elements.

## Rollout
1. PO creates PostHog account + project "CalTracker staging"; shares project key (public) → GitHub secret + EAS env.
2. PR 1: shared analytics module + web.
3. PR 2: phone (needs app rebuild).
4. Dashboards via API.

## Open item for PO
There is **no privacy policy page yet**. One is needed before App Store/TestFlight anyway; it should say app usage is tracked to improve the app. Proposed as a separate small PR (text-only page, mockup shown first).
