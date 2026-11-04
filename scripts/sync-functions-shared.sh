#!/usr/bin/env bash
# Edge Functions run in Docker with only supabase/functions mounted, so they cannot
# import packages/shared directly. Copy its source (no tests) into a git-ignored folder.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/supabase/functions/_shared/caltracker"
rm -rf "$dest"
mkdir -p "$dest"
(cd "$root/packages/shared/src" && find . -name '*.ts' ! -name '*.test.ts' -print0 | cpio -0pdm "$dest" 2>/dev/null)
# Deno needs explicit extensions on relative imports; the source uses bundler-style ones.
find "$dest" -name '*.ts' -exec sed -i.bak -E "s#(from '\.{1,2}/[^']*)'#\1.ts'#; s#\.ts\.ts'#.ts'#" {} +
find "$dest" -name '*.bak' -delete
echo "Synced packages/shared/src -> supabase/functions/_shared/caltracker"
