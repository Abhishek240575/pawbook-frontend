#!/bin/bash
# Adoption & Rescue (page 39) — new, everything else on the page unchanged:
#  1) "Before you adopt": adoption policy, rules, documents and compliance (tabs).
#  2) Agreement before applying: read all four, tick each, then agree — or quit (nothing is sent). The server also
#     refuses an application until the person has agreed (POST /api/v1/adopt/terms; migration 023 adds one table).
#  3) "Shelters & help near you": country → state → city/district → area → postal code (India Post list, adopt-loc/),
#     then the nearest animal shelters, adoption centres, vet clinics, emergency/24×7 vets and police stations
#     (Google Maps in the browser + PawBook rescue partners), each with full details, call and directions.
# Needs PawMatch 2.0 deployed first (routes v21). Every live file is compared with the last deployed copy first.
# Usage:  bash ~/pb-sync/backend/deploy_adoptguide.sh     (then restart the app in the MilesWeb Node.js panel)
set -u
PREV39=bb252f4
PREVAD=96d94d5
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-adoptguide-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
F=39_adoption_matching.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
for c in $PREV39 $PREVAD; do git cat-file -e "$c" 2>/dev/null || { echo "Commit $c not found in $REPO"; exit 1; }; done

# 1) Check everything before touching anything
BAD=0; T1=$(mktemp); T2=$(mktemp)
git show "$PREV39:$F" | norm > "$T1"; norm < "$WEB/$F" > "$T2"
cmp -s "$T1" "$T2" || { echo "  DIFFERS from $PREV39: $WEB/$F"; diff "$T1" "$T2" | head -20; BAD=1; }
for d in $DIRS; do [ -f "$d/adopt.controller.js" ] || continue
  git show "$PREVAD:backend/adopt.controller.js" | norm > "$T1"; norm < "$d/adopt.controller.js" > "$T2"
  cmp -s "$T1" "$T2" || { echo "  DIFFERS from $PREVAD: $d/adopt.controller.js"; BAD=1; }; done
rm -f "$T1" "$T2"
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  [ -f "$f" ] || continue
  grep -q "pmRouter" "$f" || { echo "  PawMatch 2.0 is not deployed yet ($f). Run deploy_pawmatch.sh first, restart, then run this again."; BAD=1; }
done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live files match what was deployed."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api" "$BK/ctrl-src" "$BK/ctrl"
cp -p "$WEB/$F" "$BK/web/"
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; [ -f "$API/routes/index.js" ] && cp -p "$API/routes/index.js" "$BK/api/index.js"
[ -f "$API/src/controllers/adopt.controller.js" ] && cp -p "$API/src/controllers/adopt.controller.js" "$BK/ctrl-src/"
[ -f "$API/controllers/adopt.controller.js" ] && cp -p "$API/controllers/adopt.controller.js" "$BK/ctrl/"
echo "Backup: $BK"

# 3) Database migration 023 (only ADDS one table; one transaction)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -1 -v ON_ERROR_STOP=1 -f "$REPO/backend/023_adoption_terms.sql"; then echo "STOPPED: migration failed and was rolled back. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 023 applied."

# 4) Backend
restore_backend() {
  cp "$BK/api-src/index.js" "$API/src/routes/index.js"; [ -f "$BK/api/index.js" ] && cp "$BK/api/index.js" "$API/routes/index.js"
  [ -f "$BK/ctrl-src/adopt.controller.js" ] && cp "$BK/ctrl-src/adopt.controller.js" "$API/src/controllers/"
  [ -f "$BK/ctrl/adopt.controller.js" ] && cp "$BK/ctrl/adopt.controller.js" "$API/controllers/"; }
for d in $DIRS; do [ -f "$d/adopt.controller.js" ] && cp "$REPO/backend/adopt.controller.js" "$d/"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
OK=1
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  [ -f "$f" ] || continue
  node --check "$f" || OK=0
  grep -q "(v22: adoption terms)" "$f" && grep -q "adCtrl.terms" "$f" && grep -q "pmRouter" "$f" && grep -q "asRouter" "$f" && grep -q "adRouter" "$f" || OK=0
done
for d in $DIRS; do [ -f "$d/adopt.controller.js" ] && { node --check "$d/adopt.controller.js" || OK=0; grep -q "exports.terms" "$d/adopt.controller.js" || OK=0; }; done
if [ "$OK" -eq 1 ]; then echo "Backend files OK."; else echo "Check failed; backend restored."; restore_backend; exit 1; fi

# 5) Area list (India Post post offices, one small file per state) + page
mkdir -p "$WEB/adopt-loc" && cp "$REPO"/adopt-loc/*.json "$WEB/adopt-loc/" && chmod 644 "$WEB"/adopt-loc/*.json || { echo "Copy of area list failed; backend restored."; restore_backend; exit 1; }
echo "Area list: $(ls "$WEB"/adopt-loc/*.json | wc -l) files"
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed; backend restored."; restore_backend; exit 1; }
echo "Frontend updated: $F"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -X POST https://pawbook.deemona.com/api/v1/adopt/terms   (401 = live)"
echo "Undo (if ever needed): cp $BK/web/$F $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; [ -f $BK/api/index.js ] && cp $BK/api/index.js $API/routes/index.js ; cp $BK/ctrl-src/adopt.controller.js $API/src/controllers/ 2>/dev/null ; cp $BK/ctrl/adopt.controller.js $API/controllers/ 2>/dev/null   (then restart)"
