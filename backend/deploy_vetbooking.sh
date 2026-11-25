#!/bin/bash
# Vet booking page (11) in the PawBook design, with VetCare as its "Vet Portal" mode (the old demo portal is removed).
# 41_vet_portal.html now opens inside page 11 (direct visits move there). Frontend only, on top of b8f25f0.
# Usage:  bash ~/pb-sync/backend/deploy_vetbooking.sh
set -u
PREV=b8f25f0
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-vetbooking-$(date +%Y%m%d-%H%M%S)
FRONT="11_vet_booking.html 41_vet_portal.html"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found in $REPO"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }
BAD=0
for f in $FRONT; do if ! git show "$PREV:$f" | cmp -s - "$WEB/$f"; then echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; fi; done
for f in "$REPO"/img/vet/*.jpg; do [ -f "$WEB/img/vet/$(basename "$f")" ] || { echo "  missing photo (run deploy_vetcare.sh first): $f"; BAD=1; }; done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; fi
echo "Check OK: live pages match $PREV."
mkdir -p "$BK" && for f in $FRONT; do cp -p "$WEB/$f" "$BK/"; done && echo "Backup: $BK"
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "Frontend updated: $FRONT"
echo
echo "DONE. No restart needed. Open https://pawbook.deemona.com/11_vet_booking.html and hard-refresh (Ctrl+Shift+R)."
echo "Undo (if ever needed): cp $BK/*.html $WEB/"
