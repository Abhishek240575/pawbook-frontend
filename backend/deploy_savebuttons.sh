#!/bin/bash
# Safe deploy: "Save to My PawBook" buttons (vets, training, travel guides, first-aid tips) + side menu renamed to "My PawBook".
# Changes ONLY two small things inside live pages (nothing else in them is touched):
#   1. the side-menu label "Saved & Activity" → "My PawBook" (every page that has it)
#   2. one line <script src="pb-save.js"></script> before </body> on pages 11, 16, 22, 24 and 37
# and adds the new file pb-save.js. Every changed page is backed up first. No server or database changes.
# Usage:  bash ~/pb-sync/backend/deploy_savebuttons.sh
set -u
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-savebuttons-$(date +%Y%m%d-%H%M%S)
PAGES="11_vet_booking.html 16_vet_profile.html 22_training.html 24_pet_travel.html 37_pet_ai_health_agent.html"

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }

# 1) Check before touching anything
BAD=0
if git show b744f29^:11_vet_booking.html | cmp -s - "$WEB/11_vet_booking.html"; then
  echo "  The Vet Portal update (deploy_vetbooking.sh) is not on the server yet. Run it first:"
  echo "    bash ~/pb-sync/backend/deploy_vetbooking.sh"; BAD=1; fi
for f in $PAGES; do
  [ -f "$WEB/$f" ] || { echo "  missing: $WEB/$f"; BAD=1; continue; }
  if ! grep -q 'pb-save.js' "$WEB/$f" && [ "$(grep -c '</body>' "$WEB/$f")" != "1" ]; then echo "  cannot find a single </body> in $f"; BAD=1; fi
done
if [ -e "$WEB/pb-save.js" ] && ! cmp -s "$REPO/pb-save.js" "$WEB/pb-save.js"; then echo "  $WEB/pb-save.js already exists with other content"; BAD=1; fi
if [ "$BAD" -ne 0 ]; then echo "STOPPED. Nothing was changed."; exit 1; fi
echo "Check OK."

# 2) Back up every page that will change
mkdir -p "$BK"
LABEL=$(grep -l 'Saved &amp; Activity\|Saved & Activity' "$WEB"/*.html 2>/dev/null)
for f in $LABEL; do cp -p "$f" "$BK/"; done
for f in $PAGES; do [ -e "$BK/$f" ] || cp -p "$WEB/$f" "$BK/"; done
echo "Backup: $BK ($(ls "$BK" | wc -l) pages)"

# 3) Patch
for f in $LABEL; do sed -i 's/Saved &amp; Activity/My PawBook/g; s/Saved & Activity/My PawBook/g' "$f"; done
for f in $PAGES; do grep -q 'pb-save.js' "$WEB/$f" || sed -i '0,/<\/body>/s//<script src="pb-save.js"><\/script>\n<\/body>/' "$WEB/$f"; done
cp "$REPO/pb-save.js" "$WEB/pb-save.js" && chmod 644 "$WEB/pb-save.js"

# 4) Verify
OK=1
grep -l 'Saved &amp; Activity\|Saved & Activity' "$WEB"/*.html >/dev/null 2>&1 && { echo "  old menu label still found"; OK=0; }
for f in $PAGES; do [ "$(grep -c 'pb-save.js' "$WEB/$f")" = "1" ] || { echo "  pb-save.js line missing in $f"; OK=0; }; done
if [ "$OK" -ne 1 ]; then echo "Verification failed — restoring backups."; cp -p "$BK"/*.html "$WEB/"; rm -f "$WEB/pb-save.js"; exit 1; fi
echo "Renamed the menu on $(echo $LABEL | wc -w) pages; save buttons added to 5 pages."
echo
echo "DONE. No restart needed. Open a vet card, a training session, a travel guide or a first-aid card and tap the bookmark."
echo "Undo (if ever needed): cp $BK/*.html $WEB/ ; rm -f $WEB/pb-save.js"
