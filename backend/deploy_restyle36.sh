#!/bin/bash
# Safe deploy of the restyled Pet Health page (36) in the Animal Welfare look (Poppins, navy + coral, photo collage),
# plus pet photo gallery support in petcare.controller.js. On top of c736c60. No database change.
# Every live file is compared with the last deployed copy first. If ANY live file differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_restyle36.sh
set -u
PREV=c736c60
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-restyle36-$(date +%Y%m%d-%H%M%S)
FRONT="36_pet_life_record.html"
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do
  if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi
done
for d in $DIRS; do
  if ! git show "$PREV:backend/petcare.controller.js" | cmp -s - "$d/petcare.controller.js"; then echo "  DIFFERS from $PREV: $d/petcare.controller.js"; BAD=1; fi
done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
cp -p "$WEB/$FRONT" "$BK/web/"
cp -p "$API/src/controllers/petcare.controller.js" "$BK/api-src/"; cp -p "$API/controllers/petcare.controller.js" "$BK/api/"
echo "Backup: $BK"

# 3) Backend (one controller)
restore_backend() { cp "$BK/api-src/petcare.controller.js" "$API/src/controllers/"; cp "$BK/api/petcare.controller.js" "$API/controllers/"; }
for d in $DIRS; do cp "$REPO/backend/petcare.controller.js" "$d/petcare.controller.js"; done
if node --check "$API/src/controllers/petcare.controller.js" && node --check "$API/controllers/petcare.controller.js"; then echo "Backend file OK."
else echo "Syntax check failed; backend restored."; restore_backend; exit 1; fi

# 4) Frontend
cp "$REPO/$FRONT" "$WEB/$FRONT"
echo "Frontend updated: $FRONT"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "Undo (if ever needed): cp $BK/web/$FRONT $WEB/ ; cp $BK/api-src/petcare.controller.js $API/src/controllers/ ; cp $BK/api/petcare.controller.js $API/controllers/"
