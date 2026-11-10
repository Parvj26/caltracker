#!/usr/bin/env bash
# Writes apps/admin/.env.local from the running local Supabase stack.
# Usage: pnpm --filter admin env:local   (run `pnpm db:start` first)
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
cat > .env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
NEXT_PUBLIC_APP_ENV=development
ENV
echo "Wrote apps/admin/.env.local"
