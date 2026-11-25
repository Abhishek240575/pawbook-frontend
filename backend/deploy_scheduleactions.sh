#!/bin/bash
# Vet portal (page 41, also shown inside page 11): Move and Cancel buttons on upcoming appointments in the weekly Schedule.
# Frontend only. The live page is compared with the last deployed copy first; if it differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_scheduleactions.sh
set -u
PREV=bb252f4
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-scheduleactions-$(date +%Y%m%d-%H%M%S)
F=41_vet_portal.html
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git show "$PREV:$F" | cmp -s - "$WEB/$F" || { echo "STOPPED: $WEB/$F differs from $PREV. Nothing was changed. Send me this output."; exit 1; }
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" && cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed"; exit 1; }
echo "DONE: $F updated (backup in $BK). No restart needed — just reload the page."
echo "Undo (if ever needed): cp $BK/$F $WEB/"
