#!/bin/bash
# SAGE Social activity drip runner — invoked by launchd every ~20 min.
# Sources the drip env (bot mnemonic + site), then runs one stateless tick.
# Logs to deploy/social-drip/drip.log. Off-chain only; refuses prod.
set -euo pipefail

REPO="/Users/dannyelcristyenciobanica/Downloads/SAGE/Sage-UI-main"
ENV_FILE="$HOME/.sage-social-drip.env"
LOG="/Users/dannyelcristyenciobanica/Downloads/SAGE/deploy/social-drip/drip.log"

[ -f "$ENV_FILE" ] || { echo "$(date -u +%FT%TZ) no env file" >>"$LOG"; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

cd "$REPO"
/opt/homebrew/bin/node scripts/social-drip.mjs >>"$LOG" 2>&1
# keep the log bounded (last 2000 lines)
tail -n 2000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
