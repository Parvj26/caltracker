#!/usr/bin/env bash
# Restart the local Supabase Auth container so it loads our custom email templates.
#
# Auth downloads the templates (supabase/templates/*.html) from the Kong gateway when it starts.
# On a cold start Auth can come up before Kong, get "connection refused", and silently fall back
# to Supabase's default emails (wrong subject, no /auth/confirm link) until it restarts.
# Run this after `supabase start` (and after `supabase db reset`). Local development only.
set -euo pipefail

project_id=$(sed -nE 's/^project_id = "(.*)"/\1/p' supabase/config.toml)
container="supabase_auth_${project_id}"

docker restart "$container" >/dev/null
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)

for _ in $(seq 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = healthy ] && break
  sleep 1
done
if [ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" != healthy ]; then
  echo "::error::$container did not become healthy after restart" >&2
  exit 1
fi

if docker logs --since "$since" "$container" 2>&1 | grep -q templatemailer_template_body_http_error; then
  echo "::error::Auth could not load the custom email templates:" >&2
  docker logs --since "$since" "$container" 2>&1 | grep templatemailer_template_body_http_error >&2
  exit 1
fi
echo "Auth restarted with custom email templates loaded."
