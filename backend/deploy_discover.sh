#!/bin/bash
# Discover page (26) redesign — look & layout only (Pet Life Record style). Every control, ID and the page's
# own script are unchanged; no backend change. Saves 3 Pexels photos to img/discover/ (the page falls back to Pexels).
# The live page is compared with the last deployed copy first; if it differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_discover.sh
set -u
PREV=bb252f4
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-discover-$(date +%Y%m%d-%H%M%S)
F=26_discover.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
T1=$(mktemp); T2=$(mktemp)   # temp files (this server has no /dev/fd)
git show "$PREV:$F" | norm > "$T1"; norm < "$WEB/$F" > "$T2"
if ! cmp -s "$T1" "$T2"; then echo "STOPPED: $WEB/$F differs from $PREV. Nothing was changed. Send me this output."; diff "$T1" "$T2" | head -20; rm -f "$T1" "$T2"; exit 1; fi
rm -f "$T1" "$T2"
mkdir -p "$BK" && cp -p "$WEB/$F" "$BK/" || { echo "Backup failed"; exit 1; }
echo "Backup: $BK"
mkdir -p "$WEB/img/discover"; GOT=0
for p in groomer:19145898 zoo:28735191 aquarium:4606188; do
  n=${p%%:*}; id=${p##*:}; t="$WEB/img/discover/$n.jpg"
  [ -s "$t" ] && { GOT=$((GOT+1)); continue; }
  if curl -sfL --max-time 40 "https://images.pexels.com/photos/$id/pexels-photo-$id.jpeg?auto=compress&cs=tinysrgb&w=1200" -o "$t.tmp" && head -c 3 "$t.tmp" | od -An -tx1 | grep -q "ff d8 ff"; then mv "$t.tmp" "$t"; chmod 644 "$t"; GOT=$((GOT+1)); else rm -f "$t.tmp"; echo "  note: could not save photo $n (the page will load it from Pexels)"; fi
done
echo "Photos saved: $GOT of 3"
for f in pets/dog-cat vet/vet-exam vet/vet-owner events/dog-park adopt/shelter-hug adopt/new-home-prep lost/missing-golden; do
  t="$WEB/img/$f.jpg"; [ -s "$t" ] || { mkdir -p "$(dirname "$t")"; cp "$REPO/img/$f.jpg" "$t" && chmod 644 "$t" && echo "  added photo img/$f.jpg"; }
done
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed"; exit 1; }
echo "DONE: $F updated. No restart needed — hard-refresh the page (Ctrl+Shift+R)."
echo "Undo (if ever needed): cp $BK/$F $WEB/"
