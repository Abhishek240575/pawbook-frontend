#!/bin/bash
# Makes the home page's left side menu (07_home.html) scrollable on desktop. One page, no backend change.
# The live page is compared with the last deployed copy first; if it differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_sidebarscroll.sh
set -u
PREV=7343f88
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
F=07_home.html
BK=~/backup-sidebarscroll-$(date +%Y%m%d-%H%M%S)
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
[ -f "$WEB/$F" ] || { echo "Missing $WEB/$F"; exit 1; }
if cmp -s "$REPO/$F" "$WEB/$F"; then echo "Already up to date — nothing to do."; exit 0; fi
git show "$PREV:$F" | cmp -s - "$WEB/$F" || { echo "STOPPED: live $F is not what was deployed. Nothing was changed. Send me this output."; exit 1; }
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" && cp "$REPO/$F" "$WEB/$F"
grep -q "overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain" "$WEB/$F" && echo "DONE: side menu now scrolls. Refresh the home page (Ctrl+F5)." || { cp "$BK/$F" "$WEB/$F"; echo "Check failed; page restored."; exit 1; }
echo "Undo (if ever needed): cp $BK/$F $WEB/$F"
