#!/usr/bin/env bash
# Points the app at the hosted staging Supabase project (for installing on a real phone).
# Usage: pnpm --filter mobile env:staging
# The anon key is public (it ships inside every app build) but is not kept in the repo:
# copy it from Supabase Dashboard -> Project Settings -> API Keys -> Legacy API keys -> anon.
set -euo pipefail
cd "$(dirname "$0")/.."
STAGING_URL="https://vfjnnofocxbpnhwpvkva.supabase.co"
read -r -p "Paste the staging anon key (starts with eyJ): " ANON_KEY
case "$ANON_KEY" in
  eyJ*) ;;
  *) echo "That does not look like an anon key (it should start with eyJ)." >&2; exit 1 ;;
esac
# The service_role key also starts with eyJ, and it must never ship in the app: it bypasses every security rule.
# Read the key's "role" claim (the middle part of the JWT) and accept only the anon key.
ROLE=$(node -e '
  const part = process.argv[1].split(".")[1] || "";
  try { console.log(JSON.parse(Buffer.from(part, "base64url").toString()).role || ""); } catch { console.log(""); }
' "$ANON_KEY")
if [ "$ROLE" != "anon" ]; then
  echo "That is not the anon key (its role is '${ROLE:-unknown}'). Copy the key labelled 'anon public', never 'service_role'." >&2
  exit 1
fi
# Usage analytics: the PostHog project key is public (write-only). Read it from STAGING_POSTHOG_KEY or the
# Keychain item caltracker-posthog-staging-key; without it analytics stays off.
POSTHOG_KEY=${STAGING_POSTHOG_KEY:-$(security find-generic-password -s caltracker-posthog-staging-key -w 2>/dev/null || true)}
cat > .env.local <<EOT
EXPO_PUBLIC_SUPABASE_URL=$STAGING_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
EXPO_PUBLIC_POSTHOG_KEY=$POSTHOG_KEY
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
EOT
echo "Wrote apps/mobile/.env.local (staging: $STAGING_URL). Run 'pnpm --filter mobile env:local' to go back to local."
