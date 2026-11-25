#!/bin/bash
# Safe deploy of PawBook Events 2.0 (page 30): real events, categories, location filters, map,
# registrations with capacity + waitlist, pay at venue / online (Razorpay), host tools, reports and moderation.
# Adds migration 014 (new tables only; existing events tables are NOT changed). On top of VetCare (routes v11).
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_events2.sh
set -u
PREV=dbdad2a
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-events2-$(date +%Y%m%d-%H%M%S)
FRONT="30_events.html"
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi; done
for d in $DIRS; do [ -e "$d/petevents.controller.js" ] && { echo "  already exists (unexpected): $d/petevents.controller.js"; BAD=1; }; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do grep -q "(v11: vetcare workspace)" "$f" || { echo "  routes are not at v11 (VetCare): $f"; BAD=1; }; done
for f in "$REPO"/img/events/*.jpg; do t="$WEB/img/events/$(basename "$f")"; if [ -e "$t" ] && ! cmp -s "$f" "$t"; then echo "  already exists with other content: $t"; BAD=1; fi; done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 014 (idempotent; only ADDS tables)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/014_pet_events.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 014 applied."

# 4) Backend
restore_backend() { cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f "$API/src/controllers/petevents.controller.js" "$API/controllers/petevents.controller.js"; }
for d in $DIRS; do cp "$REPO/backend/petevents.controller.js" "$d/petevents.controller.js"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
if node --check "$API/src/routes/index.js" && node --check "$API/routes/index.js" && node --check "$API/src/controllers/petevents.controller.js" && grep -q "peRouter" "$API/src/routes/index.js" && grep -q "vetcareRouter" "$API/src/routes/index.js"; then echo "Backend files OK."
else echo "Syntax check failed; backend restored."; restore_backend; exit 1; fi

# 5) Frontend + photos
mkdir -p "$WEB/img/events" && cp "$REPO"/img/events/*.jpg "$WEB/img/events/" && chmod 644 "$WEB"/img/events/*.jpg
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT (+ $(ls "$WEB/img/events" | wc -l) photos)"
echo
if grep -q '^RAZORPAY_KEY_ID=.' "$API/.env" && grep -q '^RAZORPAY_KEY_SECRET=.' "$API/.env"; then echo "Razorpay keys found in .env: online payment will be available."
else echo "Razorpay keys NOT in .env yet: events work with free entry and pay-at-venue; online payment stays off until you add them."; fi
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/petevents/config   (401 = Events 2.0 is live)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/petevents.controller.js $API/controllers/petevents.controller.js"
