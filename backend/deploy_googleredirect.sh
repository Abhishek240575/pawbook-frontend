#!/bin/bash
# Google sign-in on phones / the Play Store app: Google's popup opens in a separate Chrome tab that cannot report back,
# so the app hung after choosing an account. Phones now use Google's REDIRECT sign-in (same screen -> Google -> back).
# Computers keep the popup. Adds POST /auth/google/redirect next to Google login (it reuses googleAuth unchanged).
# The login page also drops the Facebook code added earlier (Facebook left as it was).
# Backs up every file first and restores them if any step fails.
# Usage:  bash ~/pb-sync/backend/deploy_googleredirect.sh     (then restart the app in the MilesWeb Node.js panel)
set -u
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-googleredirect-$(date +%Y%m%d-%H%M%S)
F=01_login.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
# live login page must be either the original (bb252f4) or the Facebook version (c1b2829)
T1=$(mktemp); T2=$(mktemp); MATCH=""
norm < "$WEB/$F" > "$T2"
for P in bb252f4 c1b2829; do git show "$P:$F" | norm > "$T1"; cmp -s "$T1" "$T2" && { MATCH=$P; break; }; done
if [ -z "$MATCH" ]; then echo "STOPPED: $WEB/$F is not a version I know. Nothing was changed. Send me this output."; diff "$T1" "$T2" | head -20; rm -f "$T1" "$T2"; exit 1; fi
rm -f "$T1" "$T2"; echo "Live login page matches $MATCH"
mkdir -p "$BK" || { echo "Backup failed"; exit 1; }
cp -p "$WEB/$F" "$BK/" && cp -p "$API/src/controllers/auth.controller.js" "$BK/" && cp -p "$API/src/routes/index.js" "$BK/src_routes_index.js" || { echo "Backup failed"; exit 1; }
[ -f "$API/routes/index.js" ] && cp -p "$API/routes/index.js" "$BK/routes_index.js"
echo "Backup: $BK"
restore() {
  cp -p "$BK/auth.controller.js" "$API/src/controllers/auth.controller.js"
  cp -p "$BK/src_routes_index.js" "$API/src/routes/index.js"
  [ -f "$BK/routes_index.js" ] && cp -p "$BK/routes_index.js" "$API/routes/index.js"
  cp -p "$BK/$F" "$WEB/$F"
  echo "Everything restored from $BK — nothing changed."
}
node "$REPO/backend/add_google_redirect.js" || { echo "Route update failed."; restore; exit 1; }
for f in "$API/src/controllers/auth.controller.js" "$API/src/routes/index.js"; do node --check "$f" || { echo "Syntax check failed in $f."; restore; exit 1; }; done
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed."; restore; exit 1; }
echo
echo "DONE. Now:"
echo " 1) RESTART the app in the MilesWeb Node.js panel."
echo " 2) Check (expect: HTTP 303 and a location ending in #gerr=...):"
echo "    curl -s -o /dev/null -w 'HTTP %{http_code} -> %{redirect_url}\n' -X POST https://pawbook.deemona.com/api/v1/auth/google/redirect"
echo "Undo (if ever needed): cp $BK/auth.controller.js $API/src/controllers/ && cp $BK/src_routes_index.js $API/src/routes/index.js && cp $BK/$F $WEB/  (then restart)"
