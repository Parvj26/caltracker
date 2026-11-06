#!/usr/bin/env bash
# CI only: point this checkout's local Supabase at its own project id and port range, so a CI run on the shared
# self-hosted Mac never touches the developers' local stacks (lane A: "fitness-tracker" on 543xx, lane B:
# "fitness-tracker-b" on 544xx). CI gets "fitness-tracker-ci" on 545xx and the web app on port 3300.
#
#   api 54521 · db 54522 · shadow db 54520 · studio 54523 · mailpit web 54524 · mailpit smtp 54525 · pop3 54526
#   analytics 54527 · pooler 54529 · edge runtime inspector 8283 · web app 3300
#
# Edits supabase/config.toml and supabase/seed.sql in place (the runner's own checkout). Never run it in your own
# working copy. Fails if anything still points at the lane A ports afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

config=supabase/config.toml
seed=supabase/seed.sql

sed -i.bak -E \
  -e 's/^project_id = "fitness-tracker"$/project_id = "fitness-tracker-ci"/' \
  -e 's/543(2[0-9])/545\1/g' \
  -e 's/^inspector_port = 8083$/inspector_port = 8283/' \
  -e 's#(localhost|127\.0\.0\.1):3000#\1:3300#g' \
  "$config"
# The pg_cron award catch-up job calls award-workout through the API gateway: keep it on the CI gateway.
sed -i.bak -E -e 's/host\.docker\.internal:543(2[0-9])/host.docker.internal:545\1/g' "$seed"
rm -f "$config.bak" "$seed.bak"

fail=0
grep -q '^project_id = "fitness-tracker-ci"$' "$config" || { echo "::error::project_id was not rewritten" >&2; fail=1; }
if grep -nE '543[0-9]{2}|inspector_port = 8083|:3000' "$config" "$seed"; then
  echo "::error::lane A ports are still referenced (lines above)" >&2
  fail=1
fi
[ "$fail" = 0 ] || exit 1
echo "Local Supabase for this checkout: project fitness-tracker-ci, ports 545xx, web app 3300."
