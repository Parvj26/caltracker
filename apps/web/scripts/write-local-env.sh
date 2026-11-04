#!/usr/bin/env bash
# Writes apps/web/.env.local from the running local Supabase stack.
# Usage: pnpm --filter web env:local   (run `pnpm db:start` first)
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
EOF
echo "Wrote apps/web/.env.local"
