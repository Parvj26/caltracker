#!/usr/bin/env bash
# Fails when supabase/migrations can't be applied in a single, unambiguous order:
#   1. two migration files share the same version (the numeric prefix before the first "_");
#   2. this branch adds a migration whose version is not newer than the newest migration on the base branch
#      (another PR merged a later one first: rename yours to a fresh, later timestamp).
# Usage: bash scripts/check-migrations.sh [base-ref]   (default: origin/$GITHUB_BASE_REF, else origin/main)
set -euo pipefail
cd "$(dirname "$0")/.."

dir=supabase/migrations
base=${1:-origin/${GITHUB_BASE_REF:-main}}
fail=0

version() { basename "$1" | cut -d_ -f1; }

dupes=$(for f in "$dir"/*.sql; do version "$f"; done | sort | uniq -d)
for v in $dupes; do
  echo "::error::Migration version $v is used by more than one file:" >&2
  ls "$dir"/"${v}"_* >&2
  fail=1
done

if git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  newest_base=$(git ls-tree --name-only "$base" "$dir/" | grep '\.sql$' | while read -r f; do version "$f"; done | sort | tail -1)
  added=$(git diff --name-only --diff-filter=A "$base"...HEAD -- "$dir" | grep '\.sql$' || true)
  for f in $added; do
    v=$(version "$f")
    if [[ -n "$newest_base" && ! "$v" > "$newest_base" ]]; then
      echo "::error file=$f::Migration $v is not newer than the newest migration on $base ($newest_base). Give it a later timestamp." >&2
      fail=1
    fi
  done
else
  echo "Base $base not found; checked duplicate versions only." >&2
fi

[ "$fail" = 0 ] && echo "Migrations: versions are unique and newer than $base."
exit "$fail"
