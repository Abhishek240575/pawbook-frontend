#!/bin/bash
# Adds a public "Delete your PawBook data" page for Facebook's "User data deletion" setting:
#   https://pawbook.deemona.com/data-deletion.html
# New file only — nothing existing is changed. No restart needed.
# Usage:  bash ~/pb-sync/backend/deploy_datadeletion.sh
set -u
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
F=data-deletion.html
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
if [ -e "$WEB/$F" ] && ! cmp -s "$REPO/$F" "$WEB/$F"; then echo "STOPPED: $WEB/$F already exists and is different. Nothing was changed. Send me this output."; exit 1; fi
cp "$REPO/$F" "$WEB/$F" && chmod 644 "$WEB/$F" || { echo "Copy failed"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "https://pawbook.deemona.com/$F")
echo "DONE: https://pawbook.deemona.com/$F (check: HTTP $code — should be 200)"
echo "Undo (if ever needed): rm $WEB/$F"
