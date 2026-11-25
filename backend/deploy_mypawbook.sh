#!/bin/bash
# Safe deploy of My PawBook (page 31): My Collection, PawBook Memories, My Journey, Paw Celebrations.
# Old routes (/saved, /memories, /activity, /birthdays) and existing data are left untouched.
# Adds migration 015 (new tables only; existing tables are NOT changed). On top of Events 2.0 (routes v12).
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_mypawbook.sh
set -u
PREV=dbdad2a
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-mypawbook-$(date +%Y%m%d-%H%M%S)
FRONT="31_saved.html"
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi; done
for d in $DIRS; do [ -e "$d/mypawbook.controller.js" ] && { echo "  already exists (unexpected): $d/mypawbook.controller.js"; BAD=1; }; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do grep -q "(v12: pet events)" "$f" || { echo "  routes are not at v12 (Events 2.0) — run deploy_events2.sh first: $f"; BAD=1; }; done
for f in "$REPO"/img/journey/*.jpg; do t="$WEB/img/journey/$(basename "$f")"; if [ -e "$t" ] && ! cmp -s "$f" "$t"; then echo "  already exists with other content: $t"; BAD=1; fi; done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 015 (idempotent; only ADDS tables)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/015_my_pawbook.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 015 applied."

# 4) Backend
restore_backend() { cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f "$API/src/controllers/mypawbook.controller.js" "$API/controllers/mypawbook.controller.js"; }
for d in $DIRS; do cp "$REPO/backend/mypawbook.controller.js" "$d/mypawbook.controller.js"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
if node --check "$API/src/routes/index.js" && node --check "$API/routes/index.js" && node --check "$API/src/controllers/mypawbook.controller.js" && grep -q "mpRouter" "$API/src/routes/index.js" && grep -q "peRouter" "$API/src/routes/index.js"; then echo "Backend files OK."
else echo "Syntax check failed; backend restored."; restore_backend; exit 1; fi

# 5) Frontend + photos
mkdir -p "$WEB/img/journey" && cp "$REPO"/img/journey/*.jpg "$WEB/img/journey/" && chmod 644 "$WEB"/img/journey/*.jpg
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT (+ $(ls "$WEB/img/journey" | wc -l) photos)"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/mypawbook/summary   (401 = My PawBook is live)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/mypawbook.controller.js $API/controllers/mypawbook.controller.js"
