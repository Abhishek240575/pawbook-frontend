#!/bin/bash
# Safe deploy of the Communities redesign (page 03): real communities by country/state/city/area, join (public) or
# request + admin approval (private), posts with photos, meetups with RSVP, comments, likes, members & roles,
# reports and PawBook-only "Verified" badges. Page 17 becomes a redirect to page 03.
# Adds migration 019 (new columns on "Group"/"GroupJoinRequest" + new tables; nothing dropped). Routes v17.
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_communities.sh
set -u
PREV=d14fae9
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-communities-$(date +%Y%m%d-%H%M%S)
FRONT="03_groups.html 17_group_detail.html"
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do
  [ -e "$WEB/$f" ] || { echo "  missing (unexpected): $WEB/$f"; BAD=1; continue; }
  git show "$PREV:$f" | cmp -s - "$WEB/$f" || { echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; }
done
for d in $DIRS; do
  git show "$PREV:backend/mypawbook.controller.js" | cmp -s - "$d/mypawbook.controller.js" || { echo "  DIFFERS from $PREV: $d/mypawbook.controller.js"; BAD=1; }
  [ -e "$d/communities.controller.js" ] && { echo "  already exists (unexpected): $d/communities.controller.js"; BAD=1; }
done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  grep -q "(v16: health agent)" "$f" && grep -q "haCtrl.nearby" "$f" || { echo "  routes are not at v16 (health agent + nearby): $f"; BAD=1; }
done
[ -f "$WEB/pb-save.js" ] || { echo "  missing $WEB/pb-save.js"; BAD=1; }
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live files match what was deployed."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api" "$BK/ctrl-src" "$BK/ctrl"
for f in $FRONT; do cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
cp -p "$API/src/controllers/mypawbook.controller.js" "$BK/ctrl-src/"; cp -p "$API/controllers/mypawbook.controller.js" "$BK/ctrl/"
echo "Backup: $BK"

# 3) Database migration 019 (idempotent; only ADDS columns and tables)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/019_communities.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 019 applied."

# 4) Backend
restore_backend() {
  cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"
  cp "$BK/ctrl-src/mypawbook.controller.js" "$API/src/controllers/"; cp "$BK/ctrl/mypawbook.controller.js" "$API/controllers/"
  rm -f "$API/src/controllers/communities.controller.js" "$API/controllers/communities.controller.js"; }
for d in $DIRS; do cp "$REPO/backend/communities.controller.js" "$d/"; cp "$REPO/backend/mypawbook.controller.js" "$d/"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
OK=1
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  node --check "$f" || OK=0
  grep -q "(v17: communities)" "$f" && grep -q "cmRouter" "$f" && grep -q "haCtrl.nearby" "$f" && grep -q "lfRouter" "$f" && grep -q "LOST & FOUND GUARD" "$f" || OK=0
done
for d in $DIRS; do node --check "$d/communities.controller.js" || OK=0; node --check "$d/mypawbook.controller.js" || OK=0; done
if [ "$OK" -eq 1 ]; then echo "Backend files OK."; else echo "Check failed; backend restored."; restore_backend; exit 1; fi

# 5) Photos from Pexels (free licence) saved on the server; the page falls back to Pexels if one is missing
mkdir -p "$WEB/img/groups"; GOT=0; N=0
for p in people-dogs:5763530 walk-together:2927557 dogs-play:16024344 family-picnic:4148839 cat-lover:6001202 cat-hold:8076506 parrot:12597830 volunteer:6568946 vet-volunteers:7469274 training:5733142 walker:19175821 shepherds:1633522 city-walk:16624777; do
  N=$((N+1)); n=${p%%:*}; id=${p##*:}; t="$WEB/img/groups/$n.jpg"
  [ -s "$t" ] && { GOT=$((GOT+1)); continue; }
  if curl -sfL --max-time 40 "https://images.pexels.com/photos/$id/pexels-photo-$id.jpeg?auto=compress&cs=tinysrgb&w=1200" -o "$t.tmp" && head -c 3 "$t.tmp" | od -An -tx1 | grep -q "ff d8 ff"; then mv "$t.tmp" "$t"; chmod 644 "$t"; GOT=$((GOT+1)); else rm -f "$t.tmp"; echo "  note: could not save photo $n (the page will load it from Pexels)"; fi
done
echo "Photos saved: $GOT of $N"

# 6) Frontend
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/communities/config   (401 = Communities backend is live)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; cp $BK/ctrl-src/mypawbook.controller.js $API/src/controllers/ ; cp $BK/ctrl/mypawbook.controller.js $API/controllers/ ; rm -f $API/src/controllers/communities.controller.js $API/controllers/communities.controller.js"
