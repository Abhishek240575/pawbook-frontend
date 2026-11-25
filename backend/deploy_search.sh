#!/bin/bash
# Safe deploy of the Search redesign (page 15): one search across real pets, people, communities, vets, verified shelters,
# products, events, adoption and lost & found — typo tolerant, city aware, no demo data, no emails/phones/exact addresses.
# New API /api/v1/pbsearch (routes v18, read-only, no database change). Page 11 learns ?q= so "Book a visit" opens that vet.
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_search.sh
set -u
PREV15=6e5ebb2
PREV11=bb252f4
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-search-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
for c in $PREV15 $PREV11; do git cat-file -e "$c" 2>/dev/null || { echo "Commit $c not found in $REPO"; exit 1; }; done

# 1) Check everything before touching anything
BAD=0
T1=$(mktemp) T2=$(mktemp)   # temp files (this server has no /dev/fd for <(...))
git show "$PREV15:15_search.html" | norm > "$T1"; norm < "$WEB/15_search.html" > "$T2"
if ! cmp -s "$T1" "$T2"; then echo "  DIFFERS from $PREV15: $WEB/15_search.html"; diff "$T1" "$T2" | head -20; BAD=1; fi
rm -f "$T1" "$T2"
git show "$PREV11:11_vet_booking.html" | cmp -s - "$WEB/11_vet_booking.html" || { echo "  DIFFERS from $PREV11: $WEB/11_vet_booking.html"; BAD=1; }
for d in $DIRS; do [ -e "$d/search.controller.js" ] && { echo "  already exists (unexpected): $d/search.controller.js"; BAD=1; }; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  grep -q "(v17: communities)" "$f" && grep -q "cmRouter" "$f" || { echo "  routes are not at v17 (communities): $f"; BAD=1; }
done
[ -f "$WEB/pb-save.js" ] || { echo "  missing $WEB/pb-save.js"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live files match what was deployed."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
cp -p "$WEB/15_search.html" "$WEB/11_vet_booking.html" "$BK/web/"
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Backend (read-only search; no migration)
restore_backend() { cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f "$API/src/controllers/search.controller.js" "$API/controllers/search.controller.js"; }
for d in $DIRS; do cp "$REPO/backend/search.controller.js" "$d/"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
OK=1
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  node --check "$f" || OK=0
  grep -q "(v18: search)" "$f" && grep -q "srRouter" "$f" && grep -q "cmRouter" "$f" && grep -q "haCtrl.nearby" "$f" && grep -q "lfRouter" "$f" || OK=0
done
for d in $DIRS; do node --check "$d/search.controller.js" || OK=0; done
if [ "$OK" -eq 1 ]; then echo "Backend files OK."; else echo "Check failed; backend restored."; restore_backend; exit 1; fi

# 4) Photos the page uses (already on the server from earlier pages; copied only if missing)
for f in pets/dog-cat vet/vet-exam vet/vet-owner events/festival events/dog-party events/cat-cafe adopt/new-home-prep adopt/rescue-golden adopt/shelter-hug adopt/family-cat-dog adopt/puppy-bed lost/missing-golden journey/thumb-vet; do
  t="$WEB/img/$f.jpg"; [ -s "$t" ] || { mkdir -p "$(dirname "$t")"; cp "$REPO/img/$f.jpg" "$t" && chmod 644 "$t" && echo "  added photo img/$f.jpg"; }
done

# 5) Frontend
cp "$REPO/15_search.html" "$WEB/15_search.html"; cp "$REPO/11_vet_booking.html" "$WEB/11_vet_booking.html"
echo "Frontend updated: 15_search.html 11_vet_booking.html"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/pbsearch/home   (401 = Search backend is live)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/search.controller.js $API/controllers/search.controller.js"
