#!/bin/bash
# Find a Vet (page 11): the India location filter now lists ALL 36 states & UTs, every district, and every area
# with its PIN code (India Post list — the same one Adopt a pet uses, in adopt-loc/). Choosing an area searches vets
# around that exact place. Other countries are unchanged. Frontend only — no restart needed.
# Usage:  bash ~/pb-sync/backend/deploy_vetlocations.sh
set -u
PREV=a0ad02d            # 11_vet_booking.html as last deployed (deploy_assistantshop.sh, widget ?v=8)
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-vetlocations-$(date +%Y%m%d-%H%M%S)
F=11_vet_booking.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
grep -q "_inFillStates" "$REPO/$F" || { echo "STOPPED: the repo doesn't have the new page yet (git pull?). Nothing was changed."; exit 1; }
[ -f "$WEB/adopt-loc/index.json" ] && [ -f "$WEB/adopt-loc/delhi.json" ] || { echo "STOPPED: the India area list (adopt-loc/) is not on the live site — run deploy_adoptsearch.sh first. Nothing was changed."; exit 1; }
T1=$(mktemp); T2=$(mktemp)   # temp files (this server has no /dev/fd)
git show "$PREV:$F" | norm > "$T1"; norm < "$WEB/$F" > "$T2"
if ! cmp -s "$T1" "$T2"; then norm < "$REPO/$F" > "$T1"; cmp -s "$T1" "$T2" && { rm -f "$T1" "$T2"; echo "Already done — nothing to change."; exit 0; }
  rm -f "$T1" "$T2"; echo "STOPPED: the live $F is not what was deployed ($PREV). Nothing was changed. Send me this output."; exit 1; fi
rm -f "$T1" "$T2"
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" || { echo "Backup failed"; exit 1; }
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed — restoring"; cp -p "$BK/$F" "$WEB/"; exit 1; }
echo "DONE: Find a Vet now lists every Indian state, district and area (with PIN). No restart needed."
echo "Undo (if ever needed): cp $BK/$F $WEB/"
