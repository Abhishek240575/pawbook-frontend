#!/bin/bash
# Assistant (page 35): location picker — Country → State → City/district → Area → PIN code (India Post list),
# "use my current location", and nearby-first results in chat. Search learns a browse mode. Routes v20 (adds /assistant/areas).
# No database change. Live files are compared with the last deployed copy first; if any differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_assistantloc.sh
set -u
PREV=3782dd5
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-assistantloc-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
BAD=0
git show "$PREV:35_ai_agent.html" | cmp -s - "$WEB/35_ai_agent.html" || { echo "  DIFFERS from $PREV: $WEB/35_ai_agent.html"; BAD=1; }
for d in $DIRS; do for c in assistant search; do git show "$PREV:backend/$c.controller.js" | cmp -s - "$d/$c.controller.js" || { echo "  DIFFERS from $PREV: $d/$c.controller.js"; BAD=1; }; done; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do grep -q "(v19: assistant)" "$f" && grep -q "asRouter" "$f" || { echo "  routes are not at v19 (assistant): $f"; BAD=1; }; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK."
mkdir -p "$BK/web" "$BK/api-src" "$BK/api" "$BK/ctrl-src" "$BK/ctrl"
cp -p "$WEB/35_ai_agent.html" "$BK/web/"; cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
for c in assistant search; do cp -p "$API/src/controllers/$c.controller.js" "$BK/ctrl-src/"; cp -p "$API/controllers/$c.controller.js" "$BK/ctrl/"; done
echo "Backup: $BK"
restore_backend() { cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; cp "$BK/ctrl-src/"*.js "$API/src/controllers/"; cp "$BK/ctrl/"*.js "$API/controllers/"; }
for d in $DIRS; do cp "$REPO/backend/assistant.controller.js" "$REPO/backend/search.controller.js" "$d/"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
OK=1
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do node --check "$f" || OK=0; grep -q "(v20: assistant areas)" "$f" && grep -q "asCtrl.areas" "$f" && grep -q "srRouter" "$f" && grep -q "cmRouter" "$f" && grep -q "lfRouter" "$f" || OK=0; done
for d in $DIRS; do node --check "$d/assistant.controller.js" || OK=0; node --check "$d/search.controller.js" || OK=0; done
if [ "$OK" -eq 1 ]; then echo "Backend files OK."; else echo "Check failed; backend restored."; restore_backend; exit 1; fi
# India Post PIN directory used by the picker (same file as page 36); copied only if missing
[ -s "$WEB/pawbook-in-locations.json" ] || { cp "$REPO/pawbook-in-locations.json" "$WEB/" && chmod 644 "$WEB/pawbook-in-locations.json" && echo "  added pawbook-in-locations.json"; }
cp "$REPO/35_ai_agent.html" "$WEB/35_ai_agent.html"
echo "Frontend updated: 35_ai_agent.html"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/assistant/areas   (401 = live)"
echo "Undo (if ever needed): cp $BK/web/35_ai_agent.html $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; cp $BK/ctrl-src/*.js $API/src/controllers/ ; cp $BK/ctrl/*.js $API/controllers/"
