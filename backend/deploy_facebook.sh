#!/bin/bash
# Facebook login: connects the "Continue with Facebook" button on the login page (01) and adds POST /auth/facebook
# next to Google login in auth.controller.js (same checks: token verified with Facebook using the app secret in .env,
# suspended accounts blocked, same user + token + refresh as Google). The old unused src/routes/auth.facebook.js is left alone.
# Backs up every file first and restores them if any step fails.
# Usage:  bash ~/pb-sync/backend/deploy_facebook.sh     (then restart the app in the MilesWeb Node.js panel)
set -u
PREV=bb252f4
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-facebook-$(date +%Y%m%d-%H%M%S)
F=01_login.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
# 1. settings present? (names only — values are never printed)
for k in FB_APP_ID FB_APP_SECRET JWT_SECRET; do grep -q "^$k=." "$API/.env" || { echo "STOPPED: $k is missing in $API/.env. Nothing was changed."; exit 1; }; done
ID=$(grep -E '^FB_APP_ID=' "$API/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[ "$ID" = "2324747544987017" ] || { echo "STOPPED: FB_APP_ID in .env ($ID) is not the app id the login page uses (2324747544987017). Nothing was changed. Send me this output."; exit 1; }
echo "Facebook settings found in .env (app id matches the page)."
# 2. live login page must be the one I last saw
T1=$(mktemp); T2=$(mktemp)   # temp files (this server has no /dev/fd)
git show "$PREV:$F" | norm > "$T1"; norm < "$WEB/$F" > "$T2"
if ! cmp -s "$T1" "$T2"; then echo "STOPPED: $WEB/$F differs from $PREV. Nothing was changed. Send me this output."; diff "$T1" "$T2" | head -20; rm -f "$T1" "$T2"; exit 1; fi
rm -f "$T1" "$T2"
# 3. backups
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
# 4. server: add the handler + route, then syntax-check
node "$REPO/backend/add_facebook_auth.js" || { echo "Route update failed."; restore; exit 1; }
for f in "$API/src/controllers/auth.controller.js" "$API/src/routes/index.js"; do
  node --check "$f" || { echo "Syntax check failed in $f."; restore; exit 1; }
done
# 5. page
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed."; restore; exit 1; }
echo
echo "DONE. Now RESTART the app in the MilesWeb Node.js panel, then run this check (expect HTTP 401, not 404):"
echo "  curl -s -w ' HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{\"access_token\":\"test\"}' https://pawbook.deemona.com/api/v1/auth/facebook"
echo "Undo (if ever needed): cp $BK/auth.controller.js $API/src/controllers/ && cp $BK/src_routes_index.js $API/src/routes/index.js && cp $BK/$F $WEB/  (then restart)"
