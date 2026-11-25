#!/bin/bash
# Safe deploy of the Vaccination Diary (page 10) with real per-pet vaccination records, plus small Pet Health (36) links.
# Adds migration 012 (two new side tables + one new column on PawBook's own pet_care_settings table; existing pet tables are NOT changed).
# On top of 1284f2a. Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_vax10.sh
set -u
PREV=1284f2a
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-vax10-$(date +%Y%m%d-%H%M%S)
FRONT="10_vaccination.html 36_pet_life_record.html"
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do
  if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi
done
for d in $DIRS; do
  if ! git show "$PREV:backend/petcare.controller.js" | cmp -s - "$d/petcare.controller.js"; then echo "  DIFFERS from $PREV: $d/petcare.controller.js"; BAD=1; fi
done
grep -q "(v9: pet health records)" "$API/src/routes/index.js" || { echo "  routes are not at v9: $API/src/routes/index.js"; BAD=1; }
grep -q "(v9: pet health records)" "$API/routes/index.js" || { echo "  routes are not at v9: $API/routes/index.js"; BAD=1; }
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/controllers/petcare.controller.js" "$BK/api-src/"; cp -p "$API/controllers/petcare.controller.js" "$BK/api/"
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 012 (idempotent; only ADDS tables / a column)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/012_vaccine_diary.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 012 applied."

# 4) Backend
restore_backend() { cp "$BK/api-src/petcare.controller.js" "$API/src/controllers/"; cp "$BK/api/petcare.controller.js" "$API/controllers/"; cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; }
for d in $DIRS; do cp "$REPO/backend/petcare.controller.js" "$d/petcare.controller.js"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
if node --check "$API/src/routes/index.js" && node --check "$API/routes/index.js" && node --check "$API/src/controllers/petcare.controller.js" && grep -q "vaccineDiary" "$API/src/routes/index.js"; then echo "Backend files OK."
else echo "Syntax check failed; backend restored."; restore_backend; exit 1; fi

# 5) Frontend
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/petcare/pets/1/vaccines   (401 = vaccination diary is live)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/petcare.controller.js $API/src/controllers/ ; cp $BK/api/petcare.controller.js $API/controllers/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js"
