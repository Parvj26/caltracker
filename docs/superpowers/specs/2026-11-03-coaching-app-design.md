# CalTracker — Version 1 Design

**Date:** 2026-11-03
**Status:** Approved
**Product name:** CalTracker
**Domain:** caltracker.app

---

## 1. Purpose and context

### What we're building
A coaching platform where coaches build and assign workout programs, log in-person sessions, track client progress (including InBody body composition), message clients, and run a private community. Clients log workouts, earn badges, and share achievements with their coach's community.

### Why
- The launch coach (a personal trainer with ~50 active clients) currently pays a monthly subscription for Everfit and wants to leave mainly because of **price**.
- Version 1 must let him move all his clients off Everfit. After that, the product will be sold to other coaches as a cheaper alternative.

### Success criteria for Version 1
1. The launch coach runs his whole coaching business on the app and cancels Everfit.
2. A beta with 3–5 of his clients completes successfully before the full switch.
3. Running costs stay low enough to undercut Everfit's per-coach price with a healthy margin.
4. The system is multi-coach from day one, so selling to other coaches needs no re-architecture.

### Roles in building it
- **Product owner (the user):** talks to the coach, sets priorities, tests builds, owns all service accounts.
- **Developer (Claude):** designs and writes all code, tests, and infrastructure configuration.

---

## 2. Scope

### In Version 1
1. Accounts, coach workspaces, client invites
2. Exercise library (built-in + coach-customised + custom)
3. Workout builder (straight sets, supersets/circuits, warm-up and drop sets) and multi-week programs
4. Assigning programs/workouts to a client calendar
5. Client workout logging (phone), works offline
6. Coach logging for a client during in-person sessions (iPad), works offline
7. Coach review of completed workouts, with comments and corrections
8. Badges: weight comparisons, distance comparisons, collection ("your zoo"), monthly/lifetime totals, personal bests, streaks, milestones
9. Share badge cards to the community and save as image
10. Progress tracking: body measurements (InBody), attachments, charts
11. One-to-one coach–client messaging (text + images)
12. One private community per coach workspace (text + images + links)
13. Push notifications
14. In-app account deletion, privacy policy

### Explicitly not in Version 1
- Coach self-sign-up and subscription billing (launch coach's workspace is created manually)
- Assistant coaches / staff accounts (data model allows them)
- Video uploads of any kind (chat, community, exercise demos)
- Voice notes, group chats, broadcast messages
- AMRAP, EMOM, interval-timer blocks *(pending coach confirmation — see Open Questions)*
- %-of-max / RPE-based prescriptions, automatic progression
- Multiple community groups per coach (data model allows them)
- Scheduled posts, polls, @mentions, live video
- Progress photos
- Automatic InBody sync and InBody file import
- Importing Everfit history
- Meal plans / nutrition
- Habits, tasks, check-ins
- Coach-themed badge packs
- Session booking / appointment scheduling (planned for a later version)

---

## 3. Users and accounts

### Roles
| Role | Belongs to | Uses |
|---|---|---|
| Coach | Owns one workspace | Web dashboard (laptop), mobile app (iPad/phone) |
| Client | Exactly one workspace | Mobile app (phone) |
| Staff (future) | A workspace | Not built in V1; schema leaves room |

### Workspaces and isolation
- Every piece of business data (clients, programs, workouts, logs, measurements, messages, posts, comments, files) belongs to exactly one workspace.
- Isolation is enforced **in the database** with Postgres Row Level Security (RLS), not only in app code:
  - A coach can read/write only their own workspace's data.
  - A client can read/write only their own data, plus read/write their workspace's community.
  - Clients cannot see other clients' private data (logs, measurements, messages).
- Automated database tests attempt cross-workspace and cross-client access on every change and must fail to access.

### Sign-in
- Email + password
- Sign in with Apple and Sign in with Google (Apple sign-in is required by App Store rules when Google sign-in is offered)

### Client onboarding
1. Coach adds a client in the dashboard (name + email), individually or by CSV upload (name, email).
2. Client receives an email invite with app download links and an invite link.
3. Client signs up; the account is automatically linked to the coach's workspace via the invite.
- Invites expire after 14 days; the coach can resend.
- A client account that signs up without a valid invite is not linked to any workspace and sees a "Ask your coach for an invite" screen.

### Account deletion
- Clients can delete their account in-app (App Store requirement). This removes their personal data; the coach is notified.

---

## 4. Exercises, workouts and programs

### Exercise library
- **Built-in exercises:** imported from **free-exercise-db** (github.com/yuhonas/free-exercise-db, ~870 exercises, Unlicense/public domain). Fields: name, images, instructions, primary/secondary muscles, equipment, category. Shared across all workspaces, read-only.
  - The license file must be verified in the repository before import.
- **"Watch form on YouTube" button** on every exercise: opens a YouTube search for `"<exercise name> form"`. No stored links.
- **Workspace overrides:** a coach can attach to any built-in exercise, for their workspace only:
  - a pinned YouTube URL (replaces the search button for their clients)
  - coaching notes
- **Custom exercises:** coach creates exercises from scratch (name, tracking type, muscles, equipment, notes, optional YouTube URL).
- **Tracking type** per exercise: `weight_reps`, `reps`, `time`, `distance`. Determines logging inputs, badge maths, and PR types.

### Workouts
- A workout is an ordered list of **blocks**:
  - **Straight sets:** one exercise, N sets
  - **Superset / circuit:** 2+ exercises performed in sequence for N rounds
- Each prescribed set has:
  - **Set type:** `normal`, `warmup`, or `drop`
  - Target reps (single value or range), target weight, target time/distance as relevant
  - Rest time (seconds)
  - Note
- **Drop sets:** a `drop` set is attached to the preceding non-drop set. Drops have optional targets (or "to failure") and no rest timer between them.
- Coaches save workouts to a workspace **workout library** for reuse.

### Programs
- A program is a multi-week template: weeks × days, each day holding zero or more library workouts.
- Built in the dashboard on a weekly grid with drag-and-drop.

### Assignment
- Assigning a program to a client with a start date **copies** its workouts onto the client's calendar as client-owned workout instances. Later edits to the program template do not change existing assignments.
- The coach can drop a single workout onto any calendar day, and move, edit, or delete any day's workout on a client calendar.

---

## 5. Workout logging

### Client logging (phone)
- **Today screen:** today's assigned workout(s) with a Start button.
- **During a workout:**
  - Sets are pre-filled with targets.
  - Each set shows the client's previous result for that exercise ("Last time: 55 kg × 8").
  - Tap ✓ to complete a set; edit weight/reps before or after.
  - Rest timer starts automatically after a completed set; alert by sound/vibration.
  - Mid-workout actions: + Set, + Drop, swap exercise, add exercise, per-exercise note.
- **Finish:** summary (duration, total volume, PRs) → badge reveal.
- **Unplanned workout:** client can start an empty workout and add exercises.
- **Resume:** an in-progress workout survives app close and is resumed on reopen.

### Coach session logging (iPad)
- **Session mode:** coach selects a client → today's workout → the same logging flow with larger touch targets.
- One client at a time.
- Logged workouts are marked **"Logged by coach"** and count identically for history, charts, PRs and badges.
- Client receives a push notification after the coach finishes the session; the badge reveal shows on the client's next app open.

### Single active logger
- A workout instance can be in progress by only one person. When the coach starts it, the client sees "Your coach is logging this session" (read-only), and vice versa.
- Offline edge case: if both sides log the same workout while offline, on sync the first completion wins; the second is saved as a separate workout and the coach is shown both to resolve.

### Forgotten workouts (reminder + auto-finish)
- **Reminder:** each completed set (re)schedules an on-device local notification for **20 minutes** after that set: "Still training? 💪 Tap to finish your {workout name} workout." Logging another set pushes it back; finishing or discarding the workout cancels it. Scheduled locally, so it works offline.
- **Auto-finish:** a workout in progress with no activity for **3 hours** is finished automatically, with its end time set to the **last completed set** (so duration is accurate). History, PRs, totals and badges count normally. The badge reveal shows on next app open with the note "We finished {workout name} for you at {time}." The workout can be reopened to add missed sets.
- Applies equally to coach session logging on iPad (the reminder goes to the coach's device).
- Auto-finish runs on the device when the app next opens or resumes, and server-side (scheduled job) for workouts whose device never reopens, using the last synced set time.

### Offline behaviour
- All logging reads and writes go to an on-device SQLite database kept in sync with Supabase by **PowerSync**.
- A "Not synced yet" indicator is shown until pending changes upload.
- Badge calculation runs on the device from shared code, so the badge reveal works offline; the server recalculates on sync and is the source of truth for the collection and totals.

### Coach home (dashboard and iPad)
- **Today's clients:** clients with a workout assigned today, each with **Log session** (or View when done; "Client is logging" when in progress). No appointment times in V1.
- **Tiles:** Done this week (completed / assigned, with progress bar), New PRs this week, Workouts today, Missed 2+ workouts.
- **Needs attention:** clients with no completed workout in ≥ 5 days (Message), programs ending within 7 days (Assign), and clients with no body measurement in ≥ 30 days (Add scan).
- **Quick search (⌘K on web):** jump to any client.
- iPad supports portrait and landscape; layouts in the design system spec. Phone app is portrait-only.

### Coach review (dashboard)
- **Activity feed:** completed workouts across clients (client, workout, duration, PR count).
- **Workout detail:** planned vs. actual, side by side.
- **Comments** on a completed workout; the client is notified.
- **Corrections:** coach can edit a completed workout (e.g. fix a typo'd weight). Badges, PRs and totals recalculate.

---

## 6. Badges, collection and progress

### Volume and comparisons
- **Workout volume** = Σ (weight × reps) over all completed sets of `weight_reps` exercises, including warm-ups and drops. Bodyweight (`reps`) exercises are excluded in V1.
- **Weight comparison badge:** after each workout, select the heaviest item from our comparison list whose weight ≤ workout volume, and show the multiple ("4,200 kg ≈ 1 elephant").
- **Comparison list:** our own list of ~30 animals/objects spanning ~5 kg to ~100,000 kg, with our own illustrations. No Everfit artwork, wording, or list reused.
- **Distance comparison badge:** for `distance` exercises, compare total distance to landmarks (our own list).

### Collection ("your zoo")
- The first time a client's workout reaches a comparison item, that item is added to their collection.
- The collection screen shows collected items and locked items with the next target ("Next: rhino — 2,300 kg").

### Totals
- Monthly and lifetime volume totals, each mapped to a comparison item ("This month: 3 school buses").

### Other achievements
- **Personal bests** per exercise, excluding warm-ups: heaviest weight, most reps at a given weight, best estimated 1RM (Epley formula: weight × (1 + reps/30)).
- **Streaks:** consecutive calendar weeks (Mon–Sun, client's timezone) with ≥1 completed workout.
- **Milestones:** 1st, 10th, 50th, 100th completed workout.

### Units
- Each user chooses kg or lb. Values are stored in kg; display converts.

### Sharing
- **Share to community:** results screen creates a community post containing a badge card + workout summary; client can add caption and image.
- **Save image:** renders the same card as an image for sharing outside the app.

### Coach controls
- Workspace badge style: `animals` or `plain` (bronze/silver/gold milestones).
- Per-client toggle to disable comparison badges.

### Progress tracking
- **Body measurements:** weight, body fat %, skeletal muscle mass, lean body mass, BMI, visceral fat level, BMR, plus coach-defined custom metrics. Each entry has a date, who entered it, and optional attachments.
- **Entry:** coach enters InBody values in the dashboard (or app) and can attach the printout (image or PDF ≤ 5 MB). Clients can log their own body weight.
- **Charts:**
  - each body measurement over time
  - per-exercise strength: best set and estimated 1RM over time
  - weekly training volume
- Clients see their own charts; coaches see all their clients'.

---

## 7. Messaging and community

### Messaging
- One conversation per coach–client pair.
- Text and images (≤ 4 per message). YouTube links show a preview and play from YouTube.
- Push notifications, unread counts, "seen" state.
- Coach inbox on dashboard and in the app, sorted by most recent, with unread filter.
- Workout comments live on the workout, not in the chat.

### Community
- One community per workspace containing all its clients and the coach. Schema supports multiple groups for later.
- Posts: text, images (≤ 4), links, badge cards.
- Likes and comments on posts.
- **Coach:** pin posts, delete any post/comment, remove a member.
- **Client:** create posts, comment, like, delete own content.
- **Report and block** (App Store requirement for user-generated content). Reports go to the coach.
- **Privacy:** members see only another member's name and profile photo. Measurements, InBody data and workout details appear only if the client explicitly shares a card.
- **Notifications:** comments on my post, new coach posts; likes grouped ("Sam and 4 others liked your post").

---

## 8. Media and storage

- **No video uploads anywhere in V1.** Videos are referenced as YouTube links only.
- **Image processing on device before upload:**
  - resize to max 1600 px on the long edge
  - encode as WebP (JPEG fallback where WebP encoding is unavailable)
  - target ~200–400 KB per image
  - generate a ~30 KB thumbnail
- Feeds and chats load thumbnails; full image loads on tap.
- Images are cached on device after first load.
- Limits: 4 images per post/message; PDFs ≤ 5 MB (InBody attachments only).
- Storage in Supabase Storage, in workspace-scoped buckets/paths protected by storage policies matching RLS.
- **Estimate for the launch coach:** 50 clients × ~5 images/week × ~300 KB ≈ 4 GB/year. Confirm against current Supabase plan limits and pricing before launch.

---

## 9. Notifications

| Recipient | Event |
|---|---|
| Client | Daily workout reminder (client-chosen time, only on days with an assigned workout) |
| Client | New workout or program assigned |
| Client | Coach logged your session |
| Client | New message |
| Client | Comment on your workout or post |
| Client | New coach post in community |
| Client / Coach | Still training? — 20 min after last logged set of an unfinished workout (local, on-device) |
| Coach | Client completed a workout |
| Coach | New message |
| Coach | New community report |

- Delivered via Expo push notifications.
- Each type can be toggled per user.

---

## 10. Technical architecture

### Stack
| Piece | Technology |
|---|---|
| Mobile + iPad app | Expo (React Native), TypeScript, Expo Router |
| Coach dashboard | Next.js (React), TypeScript |
| Backend | Supabase: Postgres, Auth, Storage, Realtime, Edge Functions |
| Offline sync | PowerSync (on-device SQLite ↔ Supabase) |
| Shared logic | TypeScript package used by both apps |
| Validation | Zod schemas in the shared package |
| Error monitoring | Sentry |
| Web hosting | Vercel |
| Mobile builds/releases | Expo EAS Build, EAS Submit, EAS Update |

### Repository layout (monorepo, pnpm workspaces + Turborepo)
```
apps/
  mobile/        Expo app (client + coach modes)
  web/           Next.js coach dashboard
packages/
  shared/        types, Zod schemas, badge/volume/PR/streak calculations, units
supabase/
  migrations/    schema + RLS policies (SQL, version-controlled)
  seed/          free-exercise-db import, comparison lists
  tests/         pgTAP database and RLS tests
```

### Key boundaries
- **Shared package** contains pure functions with no I/O (volume, comparison selection, PR detection, streaks, unit conversion). Both apps and Edge Functions import it. It is the single source of truth for badge maths.
- **Database** owns authorization (RLS) and data integrity (constraints, foreign keys).
- **Edge Functions** handle server-side work: sending invites, push notification fan-out, authoritative badge/collection recalculation on sync, account deletion.
- **Mobile app** reads/writes logging data through PowerSync's local database; other features (community, messaging) use Supabase directly with Realtime subscriptions.

### Environments
- **Local:** Supabase CLI local stack, seed data only.
- **Staging:** separate Supabase project + Vercel preview + internal app builds. Used by the product owner for testing.
- **Production:** separate Supabase project, production Vercel deployment, store builds.
- Real client data is never copied into local or staging.

---

## 11. Quality and testing

- TypeScript `strict` mode everywhere; database types generated from the schema (`supabase gen types`).
- **Unit tests (Vitest):** all shared calculations — volume, comparison selection, collection unlocks, PRs (incl. warm-up exclusion and drop sets), streak boundaries and timezones, unit conversion.
- **Database tests (pgTAP):** RLS isolation — coach ↔ other workspace, client ↔ other client, client ↔ coach-only data, storage access.
- **End-to-end tests:** web with Playwright; mobile with Maestro. Critical flows:
  1. Coach invites client → client signs up → is linked
  2. Coach assigns program → client sees calendar
  3. Client logs workout offline → reconnects → coach sees it
  4. Coach session-logs on iPad → client gets notification and badge
- **CI (GitHub Actions):** typecheck, lint, unit tests, database tests on every change; deploy blocked on failure.
- Database changes only via versioned migrations.
- Daily automated database backups (Supabase paid plan).
- Sentry on web and mobile.

---

## 12. Error handling

- **Network loss during logging:** writes stay local; sync indicator shown; automatic retry.
- **Network loss elsewhere** (messaging, community): clear "You're offline" state; messages queue and send on reconnect; posts fail with a retry option.
- **Image upload failure:** retry with backoff; post/message shows a failed state with "Retry".
- **Concurrent logging:** see Section 5 single-active-logger rule and offline conflict rule.
- **Invalid input:** Zod validation on client and in Edge Functions; database constraints as final guard (e.g. non-negative weight, reps).
- **Auth/session expiry:** silent refresh; on failure, return to sign-in without losing unsynced logs.

---

## 13. Compliance and store requirements

- In-app account deletion (Apple).
- Report and block for user-generated content (Apple).
- Sign in with Apple alongside Google (Apple).
- Privacy policy and terms of service, covering body-composition data as health-related data. Applicable regulations depend on where the business and its clients are located (see Open Questions).

---

## 14. Accounts the product owner must create

Apple Developer Program, Google Play Console, Supabase, Vercel, Expo, GitHub, Sentry, PowerSync, domain name. All owned by the product owner.

---

## 15. Build order

1. **Foundation:** monorepo, CI, Supabase schema + RLS + tests, auth, workspaces, invites, exercise library import
2. **Programs:** workout builder (blocks, set types, drop sets), workout library, program builder, assignment, client calendar
3. **Logging:** client logging, coach session mode (iPad), PowerSync offline, single-active-logger, coach review/comments/corrections
4. **Badges and progress:** shared badge maths, comparisons, collection, totals, PRs, streaks, milestones, sharing cards, body measurements, charts
5. **Messaging and community**
6. **Polish and beta:** notifications, account deletion, privacy policy, store submission, beta with 3–5 clients, then full migration off Everfit

Each phase gets its own detailed implementation plan.

---

## 16. Open questions

| # | Question | Owner | Affects |
|---|---|---|---|
| 1 | How does the coach currently get InBody results into Everfit (typed, photo/PDF, exported file)? Which metrics does he use? | Product owner → coach | Section 6 progress tracking; whether file import moves into V1 |
| 2 | Does the coach use AMRAP or timed interval sections? | Product owner → coach | Section 4; whether these block types move into V1 |
| 3 | What does the coach pay Everfit per month, and on which plan? | Product owner → coach | Pricing for other coaches |
| 4 | Does Everfit allow exporting client/workout data? | Developer to research | Possible post-launch import tool |
| 5 | ~~Product name and domain~~ Resolved: CalTracker, caltracker.app | Product owner | Branding, app store listing |
| 6 | Badge illustrations: commission an illustrator, license an icon set, or start with simple icons? (Style is defined in the design system spec.) | Product owner | Section 6 visuals |
| 10 | Claiming invites by email only: before selling to other coaches, decide whether a client joins via the specific invite link, or chooses when several coaches invited them (prevents one coach intercepting another's new client). | Product owner | Section 3 onboarding |
| 7 | Which countries are the business and its clients in? | Product owner | Privacy policy, data regulations |
| 8 | Confirm current Supabase and PowerSync pricing and free-tier limits | Developer | Cost model |
| 9 | Verify free-exercise-db license file before import | Developer | Section 4 |
