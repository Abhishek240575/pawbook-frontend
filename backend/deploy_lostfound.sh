#!/bin/bash
# Safe deploy of Lost & Found 2.0 (page 38): lost / found / sighting reports, protected messages, alerts in each person's language,
# machine translation (labelled, originals kept), volunteers, moderation. Old pages 05 and 18 now forward to page 38.
# The old /lost-pets API keeps working but is answered by the new controller, so phone numbers and exact locations stay private.
# Adds migration 017 (adds columns + new tables; nothing dropped). On top of Adoption (routes v14).
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_lostfound.sh
set -u
PREV=cb6ced3
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-lostfound-$(date +%Y%m%d-%H%M%S)
FRONT="38_lost_pet_network.html 05_lost_pet.html 18_lost_pet_report.html"
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do
  if [ ! -e "$WEB/$f" ]; then [ "$f" = "38_lost_pet_network.html" ] && { echo "  missing (unexpected): $WEB/$f"; BAD=1; } || echo "  not on the server yet (will be added): $f"; continue; fi
  if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi
done
for d in $DIRS; do [ -e "$d/lostfound.controller.js" ] && { echo "  already exists (unexpected): $d/lostfound.controller.js"; BAD=1; }; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  grep -q "(v14: adoption)" "$f" || { echo "  routes are not at v14 (Adoption): $f"; BAD=1; }
  grep -q "lost_pet.controller" "$f" || { echo "  old lost-pets routes not found (unexpected): $f"; BAD=1; }
done
for f in "$REPO"/img/lost/*.jpg; do t="$WEB/img/lost/$(basename "$f")"; if [ -e "$t" ] && ! cmp -s "$f" "$t"; then echo "  already exists with other content: $t"; BAD=1; fi; done
[ -f "$WEB/pawbook-i18n.js" ] || { echo "  missing $WEB/pawbook-i18n.js"; BAD=1; }
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."
grep -q '^ANTHROPIC_API_KEY=' "$API/.env" && echo "Translation key found in .env (machine translation on)." || echo "NOTE: ANTHROPIC_API_KEY not in .env — reports still work, they just won't be translated."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do [ -e "$WEB/$f" ] && cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 017 (idempotent; only ADDS columns and tables)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/017_lost_found.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 017 applied."

# 4) Backend
restore_backend() { cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f "$API/src/controllers/lostfound.controller.js" "$API/controllers/lostfound.controller.js"; }
for d in $DIRS; do cp "$REPO/backend/lostfound.controller.js" "$d/lostfound.controller.js"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
OK=1
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  node --check "$f" || OK=0
  grep -q "lfRouter" "$f" && grep -q "adRouter" "$f" || OK=0
  # the guard must come before the old lost-pet routes so it answers first
  node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');const g=s.indexOf('LOST & FOUND GUARD'),o=s.indexOf('lostPetCtrl.getAlerts');process.exit(g>=0&&(o<0||g<o)?0:1)" "$f" || { echo "  lost-pets guard not in place: $f"; OK=0; }
done
node --check "$API/src/controllers/lostfound.controller.js" || OK=0
if [ "$OK" -eq 1 ]; then echo "Backend files OK."; else echo "Check failed; backend restored."; restore_backend; exit 1; fi

# 5) Frontend + photos
mkdir -p "$WEB/img/lost" && cp "$REPO"/img/lost/*.jpg "$WEB/img/lost/" && chmod 644 "$WEB"/img/lost/*.jpg
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT (+ $(ls "$WEB/img/lost" | wc -l) photos)"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/lostfound/config   (401 = Lost & Found 2.0 is live)"
echo "  curl -s https://pawbook.deemona.com/api/v1/lost-pets | head -c 200   (old list, now without phone numbers)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; (rm -f $WEB/18_lost_pet_report.html if it was not there before) ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/lostfound.controller.js $API/controllers/lostfound.controller.js"
