#!/bin/bash
# Communities search fix (page 03): the Search button and Enter key now run the search with visible feedback,
# search matches word by word and tolerates small spelling mistakes ("German Sepherd" finds "German Shepherd"),
# and an empty result offers "Search all of India" and a pre-filled "Create" button.
# No database change. Live files are compared with the last deployed copy first; if any differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_communitysearch.sh
set -u
PREV=85a5957
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-communitysearch-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
BAD=0
git show "$PREV:03_groups.html" | cmp -s - "$WEB/03_groups.html" || { echo "  DIFFERS from $PREV: $WEB/03_groups.html"; BAD=1; }
for d in $DIRS; do git show "$PREV:backend/communities.controller.js" | cmp -s - "$d/communities.controller.js" || { echo "  DIFFERS from $PREV: $d/communities.controller.js"; BAD=1; }; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK."
mkdir -p "$BK/ctrl-src" "$BK/ctrl" "$BK/web"
cp -p "$WEB/03_groups.html" "$BK/web/"; cp -p "$API/src/controllers/communities.controller.js" "$BK/ctrl-src/"; cp -p "$API/controllers/communities.controller.js" "$BK/ctrl/"
echo "Backup: $BK"
for d in $DIRS; do cp "$REPO/backend/communities.controller.js" "$d/"; done
OK=1; for d in $DIRS; do node --check "$d/communities.controller.js" || OK=0; done
if [ "$OK" -ne 1 ]; then cp "$BK/ctrl-src/communities.controller.js" "$API/src/controllers/"; cp "$BK/ctrl/communities.controller.js" "$API/controllers/"; echo "Check failed; backend restored."; exit 1; fi
cp "$REPO/03_groups.html" "$WEB/03_groups.html"
echo "DONE. Now restart the app from the MilesWeb Node.js panel."
echo "Undo (if ever needed): cp $BK/web/03_groups.html $WEB/ ; cp $BK/ctrl-src/communities.controller.js $API/src/controllers/ ; cp $BK/ctrl/communities.controller.js $API/controllers/"
