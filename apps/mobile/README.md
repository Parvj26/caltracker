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

## Try it on a real phone (Expo Go)

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

`pnpm check` (typecheck, lint, test) needs neither Supabase nor a simulator.
