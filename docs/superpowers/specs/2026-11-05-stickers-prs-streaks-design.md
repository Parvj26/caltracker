# Stickers, PRs and streaks (Phase 4): design

**Status:** approved in conversation on 2026-11-05.

**Sources of truth:**
- Main spec `docs/superpowers/specs/2026-11-03-coaching-app-design.md` §6.
- The collection list and rules in `docs/design/collection.md`, which hold the animals, weights, rare-find requirements,
  drops and shiny rules.
- The facts in `docs/design/animal-facts.md`.
- The art in `art/stickers/`: 60 PNGs, processed by `scripts/process-stickers.ts`.

This document records the decisions made on 2026-11-05 and how the parts fit together. Where it is silent, the main
spec and `collection.md` apply.

## Purpose

This is the part of CalTracker that Everfit doesn't have: every finished workout pays off with something to look
forward to. Success means:
- a client finishes a workout and gets a moment of delight: a sticker, a PR or a streak;
- the client opens the zoo book between workouts to see what's next;
- a client is motivated to train every week.

## Decisions (product owner)

- **Landmark stickers are a streak journey.** Each consecutive week (Monday to Sunday, client's time zone) with at least
  one completed workout moves the client to the next landmark, smallest to largest.
  - Missing a week restarts the journey at the first step. Landmarks already collected stay in the book; walking the
    journey again only re-earns them, adding ×N.
  - The 17 steps take about a year. Each landmark is reached at the streak week shown below.

    | Week | Landmark |
    |---:|---|
    | 1 | Chichén Itzá |
    | 2 | Christ the Redeemer |
    | 3 | Petra |
    | 4 | Colosseum |
    | 6 | Taj Mahal |
    | 8 | Statue of Liberty |
    | 10 | Big Ben |
    | 12 | Great Pyramid |
    | 16 | Eiffel Tower |
    | 20 | Empire State |
    | 24 | Burj Khalifa |
    | 28 | Machu Picchu |
    | 32 | Golden Gate |
    | 36 | Mount Fuji |
    | 40 | Mount Everest |
    | 46 | Marathon |
    | 52 | Great Wall |

  - These numbers live as data in `packages/shared` (`LANDMARK_JOURNEY`).
  - The distance measures in `collection.md` §5 stay as the fun facts on each landmark ("Eiffel Tower · 330 m tall").
    They are not earning rules.
- **The reveal is a big moment.** After Finish, a full-screen dark reveal comes before the summary:
  - "You lifted 3,240 lb · that's about · [sticker pops in with a burst and a haptic] · 1 Hippo! · NEW for your zoo
    book", then a fun fact, then **Continue**.
  - A repeat says "Another hippo! ×4". A shiny says "✦ Shiny hippo!" with the foil effect.
  - A surprise drop, a new rare find, a new landmark or a milestone each add a further reveal card, shown in this
    order: ladder, drop, rare find, landmark, milestone.
  - A workout with no weighted sets (all bodyweight or cardio) skips the ladder card. It shows a streak or milestone
    card if there is one, and otherwise goes straight to the summary.
- **The zoo book is one scrolling album**:
  1. **Streak journey** at the top: the current week count 🔥 and a path of dots showing the next landmark ("next:
     Christ the Redeemer"), with the collected landmarks in a row.
  2. **Animals**: "12 of 30 · Shiny 2 / 30", in a grid ordered by weight. Locked animals show as silhouettes, owned ones
     carry a ×N badge, and shiny ones get ✦ and the foil effect.
  3. **Rare finds**: "1 of 10". Locked ones show their requirement ("12-week streak").
  4. **Surprise drops**: three "???" until found.

  Tapping a sticker opens a detail sheet with the big art, name, fact, first earned date, ×N and shiny state.
- **Sharing:** only **Save image** in this version. It renders a sticker card (sticker, "3,240 lb ≈ 1 Hippo", the
  workout name, the CalTracker logo) to the photo library. Share-to-community comes with the community feature.
- **Coach controls** (plain-badge style, per-client comparison toggle) are deferred until after go-live, unless the
  trainer asks for them.

## Rules (all pure functions in `packages/shared`, with unit tests)

These are the main spec §6 rules, restated here so the build has one place to read.

- **Volume:** the shared `logVolumeKg`, which counts only completed `weight_reps` sets, including warm-ups and drops.
- **Ladder animal:** new animals first (product owner decision, 2026-11-06; the full rule is in
  `docs/design/collection.md` §1). Of the animals the volume reaches, one the client hasn't got yet, at random seeded by
  the log id; once they have them all, the one they got longest ago. The multiple is that animal's ("≈ 1 Hippo",
  "1.4 Hippos", "≈ 1,500 Rabbits"), rounded to 1 decimal under 10 and to whole numbers above that.
- **Qualifying workout:** a completed log with at least 5 completed sets. Only qualifying workouts get drop and shiny
  rolls.
- **Shiny:** each time a qualifying workout earns its ladder animal, a 1-in-20 roll, provided that animal isn't already
  shiny.
- **Surprise drop:** a 1-in-100 roll per qualifying workout, drawn from the drops the client doesn't own yet.
- **Personal bests,** per exercise and excluding warm-ups:
  - heaviest weight;
  - most reps at a given weight;
  - best estimated 1RM, by Epley: weight × (1 + reps / 30).

  The first ever log of an exercise sets a baseline and isn't shown as a PR. A PR counts toward rare finds.
- **Streak:** consecutive Monday-to-Sunday weeks, in the client's time zone, each with at least one completed workout.
  The current week counts once it has a workout. A week that ended without one breaks the streak.
- **Milestones:** the 1st, 10th, 50th and 100th completed workout.
- **Totals:** monthly and lifetime volume, each mapped to a ladder animal ("This month: 3 elephants").
- **Rare finds:** the requirements in `collection.md` §2, checked after each award.

## Awarding (server is the source of truth)

- **Edge Function `award-workout`:**
  - Called with `{ logId }` by the phone after its completed log is applied (`applied: true`). It imports the rules
    from `@caltracker/shared`, as `accept-invite` already does.
  - It is idempotent per log: an `awards` row keyed by `log_id` records what was granted, and a second call returns
    the same result.
  - Random rolls use a server-side CSPRNG and happen only here, never on the device.
- **Catch-up:** logs completed by the hourly auto-finish job, or by a phone that never called the function, are awarded
  by a `pg_cron` job every 15 minutes. It calls `award-workout` through `pg_net` for completed logs with no `awards`
  row, using a function secret, never the service role from the app.
- **On the phone:**
  - The reveal shows the ladder animal straight away, computed on the device from the shared rules, so it works
    offline.
  - Rolls, rare finds and PRs show as soon as the award returns.
  - If the phone is offline, those appear as a "Surprise!" reveal the next time the app opens after the sync.
- **Corrections and reopen:**
  - A coach correction recomputes that log's PRs and totals. It does not take away a sticker that was already shown
    and does not re-roll. A workout keeps its ladder animal forever (only the multiple changes) and never gets a
    second one (product owner, 2026-11-07).
  - Reopening an auto-finished log and finishing it again re-runs the PR and total checks only.
- **Tables:**
  - `sticker_awards` (client, sticker key, count, shiny, first and last earned, `log_id` of the first)
  - `awards` (per-log record of what was granted)
  - `personal_records` (client, exercise, kind, value, `log_id`, achieved_at)
  - `client_stats` (streak, best streak, journey step, workout count, lifetime volume, PR count)

  All of them get RLS: the client reads their own, the coach reads their workspace's, and only the award function
  writes. Every policy gets pgTAP tests for cross-client and cross-workspace access.

## Art

- `scripts/process-stickers.ts` turns `art/stickers/*.png` into the app's assets: trimmed WebP at 512 px and 256 px, plus
  a silhouette variant.
- These go into the mobile bundle under `apps/mobile/assets/stickers/` (60 files), and into public storage for the web.
- `art/stickers/` gets committed with this phase. It is locally git-excluded today.

## Coach side

- **Client page:** the client's streak 🔥, zoo-book count, recent stickers and a **Personal bests** list (exercise,
  best weight × reps, estimated 1RM, date).
- **Activity feed and log page:** a "PR" chip on logs that set a personal best.

## Testing

- **Vitest (shared):**
  - ladder choice and multiples at boundaries;
  - the qualifying rule;
  - PR detection for weight, reps at weight and Epley 1RM, with warm-ups excluded and the first log as a baseline;
  - streak counting across a week boundary, in the client's time zone, with a missed week resetting;
  - the journey step for weeks 1–52 against `LANDMARK_JOURNEY`;
  - rare-find thresholds;
  - milestones;
  - deterministic roll functions given an injected random source.
- **Deno tests (`award-workout`):**
  - idempotency: the same log twice gives one award;
  - rolls use the injected RNG;
  - unauthorised callers are refused;
  - a non-completed log is refused.
- **pgTAP:** RLS on all new tables.
- **Maestro:**
  - finishing a seeded 5-set workout shows the reveal with the expected ladder animal, then the summary;
  - the zoo book shows it with ×1.
- **Playwright:** the client page shows the streak and personal bests.

## Out of scope (this phase)

- Share to community (comes with community).
- Plain-badge style and per-client comparison toggle.
- Strength and body charts (they come with body scans and progress).
- Push notifications for awards.
