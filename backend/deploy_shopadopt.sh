#!/bin/bash
# Shop header "Adopt" tab and shop footer "Adopt" link now open Adoption Matching (39_adoption_matching.html)
# instead of the old adoption page (04). Frontend only — shop.js. No restart needed.
# Usage:  bash ~/pb-sync/backend/deploy_shopadopt.sh
set -u
PREV=5e8ea72
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-shopadopt-$(date +%Y%m%d-%H%M%S)
F=shop.js
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
T1=$(mktemp); T2=$(mktemp)   # temp files (this server has no /dev/fd)
git show "$PREV:$F" | norm > "$T1"; norm < "$WEB/$F" > "$T2"
if ! cmp -s "$T1" "$T2"; then echo "STOPPED: $WEB/$F differs from $PREV. Nothing was changed. Send me this output."; diff "$T1" "$T2" | head -20; rm -f "$T1" "$T2"; exit 1; fi
rm -f "$T1" "$T2"
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" || { echo "Backup failed"; exit 1; }
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed"; exit 1; }
echo "DONE: shop Adopt links now open 39_adoption_matching.html. No restart needed — press Ctrl+F5 on a shop page once."
echo "Undo (if ever needed): cp $BK/$F $WEB/"
