#!/usr/bin/env bash
# PreToolUse hook for the reviewer subagent (.claude/agents/reviewer.md): lets its Bash tool run only read-only git and
# gh commands, one at a time. Anything else is blocked (exit 2) with a message telling the reviewer what is allowed.
cmd=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.command??"")}catch{}})' 2>/dev/null)

block() {
  echo "Reviewer is read-only: $1. Allowed: git status|log|diff|show|fetch|merge-base|rev-parse|ls-files|ls-tree|blame|grep, gh pr view|list|diff|checks, gh run view|list. One command per call, no pipes, redirects or substitutions." >&2
  exit 2
}

# No chaining, pipes, redirects, substitutions or newlines.
case "$cmd" in
  *';'* | *'&'* | *'|'* | *'>'* | *'<'* | *'$('* | *'`'* | *$'\n'*) block "shell operators are not allowed" ;;
esac
# git options that write files.
case "$cmd" in
  *--output* | *' -o '* | *--ext-diff*) block "options that write files or run programs are not allowed" ;;
esac

read -r prog sub rest <<<"$cmd"
case "$prog $sub" in
  "git status" | "git log" | "git diff" | "git show" | "git fetch" | "git merge-base" | "git rev-parse" | \
    "git ls-files" | "git ls-tree" | "git blame" | "git grep") exit 0 ;;
  "gh pr")
    read -r _ _ action _ <<<"$cmd"
    case "$action" in view | list | diff | checks) exit 0 ;; esac
    ;;
  "gh run")
    read -r _ _ action _ <<<"$cmd"
    case "$action" in view | list) exit 0 ;; esac
    ;;
esac
block "'$prog $sub' is not on the list"
