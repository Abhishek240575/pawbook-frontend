#!/bin/bash
# Shop pages load shop.js?v=11 (was v=10) so browsers and the Play Store app pick up the new shop.js at once
# (the site's offline helper served the old saved copy first, so the Adopt tab still opened the old adoption page).
# Frontend only — the 13 shop pages. No restart needed.
# Usage:  bash ~/pb-sync/backend/deploy_shopjsv11.sh
set -u
PREV=d1e542e
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-shopjsv11-$(date +%Y%m%d-%H%M%S)
FRONT="42_shop.html 43_shop_list.html 44_shop_product.html 45_shop_brands.html 46_shop_brand.html 47_shop_compare.html 48_shop_admin.html 49_seller_join.html 50_seller_hub.html 51_seller_product.html 52_shop_checkout.html 53_shop_orders.html 54_shop_receipt.html "
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
T1=$(mktemp); T2=$(mktemp); BAD=0   # temp files (this server has no /dev/fd)
for f in $FRONT; do git show "$PREV:$f" | norm > "$T1"; norm < "$WEB/$f" > "$T2"; cmp -s "$T1" "$T2" || { echo "  DIFFERS from $PREV: $f"; BAD=1; }; done
rm -f "$T1" "$T2"
[ "$BAD" -ne 0 ] && { echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; }
mkdir -p "$BK" && for f in $FRONT; do cp -p "$WEB/$f" "$BK/"; done || { echo "Backup failed"; exit 1; }
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f" || { echo "Copy failed: $f — restoring"; cp -p "$BK"/* "$WEB/"; exit 1; }; done
echo "DONE: 13 shop pages now load shop.js?v=11. No restart needed."
echo "Undo (if ever needed): cp $BK/* $WEB/"
