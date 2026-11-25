#!/bin/bash
# Safe deploy of the AI Health Agent redesign (page 37): real pets, vaccine-aware symptom checker, AI chat that uses the pet's own
# records (Claude Haiku via ANTHROPIC_API_KEY), first aid, vitals, the owner's vets and emergency contacts, check history.
# Adds migration 018 (new tables only). On top of Lost & Found (routes v15). Photos come from Pexels and are saved into img/ai/.
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_healthagent.sh
set -u
PREV=5098d1b
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-healthagent-$(date +%Y%m%d-%H%M%S)
FRONT="37_pet_ai_health_agent.html"
DIRS="$API/src/controllers $API/controllers"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check everything before touching anything
BAD=0
for f in $FRONT; do
  if [ ! -e "$WEB/$f" ]; then echo "  missing (unexpected): $WEB/$f"; BAD=1; continue; fi
  if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi
done
for d in $DIRS; do [ -e "$d/healthagent.controller.js" ] && { echo "  already exists (unexpected): $d/healthagent.controller.js"; BAD=1; }; done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  grep -q "(v15: lost & found)" "$f" || { echo "  routes are not at v15 (Lost & Found): $f"; BAD=1; }
done
[ -f "$WEB/pb-save.js" ] || { echo "  missing $WEB/pb-save.js"; BAD=1; }
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: all live files match $PREV."
grep -q '^ANTHROPIC_API_KEY=' "$API/.env" && echo "AI key found in .env (AI chat on)." || echo "NOTE: ANTHROPIC_API_KEY not in .env — the page works, but the AI chat will say it is unavailable."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api"
for f in $FRONT; do [ -e "$WEB/$f" ] && cp -p "$WEB/$f" "$BK/web/"; done
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
echo "Backup: $BK"

# 3) Database migration 018 (idempotent; only ADDS tables)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/018_health_agent.sql"; then
  echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 018 applied."

# 4) Backend
restore_backend() { cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"; rm -f "$API/src/controllers/healthagent.controller.js" "$API/controllers/healthagent.controller.js"; }
for d in $DIRS; do cp "$REPO/backend/healthagent.controller.js" "$d/healthagent.controller.js"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
OK=1
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do node --check "$f" || OK=0; grep -q "haRouter" "$f" && grep -q "lfRouter" "$f" && grep -q "LOST & FOUND GUARD" "$f" || OK=0; done
node --check "$API/src/controllers/healthagent.controller.js" || OK=0
if [ "$OK" -eq 1 ]; then echo "Backend files OK."; else echo "Check failed; backend restored."; restore_backend; exit 1; fi

# 5) Photos from Pexels (free licence) saved on the server; the page falls back to Pexels if one is missing
mkdir -p "$WEB/img/ai"; GOT=0
for p in vet-dog:7469222 doctor-dog:7470634 vet-dog-2:7469233 phone-dog:5256087 cat-eye:6816861 cat-bandage:6816862 cat-vaccine:6816869 ultrasound:6234610 sofa-hug:5255530 water:4873126 golden:2409503 firstaid-kit:5146534; do
  n=${p%%:*}; id=${p##*:}; t="$WEB/img/ai/$n.jpg"
  [ -s "$t" ] && { GOT=$((GOT+1)); continue; }
  if curl -sfL --max-time 40 "https://images.pexels.com/photos/$id/pexels-photo-$id.jpeg?auto=compress&cs=tinysrgb&w=1200" -o "$t.tmp" && head -c 3 "$t.tmp" | od -An -tx1 | grep -q "ff d8 ff"; then mv "$t.tmp" "$t"; chmod 644 "$t"; GOT=$((GOT+1)); else rm -f "$t.tmp"; echo "  note: could not save photo $n (the page will load it from Pexels)"; fi
done
echo "Photos saved: $GOT of 12"

# 6) Frontend
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/healthagent/contacts   (401 = AI Health Agent backend is live)"
echo "Undo (if ever needed): cp $BK/web/* $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; rm -f $API/src/controllers/healthagent.controller.js $API/controllers/healthagent.controller.js"
