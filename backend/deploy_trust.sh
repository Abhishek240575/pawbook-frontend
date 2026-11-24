#!/bin/bash
# Safe deploy of Phase 4 seller trust (KYC documents + listing approval) on top of the live site (09ddd3e).
# Every live file is compared with the copy from the last deployed commit first.
# If ANY live file differs (someone edited it on the server), nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_trust.sh
set -u
PREV=09ddd3e
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
PRIV=~/pawbook_private/kyc
BK=~/backup-trust-$(date +%Y%m%d-%H%M%S)
FRONT="42_shop.html 43_shop_list.html 44_shop_product.html 45_shop_brands.html 46_shop_brand.html 47_shop_compare.html 48_shop_admin.html 49_seller_join.html 50_seller_hub.html 51_seller_product.html 52_shop_checkout.html 53_shop_orders.html seller-i18n.js"
CTRL="shop seller checkout experience"   # existing controllers, must match PREV
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
  for c in $CTRL; do
    if ! git show "$PREV:backend/$c.controller.js" | cmp -s - "$d/$c.controller.js"; then echo "  DIFFERS from $PREV: $d/$c.controller.js"; BAD=1; fi
  done
  [ -e "$d/trust.controller.js" ] && { echo "  already exists (unexpected): $d/trust.controller.js"; BAD=1; }
done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
( cd "$API" && node -e "require.resolve('multer')" ) 2>/dev/null || { echo "  multer is not installed in $API (needed for document upload)"; BAD=1; }
case "$PRIV" in "$WEB"*) echo "  private folder is inside the web root"; BAD=1;; esac
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
for c in $CTRL; do cp -p "$API/src/controllers/$c.controller.js" "$BK/api-src/"; cp -p "$API/controllers/$c.controller.js" "$BK/api/"; done
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Private folder for KYC documents (outside the website, only this account can read it)
mkdir -p "$PRIV" && chmod 700 ~/pawbook_private "$PRIV" || { echo "STOPPED: could not create $PRIV. Nothing was changed."; exit 1; }
echo "Private document folder: $PRIV"

# 4) Database migration 008 (idempotent; only adds tables/columns, existing products stay approved)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/008_marketplace_seller_trust.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 008 applied."

# 5) Backend
restore_backend() { cp "$BK"/api-src/*.controller.js "$API/src/controllers/"; cp "$BK"/api/*.controller.js "$API/controllers/"; cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f "$API/src/controllers/trust.controller.js" "$API/controllers/trust.controller.js"; }
for d in $DIRS; do for c in $CTRL trust; do cp "$REPO/backend/$c.controller.js" "$d/$c.controller.js"; done; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
if node --check "$API/src/routes/index.js" && node --check "$API/routes/index.js" && node --check "$API/src/controllers/trust.controller.js" && node --check "$API/src/controllers/seller.controller.js"; then echo "Backend files OK."
else echo "Syntax check failed; backend restored."; restore_backend; exit 1; fi

# 6) Frontend
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  curl -s -o /dev/null -w '%{http_code}\n' https://pawbook.deemona.com/api/v1/shop/seller/kyc"
echo "  (401 = seller trust routes are live; 404 = app not restarted yet)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/*.controller.js $API/src/controllers/ ; cp $BK/api/*.controller.js $API/controllers/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/trust.controller.js $API/controllers/trust.controller.js"
