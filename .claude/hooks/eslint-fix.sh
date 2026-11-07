#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): runs `eslint --fix` on the one TS/TSX file Claude just changed, so lint-only nits never
# reach CI or review. Never blocks: any failure (no node_modules yet, a lint error eslint can't fix, a timeout) is
# ignored, and output is discarded. settings.json gives it a 30 s timeout. `pnpm check` and CI still enforce lint.
# Not prettier: most of the repo is not prettier-formatted, so formatting on edit would rewrite whole files.
input=$(cat)
file=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.file_path??"")}catch{}})' 2>/dev/null)
case "$file" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0
# The checkout that owns the file (a worktree has its own node_modules and config).
root=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0
eslint="$root/node_modules/.bin/eslint"
[ -x "$eslint" ] || exit 0
cd "$root" || exit 0
"$eslint" --fix --no-warn-ignored "$file" >/dev/null 2>&1
exit 0
