#!/bin/bash
# My PawBook → My Journey: every category shows its count (0 included); an empty category explains what goes there and links to it;
# Lost & found now includes missing-pet alerts, found-pet reports and sightings from Lost & Found 2.0; Pet care adds weigh-ins,
# medicines, vitals and symptom checks. Changes 31_saved.html and mypawbook.controller.js. Usage: bash ~/pb-sync/backend/deploy_journeyfix.sh
set -u
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-journeyfix-$(date +%Y%m%d-%H%M%S)
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
BAD=0
git show bb252f4:31_saved.html | cmp -s - "$WEB/31_saved.html" || { echo "  DIFFERS from bb252f4: $WEB/31_saved.html"; BAD=1; }
for d in "$API/src/controllers" "$API/controllers"; do git show b1a12d7:backend/mypawbook.controller.js | cmp -s - "$d/mypawbook.controller.js" || { echo "  DIFFERS from b1a12d7: $d/mypawbook.controller.js"; BAD=1; }; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
mkdir -p "$BK/web" "$BK/src" "$BK/api"
cp -p "$WEB/31_saved.html" "$BK/web/"; cp -p "$API/src/controllers/mypawbook.controller.js" "$BK/src/"; cp -p "$API/controllers/mypawbook.controller.js" "$BK/api/"
cp "$REPO/backend/mypawbook.controller.js" "$API/src/controllers/"; cp "$REPO/backend/mypawbook.controller.js" "$API/controllers/"
if ! node --check "$API/src/controllers/mypawbook.controller.js"; then cp "$BK/src/mypawbook.controller.js" "$API/src/controllers/"; cp "$BK/api/mypawbook.controller.js" "$API/controllers/"; echo "Syntax check failed; restored."; exit 1; fi
cp "$REPO/31_saved.html" "$WEB/31_saved.html"
echo "DONE. Restart the app from the MilesWeb Node.js panel, then open My PawBook → My Journey."
echo "Undo: cp $BK/web/31_saved.html $WEB/ ; cp $BK/src/mypawbook.controller.js $API/src/controllers/ ; cp $BK/api/mypawbook.controller.js $API/controllers/"
