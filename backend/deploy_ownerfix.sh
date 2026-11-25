#!/bin/bash
# Security fix: owner-only access for the older endpoints
#   GET  /api/v1/pets/:pet_id/health            (controllers/pet.controller.js, both copies)
#   GET/POST/DELETE /api/v1/vaccinations/...   (routes/vaccinations.js, the flat copy without checks)
# src/routes/vaccinations.js already checks ownership and is not touched.
# Each live file must exactly match the version inspected on 25 Nov 2026 (full SHA-256), otherwise nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_ownerfix.sh
set -u
REPO=~/pb-sync
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
BK=~/backup-ownerfix-$(date +%Y%m%d-%H%M%S)
PET_OLD=315f873346f7dc0045f3b263e3c8ab6efc2033931f35957d85e5e8f9d38fcf31
VAX_OLD=9ee4c5ea460b2f42f03a1ce6687ca07a0cb8e894c2bfdba2d80780356e622894

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
BAD=0
chk() { [ "$(sha256sum "$1" 2>/dev/null | cut -d' ' -f1)" = "$2" ] || { echo "  DIFFERS from inspected version: $1"; BAD=1; }; }
chk "$API/src/controllers/pet.controller.js" $PET_OLD
chk "$API/controllers/pet.controller.js" $PET_OLD
chk "$API/routes/vaccinations.js" $VAX_OLD
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was inspected. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live files match the inspected versions."

mkdir -p "$BK/src-controllers" "$BK/controllers" "$BK/routes"
cp -p "$API/src/controllers/pet.controller.js" "$BK/src-controllers/"; cp -p "$API/controllers/pet.controller.js" "$BK/controllers/"; cp -p "$API/routes/vaccinations.js" "$BK/routes/"
echo "Backup: $BK"

restore() { cp "$BK/src-controllers/pet.controller.js" "$API/src/controllers/"; cp "$BK/controllers/pet.controller.js" "$API/controllers/"; cp "$BK/routes/vaccinations.js" "$API/routes/"; }
cp "$REPO/backend/legacy/pet.controller.js" "$API/src/controllers/pet.controller.js"
cp "$REPO/backend/legacy/pet.controller.js" "$API/controllers/pet.controller.js"
cp "$REPO/backend/legacy/vaccinations.flat.js" "$API/routes/vaccinations.js"
if node --check "$API/src/controllers/pet.controller.js" && node --check "$API/controllers/pet.controller.js" && node --check "$API/routes/vaccinations.js"; then echo "Files OK."
else echo "Syntax check failed; files restored."; restore; exit 1; fi
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel, then run:"
echo "  bash ~/pb-sync/backend/smoke.sh"
echo "Undo (if ever needed): cp $BK/src-controllers/pet.controller.js $API/src/controllers/ ; cp $BK/controllers/pet.controller.js $API/controllers/ ; cp $BK/routes/vaccinations.js $API/routes/"
