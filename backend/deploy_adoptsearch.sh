#!/bin/bash
# Adoption page (39), "Shelters & help near you": adds "Search your area or PIN code" above the dropdowns.
#  - Typing an area (e.g. Dwarka) or a PIN (e.g. 110075) finds it in the India Post list whatever district it is in.
#  - Localities without their own post office (e.g. Dwarka Sector 10) are suggested from Google Maps and placed in
#    the right district with their PIN. Frontend only (page + adopt-loc/index.json). No restart needed.
# Usage:  bash ~/pb-sync/backend/deploy_adoptsearch.sh
set -u
PREV=83c6430
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-adoptsearch-$(date +%Y%m%d-%H%M%S)
F=39_adoption_matching.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
T1=$(mktemp); T2=$(mktemp)   # temp files (this server has no /dev/fd)
norm < "$WEB/$F" > "$T2"
git show "bb252f4:$F" | norm > "$T1"
if cmp -s "$T1" "$T2"; then rm -f "$T1" "$T2"; echo "STOPPED: the adoption guide is not deployed yet. Run deploy_adoptguide.sh instead — it now includes this search. Nothing was changed."; exit 1; fi
git show "$PREV:$F" | norm > "$T1"
if ! cmp -s "$T1" "$T2"; then echo "STOPPED: $WEB/$F differs from $PREV. Nothing was changed. Send me this output."; diff "$T1" "$T2" | head -20; rm -f "$T1" "$T2"; exit 1; fi
rm -f "$T1" "$T2"
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" && cp -p "$WEB/adopt-loc/index.json" "$BK/" || { echo "Backup failed"; exit 1; }
echo "Backup: $BK"
cp "$REPO/adopt-loc/index.json" "$WEB/adopt-loc/index.json" && chmod 644 "$WEB/adopt-loc/index.json" || { echo "Copy failed"; exit 1; }
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed — restoring"; cp -p "$BK/index.json" "$WEB/adopt-loc/"; exit 1; }
echo "DONE: area / PIN search added. No restart needed — press Ctrl+F5 on the adoption page once."
echo "Undo (if ever needed): cp $BK/$F $WEB/ ; cp $BK/index.json $WEB/adopt-loc/"
