#!/usr/bin/env bash
# Provision the nightly DB backup as a SELF-CONTAINED launchd agent in
# ~/.sage-db-backup — macOS TCC blocks launchd-spawned scripts from touching
# ~/Downloads (observed: "Operation not permitted" on the repo copy; the
# social-drip agent works for exactly this reason, living in ~/.sage-social-drip).
# Copies the runtime script, materializes an env file from the repo's
# secrets, installs + loads the plist. Re-run after a DB password rotation
# (rotate-db-password.sh does this automatically when the agent is present).
set -euo pipefail
cd "$(dirname "$0")/../.."

HOME_DIR="$HOME/.sage-db-backup"
mkdir -p "$HOME_DIR/dumps"

# session-mode URL (pg_dump can't use the transaction pooler) + AWS creds
DBURL=$(grep "^DATABASE_CONNECTION_POOL_URL=" Sage-UI-main/.env.deploy | cut -d= -f2- | sed "s/^['\"]//; s/['\"]$//; s/:6543\//:5432\//; s/?.*$//")
AK=$(grep "^AWS_ACCESS_KEY_SAGE=" Sage-UI-main/.env | cut -d= -f2-)
SK=$(grep "^AWS_SECRET_ACCESS_KEY_SAGE=" Sage-UI-main/.env | cut -d= -f2-)
BUCKET=$(grep "^S3_BUCKET=" Sage-UI-main/.env | cut -d= -f2-)
umask 077
cat > "$HOME_DIR/env" <<ENV
SESSION_DB_URL='$DBURL'
AWS_ACCESS_KEY_ID=$AK
AWS_SECRET_ACCESS_KEY=$SK
S3_BUCKET=$BUCKET
ENV

cat > "$HOME_DIR/run-backup.sh" <<'SCRIPT'
#!/usr/bin/env bash
# Nightly SAGE DB backup (self-contained; provisioned by deploy/db-backup/install.sh)
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./env; set +a
STAMP=$(date +%Y-%m-%d-%H%M)
FILE="dumps/sage-$STAMP.sql.gz"
/opt/homebrew/opt/libpq/bin/pg_dump "$SESSION_DB_URL" --no-owner --no-privileges | gzip > "$FILE"
SIZE=$(stat -f%z "$FILE")
if [ "$SIZE" -lt 100000 ]; then
  echo "$(date -u +%FT%TZ) BACKUP SUSPICIOUSLY SMALL (${SIZE}B) — keeping old copies" >&2
  exit 1
fi
echo "$(date -u +%FT%TZ) dumped $FILE (${SIZE}B)"
/opt/homebrew/bin/aws s3 cp "$FILE" "s3://$S3_BUCKET/db-backups/" --only-show-errors
echo "$(date -u +%FT%TZ) mirrored to s3://$S3_BUCKET/db-backups/"
find dumps -name "sage-*.sql.gz" -mtime +14 -delete
SCRIPT
chmod +x "$HOME_DIR/run-backup.sh"

PLIST="$HOME/Library/LaunchAgents/xyz.sageart.db-backup.plist"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>xyz.sageart.db-backup</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$HOME_DIR/run-backup.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>30</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/launchd.out</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/launchd.err</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed — agent loaded (daily 04:30 + one run now); dumps in $HOME_DIR/dumps"
