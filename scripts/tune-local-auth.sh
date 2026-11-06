#!/usr/bin/env bash
# Stops the local auth container running out of ports during long e2e runs: reuse sockets in TIME_WAIT and widen the
# port range. The setting resets whenever the Supabase containers restart, so e2e global setup re-applies it.
set -euo pipefail
docker run --rm --privileged --net container:supabase_auth_fitness-tracker alpine:3.20 \
  sysctl -w net.ipv4.tcp_tw_reuse=1 net.ipv4.ip_local_port_range="1024 65000"
