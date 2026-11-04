#!/usr/bin/env bash
# Writes apps/mobile/.env.local from the running local Supabase stack.
# Usage: pnpm --filter mobile env:local [host]   (run `pnpm db:start` first)
# The iOS simulator can use the default 127.0.0.1. A real phone (Expo Go) must reach your Mac,
# so pass its LAN IP: pnpm --filter mobile env:local 192.168.1.20
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
if [ -n "${1:-}" ]; then
  API_URL="$(echo "$API_URL" | sed -E "s#//[^:/]+#//$1#")"
fi
cat > .env.local <<EOT
EXPO_PUBLIC_SUPABASE_URL=$API_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
EOT
echo "Wrote apps/mobile/.env.local ($API_URL)"
