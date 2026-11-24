#!/bin/bash
# Safe deploy of the Marketplace seller side (Phase 2) on top of the live site (103a03b).
# Every live file is compared with the copy from the last deployed commit first.
# If ANY live file differs (someone edited it on the server), nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_seller.sh
set -u
PREV=103a03b
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
BK=~/backup-seller-$(date +%Y%m%d-%H%M%S)

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }

HITS=$(find /var/www/1015d59e-67f5-4aea-838c-7f7392731800 ~ -maxdepth 3 -name 42_shop.html -not -path "*pb-sync*" -not -path "*backup*" 2>/dev/null | xargs -r -n1 dirname | sort -u)
NHITS=$(printf '%s\n' "$HITS" | grep -c .)
if [ "$NHITS" -ne 1 ]; then echo "Could not find exactly one live web folder (found: ${HITS:-none}). Nothing changed."; exit 1; fi
WEB=$HITS
echo "Web folder: $WEB"
echo "API folder: $API"

FRONT="shop.js 48_shop_admin.html"
NEW="49_seller_join.html 50_seller_hub.html 51_seller_product.html seller.js seller.css seller-i18n.js"
SHOPC="$API/src/controllers/shop.controller.js $API/controllers/shop.controller.js"
SELLC="$API/src/controllers/seller.controller.js $API/controllers/seller.controller.js"

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do
  if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi
done
for c in $SHOPC; do
  if ! git show "$PREV:backend/shop.controller.js" | cmp -s - "$c"; then echo "  DIFFERS from $PREV: $c"; BAD=1; fi
done
for c in $SELLC; do [ -e "$c" ] && { echo "  already exists (unexpected): $c"; BAD=1; }; done
for f in $NEW; do [ -e "$WEB/$f" ] && { echo "  already exists (unexpected): $WEB/$f"; BAD=1; }; done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/controllers/shop.controller.js" "$BK/api-src/"; cp -p "$API/controllers/shop.controller.js" "$BK/api/"
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 005 (idempotent, safe to re-run; only adds tables/columns)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/005_marketplace_sellers.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 005 applied."

# 4) Backend: new seller controller, updated shop controller, route block upgrade
for c in $SELLC; do cp "$REPO/backend/seller.controller.js" "$c"; done
for c in $SHOPC; do cp "$REPO/backend/shop.controller.js" "$c"; done
restore_backend() { cp "$BK/api-src/shop.controller.js" "$API/src/controllers/"; cp "$BK/api/shop.controller.js" "$API/controllers/"; cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f $SELLC; }
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
if node --check "$API/src/routes/index.js" && node --check "$API/routes/index.js" && node --check "$API/src/controllers/seller.controller.js"; then echo "Backend files OK."
else echo "Syntax check failed; backend restored."; restore_backend; exit 1; fi

# 5) Frontend
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
for f in $NEW; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo "Frontend added:   $NEW"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  curl -s -o /dev/null -w '%{http_code}\n' https://pawbook.deemona.com/api/v1/shop/seller/me"
echo "  (401 = seller routes are live and asking for login; 404 = app not restarted yet)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/shop.controller.js $API/src/controllers/ ; cp $BK/api/shop.controller.js $API/controllers/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $WEB/49_seller_join.html $WEB/50_seller_hub.html $WEB/51_seller_product.html"
