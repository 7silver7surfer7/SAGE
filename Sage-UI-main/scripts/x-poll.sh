#!/usr/bin/env bash
# Poll @SAGEARTXYZ mentions on a loop.
#
# The worker at /api/x-mentions is a SINGLE cycle by design — idempotent, safe
# to poke twice, and cheap when there is nothing new. This just pokes it on an
# interval so the bot answers without someone running curl.
#
# LOCAL USE. In production this belongs on Cloud Scheduler hitting the same
# endpoint; a laptop is not a worker host, and this repo has already watched a
# dev server die under a long job on 8GB.
#
#   ./scripts/x-poll.sh              # every 60s against localhost:3005
#   INTERVAL=120 ./scripts/x-poll.sh # slower
#   BASE=https://testnet.sageart.xyz ./scripts/x-poll.sh
#
# Ctrl-C to stop. Nothing posts unless SAGE_X_LIVE=true is set for the server.
set -uo pipefail

BASE="${BASE:-http://localhost:3005}"
INTERVAL="${INTERVAL:-60}"

echo "polling ${BASE}/api/x-mentions every ${INTERVAL}s — Ctrl-C to stop"
while true; do
  out=$(curl -s -X POST "${BASE}/api/x-mentions/" --max-time 120 2>/dev/null)
  ts=$(date +%H:%M:%S)
  if [ -z "$out" ]; then
    echo "  $ts  (no response — is the server up?)"
  else
    echo "  $ts  $out"
  fi
  sleep "$INTERVAL"
done
