#!/bin/bash
# Pet Health (36) + Vaccination Diary (10): sample photos from the images you shared (served from img/pets/),
# a different set for each pet, and better dog/cat detection (e.g. "Dog ", "Puppy"). Frontend only, on top of 91e2f7b.
# Usage:  bash ~/pb-sync/backend/deploy_photos2.sh
set -u
PREV=91e2f7b
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-photos2-$(date +%Y%m%d-%H%M%S)
FRONT="36_pet_life_record.html 10_vaccination.html"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }
BAD=0
for f in $FRONT; do if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi; done
for f in "$REPO"/img/pets/*.jpg; do t="$WEB/img/pets/$(basename "$f")"; if [ -e "$t" ] && ! cmp -s "$f" "$t"; then echo "  already exists with other content: $t"; BAD=1; fi; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live pages match $PREV."
mkdir -p "$BK" && for f in $FRONT; do cp -p "$WEB/$f" "$BK/"; done && echo "Backup: $BK"
mkdir -p "$WEB/img/pets" && cp "$REPO"/img/pets/*.jpg "$WEB/img/pets/" && chmod 644 "$WEB"/img/pets/*.jpg && echo "Photos copied: $(ls "$WEB/img/pets" | wc -l) files in $WEB/img/pets"
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo
echo "DONE. No restart needed. Hard-refresh the pages (Ctrl+Shift+R)."
echo "Undo (if ever needed): cp $BK/*.html $WEB/"
