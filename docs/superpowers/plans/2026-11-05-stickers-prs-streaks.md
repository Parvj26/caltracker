# Stickers, PRs, Streaks and Strength Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every finished workout the client gets the following, and the coach sees streaks and PRs:
- a sticker reveal
- PRs
- streak and landmark-journey progress
- a zoo-book album to collect into
- strength charts

**Architecture:**
- **Rules:** every rule is a pure function in `packages/shared`. Calling one of them with an injected random source
  makes the rolls deterministic for tests.
- **Server awards:** an idempotent Edge Function `award-workout` is the only writer of awards. It imports the shared rules
  and uses a CSPRNG. A `pg_cron` + `pg_net` catch-up job awards logs that the phone never reported.
- **Phone:**
  - Shows the ladder animal straight away, computed on the device.
  - Merges the server's result when it arrives.
  - Queues a "Surprise!" reveal for awards that came in while it was offline.

**Tech Stack:** TypeScript strict, Vitest, Deno tests, Postgres/pgTAP, pg_cron + pg_net, Expo SDK 58 (Reanimated for the
reveal), Next.js 16, Maestro, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-stickers-prs-streaks-design.md`. Lists and weights come from
`docs/design/collection.md`, and facts from `docs/design/animal-facts.md`.

**Branch:**
- `feature/stickers` from `feature/phase-3a-logging`. Rebase it onto main after 3a merges.
- Task 1 (Vitest) and Task 2 (art script, no DB) can run in parallel with other worktrees.
- Tasks 3–8 need the shared local DB and simulator.

## Global Constraints
- **Where the rules live:** badge, volume, PR, streak and unit logic exists only in `packages/shared`, per CLAUDE.md. The
  Edge Function and the apps import it and never re-implement it.
- **Ladder animal:** the heaviest ladder animal whose weight in kg is at most `logVolumeKg(log)`. The volume excludes
  nothing: warm-ups and drops count.
- **Multiple wording:**
  - one decimal under 10: "≈ 1.4 Giraffes";
  - whole numbers from 10: "≈ 12 Elephants";
  - exactly 1.0–1.04: "≈ 1 Giraffe".
- **Qualifying workout:** completed, with at least 5 completed sets.
- **Rolls:**
  - Shiny is 1 in 20. It applies only to a qualifying workout that earns its ladder animal, and only if that animal is not
    already shiny.
  - A drop is 1 in 100 per qualifying workout, picked uniformly from the drops the client doesn't own.
- **Personal bests:** per exercise, excluding warm-ups.
  - The kinds are `heaviest` (max weight), `reps_at_weight` (more reps than ever at a weight at or above that weight), and
    `e1rm` (Epley: `w × (1 + r/30)`, rounded to 0.1 kg).
  - The first log of an exercise is a baseline, not a PR.
- **Streak:** consecutive Monday–Sunday weeks in the client's time zone, each with at least one completed workout. The
  time zone is stored on the profile (`profiles.time_zone`, an IANA string, set by the phone).
- **`LANDMARK_JOURNEY`** (week → landmark key): 1 chichen-itza, 2 christ-the-redeemer, 3 petra, 4 colosseum, 6 taj-mahal,
  8 statue-of-liberty, 10 big-ben, 12 great-pyramid, 16 eiffel-tower, 20 empire-state, 24 burj-khalifa, 28 machu-picchu,
  32 golden-gate, 36 mount-fuji, 40 mount-everest, 46 marathon, 52 great-wall.
  - A broken streak restarts the journey.
  - Re-reaching a landmark adds ×N.
- **Rare finds:** exactly as in `collection.md` §2. Volume thresholds are in kg.
- **Milestones:** the 1st, 10th, 50th and 100th completed workout.
- **Reveal card order:** ladder, then drop, then rare find, then landmark, then milestone.
  - A workout with no weighted sets skips the ladder card.
  - With nothing new, the ladder card shows "Another {animal}! ×N" for about 1 s, and Continue is still available.
- **Awards:** every award table is written only by `award-workout`.
  - RLS: the client reads their own rows, and the workspace coach reads their clients' rows.
  - pgTAP covers cross-client, cross-workspace and anon access.
- **Corrections and reopen:** a coach correction, or a reopen followed by a re-finish, recomputes PRs and totals for
  that log. Stickers already granted are never removed or re-rolled.
- **Sharing:** "Save image" only, through `react-native-view-shot` and `expo-media-library`. Pin exact versions.
- **Design:** tokens only, with no space-5. Silhouettes are generated art variants, not CSS filters, on the phone. The
  shiny foil is an animated gradient overlay.

## Review Focus
1. **Two awards for one log.** The phone call and the cron catch-up racing must give exactly one award and one roll.
   Test: Task 4 (Deno: concurrent calls produce one `awards` row and the same response).
2. **A coach correction after the award.** The award is not re-rolled. A PR that the correction lowers is recomputed, and
   the client keeps the sticker. Test: Task 4.
3. **Streak across time zones and DST.** A Sunday 11:30 pm workout in LA counts for that week, and the DST change week is
   handled. Test: Task 1.
4. **Offline finish.** The reveal shows the ladder animal with no network, and the server's drop or rare find appears
   later as "Surprise!" on the next app open. Test: Task 6 (unit test on the pending-reveal queue; Maestro where
   feasible).
5. **A client with no weighted exercises (cardio only).** There's no ladder card and no crash. The streak and milestone
   still count. Test: Tasks 1 and 6.

---

### Task 1: Shared rules
**Files:**
- Create in `packages/shared/src/awards/`: `catalogue.ts`, `ladder.ts`, `prs.ts`, `streak.ts`, `rare.ts`, `rolls.ts`, and
  `award.ts` (the orchestrator).
- Create tests in `packages/shared/test/awards/*.test.ts`.
- Modify the index.

**Interfaces (produces):**
```ts
export type StickerKind = 'ladder' | 'rare' | 'drop' | 'landmark';
export type StickerDef = { key: string; kind: StickerKind; name: string; weightKg?: number; tier?: 'common' | 'exotic'; requirement?: RareRequirement; fact: string };
export const STICKERS: readonly StickerDef[]; // 30 ladder + 10 rare + 3 drop + 17 landmark, keys = art file names
export const LANDMARK_JOURNEY: ReadonlyArray<{ week: number; key: string }>;
export function ladderAnimal(volumeKg: number): { sticker: StickerDef; multiple: number } | null;
export function formatMultiple(multiple: number, name: string): string;
export function isQualifying(log: WorkoutLogDoc): boolean;
export type PrKind = 'heaviest' | 'reps_at_weight' | 'e1rm';
export type PersonalRecord = { exerciseId: string; kind: PrKind; valueKg: number; reps: number | null; logId: string; achievedAt: string };
export function detectPrs(log: WorkoutLogDoc, history: PersonalRecord[], firstLogOfExercise: ReadonlySet<string>): PersonalRecord[];
export function epley1rm(weightKg: number, reps: number): number;
export function weekKey(isoTimestamp: string, timeZone: string): IsoDate; // the Monday of that week, in that zone
export function streakWeeks(completedWeekKeys: readonly IsoDate[], currentWeek: IsoDate): { current: number; best: number };
export function journeyStep(streak: number): { reached: string[] /* landmark keys at exactly this streak */; next: { week: number; key: string } | null };
export type ClientStats = { workouts: number; streak: number; bestStreak: number; prCount: number; lifetimeVolumeKg: number; monthVolumeKg: number };
export function newRareFinds(before: ClientStats, after: ClientStats, owned: ReadonlySet<string>): StickerDef[];
export function milestoneFor(workoutCount: number): 1 | 10 | 50 | 100 | null;
export type Rng = () => number; // [0,1)
export type AwardInput = { log: WorkoutLogDoc; owned: Map<string, { count: number; shiny: boolean }>; prHistory: PersonalRecord[]; firstLogOfExercise: ReadonlySet<string>; statsBefore: ClientStats; statsAfter: ClientStats; rng: Rng };
export type AwardResult = { ladder: { key: string; multiple: number; isNew: boolean; count: number; shiny: boolean } | null; drop: string | null; rare: string[]; landmarks: string[]; milestone: number | null; prs: PersonalRecord[] };
export function computeAward(i: AwardInput): AwardResult;
export function revealCards(r: AwardResult): Array<{ type: 'ladder' | 'drop' | 'rare' | 'landmark' | 'milestone'; key?: string; value?: number }>;
```

- [ ] **Step 1: Write failing tests**, using the exact values from `collection.md`:
  - `ladderAnimal`:
    - `ladderAnimal(1470)` gives Giraffe (1,200 kg).
    - `ladderAnimal(1500)` gives Hippo.
    - `ladderAnimal(1.9)` gives null.
    - `ladderAnimal(150000)` gives Blue whale.
  - `formatMultiple`: `formatMultiple(1.225, 'Giraffe')` gives "≈ 1.2 Giraffes". Also test 1.02 and 12.4.
  - `isQualifying`: 4 sets is false and 5 is true.
  - `detectPrs`:
    - A warm-up is ignored.
    - The first log is a baseline and produces no PR.
    - 100 kg × 5, then 100 kg × 6, gives `reps_at_weight`.
    - 100×5 then 105×3 gives `heaviest`. It is not an e1rm PR, because 105×3 gives 115.5 and 100×5 gives 116.7.
  - `epley1rm(100, 5)` is 116.7.
  - `weekKey`:
    - `weekKey('2026-11-09T07:30:00Z', 'America/Los_Angeles')` is `'2026-11-02'`: it's Sunday 11:30 pm in LA.
    - The DST week of 2026-11-01 is handled.
  - `streakWeeks`:
    - Three consecutive weeks give `{current:3}`.
    - A gap resets `current` while `best` keeps the old maximum.
    - The current week with no workout yet doesn't break the streak until it ends.
  - `journeyStep`:
    - `journeyStep(4)` reaches `['colosseum']`, with next `{6,'taj-mahal'}`.
    - `journeyStep(5)` reaches `[]`.
    - `journeyStep(52)` reaches `['great-wall']`, with next null.
  - `newRareFinds`: Axolotl at 10 workouts, Quokka at a 4-week streak, Narwhal at 1,000,000 kg.
  - `milestoneFor`: 1, 10, 50 and 100 return themselves; 2 returns null.
  - `computeAward`, with an injected `rng`:
    - `rng = () => 0.01` gives shiny and a drop.
    - `rng = () => 0.99` gives neither.
    - An already shiny animal never rolls shiny.
    - A non-qualifying workout never rolls.
    - A cardio-only log gives `ladder: null`.
  - `revealCards`: the order is ladder, drop, rare, landmark, milestone.
  - `STICKERS`: there are 60 keys, matching `art/stickers/*.png` file names exactly. The test reads the directory.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/shared test -- awards`. Expected: FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** the shared tests and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): work out stickers, PRs, streaks and the landmark journey`

### Task 2: Sticker art assets
**Files:**
- Modify: `scripts/process-stickers.ts` and its unit test.
- Create: `apps/mobile/assets/stickers/{key}.webp`, `{key}-sm.webp` and `{key}-locked.webp` (60 × 3 files).
- Create: `apps/mobile/src/lib/sticker-assets.ts`, a static `require` map keyed by sticker key.
- Commit: `art/stickers/*.png`. It is currently locally excluded, so remove its line from `.git/info/exclude` and tell
  the controller.

**Interfaces:** produces `stickerImage(key, size: 'lg' | 'sm' | 'locked')` on the phone, plus public web copies under
`apps/web/public/stickers/` at the same sizes.
- **Sizes:**
  - `lg` is 512 px, trimmed, with transparent padding of 4%.
  - `sm` is 256 px.
  - `locked` is a 256 px solid silhouette in `#121212` at 12% alpha.
- [ ] **Step 1: Write failing unit tests:**
  - For a fixture PNG, the output exists at each size.
  - The `locked` variant has only one opaque colour.
  - The sticker map covers all 60 `STICKERS` keys.
- [ ] **Step 2: Run** `pnpm --filter @caltracker/scripts test`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run the script to generate the assets.
- [ ] **Step 4: Run** the tests and `pnpm check`. Expected: PASS. Check the bundle size added and report it; it should be
  under 6 MB.
- [ ] **Step 5: Commit** `feat: prepare the sticker art for the app and web`

### Task 3: Award tables
**Files:**
- Create: `supabase/migrations/<next>_awards.sql` and `supabase/tests/awards_rls.test.sql`.
- Modify: the generated database types.

**Interfaces:** produces these tables:
- `sticker_awards (client_id, workspace_id, sticker_key, count int, shiny bool, first_earned_at, last_earned_at, first_log_id, pk (client_id, sticker_key))`
- `awards (log_id pk, client_id, workspace_id, result jsonb, created_at)`
- `personal_records (id, client_id, workspace_id, exercise_id, kind, value_kg numeric, reps int, log_id, achieved_at, unique (client_id, exercise_id, kind))`, holding the current best per kind
- `client_stats (client_id pk, workspace_id, workouts, streak, best_streak, journey_week, pr_count, lifetime_volume_kg, updated_at)`
- `profiles.time_zone text`, default `'UTC'`

RLS on the new tables:
- Select is allowed for the client on their own rows, or for the workspace coach.
- There are no insert, update or delete grants to `authenticated`. Writes come only from the Edge Function, through the
  service role.

The workspace-delete cascade is extended to the new tables. Account deletion later relies on these tables cascading from
`auth.users`.

- [ ] **Step 1: Write failing pgTAP:**
  - The client reads their own rows and not another client's.
  - A coach reads their clients' rows and not another workspace's.
  - An authenticated user can't insert into any award table.
  - Anon gets nothing.
  - Deleting the user cascades.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm db:reset` (with the re-import), `pnpm db:test`, `pnpm db:types` and `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): store stickers, personal bests and streak stats`

### Task 4: `award-workout` Edge Function and the catch-up job
**Files:**
- Create: `supabase/functions/award-workout/{index.ts,index.test.ts}` and `supabase/migrations/<next>_award_catchup.sql`.

**Interfaces:**
- **Request:** `POST {logId}`, called with the caller's JWT. The function verifies that the caller owns the log, which
  must be completed. It can also be called with the function secret by the cron job.
- **Response:** `AwardResult`, the same JSON the first call returned.
- **Steps, in order:**
  1. Take an advisory lock on the log.
  2. If an `awards` row exists, return it.
  3. Otherwise load owned stickers, PR history, the first-log set, and the stats before and after, then run
     `computeAward` with a CSPRNG `rng` (crypto.getRandomValues).
  4. Upsert `sticker_awards`, `personal_records` and `client_stats`, and insert `awards`, all in one transaction through
     one SQL function, `apply_award(p_log_id, p_result jsonb)` (definer, service role only).
- **Recompute entry point** (`{logId, recompute: true}`, coach correction or re-finish): recomputes PRs and stats from the
  logs, and never touches `sticker_awards` or rolls.
  - Hook: `correct_workout_log` calls it. A correction makes `pg_net` POST to the function for that log, or the web
    action calls it after the correction succeeds. Pick the web-action call, since it is simpler and testable, and note
    the ruling.
- **Catch-up:** `pg_cron` runs every 15 minutes. For completed logs with no `awards` row that finished more than 2
  minutes ago, it calls the function through `pg_net` with the secret from Vault.
- [ ] **Step 1: Write failing Deno tests:**
  - An unauthorised caller gets 401.
  - Another client's log gets 403.
  - An `in_progress` log gets 409.
  - The same log called twice gives one award and an identical response.
  - Two concurrent calls give one `awards` row (Review Focus 1).
  - A recompute after a correction lowers a PR, and `sticker_awards` is unchanged (Review Focus 2).
  - An injected RNG makes rolls deterministic.
  - pgTAP: the catch-up job exists and `apply_award` is not callable by `authenticated`.
- [ ] **Step 2: Run** `pnpm functions:test` (export `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase status`)
  and `pnpm db:test`. Expected: FAIL. **Step 3: Implement.** **Step 4: Run** them both, plus `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: award stickers and personal bests on the server, exactly once per workout`

### Task 5: Phone reveal
**Files:**
- Create: `apps/mobile/src/app/(app)/log/[id]/reveal.tsx` and `apps/mobile/src/components/stickers/{reveal-card,sticker,foil}.tsx`.
- Create: `apps/mobile/src/lib/awards.ts` (calls `award-workout` after an applied completed save, plus the pending-reveal
  queue in AsyncStorage) and `apps/mobile/.maestro/sticker-reveal.yaml`.
- Modify: the finish flow, so that the sequence is Finish, then reveal, then summary. Modify `summary.tsx` to show the
  sticker row and PR pills.

**Interfaces:**
- **Consumes:** Task 1 (`ladderAnimal`, `revealCards`), Task 2 (`stickerImage`) and Task 4 (response shape).
- **Produces:**
  - `requestAward(logId): Promise<AwardResult | null>`
  - `pendingReveals(): Promise<AwardResult[]>`, shown as "Surprise!" on the next app open
  - the phone sets `profiles.time_zone` on sign-in when it differs
- **Reveal screen:**
  - A dark full-screen view: "You lifted {formatWeight}", "that's about", a sticker pop (scale and burst through
    Reanimated, plus `tapHaptic`), "{multiple}!", "NEW for your zoo book" or "×N", the fact, and Continue.
  - Further cards follow in order.
  - The ladder card is rendered at once from the local doc; the server's extra cards are appended when they arrive.
  - If the server response doesn't come within 4 s, Continue goes to the summary, and the extras are queued as
    pending.
- [ ] **Step 1: Write failing tests:**
  - Vitest:
    - The queue persists and dedupes by `logId`.
    - The reveal order merges the local ladder card with the server result.
    - A cardio-only log has no ladder card (Review Focus 5).
  - Maestro: finish a seeded 5-set workout of 3 × 8 at 60 kg. The volume is 1,440 kg, so assert "Giraffe" on the reveal.
    Then Continue, the summary shows the sticker row, and the zoo-book entry shows ×1.
- [ ] **Step 2: Run** the tests. Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check`, rebuild the Release simulator app, and run all Maestro flows. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): reveal the workout's sticker after finishing`

### Task 6: Zoo book album and Save image
**Files:**
- Create: `apps/mobile/src/app/(app)/(tabs)/zoo.tsx` and `apps/mobile/src/components/stickers/{journey,album-grid,sticker-sheet,share-card}.tsx`.
- Modify: the tabs layout, which gets a Zoo tab.

**Interfaces:**
- **Data:** the album reads `sticker_awards` and `client_stats`, cached for offline use.
- **Sections:**
  1. Journey: "🔥 {n}-week streak", the path dots, "next: {landmark}" and the collected row.
  2. Animals: "{owned} of 30 · Shiny {s} / 30", a grid by weight with silhouette, ×N and ✦ foil.
  3. Rare finds: "{n} of 10", with requirements on the locked ones.
  4. Surprise drops: "???" × 3.
- **Sticker sheet:** big art, name, fact, first earned date, ×N and shiny.
- **Save image** on the summary and the sheet renders `share-card` to the photo library, asking for permission once.
- [ ] **Step 1: Write failing tests:**
  - Vitest: the album section model built from awards and stats (counts, order, locked states).
  - Maestro: open Zoo and see the streak header and a ×1 sticker from the previous flow's seed. Tap it and see the fact.
- [ ] **Step 2: Run** the tests. Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check`, rebuild, and run all flows. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): add the zoo book album and save-image cards`

### Task 7: Coach side
**Files:**
- Modify: `apps/web/src/app/(coach)/clients/[clientId]/page.tsx`, which gets a "Streak & stickers" panel (streak 🔥, book
  count and the last 6 stickers) and a "Personal bests" table (exercise, best weight × reps, e1RM, date).
- Modify: `activity/page.tsx` and the log page, which get a "PR" chip when the log's `awards.result.prs` is non-empty.
- Modify: `apps/web/e2e/stickers.spec.ts`.

**Interfaces:** consumes Task 3's tables through RLS, and Task 2's web assets.
- [ ] **Step 1: Write failing Playwright tests.** Seed through the service role: an `awards` row with a PR, `client_stats`
  with a 3-week streak, and `sticker_awards`. Then assert:
  - the client page shows "3-week streak" and the PR row;
  - the activity row shows a "PR" chip;
  - a correction through the log page triggers a recompute (the stats update).
- [ ] **Step 2: Run** the tests. Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check && CI=1 pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): show clients' streaks, stickers and personal bests`

### Task 8: Strength charts
**Files:**
- Create: `packages/shared/src/awards/strength-series.ts` and its test.
- Create: `apps/web/src/components/charts/line-chart.tsx`, a small dependency-free SVG chart that the body scans phase
  will reuse.
- Create: `apps/mobile/src/components/charts/line-chart.tsx`, using `react-native-svg`, which is already in Expo.
- Modify: the client page (a Progress section with an exercise dropdown) and the mobile Progress screen. Create the
  Progress screen if it doesn't exist yet; it's a placeholder screen that body scans will extend.

**Interfaces:** `strengthSeries(logs: WorkoutLogDoc[], exerciseId: string): Array<{ date: IsoDate; e1rmKg: number; bestSet: { weightKg: number; reps: number } }>`
- Each point is per log. Warm-ups are excluded. The best set is the one with the highest e1RM.
- [ ] **Step 1: Write failing tests:**
  - Vitest: the series from 3 logs is correct and sorted by date, with warm-ups excluded.
  - Playwright: the client page's exercise dropdown shows a chart with 3 points for a seeded client.
  - Maestro: Progress shows the chart.
- [ ] **Step 2: Run** the tests. Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm check`, e2e and Maestro. Expected: PASS.
- [ ] **Step 5: Commit** `feat: chart each exercise's estimated max over time`
