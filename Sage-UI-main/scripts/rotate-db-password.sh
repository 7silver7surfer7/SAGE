#!/usr/bin/env bash
# Rotate the Supabase DB password across every place the connection string
# lives — run AFTER resetting the password in the Supabase dashboard.
# Prompts silently (the password never appears in shell history, logs, or
# any chat transcript), URL-encodes it, rewrites the six env files, updates
# the Cloud Run runtime env, and verifies with a live query.
#
#   bash scripts/rotate-db-password.sh
set -euo pipefail
cd "$(dirname "$0")/.."

read -r -s -p "New Supabase DB password: " PW; echo
[ -n "$PW" ] || { echo "empty password — aborting"; exit 1; }

# URL-encode (passwords with ! # @ etc. must be percent-encoded in the URL)
ENC=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PW")

FILES=(.env.deploy .env.cloudrun.yaml .env.staging-deploy .env.pixelsjob.yaml .env.staging.yaml .env.docker-test)
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  # replace the password segment of every pooler URL: ://postgres.REF:OLD@ → ://postgres.REF:NEW@
  python3 - "$f" "$ENC" <<'EOF'
import re, sys
path, enc = sys.argv[1], sys.argv[2]
s = open(path).read()
s2 = re.sub(r'(://postgres\.[a-z]+:)[^@]+(@)', r'\g<1>' + enc + r'\g<2>', s)
open(path, 'w').write(s2)
print(f"  updated {path}" if s2 != s else f"  no pooler URL found in {path}")
EOF
done

# Cloud Run runtime env (prod) — rebuild the URL from .env.deploy's fresh value
DBURL=$(grep "^DATABASE_CONNECTION_POOL_URL=" .env.deploy | cut -d= -f2- | sed "s/^['\"]//; s/['\"]$//")
echo "updating Cloud Run env (new revision)…"
gcloud run services update sage-testnet --region us-west1 \
  --update-env-vars "^|^DATABASE_CONNECTION_POOL_URL=${DBURL}" --quiet >/dev/null
echo "  Cloud Run updated"

# GitHub Actions secret (pixels-update.yml authenticates with its own copy —
# missing this stranded the hourly job with auth failures after a rotation)
echo "updating GitHub secret…"
printf '%s' "$DBURL" | gh secret set DATABASE_CONNECTION_POOL_URL && echo "  gh secret updated" \
  || echo "  gh secret update FAILED — run: gh secret set DATABASE_CONNECTION_POOL_URL"

# verify: one live query through the new credential
echo "verifying…"
DATABASE_CONNECTION_POOL_URL="$DBURL" node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.$queryRaw`SELECT 1 AS ok`.then(() => { console.log("  DB reachable with the new password ✓"); return p.$disconnect(); })
  .catch((e) => { console.error("  VERIFY FAILED:", e.message.split("\n").pop()); process.exit(1); });
' 2>/dev/null || { echo "  verify failed — check the password and re-run"; exit 1; }

# prod smoke check
code=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 30 "https://sageart.xyz/api/social/?action=GetFeed&scope=global")
echo "  prod GetFeed after env swap: HTTP $code"
echo "done — old password is dead everywhere."
