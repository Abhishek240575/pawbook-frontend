#!/bin/bash
# Daily PawBook database backup (pg_dump, compressed custom format). Keeps the newest 14 copies.
# Backups go to ~/pawbook_backups (outside the website folder, readable only by this account).
# Run once by hand:   bash ~/pb-sync/backend/backup_db.sh
# Restore (careful — into a NEW/empty database):  pg_restore --no-owner --no-privileges -d "<target db url>" ~/pawbook_backups/<file>.dump
set -u
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
DEST=~/pawbook_backups
KEEP=14
mkdir -p "$DEST" && chmod 700 "$DEST" || { echo "Cannot create $DEST"; exit 1; }
command -v pg_dump >/dev/null || { echo "pg_dump is not installed on this server. Ask MilesWeb support to enable PostgreSQL client tools, or rely on Neon's built-in restore."; exit 1; }
DATABASE_URL=$(grep '^DATABASE_URL=' "$API/.env" | head -1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL not found in $API/.env"; exit 1; }
FILE="$DEST/pawbook-$(date +%Y%m%d-%H%M).dump"
umask 077
if ! pg_dump --format=custom --no-owner --no-privileges --compress=6 --file="$FILE" "$DATABASE_URL" 2> "$FILE.err"; then
  echo "Backup FAILED:"; sed 's/postgres[^ ]*@/postgres:***@/g' "$FILE.err"
  grep -q "server version" "$FILE.err" && echo "Hint: the server's pg_dump is older than the Neon database. Ask MilesWeb for a newer PostgreSQL client, or use Neon's restore/branching."
  rm -f "$FILE" "$FILE.err"; exit 1
fi
rm -f "$FILE.err"
# make sure the file is a readable backup
if ! pg_restore --list "$FILE" >/dev/null 2>&1; then echo "Backup file looks damaged: $FILE"; exit 1; fi
TABLES=$(pg_restore --list "$FILE" 2>/dev/null | grep -c ' TABLE DATA ')
echo "$(date '+%Y-%m-%d %H:%M') backup OK: $FILE ($(du -h "$FILE" | cut -f1), $TABLES tables)"
# keep the newest $KEEP
ls -1t "$DEST"/pawbook-*.dump 2>/dev/null | tail -n +$((KEEP+1)) | while read -r old; do rm -f "$old"; done
echo "Backups kept: $(ls -1 "$DEST"/pawbook-*.dump 2>/dev/null | wc -l) (newest $KEEP)"
