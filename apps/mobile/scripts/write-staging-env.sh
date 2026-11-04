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
cat > .env.local <<EOT
EXPO_PUBLIC_SUPABASE_URL=$STAGING_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
EOT
echo "Wrote apps/mobile/.env.local (staging: $STAGING_URL). Run 'pnpm --filter mobile env:local' to go back to local."
