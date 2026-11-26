#!/bin/bash
# Assistant (page 35) + Google Maps on the server: when someone asks for vets / shelters / groomers / boarding /
# pet shops near the chosen location, nearby places come from Google Places API (New), nearest first, with
# distance, open-now, rating, Directions and Call — shown live with Google Maps attribution, never stored.
# PawBook vets in that city still come first. Uses the Google key already in .env (never printed). No database change.
# Daily cap: PB_GOOGLE_DAILY_CAP (default 300 Google calls/day). PB_GOOGLE_PLACES=0 turns it off.
# Usage:  bash ~/pb-sync/backend/deploy_assistantgoogle.sh
set -u
PREVS="a29ad1e 3812088 b69c4ed"
PREV35=b69c4ed
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-assistantgoogle-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
BAD=0
for d in $DIRS; do M=0; for P in $PREVS; do git show "$P:backend/assistant.controller.js" | cmp -s - "$d/assistant.controller.js" && M=1; done; [ $M -eq 1 ] || { echo "  DIFFERS from $PREVS: $d/assistant.controller.js"; BAD=1; }; done
git show "$PREV35:35_ai_agent.html" | cmp -s - "$WEB/35_ai_agent.html" || { echo "  DIFFERS from $PREV35: $WEB/35_ai_agent.html"; BAD=1; }
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do grep -q "(v20: assistant areas)" "$f" || { echo "  routes are not at v20 — run deploy_assistantloc.sh first: $f"; BAD=1; }; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: nothing was changed. Send me this output."; exit 1; fi
echo "Check OK."
echo "Testing the Google key in .env from this server (the key itself is never shown):"
node "$REPO/backend/check_google_key.js" "$API/.env"
mkdir -p "$BK/src" "$BK/root" "$BK/web"
cp -p "$API/src/controllers/assistant.controller.js" "$BK/src/"; cp -p "$API/controllers/assistant.controller.js" "$BK/root/"; cp -p "$WEB/35_ai_agent.html" "$BK/web/"
for d in $DIRS; do cp "$REPO/backend/assistant.controller.js" "$d/"; done
OK=1; for d in $DIRS; do node --check "$d/assistant.controller.js" || OK=0; done
if [ "$OK" -ne 1 ]; then cp "$BK/src/assistant.controller.js" "$API/src/controllers/"; cp "$BK/root/assistant.controller.js" "$API/controllers/"; echo "Check failed; restored."; exit 1; fi
cp "$REPO/35_ai_agent.html" "$WEB/35_ai_agent.html"
echo "DONE (backup in $BK). Now RESTART the app from the MilesWeb Node.js panel."
echo "If the key test above says FAILED, send me that line — the assistant still works, just without Google places."
echo "Undo (if ever needed): cp $BK/src/assistant.controller.js $API/src/controllers/ ; cp $BK/root/assistant.controller.js $API/controllers/ ; cp $BK/web/35_ai_agent.html $WEB/"
