#!/bin/bash
# Safe deploy: checkout note text + version tags on shop/seller page scripts (stops stale browser caches).
# A page is updated ONLY if the live copy is identical to the last deployed version (PREV).
# Pages that were changed on the server are left untouched and listed at the end.
# Usage:  bash ~/pb-sync/backend/deploy_cachefix.sh
set -u
PREV=5d1467f
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-cachefix-$(date +%Y%m%d-%H%M%S)
FILES="42_shop.html 43_shop_list.html 44_shop_product.html 45_shop_brands.html 46_shop_brand.html 47_shop_compare.html 48_shop_admin.html 49_seller_join.html 50_seller_hub.html 51_seller_product.html 52_shop_checkout.html 53_shop_orders.html shop-i18n.js "

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }
mkdir -p "$BK"
OK=0; SKIP=""; MISS=""
for f in $FILES; do
  if [ ! -e "$WEB/$f" ]; then MISS="$MISS $f"; continue; fi
  if git show "$PREV:$f" | cmp -s - "$WEB/$f"; then cp -p "$WEB/$f" "$BK/" && cp "$REPO/$f" "$WEB/$f" && OK=$((OK+1))
  else SKIP="$SKIP $f"; fi
done
echo "Backup of replaced pages: $BK"
echo "Updated: $OK page(s)"
[ -n "$SKIP" ] && echo "NOT updated (changed on the server since last deploy, left as is):$SKIP"
[ -n "$MISS" ] && echo "NOT on live site (skipped):$MISS"
echo "Undo (if ever needed): cp $BK/* $WEB/"
echo "No restart needed (pages only). Press Ctrl+Shift+R in the browser."
