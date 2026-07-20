#!/usr/bin/env bash
# Warms the media proxy cache on production after a deploy.
#
# Every Cloud Run deploy (and any scale-to-zero restart) starts an instance
# with an empty tmpfs media cache; the first viewer of each video would wait
# on a full Arweave download — long enough that iOS Safari's player can give
# up before its range probe is answered. This hits ?prewarm=1 (download +
# iOS transcode if needed + poster) for every video on a live drop so the
# cache is hot before any real viewer arrives.
#
# Usage: ./scripts/warm-media.sh   (needs .env.deploy for the prod DB URL)
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-https://sageart.xyz}"
# strip optional shell quotes: the value is quoted in .env.deploy because the
# Dockerfile SOURCES that file with sh and the URL contains '&' (unquoted, sh
# would background the assignment and the var would vanish at build time)
PROD_URL=$(grep "^DATABASE_CONNECTION_POOL_URL=" .env.deploy | cut -d= -f2- | sed "s/^['\"]//; s/['\"]$//")

# every video txid referenced by a live (approved) drop's games
TXIDS=$(psql "$PROD_URL" -t -A -c "
  SELECT DISTINCT substring(n.\"s3Path\" from 'arweave\.net/([A-Za-z0-9_-]{43})')
  FROM \"Nft\" n
  LEFT JOIN \"Auction\" a ON a.\"nftId\" = n.id
  LEFT JOIN \"Lottery\" l ON l.id = n.\"lotteryId\"
  LEFT JOIN \"OpenEdition\" oe ON oe.\"nftId\" = n.id
  JOIN \"Drop\" d ON d.id = COALESCE(a.\"dropId\", l.\"dropId\", oe.\"dropId\")
  WHERE d.\"approvedAt\" IS NOT NULL
    AND (n.\"s3Path\" ILIKE '%filetype=mp4%' OR n.\"s3Path\" ILIKE '%.mp4%')
    AND n.\"s3Path\" LIKE '%arweave.net%';
")

COUNT=0
for TXID in $TXIDS; do
  [ -z "$TXID" ] && continue
  COUNT=$((COUNT + 1))
  echo -n "warming $TXID ... "
  curl -s --max-time 300 "$BASE_URL/api/media/$TXID/?prewarm=1" | head -c 120
  echo ""
done
echo "warmed $COUNT video(s)"
