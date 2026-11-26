#!/bin/bash
# Assistant + AI widget: smart shop and order answers (includes the adoption-guide update, so run only this one).
#  - "cat food under 700", "cheapest treats", "food for Bruno" (uses your pet's type and age), "offers on toys",
#    "Himalaya products", "is the orthopaedic bed in stock", "kutte ka khana 1000 se kam" → real products from the
#    PawBook shop with price, discount, rating and stock, plus "See all in the shop" and "Compare these"
#  - "where is my order" / "return my order" → your real latest orders and their status
#  - adoption documents / rules / fees / law answered from the official Adopt a pet text
#  No database change.  backend: assistant.controller.js (RESTART needed) · frontend: widget + 38 pages (?v=8)
# Usage:  bash ~/pb-sync/backend/deploy_assistantshop.sh
set -u
PREVC="a7bc904 e4c781d"     # assistant.controller.js as deployed (before / after deploy_assistantguide.sh)
PREVW="5f928b7 e4c781d"     # widget as deployed (deploy_aiwidget.sh / deploy_assistantguide.sh)
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-assistantshop-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
W=pawbook-ai-widget.v4.js
NEWV='pawbook-ai-widget.v4.js?v=8'
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
grep -q "shopSmart" "$REPO/backend/assistant.controller.js" || { echo "STOPPED: the repo doesn't have the new Assistant yet (git pull?). Nothing was changed."; exit 1; }

T1=$(mktemp); T2=$(mktemp); BAD=0   # temp files (this server has no /dev/fd)
same() { # $1 = live file, $2 = repo path, rest = commits; true if the live file equals one of them
  local live="$1" rp="$2"; shift 2; norm < "$live" > "$T2"; for c in "$@"; do git show "$c:$rp" | norm > "$T1"; cmp -s "$T1" "$T2" && return 0; done; return 1; }
for d in $DIRS; do
  same "$d/assistant.controller.js" backend/assistant.controller.js $PREVC || { echo "  DIFFERS from $PREVC: $d/assistant.controller.js"; BAD=1; }
  grep -q "exports.listProducts" "$d/shop.controller.js" 2>/dev/null || { echo "  missing shop search: $d/shop.controller.js"; BAD=1; }
  grep -q "exports.myOrders" "$d/checkout.controller.js" 2>/dev/null || { echo "  missing my orders: $d/checkout.controller.js"; BAD=1; }
done
same "$WEB/$W" "$W" $PREVW || { echo "  DIFFERS from $PREVW: $WEB/$W"; BAD=1; }
rm -f "$T1" "$T2"
PAGES=$(cd "$REPO" && grep -l -F "$NEWV" *.html); TODO=""
for f in $PAGES; do
  [ -f "$WEB/$f" ] || { echo "  (not on the live site, skipped: $f)"; continue; }
  nold=$(grep -o -E 'pawbook-ai-widget\.v4\.js\?v=[567]"' "$WEB/$f" | wc -l); nnew=$(grep -o -F "$NEWV" "$WEB/$f" | wc -l)
  if [ "$nold" -eq 1 ] && [ "$nnew" -eq 0 ]; then TODO="$TODO $f"
  elif [ "$nold" -eq 0 ] && [ "$nnew" -eq 1 ]; then :
  else echo "  UNEXPECTED in $f: old x$nold, v8 x$nnew"; BAD=1; fi
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
  sed -i -E 's/pawbook-ai-widget\.v4\.js\?v=[567]"/pawbook-ai-widget.v4.js?v=8"/' "$WEB/$f" || restore "Edit failed: $f"
  grep -q -F "$NEWV" "$WEB/$f" || restore "Check failed: $f"; N=$((N+1))
done
echo "DONE: Assistant + AI widget updated ($N page(s) now load the widget as ?v=8). Backup in $BK"
echo "Now RESTART the app from the MilesWeb Node.js panel, then ask the widget: dog food under 1000"
echo "Undo (if ever needed): cp $BK/src/assistant.controller.js $API/src/controllers/ ; cp $BK/root/assistant.controller.js $API/controllers/ ; cp $BK/web/* $WEB/   (then restart)"
