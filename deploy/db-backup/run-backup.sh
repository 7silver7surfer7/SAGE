#!/usr/bin/env bash
# Nightly self-hosted DB backup — the daily-backup replacement that makes the
# Supabase FREE tier safe for a production database (free = no managed
# backups). pg_dump via the SESSION pooler (5432 — pg_dump cannot run through
# the transaction pooler), gzip to backups/db/, mirror to S3, prune local
# copies older than 14 days. The whole DB is ~26MB, so a run takes seconds.
#
# Installed as a launchd agent (see xyz.sageart.db-backup.plist next to this).
set -euo pipefail
cd "$(dirname "$0")/../.."

UI=Sage-UI-main
OUT=backups/db
mkdir -p "$OUT"

# session-mode URL: take the runtime URL, swap the transaction port, drop the
# prisma-only query params
DBURL=$(grep "^DATABASE_CONNECTION_POOL_URL=" "$UI/.env.deploy" | cut -d= -f2- | sed "s/^['\"]//; s/['\"]$//; s/:6543\//:5432\//; s/?.*$//")
STAMP=$(date +%Y-%m-%d-%H%M)
FILE="$OUT/sage-$STAMP.sql.gz"

/opt/homebrew/opt/libpq/bin/pg_dump "$DBURL" --no-owner --no-privileges | gzip > "$FILE"
SIZE=$(stat -f%z "$FILE")
if [ "$SIZE" -lt 100000 ]; then
  echo "$(date -u +%FT%TZ) BACKUP SUSPICIOUSLY SMALL: $FILE is ${SIZE}B — NOT pruning old copies" >&2
  exit 1
fi
echo "$(date -u +%FT%TZ) dumped $FILE (${SIZE}B)"

# offsite copy (same media bucket, private prefix)
(cd "$UI" && node -e '
const aws = require("aws-sdk");
const fs = require("fs");
require("dotenv").config();
aws.config.update({
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_SAGE, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_SAGE },
  region: "us-east-2",
});
const file = process.argv[1];
new aws.S3().putObject({
  Bucket: process.env.S3_BUCKET,
  Key: "db-backups/" + file.split("/").pop(),
  Body: fs.readFileSync(file),
  ContentType: "application/gzip",
}).promise().then(() => console.log("uploaded to s3://" + process.env.S3_BUCKET + "/db-backups/"))
  .catch((e) => { console.error("S3 upload failed:", e.message); process.exit(1); });
' "../$FILE")

# prune local dumps older than 14 days (S3 keeps everything; add a bucket
# lifecycle rule on db-backups/ if that ever matters)
find "$OUT" -name "sage-*.sql.gz" -mtime +14 -delete
echo "$(date -u +%FT%TZ) done"
