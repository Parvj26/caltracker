# Client home screen: design

**Status:** approved in conversation on 2026-11-05 (layout A, "Workout first").

**Depends on:**
- Phase 3a logging
- stickers, PRs and streaks (`2026-11-05-stickers-prs-streaks-design.md`)
- messages (`2026-11-05-messages-design.md`), for the Coach tab
- coach profile, for the coach's photo and name

## Purpose

Today the client's Today tab only shows a workout card. The home screen should do two things: get the client training
in one tap, and give them a reason to open the app on rest days. Success looks like this:
- On a training day, Start is the first thing they see.
- On a rest day, the streak and zoo book pull them back.
- The coach's latest word is always visible.

## Layout (top to bottom)

1. **Greeting:** "Hey {first name} 👋" with the weekday.
2. **Today's workout card** (lime). It shows the workout name, the exercise count and an estimated duration.
   - **Start workout**, or "Resume {name}" while one is in progress, or "Done ✓ · 52 min" with View.
   - **Two workouts today:** two cards.
   - **No workout today:** the card is replaced by a small "Rest day" card showing the next planned workout ("Next: Upper B
     on Saturday"). On a rest day, the streak card moves above it.
   - **Log a workout:** a quiet link under the card that starts an unplanned workout.
3. **This week strip:** Mon to Sun in the client's time zone, with ✓ on days that have a completed workout and today
   outlined. A planned day that has passed without a workout shows a soft dot. It never says "missed".
4. **Streak card** (ink): "🔥 {n}-week streak", plus the journey path with the next landmark ("next: Colosseum").
   - If this week has no workout yet, the line reads "Train this week to keep your streak".
   - A streak of 0 reads "Train this week to start your journey".
   - Tapping the card opens the zoo book at the journey.
5. **Zoo book card** (pink): the latest sticker art, "Zoo book · 12 of 30" and "Latest: Hippo ×2". Tapping it opens
   the zoo book.
6. **Latest PR:** "PR · Bench press 155 lb × 6 · Tue". Shown only when there's a PR from the last 14 days.
7. **Coach card:** the coach's thumbnail with their latest workout comment ("on Upper B: 'Great depth today!'"), or, when
   that is newer, their latest chat message.
   - Tapping a comment opens that workout's summary. Tapping a chat message opens the Coach tab.
   - Hidden when there's neither.

**First-time state.** Before the first assigned workout, the existing "Meet your coach" welcome card stays (from the
Part B spec), now with the coach's photo and bio. The streak and zoo-book cards then show their empty versions, with a
locked sticker teaser.

## Tabs

The bottom bar shows **Today**, **Workouts**, **Zoo** and **Coach**:
- **Zoo** is the album from the stickers design.
- **Coach** is the messages design. It shows the unread count.

Each tab is built in its own phase. The home screen must not show a card whose feature hasn't shipped yet.

## Data

- **Cache:** everything comes from what the app already loads (today's detail and logs, `client_stats`,
  `sticker_awards`, `personal_records`, comments, messages). The summary is cached in AsyncStorage so the screen draws
  offline, then refreshes in the background.
- **Pure logic** lives in `packages/shared`, each with unit tests:
  - the week strip states;
  - which coach item is newest;
  - the rest-day "next workout";
  - the PR recency window.

## Testing

- **Vitest:**
  - week strip states, including a time-zone edge;
  - rest-day next workout;
  - choosing the comment or the message;
  - the 14-day PR window.
- **Maestro:**
  - On a training day, the home screen shows Start first, and Start opens logging.
  - After finishing, the card shows Done ✓, the strip shows today ✓ and the zoo card shows the new sticker.
  - On a rest day, the streak card is above the rest-day card.
  - A coach comment appears on the coach card.

## Out of scope

- Charts on the home screen. Body and strength charts come with body scans.
- Community posts.
