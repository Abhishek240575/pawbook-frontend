#!/bin/bash
# Nearby help on page 37: area-aware Google Maps search, clear error messages from Google, and better matching of
# PawBook shelters/vets (other city spellings such as Delhi/New Delhi, Bangalore/Bengaluru; area first; state fallback).
# Changes 37_pet_ai_health_agent.html and healthagent.controller.js only. Usage:  bash ~/pb-sync/backend/deploy_nearbyfix.sh
set -u
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-nearbyfix-$(date +%Y%m%d-%H%M%S)
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
BAD=0
git show bb252f4:37_pet_ai_health_agent.html | cmp -s - "$WEB/37_pet_ai_health_agent.html" || { echo "  DIFFERS from bb252f4: $WEB/37_pet_ai_health_agent.html"; BAD=1; }
for d in "$API/src/controllers" "$API/controllers"; do git show 7343f88:backend/healthagent.controller.js | cmp -s - "$d/healthagent.controller.js" || { echo "  DIFFERS from 7343f88: $d/healthagent.controller.js"; BAD=1; }; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
mkdir -p "$BK/web" "$BK/src" "$BK/api"
cp -p "$WEB/37_pet_ai_health_agent.html" "$BK/web/"; cp -p "$API/src/controllers/healthagent.controller.js" "$BK/src/"; cp -p "$API/controllers/healthagent.controller.js" "$BK/api/"
cp "$REPO/backend/healthagent.controller.js" "$API/src/controllers/healthagent.controller.js"; cp "$REPO/backend/healthagent.controller.js" "$API/controllers/healthagent.controller.js"
if ! node --check "$API/src/controllers/healthagent.controller.js"; then cp "$BK/src/healthagent.controller.js" "$API/src/controllers/"; cp "$BK/api/healthagent.controller.js" "$API/controllers/"; echo "Syntax check failed; restored."; exit 1; fi
cp "$REPO/37_pet_ai_health_agent.html" "$WEB/37_pet_ai_health_agent.html"
echo "DONE. Restart the app from the MilesWeb Node.js panel, then open page 37 → Nearby help."
echo "Undo: cp $BK/web/37_pet_ai_health_agent.html $WEB/ ; cp $BK/src/healthagent.controller.js $API/src/controllers/ ; cp $BK/api/healthagent.controller.js $API/controllers/"
