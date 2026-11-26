#!/bin/bash
# Meal Planner page (23): dish photos — every dish in the plan, the meal picker, the recipe cards and the recipe /
# meal windows shows a photo of its main ingredient. Page look only: the page's own script and all controls are
# unchanged; no backend change. Includes the earlier redesign, so it works whether or not deploy_nutrition.sh was run.
# Saves 21 food photos to img/food/ (Pexels, free licence; the page falls back to Pexels if one is missing).
# The live page is compared with the last deployed copy first; if it differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_nutritionphotos.sh
set -u
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-nutritionphotos-$(date +%Y%m%d-%H%M%S)
F=23_nutrition.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
T1=$(mktemp); T2=$(mktemp); MATCH=""   # temp files (this server has no /dev/fd)
norm < "$WEB/$F" > "$T2"
for PREV in 1ae2212 bb252f4; do git show "$PREV:$F" | norm > "$T1"; cmp -s "$T1" "$T2" && { MATCH=$PREV; break; }; done
if [ -z "$MATCH" ]; then echo "STOPPED: $WEB/$F differs from both 1ae2212 and bb252f4. Nothing was changed. Send me this output."; diff "$T1" "$T2" | head -20; rm -f "$T1" "$T2"; exit 1; fi
rm -f "$T1" "$T2"; echo "Live page matches $MATCH"
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" || { echo "Backup failed"; exit 1; }
echo "Backup: $BK"
save() {  # dir name id
  local t="$WEB/img/$1/$2.jpg"; mkdir -p "$WEB/img/$1"; [ -s "$t" ] && return 0
  if curl -sfL --max-time 40 "https://images.pexels.com/photos/$3/pexels-photo-$3.jpeg?auto=compress&cs=tinysrgb&w=900" -o "$t.tmp" && head -c 3 "$t.tmp" | od -An -tx1 | grep -q "ff d8 ff"; then mv "$t.tmp" "$t"; chmod 644 "$t"; else rm -f "$t.tmp"; echo "  note: could not save photo $1/$2 (the page will load it from Pexels)"; return 1; fi
}
GOT=0; for p in apple:6368799 berries:7024 carrot:2452277 chicken:24738519 egg:7243349 fish:3029526 fruit:1161682 greens:2095569 hay:7192754 lentil:6120506 oats:16144160 peanut:5149349 pumpkin:30462273 seeds:28552092 shrimp:566344 stew:1618952 strawberry:4038780 sweetpotato:6060223 tofu:4518587 veg:3872367 yogurt:10421049 ; do save food ${p%%:*} ${p##*:} && GOT=$((GOT+1)); done
echo "Dish photos saved: $GOT of 21"
for p in dog-meal:6568944 cat-treat:29252264 bowl:4432260 dog-bowl:8434670 brown-dog:7086030; do save nutrition ${p%%:*} ${p##*:}; done
for f in vet/vet-owner; do
  t="$WEB/img/$f.jpg"; [ -s "$t" ] || { mkdir -p "$(dirname "$t")"; cp "$REPO/img/$f.jpg" "$t" && chmod 644 "$t" && echo "  added photo img/$f.jpg"; }
done
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed"; exit 1; }
echo "DONE: $F updated. No restart needed — hard-refresh the page (Ctrl+Shift+R)."
echo "Undo (if ever needed): cp $BK/$F $WEB/"
