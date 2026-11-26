#!/bin/bash
# Brands: (1) adds 50 pet brands sold in India to the shop's brand records — names only, no logos; existing brands
# are never changed (migration 021, ON CONFLICT DO NOTHING). A brand still appears on "Shop by brand" only once it
# has a product on sale. (2) Shop admin → Brands: Upload buttons for logo and cover, preview, logo thumbnails in the list.
# No restart needed (no server code change).
# Usage:  bash ~/pb-sync/backend/deploy_brands.sh
set -u
PREV=6960339
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-brands-$(date +%Y%m%d-%H%M%S)
F=48_shop_admin.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
T1=$(mktemp); T2=$(mktemp)   # temp files (this server has no /dev/fd)
git show "$PREV:$F" | norm > "$T1"; norm < "$WEB/$F" > "$T2"
if ! cmp -s "$T1" "$T2"; then echo "STOPPED: $WEB/$F differs from $PREV. Nothing was changed. Send me this output."; diff "$T1" "$T2" | head -20; rm -f "$T1" "$T2"; exit 1; fi
rm -f "$T1" "$T2"
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" || { echo "Backup failed"; exit 1; }
echo "Backup: $BK"
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
B0=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM marketplace_brands") || { echo "STOPPED: could not reach the database. Nothing was changed."; exit 1; }
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/021_brand_directory.sql"; then echo "STOPPED: brand list not added (database error). Page not changed."; exit 1; fi
B1=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM marketplace_brands")
echo "Brand records: $B0 before, $B1 now (existing brands unchanged)."
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed"; exit 1; }
echo "DONE. Shop admin → Brands now has Upload buttons for logo and cover. No restart needed."
echo "Undo page (if ever needed): cp $BK/$F $WEB/"
