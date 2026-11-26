#!/bin/bash
# The Assistant and the AI widget now answer adoption questions — documents, rules, policy/fees and the law
# (housing societies, licences, community dogs) — from the same official text shown on Adopt a pet (page 39),
# instead of guessing. The AI gets that text too. No database change.
#  - backend: assistant.controller.js (needs a RESTART)
#  - frontend: the AI widget + the 38 pages that load it (only their ?v=6 -> ?v=7 changes)
# Usage:  bash ~/pb-sync/backend/deploy_assistantguide.sh
set -u
PREVC=a7bc904            # assistant.controller.js as last deployed (deploy_assistantgmaps.sh)
PREVW=5f928b7            # widget as last deployed (deploy_aiwidget.sh)
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-assistantguide-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
W=pawbook-ai-widget.v4.js
OLDV='pawbook-ai-widget.v4.js?v=6'
NEWV='pawbook-ai-widget.v4.js?v=7'
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
grep -q "ADOPT_GUIDE" "$REPO/backend/assistant.controller.js" || { echo "STOPPED: the repo doesn't have the new Assistant yet (git pull?). Nothing was changed."; exit 1; }

T1=$(mktemp); T2=$(mktemp); BAD=0   # temp files (this server has no /dev/fd)
git show "$PREVC:backend/assistant.controller.js" | norm > "$T1"
for d in $DIRS; do norm < "$d/assistant.controller.js" > "$T2"; cmp -s "$T1" "$T2" || { echo "  DIFFERS from $PREVC: $d/assistant.controller.js"; BAD=1; }; done
git show "$PREVW:$W" | norm > "$T1"; norm < "$WEB/$W" > "$T2"; cmp -s "$T1" "$T2" || { echo "  DIFFERS from $PREVW: $WEB/$W (did deploy_aiwidget.sh run?)"; BAD=1; }
rm -f "$T1" "$T2"
PAGES=$(cd "$REPO" && grep -l -F "$NEWV" *.html); TODO=""
for f in $PAGES; do
  [ -f "$WEB/$f" ] || { echo "  (not on the live site, skipped: $f)"; continue; }
  n6=$(grep -o -F "$OLDV" "$WEB/$f" | wc -l); n7=$(grep -o -F "$NEWV" "$WEB/$f" | wc -l)
  if [ "$n6" -eq 1 ] && [ "$n7" -eq 0 ]; then TODO="$TODO $f"
  elif [ "$n6" -eq 0 ] && [ "$n7" -eq 1 ]; then :
  else echo "  UNEXPECTED in $f: v6 x$n6, v7 x$n7"; BAD=1; fi
done
[ "$BAD" -ne 0 ] && { echo "STOPPED: nothing was changed. Send me this output."; exit 1; }
echo "Check OK."

mkdir -p "$BK/src" "$BK/root" "$BK/web" || { echo "Backup failed"; exit 1; }
cp -p "$API/src/controllers/assistant.controller.js" "$BK/src/" && cp -p "$API/controllers/assistant.controller.js" "$BK/root/" && cp -p "$WEB/$W" "$BK/web/" || { echo "Backup failed"; exit 1; }
for f in $TODO; do cp -p "$WEB/$f" "$BK/web/" || { echo "Backup failed: $f"; exit 1; }; done
restore() { echo "$1 — restoring the backup"; cp -p "$BK/src/assistant.controller.js" "$API/src/controllers/"; cp -p "$BK/root/assistant.controller.js" "$API/controllers/"; cp -p "$BK/web/"* "$WEB/"; exit 1; }

for d in $DIRS; do cp "$REPO/backend/assistant.controller.js" "$d/" || restore "Copy failed: $d"; node --check "$d/assistant.controller.js" || restore "Syntax check failed: $d"; done
cp "$REPO/$W" "$WEB/$W" || restore "Copy failed: $W"
N=0
for f in $TODO; do
  sed -i "s/pawbook-ai-widget\.v4\.js?v=6/pawbook-ai-widget.v4.js?v=7/" "$WEB/$f" || restore "Edit failed: $f"
  grep -q -F "$NEWV" "$WEB/$f" || restore "Check failed: $f"; N=$((N+1))
done
echo "DONE: Assistant + AI widget updated ($N page(s) now load the widget as ?v=7). Backup in $BK"
echo "Now RESTART the app from the MilesWeb Node.js panel, then ask the widget: What documents do I need to adopt?"
echo "Undo (if ever needed): cp $BK/src/assistant.controller.js $API/src/controllers/ ; cp $BK/root/assistant.controller.js $API/controllers/ ; cp $BK/web/* $WEB/   (then restart)"
