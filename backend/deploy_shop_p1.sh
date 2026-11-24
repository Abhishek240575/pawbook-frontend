#!/bin/bash
# Safe deploy of Shop Phase 1 completion (commit dca4b7e) on top of the live site (bec4712).
# Every live file is compared with the copy from the last deployed commit first.
# If ANY live file differs (someone edited it on the server), nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_shop_p1.sh
set -u
PREV=bec4712
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
BK=~/backup-shop-p1-$(date +%Y%m%d-%H%M%S)

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }

# Locate the live web folder: the one that holds the live 42_shop.html
HITS=$(find /var/www/1015d59e-67f5-4aea-838c-7f7392731800 ~ -maxdepth 3 -name 42_shop.html -not -path "*pb-sync*" -not -path "*backup*" 2>/dev/null | xargs -r -n1 dirname | sort -u)
NHITS=$(printf '%s\n' "$HITS" | grep -c .)
if [ "$NHITS" -ne 1 ]; then echo "Could not find exactly one live web folder (found: ${HITS:-none}). Nothing changed."; exit 1; fi
WEB=$HITS
echo "Web folder: $WEB"
echo "API folder: $API"

FRONT="42_shop.html 43_shop_list.html 44_shop_product.html shop.js shop.css shop-i18n.js"
NEW="45_shop_brands.html 46_shop_brand.html 47_shop_compare.html 48_shop_admin.html"
CTRLS="$API/src/controllers/shop.controller.js $API/controllers/shop.controller.js"

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do
  if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi
done
for c in $CTRLS; do
  if ! git show "$PREV:backend/shop.controller.js" | cmp -s - "$c"; then echo "  DIFFERS from $PREV: $c"; BAD=1; fi
done
for f in $NEW; do [ -e "$WEB/$f" ] && echo "  note: $WEB/$f already exists, will be left as is"; done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files differ from what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/controllers/shop.controller.js" "$BK/api-src/"; cp -p "$API/controllers/shop.controller.js" "$BK/api/"
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 004 (idempotent, safe to re-run)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/004_marketplace_discovery.sql"; then
  echo "STOPPED: migration failed. Files not changed yet (backup is in $BK)."; exit 1; fi
echo "Migration 004 applied."

# 4) Backend
for c in $CTRLS; do cp "$REPO/backend/shop.controller.js" "$c"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; restoring controllers."; cp "$BK/api-src/shop.controller.js" "$API/src/controllers/"; cp "$BK/api/shop.controller.js" "$API/controllers/"; exit 1; }
node --check "$API/src/routes/index.js" && node --check "$API/routes/index.js" && echo "Backend files OK."

# 5) Frontend
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
for f in $NEW; do [ -e "$WEB/$f" ] || cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo "Frontend added:   $NEW"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  curl -s https://pawbook.deemona.com/api/v1/shop/brands | head -c 200; echo"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/shop.controller.js $API/src/controllers/ ; cp $BK/api/shop.controller.js $API/controllers/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js"
