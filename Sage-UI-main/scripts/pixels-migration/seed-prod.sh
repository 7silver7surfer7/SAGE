#!/usr/bin/env bash
#
# Run the Pixels backfill against a DEPLOYED database, from anywhere.
#
# The seed script itself needs DATABASE_CONNECTION_POOL_URL (that is the
# variable prisma/schema.prisma reads — NOT DATABASE_URL, which is easy to set
# correctly and still have nothing happen). The deployed connection strings
# live in the Cloud Run env files next to the app, so this pulls the right one
# out rather than asking anyone to paste a production credential.
#
# Everything resolves from THIS FILE's location, so the working directory does
# not matter. Run it by absolute path, symlink it onto your PATH, whatever.
#
#   seed-prod.sh                 # production, dry run  (writes nothing)
#   seed-prod.sh --commit        # production, WRITES
#   seed-prod.sh --staging       # staging, dry run
#   seed-prod.sh --target-only   # print the target and exit; touches no database
#
# Safe to re-run: writes are keyed on one 'seed' journal row per wallet, so a
# second --commit skips those wallets instead of double-crediting.

set -euo pipefail

# Resolve this script's real directory, following symlinks, so putting a
# symlink on PATH still finds the repo.
SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
done
HERE=$(cd -P "$(dirname "$SOURCE")" && pwd)
APP=$(cd -P "$HERE/../.." && pwd)   # .../Sage-UI-main

SEED="$HERE/seed-from-purchases.mjs"
[ -f "$SEED" ] || { echo "seed script not found at $SEED" >&2; exit 1; }

# --- pick the environment -------------------------------------------------
ENV_FILE="$APP/.env.cloudrun.yaml"
ENV_NAME="PRODUCTION (mainnet · public schema)"
ARGS=()
TARGET_ONLY=0
for a in "$@"; do
  case "$a" in
    --staging)
      ENV_FILE="$APP/.env.staging.yaml"
      ENV_NAME="STAGING (staging_mainnet schema)"
      ;;
    --target-only) TARGET_ONLY=1 ;;
    *) ARGS+=("$a") ;;
  esac
done

[ -f "$ENV_FILE" ] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }

# --- extract the SESSION pooler URL (port 5432) ---------------------------
# Port 6543 is the pgbouncer transaction pooler. It cannot hold the session
# state this script's transactions need, so match 5432 explicitly rather than
# taking whichever URL appears first.
#
# THE SCHEME IS postgresql://, NOT postgres://. Both are valid libpq spellings
# and these files use the long one; a pattern written for the short one matches
# NOTHING and — worse — a REDACTION written for the short one silently passes
# the password through instead of masking it. Every regex here accepts both.
#
# Extraction runs through node rather than grep because the password is
# percent-encoded (%26 for &) and quoting that safely across shells is exactly
# the kind of detail that fails quietly.
URL=$(node -e "
const fs=require('fs');
const s=fs.readFileSync(process.argv[1],'utf8');
const m=s.match(/postgres(?:ql)?:\/\/[^'\"\s]*:5432\/postgres[^'\"\s]*/);
if(m) process.stdout.write(m[0]);
" "$ENV_FILE" || true)
if [ -z "$URL" ]; then
  echo "no session-pooler (:5432) connection string found in $ENV_FILE" >&2
  exit 1
fi

REDACTED=$(printf '%s' "$URL" | sed -E 's#postgres(ql)?://[^:]*:[^@]*@#postgresql://<redacted>@#')
# Refuse to print anything that still looks like it carries credentials —
# a redaction that silently no-ops is how a password reaches a terminal.
case "$REDACTED" in
  *"<redacted>"*) : ;;
  *) echo "refusing to print the target: redaction did not apply" >&2; exit 1 ;;
esac
echo "env    : $ENV_NAME"
echo "target : $REDACTED"

if [ "$TARGET_ONLY" -eq 1 ]; then
  echo "(--target-only: no database was contacted)"
  exit 0
fi

# Say plainly which way this run goes. A dry run prints a table and writes
# nothing; --commit is the one that moves real balances.
if printf '%s\n' "${ARGS[@]:-}" | grep -qx -- --commit; then
  echo "mode   : COMMIT — this WRITES to the ledger above"
else
  echo "mode   : dry run — writes nothing"
fi
echo

# `cd` into the app so prisma resolves its generated client and engines the
# same way the app does, regardless of where this was invoked from.
cd "$APP"
DATABASE_CONNECTION_POOL_URL="$URL" exec node "$SEED" "${ARGS[@]:-}"
