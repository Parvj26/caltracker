# CalTracker mobile (Expo)

Client app (iPhone and iPad). Clients are invited by their coach, sign up with the invited email,
and are linked to the coach's workspace automatically (`claim_invites()`).

Expo SDK 58, expo-router. Source is in `src/app` (screens) and `src/lib` (Supabase, claiming, session).
Session storage: AES key in expo-secure-store, encrypted session in AsyncStorage (see `src/lib/secure-storage.ts`).
Deep link: `caltracker://auth/confirmed` (email confirmation).

## Setup

```bash
pnpm install
pnpm db:start                        # local Supabase (repo root)
pnpm --filter mobile env:local       # writes apps/mobile/.env.local (simulator: 127.0.0.1)
```

## Tabs

The app has two tabs in this phase. **Today** shows the workouts assigned for today plus a week calendar;
**Workouts** lists the client's workouts, and tapping one opens a read-only detail. There is no Start button yet.

## Install a dev build on your iPhone

We use dev builds on the iPhone, not Expo Go, because Expo Go cannot open `caltracker://` links (invite
and email confirmation). Short version (full steps in "Install on your own iPhone against staging" below):

```bash
pnpm --filter mobile env:staging     # staging URL + anon key only; it refuses a service_role key
pnpm --filter mobile exec expo prebuild
# Xcode: open apps/mobile/ios/CalTracker.xcworkspace, set Signing & Capabilities -> Team to your Apple ID
pnpm --filter mobile exec expo run:ios --configuration Release --device <udid>
```

A free Apple ID install lasts 7 days; run the last command again to renew it.

## Try it on a real phone (Expo Go, quick look only)

The phone cannot reach `127.0.0.1` on your Mac. Use the Mac's wifi IP (System Settings > Network),
on the same wifi as the phone:

```bash
pnpm --filter mobile env:local 192.168.1.20   # your Mac's LAN IP
pnpm --filter mobile start                    # scan the QR code with Expo Go
```

Local Supabase listens on all interfaces by default, so no further change is needed. Invite an email
from the coach dashboard, sign up with it in the app, then confirm the email: local mail arrives in
Mailpit (http://127.0.0.1:54324), and its link opens `caltracker://auth/confirmed` only on a device
where the app is installed. In Expo Go, either use the link `exp://<ip>:8081/--/auth/confirmed...` or
simply confirm with `pnpm --filter mobile e2e:confirm <email>`, then sign in.

## Install on your own iPhone against staging (free Apple ID)

Expo Go cannot open the app's `caltracker://` confirmation link, so for real sign-ups against
staging install the app itself from Xcode. A free Apple ID is enough; the install works for 7 days,
then repeat the last step.

1. Xcode -> Settings -> Accounts -> **+** -> sign in with your Apple ID.
2. Plug the iPhone into the Mac, unlock it and tap **Trust**. On the iPhone: Settings -> Privacy &
   Security -> **Developer Mode** -> on (the phone restarts).
3. Point the app at staging (asks for the staging **anon** key; never use the service_role key):
   ```bash
   pnpm --filter mobile env:staging
   ```
4. Build and install a Release build (JS embedded, no Mac needed afterwards):
   ```bash
   pnpm --filter mobile exec expo run:ios --configuration Release --device
   ```
   Pick the iPhone from the list. If Xcode reports a signing error, open
   `apps/mobile/ios/CalTracker.xcworkspace`, select the CalTracker target -> Signing & Capabilities ->
   Team = your Apple ID ("Personal Team"), then run the command again.
5. First launch only: iPhone Settings -> General -> VPN & Device Management -> your Apple ID -> **Trust**.
6. Test: invite your own address (e.g. `you+client@gmail.com`) from https://staging.caltracker.app,
   sign up with it in the app, open the confirmation email **on the iPhone** (the link opens the app).

Switch back to local with `pnpm --filter mobile env:local` and rebuild.

## Maestro end-to-end tests (iOS simulator, local only, not in CI)

Needs Xcode with an iOS simulator, Maestro 2.x and Java 17 (`brew install openjdk@17`).

```bash
pnpm db:start
pnpm --filter mobile env:local
# Build and install a Release build (JS is embedded; no Metro needed). First build takes minutes.
xcrun simctl boot "iPhone 18 Pro"
pnpm --filter mobile exec expo run:ios --configuration Release --device "iPhone 18 Pro"
# Run the flows
pnpm --filter mobile e2e
```

`ios/` and `android/` are generated and git-ignored. Rebuild after changing `.env.local` or native config.
Flows create and delete their own test users (`e2e-client@x.com`, `nobody@x.com`) through
service-role helpers in `scripts/e2e-helper.ts`, which read keys from `supabase status`:

```bash
pnpm --filter mobile e2e:invite  <email> <name>   # invite to Demo Coaching
pnpm --filter mobile e2e:confirm <email>          # mark email confirmed
pnpm --filter mobile e2e:cleanup <email>          # delete user and invites
```

`calendar.yaml` signs in as the seed client (`client@demo.local`) and needs the built-in exercises
(`pnpm import:exercises`, for Barbell Squat). It assigns an "E2E Program" through the seed coach and deletes every
"E2E " workout, program and assignment at the end (`assign` and `cleanup-workouts` helper actions).
It checks the Today and Workouts tabs and the calendar. Run just this flow with
`pnpm --filter mobile exec maestro test .maestro/calendar.yaml`.

`pnpm check` (typecheck, lint, test) needs neither Supabase nor a simulator.

## Workout logging flows

Clients start today's workout, tick sets (a rest timer runs between sets), and finish to see a summary. Closing the app mid-workout offers Resume on reopen. A workout left open is finished automatically by a `pg_cron` job in the database.

New Maestro flows in `.maestro/`:
- `log-workout.yaml`: start, tick sets, finish and see the summary.
- `log-resume.yaml`: leave mid-workout, reopen and resume.
- `log-unplanned.yaml`: log a workout that was not on the calendar.

They need the built-in exercises (`pnpm import:exercises`) and run with the rest through `bash scripts/run-e2e.sh`.
