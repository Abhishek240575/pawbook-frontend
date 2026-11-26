#!/bin/bash
# Assistant (page 35): nearby vets / shelters / groomers / boarding / pet shops from Google Maps, looked up IN THE BROWSER
# with the website's Maps key (the same key the other pages use — it is locked to the website, so the server can't use it).
# The server decides what to look for and where; the page shows the places under the reply with Google Maps attribution.
# A server key (GOOGLE_MAPS_SERVER_KEY, IP-restricted) is still used first if one that works is ever added. No database change.
# Usage:  bash ~/pb-sync/backend/deploy_assistantgmaps.sh
set -u
PREVS="5a8ac52"
PREV35=5a8ac52
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-assistantgmaps-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
BAD=0
for d in $DIRS; do M=0; for P in $PREVS; do git show "$P:backend/assistant.controller.js" | cmp -s - "$d/assistant.controller.js" && M=1; done; [ $M -eq 1 ] || { echo "  DIFFERS from $PREVS: $d/assistant.controller.js"; BAD=1; }; done
git show "$PREV35:35_ai_agent.html" | cmp -s - "$WEB/35_ai_agent.html" || { echo "  DIFFERS from $PREV35: $WEB/35_ai_agent.html"; BAD=1; }
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do grep -q "(v20: assistant areas)" "$f" || { echo "  routes are not at v20 — run deploy_assistantloc.sh first: $f"; BAD=1; }; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: nothing was changed. Send me this output."; exit 1; fi
echo "Check OK."
mkdir -p "$BK/src" "$BK/root" "$BK/web"
cp -p "$API/src/controllers/assistant.controller.js" "$BK/src/"; cp -p "$API/controllers/assistant.controller.js" "$BK/root/"; cp -p "$WEB/35_ai_agent.html" "$BK/web/"
for d in $DIRS; do cp "$REPO/backend/assistant.controller.js" "$d/"; done
OK=1; for d in $DIRS; do node --check "$d/assistant.controller.js" || OK=0; done
if [ "$OK" -ne 1 ]; then cp "$BK/src/assistant.controller.js" "$API/src/controllers/"; cp "$BK/root/assistant.controller.js" "$API/controllers/"; echo "Check failed; restored."; exit 1; fi
cp "$REPO/35_ai_agent.html" "$WEB/35_ai_agent.html"
echo "DONE (backup in $BK). Now RESTART the app from the MilesWeb Node.js panel."
echo "Undo (if ever needed): cp $BK/src/assistant.controller.js $API/src/controllers/ ; cp $BK/root/assistant.controller.js $API/controllers/ ; cp $BK/web/35_ai_agent.html $WEB/"
