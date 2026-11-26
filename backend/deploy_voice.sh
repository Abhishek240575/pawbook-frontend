#!/bin/bash
# Voice Assistant (page 40) becomes real, and an AI-widget style fix.
#  - page 40: real listening (Chrome/Edge/Android) in Hinglish, English, Hindi, Bengali, Telugu, Tamil or Marathi; answers
#    from the same PawBook Assistant as the 🤖 widget (your pets, vaccines due, vets near you, shop, orders, adoption);
#    replies read aloud; your own pets instead of the made-up "Rocky & Mittens"; real recent questions and "coming up".
#  - widget: its card/button styles no longer change boxes on Pet Travel (24), Stories (27) and the Voice page (40).
# Frontend only — no restart needed. Pages 11 / 01 changes are separate scripts.
# Usage:  bash ~/pb-sync/backend/deploy_voice.sh
set -u
PREVW=a0ad02d            # widget + page 40 as last deployed (deploy_assistantshop.sh, ?v=8)
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-voice-$(date +%Y%m%d-%H%M%S)
W=pawbook-ai-widget.v4.js
V=40_voice_pet_assistant.html
NEWV='pawbook-ai-widget.v4.js?v=9"'
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
grep -q "pbAI.kit" "$REPO/$W" || { echo "STOPPED: the repo doesn't have the new files yet (git pull?). Nothing was changed."; exit 1; }
T1=$(mktemp); T2=$(mktemp); BAD=0   # temp files (this server has no /dev/fd)
for f in $W $V; do git show "$PREVW:$f" | norm > "$T1"; norm < "$WEB/$f" > "$T2"; cmp -s "$T1" "$T2" || { echo "  DIFFERS from $PREVW: $WEB/$f"; BAD=1; }; done
rm -f "$T1" "$T2"
PAGES=$(cd "$REPO" && grep -l -F "$NEWV" *.html); TODO=""
for f in $PAGES; do
  [ "$f" = "$V" ] && continue
  [ -f "$WEB/$f" ] || { echo "  (not on the live site, skipped: $f)"; continue; }
  nold=$(grep -o -E 'pawbook-ai-widget\.v4\.js\?v=[5678]"' "$WEB/$f" | wc -l); nnew=$(grep -o -F "$NEWV" "$WEB/$f" | wc -l)
  if [ "$nold" -eq 1 ] && [ "$nnew" -eq 0 ]; then TODO="$TODO $f"
  elif [ "$nold" -eq 0 ] && [ "$nnew" -eq 1 ]; then :
  else echo "  UNEXPECTED in $f: old x$nold, v9 x$nnew"; BAD=1; fi
done
[ "$BAD" -ne 0 ] && { echo "STOPPED: nothing was changed. Send me this output."; exit 1; }
echo "Check OK."
mkdir -p "$BK" && cp -p "$WEB/$W" "$WEB/$V" "$BK/" || { echo "Backup failed"; exit 1; }
for f in $TODO; do cp -p "$WEB/$f" "$BK/" || { echo "Backup failed: $f"; exit 1; }; done
restore() { echo "$1 — restoring the backup"; cp -p "$BK/"* "$WEB/"; exit 1; }
cp "$REPO/$W" "$WEB/$W" || restore "Copy failed: $W"
cp "$REPO/$V" "$WEB/$V" || restore "Copy failed: $V"
N=0
for f in $TODO; do
  sed -i -E 's/pawbook-ai-widget\.v4\.js\?v=[5678]"/pawbook-ai-widget.v4.js?v=9"/' "$WEB/$f" || restore "Edit failed: $f"
  grep -q -F "$NEWV" "$WEB/$f" || restore "Check failed: $f"; N=$((N+1))
done
echo "DONE: Voice Assistant is live, widget fixed ($N other page(s) now load it as ?v=9). No restart needed."
echo "Try it: open 40_voice_pet_assistant.html in Chrome, tap the mic and ask: when is my pet's vaccine due?"
echo "Undo (if ever needed): cp $BK/* $WEB/"
