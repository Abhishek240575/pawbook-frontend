#!/bin/bash
# PawBook AI widget (the round 🤖 button on 38 pages) gets a new brain:
#  - signed-in people get the real PawBook Assistant: their pets, vaccines due, appointments, real listings,
#    places near them from Google Maps, support requests (and Claude, if the server has the AI key)
#  - reminders badge on the button, page-aware greeting and suggestions, location picker, thumbs up/down
#  - guests / no network: safe built-in answers; emergencies answered instantly; no fake demo sign-in or made-up numbers
# Frontend only — the widget file + the 38 pages that load it (only their ?v=5 -> ?v=6 changes). No restart needed.
# Usage:  bash ~/pb-sync/backend/deploy_aiwidget.sh
set -u
PREVW="bb252f4 6e5ebb2"           # widget as last deployed (either is fine)
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-aiwidget-$(date +%Y%m%d-%H%M%S)
W=pawbook-ai-widget.v4.js
OLDV='pawbook-ai-widget.v4.js?v=5'
NEWV='pawbook-ai-widget.v4.js?v=6'
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
grep -q "v5-20261126-assistant" "$REPO/$W" || { echo "STOPPED: the repo does not have the new widget yet (git pull?). Nothing was changed."; exit 1; }

# 1) the live widget must be one we deployed
T1=$(mktemp); T2=$(mktemp); OKW=0   # temp files (this server has no /dev/fd)
norm < "$WEB/$W" > "$T2"
for c in $PREVW; do git show "$c:$W" | norm > "$T1"; cmp -s "$T1" "$T2" && OKW=1; done
norm < "$REPO/$W" > "$T1"; cmp -s "$T1" "$T2" && OKW=2
rm -f "$T1" "$T2"
[ "$OKW" -eq 0 ] && { echo "STOPPED: the live $W is not the one that was deployed. Nothing was changed. Send me this output."; exit 1; }

# 2) the pages: each live page must load the widget exactly once (v5, or v6 if already done)
PAGES=$(cd "$REPO" && grep -l "$NEWV" *.html)
BAD=0; TODO=""
for f in $PAGES; do
  [ -f "$WEB/$f" ] || { echo "  (not on the live site, skipped: $f)"; continue; }
  n5=$(grep -o -F "$OLDV" "$WEB/$f" | wc -l); n6=$(grep -o -F "$NEWV" "$WEB/$f" | wc -l)
  if [ "$n5" -eq 1 ] && [ "$n6" -eq 0 ]; then TODO="$TODO $f"
  elif [ "$n5" -eq 0 ] && [ "$n6" -eq 1 ]; then :   # already done
  else echo "  UNEXPECTED in $f: v5 x$n5, v6 x$n6"; BAD=1; fi
done
[ "$BAD" -ne 0 ] && { echo "STOPPED: some live pages are not as expected. Nothing was changed. Send me this output."; exit 1; }

# 3) back up, then change
mkdir -p "$BK" && cp -p "$WEB/$W" "$BK/" || { echo "Backup failed"; exit 1; }
for f in $TODO; do cp -p "$WEB/$f" "$BK/" || { echo "Backup failed: $f"; exit 1; }; done
restore() { echo "$1 — restoring the backup"; cp -p "$BK"/* "$WEB/"; exit 1; }
cp "$REPO/$W" "$WEB/$W" || restore "Copy failed: $W"
N=0
for f in $TODO; do
  sed -i "s/pawbook-ai-widget\.v4\.js?v=5/pawbook-ai-widget.v4.js?v=6/" "$WEB/$f" || restore "Edit failed: $f"
  grep -q -F "$NEWV" "$WEB/$f" || restore "Check failed: $f"
  N=$((N+1))
done
echo "DONE: new AI widget is live; $N page(s) now load it as ?v=6 (others were already done). No restart needed."
echo "Check: open any page, tap the 🤖 button — the header shows 'Signed in' or 'Guest mode' and a 📍 location chip."
echo "Undo (if ever needed): cp $BK/* $WEB/"
