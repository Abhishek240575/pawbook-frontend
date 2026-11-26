#!/bin/bash
# PawMatch 2.0 (page 35): real pet matchmaking — swipe deck per match type (playdate, walk buddy, companion, breeding),
# mutual like = match, chat, and a date planner (offer up to 3 times + a place, the other side picks one).
# New backend /api/v1/matchmaking (routes v21). Migration 022 only ADDS new tables. Page redesigned (Meal Planner look).
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_pawmatch.sh     (then restart the app in the MilesWeb Node.js panel)
set -u
PREV35=bb252f4
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-pawmatch-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
F=35_pawmatch.html
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV35" 2>/dev/null || { echo "Commit $PREV35 not found in $REPO"; exit 1; }

# 1) Check everything before touching anything (temp files: this server has no /dev/fd)
BAD=0; T1=$(mktemp); T2=$(mktemp)
git show "$PREV35:$F" | norm > "$T1"; norm < "$WEB/$F" > "$T2"
cmp -s "$T1" "$T2" || { echo "  DIFFERS from $PREV35: $WEB/$F"; diff "$T1" "$T2" | head -20; BAD=1; }
rm -f "$T1" "$T2"
for d in $DIRS; do [ -d "$d" ] || continue; [ -e "$d/pawmatch.controller.js" ] && { echo "  already exists (unexpected): $d/pawmatch.controller.js"; BAD=1; }; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  [ -f "$f" ] || continue
  grep -q "(v20: assistant areas)" "$f" && grep -q "asRouter" "$f" || { echo "  routes are not at v20 (assistant areas): $f"; BAD=1; }
done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live files match what was deployed."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
cp -p "$WEB/$F" "$BK/web/"
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; [ -f "$API/routes/index.js" ] && cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 022 (only ADDS new pm_ tables; runs as ONE transaction — all or nothing)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
EXIST=$(psql "$DATABASE_URL" -tAc "SELECT string_agg(table_name, ', ') FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('pm_profiles','pm_swipes','pm_matches','pm_messages','pm_reads','pm_dates','pm_reports')") || { echo "STOPPED: could not reach the database. Nothing was changed."; exit 1; }
if [ -n "$EXIST" ] && [ "$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pm_swipes' AND column_name = 'to_profile'")" != "1" ]; then
  echo "STOPPED: tables with these names already exist and are not PawMatch 2.0 tables: $EXIST. Nothing was changed. Send me this output."; exit 1; fi
if ! psql "$DATABASE_URL" -q -1 -v ON_ERROR_STOP=1 -f "$REPO/backend/022_pawmatch.sql"; then echo "STOPPED: migration failed and was rolled back. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 022 applied."

# 4) Backend
restore_backend() {
  cp "$BK/api-src/index.js" "$API/src/routes/index.js"; [ -f "$BK/api/index.js" ] && cp "$BK/api/index.js" "$API/routes/index.js"
  for d in $DIRS; do rm -f "$d/pawmatch.controller.js"; done; }
for d in $DIRS; do [ -d "$d" ] && cp "$REPO/backend/pawmatch.controller.js" "$d/"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
OK=1
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  [ -f "$f" ] || continue
  node --check "$f" || OK=0
  grep -q "(v21: pawmatch)" "$f" && grep -q "pmRouter" "$f" && grep -q "asRouter" "$f" && grep -q "cmRouter" "$f" && grep -q "lfRouter" "$f" || OK=0
done
for d in $DIRS; do [ -f "$d/pawmatch.controller.js" ] && { node --check "$d/pawmatch.controller.js" || OK=0; }; done
if [ "$OK" -eq 1 ]; then echo "Backend files OK."; else echo "Check failed; backend restored."; restore_backend; exit 1; fi

# 5) Photos the page uses (already on the server from earlier pages; copied only if missing)
for f in events/dog-park events/dog-party pets/dog-cat adopt/family-play adopt/pets-group vet/vet-owner; do
  t="$WEB/img/$f.jpg"; [ -s "$t" ] || { mkdir -p "$(dirname "$t")"; cp "$REPO/img/$f.jpg" "$t" && chmod 644 "$t" && echo "  added photo img/$f.jpg"; }
done

# 6) Frontend
cp "$REPO/$F" "$WEB/$F" || { echo "Copy failed; backend restored."; restore_backend; exit 1; }
echo "Frontend updated: $F"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/matchmaking/me   (401 = PawMatch backend is live)"
echo "Undo (if ever needed): cp $BK/web/$F $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; [ -f $BK/api/index.js ] && cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/pawmatch.controller.js $API/controllers/pawmatch.controller.js   (then restart; the new tables can stay)"
