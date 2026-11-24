#!/bin/bash
# PawBook post-deploy smoke test. Read-only: only GET requests, nothing is changed.
# Usage:  bash ~/pb-sync/backend/smoke.sh            (checks https://pawbook.deemona.com)
#         bash ~/pb-sync/backend/smoke.sh https://staging.example.com
set -u
SITE="${1:-https://pawbook.deemona.com}"
API="$SITE/api/v1"
PASS=0; FAIL=0
check() {  # check <expected-code> <url> [text that must appear]
  local want="$1" url="$2" must="${3:-}" body code
  body=$(curl -s -m 20 -w '\n%{http_code}' "$url" 2>/dev/null) || body=$'\n000'
  code="${body##*$'\n'}"; body="${body%$'\n'*}"
  if [ "$code" = "$want" ] && { [ -z "$must" ] || printf '%s' "$body" | grep -q -- "$must"; }; then
    PASS=$((PASS+1)); printf '  ok    %s  %s\n' "$code" "${url#$SITE}"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  %s  %s   (expected %s%s)\n' "$code" "${url#$SITE}" "$want" "${must:+ with \"$must\"}"
  fi
}
echo "Smoke test: $SITE"
echo "API"
check 200 "$API/shop/health" '"ok":true'
check 200 "$API/shop/categories"
check 200 "$API/shop/products?limit=1"
check 200 "$API/shop/brands"
check 200 "$API/shop/fulfilment-settings" 'return_window_days'
check 200 "$API/shop/sitemap.xml" '<urlset'
echo "API (login required — 401 is correct)"
for p in shop/cart shop/orders shop/returns shop/seller/me shop/seller/returns shop/admin/reports shop/admin/returns shop/admin/payouts; do check 401 "$API/$p"; done
echo "Pages"
for p in 01_login 07_home 42_shop 43_shop_list 44_shop_product 45_shop_brands 46_shop_brand 47_shop_compare 48_shop_admin 49_seller_join 50_seller_hub 51_seller_product 52_shop_checkout 53_shop_orders 54_shop_receipt; do check 200 "$SITE/$p.html"; done
check 200 "$SITE/shop.js" 'Shop'
check 200 "$SITE/seller-i18n.js" 'rt.receipt'
check 200 "$SITE/robots.txt" 'Sitemap:'
echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "ALL GOOD" || echo "Something is not right — send me this output."
exit $FAIL
