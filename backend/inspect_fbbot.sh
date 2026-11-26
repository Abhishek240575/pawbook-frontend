#!/bin/bash
# Read-only: why does Facebook's checker get 403? Fetches pages as a normal browser and as Facebook's bot,
# and lists any bot/blocking rules in the site folder. Changes nothing.
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BR="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
echo "== status codes (browser / facebookexternalhit / Facebot / no user-agent) =="
for u in data-deletion.html legal.html robots.txt 01_login.html; do
  a=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -A "$BR" "https://pawbook.deemona.com/$u")
  b=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -A "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" "https://pawbook.deemona.com/$u")
  c=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -A "Facebot" "https://pawbook.deemona.com/$u")
  d=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -H "User-Agent:" "https://pawbook.deemona.com/$u")
  echo "  $u: $a / $b / $c / $d"
done
echo; echo "== what the 403 page says (first lines, as facebookexternalhit) =="
curl -s -m 20 -D - -A "facebookexternalhit/1.1" "https://pawbook.deemona.com/data-deletion.html" | sed -n '1,15p' | grep -iv "set-cookie"
echo; echo "== blocking rules in the site folder =="
for f in "$WEB/.htaccess" "$WEB/../.htaccess" "$WEB/.user.ini"; do [ -f "$f" ] && { echo "--- $f"; grep -niE "facebook|bot|agent|deny|forbid|F\]|RewriteCond|Require" "$f" | head -30; }; done
ls -la "$WEB" | grep -E "^\S+\s.*\s\.(htaccess|user\.ini)" || echo "  (no .htaccess / .user.ini in public_html)"
