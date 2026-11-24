#!/bin/bash
# Shop/seller pages: the PawBook logo now goes to the PawBook home page; a "Shop" tab is added to the category bar.
# Frontend only. Live files are compared with the last deploy (d43a4e9) first; if any differ, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_logo.sh
set -u
PREV=d43a4e9
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-logo-$(date +%Y%m%d-%H%M%S)
FRONT="42_shop.html 43_shop_list.html 44_shop_product.html 45_shop_brands.html 46_shop_brand.html 47_shop_compare.html 48_shop_admin.html 49_seller_join.html 50_seller_hub.html 51_seller_product.html 52_shop_checkout.html 53_shop_orders.html shop.js"
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found"; exit 1; }
BAD=0
for f in $FRONT; do git show "$PREV:$f" | cmp -s - "$WEB/$f" || { echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; }; done
[ "$BAD" -ne 0 ] && { echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; }
echo "Check OK: all live files match $PREV."
mkdir -p "$BK" && for f in $FRONT; do cp -p "$WEB/$f" "$BK/"; done && echo "Backup: $BK"
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "DONE (no restart needed). Press Ctrl+F5 on a shop page once."
echo "Undo (if ever needed): cp $BK/* $WEB/"
