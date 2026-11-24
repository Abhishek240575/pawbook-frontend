#!/bin/bash
# Safe deploy of the redesigned Pet Health page (36) with real per-pet records (vaccines, vet care, medicines, weight,
# daily wellness, memories, private documents). On top of d79e166. Every live file is compared with the last deployed copy first.
# If ANY live file differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_pethealth.sh
set -u
PREV=d79e166
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-pethealth-$(date +%Y%m%d-%H%M%S)
PRIV=~/pawbook_private/petdocs
FRONT="36_pet_life_record.html"
CTRL="shop seller checkout experience trust reports fulfil"   # existing controllers, must match PREV
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 0) Phases 5+8 must be live first
if [ ! -f "$API/controllers/fulfil.controller.js" ]; then echo "STOPPED: deploy_phase58.sh has not been run yet. Nothing was changed."; exit 1; fi

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do
  if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi
done
for d in $DIRS; do
  for c in $CTRL; do
    if ! git show "$PREV:backend/$c.controller.js" | cmp -s - "$d/$c.controller.js"; then echo "  DIFFERS from $PREV: $d/$c.controller.js"; BAD=1; fi
  done
  [ -e "$d/petcare.controller.js" ] && { echo "  already exists (unexpected): $d/petcare.controller.js"; BAD=1; }
done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
( cd "$API" && node -e "require.resolve('multer')" ) 2>/dev/null || { echo "  multer is not installed in $API (needed for document upload)"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
for c in $CTRL; do cp -p "$API/src/controllers/$c.controller.js" "$BK/api-src/"; cp -p "$API/controllers/$c.controller.js" "$BK/api/"; done
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Private folder for pet documents (outside the website, only this account can read it)
mkdir -p "$PRIV" && chmod 700 ~/pawbook_private "$PRIV" || { echo "STOPPED: could not create $PRIV. Nothing was changed."; exit 1; }
echo "Private document folder: $PRIV"

# 3b) Database migration 011 (idempotent; only ADDS four new tables, existing pet tables are not changed)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/011_pet_care.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 011 applied."

# 4) Backend
restore_backend() { cp "$BK"/api-src/*.controller.js "$API/src/controllers/"; cp "$BK"/api/*.controller.js "$API/controllers/"; cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f "$API/src/controllers/petcare.controller.js" "$API/controllers/petcare.controller.js"; }
for d in $DIRS; do for c in $CTRL petcare; do cp "$REPO/backend/$c.controller.js" "$d/$c.controller.js"; done; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
if node --check "$API/src/routes/index.js" && node --check "$API/routes/index.js" && node --check "$API/src/controllers/petcare.controller.js"; then echo "Backend files OK."
else echo "Syntax check failed; backend restored."; restore_backend; exit 1; fi

# 5) Frontend
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run the smoke test:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/petcare/pets   (401 = pet health is live)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/*.controller.js $API/src/controllers/ ; cp $BK/api/*.controller.js $API/controllers/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/petcare.controller.js $API/controllers/petcare.controller.js"
