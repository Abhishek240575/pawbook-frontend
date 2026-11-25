#!/bin/bash
# Safe deploy of PawBook VetCare (Vet Portal, page 41): real dashboard, waiting room, patient records,
# consultation notes, prescriptions, vaccinations, clinic team roles and audit trail.
# Adds migration 013 (new tables only; existing vet tables are NOT changed). On top of dc69d5f.
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_vetcare.sh
set -u
PREV=dc69d5f
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-vetcare-$(date +%Y%m%d-%H%M%S)
FRONT="41_vet_portal.html"
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi; done
for d in $DIRS; do [ -e "$d/vetcare.controller.js" ] && { echo "  already exists (unexpected): $d/vetcare.controller.js"; BAD=1; }; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do grep -q "(v10: vaccination diary)" "$f" || { echo "  routes are not at v10: $f"; BAD=1; }; done
for f in "$REPO"/img/vet/*.jpg; do t="$WEB/img/vet/$(basename "$f")"; if [ -e "$t" ] && ! cmp -s "$f" "$t"; then echo "  already exists with other content: $t"; BAD=1; fi; done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 013 (idempotent; only ADDS tables)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/013_vetcare.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 013 applied."

# 4) Backend
restore_backend() { cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f "$API/src/controllers/vetcare.controller.js" "$API/controllers/vetcare.controller.js"; }
for d in $DIRS; do cp "$REPO/backend/vetcare.controller.js" "$d/vetcare.controller.js"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
if node --check "$API/src/routes/index.js" && node --check "$API/routes/index.js" && node --check "$API/src/controllers/vetcare.controller.js" && grep -q "vetcareRouter" "$API/src/routes/index.js"; then echo "Backend files OK."
else echo "Syntax check failed; backend restored."; restore_backend; exit 1; fi

# 5) Frontend + photos
mkdir -p "$WEB/img/vet" && cp "$REPO"/img/vet/*.jpg "$WEB/img/vet/" && chmod 644 "$WEB"/img/vet/*.jpg
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT (+ $(ls "$WEB/img/vet" | wc -l) photos)"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/vetcare/dashboard   (401 = VetCare is live)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/vetcare.controller.js $API/controllers/vetcare.controller.js"
