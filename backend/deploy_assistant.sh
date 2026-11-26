#!/bin/bash
# Safe deploy of the PawBook Assistant (page 35): real chat backend /api/v1/assistant (routes v19), conversation saved
# per user, real listings via Search, your pets' vaccines & visits, fixed safe emergency reply, support requests with
# reference numbers + admin inbox. Migration 020 only ADDS two tables. Uses Claude if ANTHROPIC_API_KEY is in .env,
# otherwise quick rule-based answers (set PB_ASSISTANT_AI=0 in .env to force quick answers).
# Every live file is compared with the last deployed copy first. If ANY differs, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_assistant.sh
set -u
PREV35=6e5ebb2
PREVSR=0cbf8e9
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-assistant-$(date +%Y%m%d-%H%M%S)
DIRS="$API/src/controllers $API/controllers"
norm() { sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//'; }

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
for c in $PREV35 $PREVSR; do git cat-file -e "$c" 2>/dev/null || { echo "Commit $c not found in $REPO"; exit 1; }; done

# 1) Check everything before touching anything (temp files: this server has no /dev/fd)
BAD=0; T1=$(mktemp); T2=$(mktemp)
git show "$PREV35:35_ai_agent.html" | norm > "$T1"; norm < "$WEB/35_ai_agent.html" > "$T2"
cmp -s "$T1" "$T2" || { echo "  DIFFERS from $PREV35: $WEB/35_ai_agent.html"; diff "$T1" "$T2" | head -20; BAD=1; }
rm -f "$T1" "$T2"
for d in $DIRS; do
  git show "$PREVSR:backend/search.controller.js" | cmp -s - "$d/search.controller.js" || { echo "  DIFFERS from $PREVSR: $d/search.controller.js"; BAD=1; }
  [ -e "$d/assistant.controller.js" ] && { echo "  already exists (unexpected): $d/assistant.controller.js"; BAD=1; }
done
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  grep -q "(v18: search)" "$f" && grep -q "srRouter" "$f" || { echo "  routes are not at v18 (search): $f"; BAD=1; }
done
[ -f "$API/.env" ] || { echo "  missing $API/.env"; BAD=1; }
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live files match what was deployed."

# 2) Backup
mkdir -p "$BK/web" "$BK/api-src" "$BK/api" "$BK/ctrl-src" "$BK/ctrl"
cp -p "$WEB/35_ai_agent.html" "$BK/web/"
cp -p "$API/src/routes/index.js" "$BK/api-src/index.js"; cp -p "$API/routes/index.js" "$BK/api/index.js"
cp -p "$API/src/controllers/search.controller.js" "$BK/ctrl-src/"; cp -p "$API/controllers/search.controller.js" "$BK/ctrl/"
echo "Backup: $BK"

# 3) Database migration 020 (idempotent; only ADDS tables)
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$REPO/backend/020_assistant.sql"; then echo "STOPPED: migration failed. Files not changed (backup is in $BK)."; exit 1; fi
echo "Migration 020 applied."

# 4) Backend
restore_backend() {
  cp "$BK/api-src/index.js" "$API/src/routes/index.js"; cp "$BK/api/index.js" "$API/routes/index.js"
  cp "$BK/ctrl-src/search.controller.js" "$API/src/controllers/"; cp "$BK/ctrl/search.controller.js" "$API/controllers/"
  rm -f "$API/src/controllers/assistant.controller.js" "$API/controllers/assistant.controller.js"; }
for d in $DIRS; do cp "$REPO/backend/assistant.controller.js" "$REPO/backend/search.controller.js" "$d/"; done
node "$REPO/backend/add_shop_routes.js" || { echo "Route update failed; backend restored."; restore_backend; exit 1; }
OK=1
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do
  node --check "$f" || OK=0
  grep -q "(v19: assistant)" "$f" && grep -q "asRouter" "$f" && grep -q "srRouter" "$f" && grep -q "cmRouter" "$f" && grep -q "haCtrl.nearby" "$f" && grep -q "lfRouter" "$f" || OK=0
done
for d in $DIRS; do node --check "$d/assistant.controller.js" || OK=0; node --check "$d/search.controller.js" || OK=0; done
if [ "$OK" -eq 1 ]; then echo "Backend files OK."; else echo "Check failed; backend restored."; restore_backend; exit 1; fi

# 5) Photos the page uses (already on the server from earlier pages; copied only if missing)
for f in vet/vet-owner vet/vet-exam pets/dog-cat pets/dog-run adopt/golden-smile adopt/family-cat-dog adopt/rescue-golden adopt/new-home-prep events/festival lost/missing-golden lost/community; do
  t="$WEB/img/$f.jpg"; [ -s "$t" ] || { mkdir -p "$(dirname "$t")"; cp "$REPO/img/$f.jpg" "$t" && chmod 644 "$t" && echo "  added photo img/$f.jpg"; }
done

# 6) Frontend
cp "$REPO/35_ai_agent.html" "$WEB/35_ai_agent.html"
echo "Frontend updated: 35_ai_agent.html"
if grep -q '^PB_ASSISTANT_AI=0' "$API/.env"; then echo "Assistant mode: quick answers (PB_ASSISTANT_AI=0 is set)";
elif grep -q '^ANTHROPIC_API_KEY=.' "$API/.env"; then echo "Assistant mode: AI answers (ANTHROPIC_API_KEY is set)";
else echo "Assistant mode: quick answers (no ANTHROPIC_API_KEY in .env — add it yourself on the server to turn on AI answers)"; fi
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://pawbook.deemona.com/api/v1/assistant/state   (401 = Assistant backend is live)"
echo "Undo (if ever needed): cp $BK/web/35_ai_agent.html $WEB/ ; cp $BK/api-src/index.js $API/src/routes/index.js ; cp $BK/api/index.js $API/routes/index.js ; cp $BK/ctrl-src/search.controller.js $API/src/controllers/ ; cp $BK/ctrl/search.controller.js $API/controllers/ ; rm -f $API/src/controllers/assistant.controller.js $API/controllers/assistant.controller.js"
