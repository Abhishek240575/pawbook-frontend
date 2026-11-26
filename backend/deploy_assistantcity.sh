#!/bin/bash
# Assistant: when a location is chosen, show ONLY listings in that city (chosen area first) — never mix in other cities.
# If nothing is in that city, it says so and shows the closest elsewhere, clearly labelled. Backend only.
# The live controller is compared with the last deployed copy first; if it differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_assistantcity.sh
set -u
PREVS="3812088 b69c4ed"
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
BK=~/backup-assistantcity-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
BAD=0
for d in $DIRS; do M=0; for P in $PREVS; do git show "$P:backend/assistant.controller.js" | cmp -s - "$d/assistant.controller.js" && M=1; done; [ $M -eq 1 ] || { echo "  DIFFERS from $PREVS: $d/assistant.controller.js"; BAD=1; }; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do grep -q "(v20: assistant areas)" "$f" || { echo "  routes are not at v20 — run deploy_assistantloc.sh first: $f"; BAD=1; }; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: nothing was changed. Send me this output."; exit 1; fi
mkdir -p "$BK/src" "$BK/root"; cp -p "$API/src/controllers/assistant.controller.js" "$BK/src/"; cp -p "$API/controllers/assistant.controller.js" "$BK/root/"
for d in $DIRS; do cp "$REPO/backend/assistant.controller.js" "$d/"; done
OK=1; for d in $DIRS; do node --check "$d/assistant.controller.js" || OK=0; done
if [ "$OK" -ne 1 ]; then cp "$BK/src/assistant.controller.js" "$API/src/controllers/"; cp "$BK/root/assistant.controller.js" "$API/controllers/"; echo "Check failed; restored."; exit 1; fi
echo "DONE (backup in $BK). Now RESTART the app from the MilesWeb Node.js panel — the change only works after the restart."
echo "Undo (if ever needed): cp $BK/src/assistant.controller.js $API/src/controllers/ ; cp $BK/root/assistant.controller.js $API/controllers/"
