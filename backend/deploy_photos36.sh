#!/bin/bash
# Safe deploy: Pet Health page (36) shows free-licence sample photos (Pexels) while a pet has no photo of its own.
# Frontend only, on top of 7d5999b. If the live page differs from what was deployed, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_photos36.sh
set -u
PREV=7d5999b
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-photos36-$(date +%Y%m%d-%H%M%S)
FRONT="36_pet_life_record.html"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }
if ! git show "$PREV:$FRONT" | cmp -s - "$WEB/$FRONT"; then echo "  DIFFERS from $PREV: $WEB/$FRONT"; echo "STOPPED: live page is not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live page matches $PREV."
mkdir -p "$BK" && cp -p "$WEB/$FRONT" "$BK/" && echo "Backup: $BK"
cp "$REPO/$FRONT" "$WEB/$FRONT" && echo "Frontend updated: $FRONT"
echo
echo "DONE. No restart needed. Hard-refresh the Pet Health page (Ctrl+Shift+R)."
echo "Undo (if ever needed): cp $BK/$FRONT $WEB/"
