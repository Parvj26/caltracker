# Client push notifications — design

Status: design and mockups approved by PO in chat 2026-11-09 (canvas: https://claude.ai/artifact/QfcJamEADw95Y4HwEqCxXM). Awaiting written-spec review.

## Goal

Clients get timely iPhone notifications about things their coach does (and a daily workout reminder), and can choose which ones they get. Main spec §9 lists notifications; this spec covers the **client** side. Coach notifications are out of scope (PO: later).

## Decisions (PO)

- Clients only for now.
- Every type has its own on/off switch; defaults below.
- Quiet hours on by default, 10:00 PM – 7:00 AM; anything in the window waits until the end of it.
- App-icon badge with the unread count (messages + comments).
- Lock screen shows **who and what, never the content** ("Luis sent you a message.").
- Permission is asked from a friendly card on Today ("Turn on notifications" / "Later"), never on first launch.
- Manage in Settings (gear on Today) → **Notifications ›** → full screen. Layout as in the approved canvas.

## Notification catalogue

| key | When | Default | Example text | Opens |
|---|---|---|---|---|
| `workout_assigned` | Coach assigns a program or a single workout to the client | on | "New workout assigned" / "Luis assigned you Strength Block." | Workouts tab |
| `workout_changed` | Coach edits a workout scheduled for **today** (Live Sync never changes today's copy, so it never sends this; dropped if the workout moves off today or is deleted first) | on | "Today's workout changed" / "Luis updated Upper A." | that workout |
| `daily_reminder` | At the client's reminder time (default 8:00 AM, their time zone), only if a workout is scheduled today and not yet done | on | "Today: Upper A" / "Your workout is ready. Tap to start." | Today |
| `coach_logged` | Coach finished logging a session for the client | on | "Luis logged your session" / "Your sticker is waiting." | the log summary / reveal |
| `still_training` | 20 min after the last set of an unfinished workout (already built, on-device) | on | existing | existing |
| `message` | New message from the coach | on | "Message from Luis" / "Luis sent you a message." | Coach tab chat |
| `workout_comment` | Coach comments on the client's workout | on | "Comment on your workout" / "Luis commented on Upper A." | that log |
| `meal_comment` | Coach comments on the client's meal | on | "Comment on your meal" / "Luis commented on your lunch." | that meal |
| `food_targets` | Coach sets or changes the client's food targets | on | "New food targets" / "Luis updated your daily targets." | Food tab |
| `community_coach_post` | Coach posts in the community | on | "Community" / "Luis posted in Luis Bueno Coaching." | that post |
| `community_activity` | Reactions/comments on the client's own post; grouped per post | on | "Sam and 4 others reacted to your post." | that post |

Text never includes message, comment or meal content, body data or weights. Names: the coach's first name ("Your coach" when unknown); for community grouping, the first reactor's first name.

## Architecture

```
coach action ──(DB trigger)──▶ push_outbox row ──(pg_cron, every minute)──▶ send-push Edge Function ──▶ APNs ──▶ iPhone
daily reminder ──(pg_cron, every 15 min)──▶ push_outbox rows ─┘
```

1. **Devices.** `push_devices(user_id, token, platform 'ios', app_version, updated_at)`. The phone registers its APNs device token after permission is granted (expo-notifications `getDevicePushTokenAsync`) and on each app start; removes it on sign-out. RLS: a user sees and writes only their own rows.
2. **Preferences.** `notification_prefs(user_id pk, disabled text[] of type keys, reminder_time time default '08:00', quiet_enabled bool default true, quiet_start time default '22:00', quiet_end time default '07:00')`. No row = all defaults. Time zone: `profiles.time_zone` (kept current by the phone), else the coach's zone, else UTC. RLS: own row only.
3. **Outbox.** `push_outbox(id, user_id, type, group_key, title, body, data jsonb (deep-link route), not_before timestamptz, created_at, sent_at, attempts, last_error)`. Written only by `security definer` trigger functions and the cron job; never readable by clients. Triggers on: program/workout assignment, today's scheduled workout change, coach-finished log, messages from the coach, workout-log comments by the coach, meal comments by the coach, nutrition target changes, coach community posts, reactions/comments on a client's post. Each trigger fires only when the actor is the coach (or another member, for community activity) and the recipient is a different user.
4. **Sender.** Edge Function `send-push` (called by pg_cron every minute with a shared secret, like the award catch-up job): picks due rows (`sent_at is null and not_before <= now()`), drops types the user disabled, moves rows inside quiet hours to the quiet end (in the user's time zone), collapses rows with the same `group_key` into one notification ("Sam and 4 others…"), computes the badge (unread messages + unread comments), sends to every device of the user via **APNs HTTP/2 with token auth** (ES256 JWT from an Apple Push key), marks sent, tries each notification at most 5 times in total (retries after 1, 5, 15 and 60 minutes), deletes device rows APNs reports as invalid (410 / BadDeviceToken).
5. **Daily reminder.** pg_cron every 15 minutes inserts a `daily_reminder` row for each client whose local time just passed their reminder time today, who has a workout scheduled today not yet completed, and who has no reminder row for today yet.
6. **Phone.** Today card (permission); Settings → Notifications screen (switches, reminder time, quiet hours, "off on this iPhone" banner with Open iPhone Settings); tap → deep link via `data.route`; badge cleared when the relevant screens are read; sign-out unregisters the device.

### Why direct APNs instead of Expo's push service
Main spec says "Expo push". We build locally (not EAS), so Expo push would need an Expo account and uploading the push key there. Sending straight to Apple with the same kind of key we already manage avoids another account and service, keeps sending in Supabase (portable hosting rule), and Android can be added later via FCM. **Ruling, PO to confirm in spec review.**

## Shared logic (packages/shared, pure + unit-tested)
- `notificationCatalogue`: keys, defaults, text builders (no content).
- `isEnabled(prefs, type)`.
- `nextAllowedTime(nowUtc, prefs)`: quiet-hours deferral incl. windows crossing midnight and DST.
- `reminderDue(nowUtc, prefs, lastReminderDate)`: local-time check.
- `groupOutbox(rows)`: collapse by `group_key`, build grouped text.
- `routeFor(type, ids)`: deep-link routes.

## Setup the PO does once
Apple Developer → Certificates, Identifiers & Profiles → **Keys → +** → tick **Apple Push Notifications service (APNs)** → download the `.p8` (once) → tell Claude where it is and the Key ID. Stored as Supabase secrets (`APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID=88L5M6CC34`, `APNS_TOPIC=app.caltracker.client`, `APNS_ENV=sandbox|production` — TestFlight uses production). The app gets the Push Notifications capability (entitlement) in the next build.

## Testing
- Unit: every shared function above (quiet hours across midnight/DST, reminder timing in several zones, grouping, disabled types).
- pgTAP: RLS on `push_devices` and `notification_prefs` (own rows only; cross-client and cross-workspace fail); clients cannot read `push_outbox`; each trigger writes the right row only for the right actor/recipient.
- Edge Function tests: APNs request shape, JWT, invalid-token cleanup, retries, quiet-hour deferral (APNs mocked).
- Maestro: Today card → permission flow; Settings → Notifications toggles persist.
- Manual: real push to the PO's phone via TestFlight for each type.

## Out of scope
Coach notifications (email/push), Android, rich notifications with images, per-conversation mute.
