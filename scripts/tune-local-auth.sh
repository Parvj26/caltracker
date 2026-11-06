#!/usr/bin/env bash
# Stops the local auth container running out of ports during long e2e runs: reuse sockets in TIME_WAIT and widen the
# port range. The setting resets whenever the Supabase containers restart, so e2e global setup re-applies it.
# Targets this checkout's stack (project_id in supabase/config.toml); set SUPABASE_PROJECT_ID to target another one.
set -euo pipefail
cd "$(dirname "$0")/.."
project_id="${SUPABASE_PROJECT_ID:-$(sed -nE 's/^project_id = "(.*)"/\1/p' supabase/config.toml)}"
docker run --rm --privileged --net "container:supabase_auth_${project_id}" alpine:3.20 \
  sysctl -w net.ipv4.tcp_tw_reuse=1 net.ipv4.ip_local_port_range="1024 65000"
