#!/bin/bash
# Safe deploy of the sidebar/drawer menu update (36 pages) on top of the live site.
# A page is updated ONLY if the live copy is identical to the last deployed version (PREV).
# Pages that were changed on the server are left untouched and listed at the end.
# Usage:  bash ~/pb-sync/backend/deploy_sidebar.sh
set -u
PREV=04192c8
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-sidebar-$(date +%Y%m%d-%H%M%S)
FILES="01_login.html 02_onboarding.html 03_groups.html 04_adoption.html 05_lost_pet.html 06_emergency.html 07_home.html 08_pet_profile.html 09_marketplace.html 10_vaccination.html 11_vet_booking.html 12_notifications.html 13_messages.html 14_settings.html 17_group_detail.html 21_pet_insurance.html 22_training.html 23_nutrition.html 24_pet_travel.html 25_analytics.html 26_discover.html 27_stories.html 28_reels.html 29_user_profile.html 30_events.html 31_saved.html 32_gallery.html 33_breeds.html 34_live.html 35_pawmatch.html 36_pet_life_record.html 37_pet_ai_health_agent.html 38_lost_pet_network.html 39_adoption_matching.html 40_voice_pet_assistant.html 41_vet_portal.html "

cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found"; exit 1; }
[ -f "$WEB/42_shop.html" ] || { echo "Web folder not found: $WEB"; exit 1; }
mkdir -p "$BK"
OK=0; SKIP=""; MISS=""
for f in $FILES; do
  if [ ! -e "$WEB/$f" ]; then MISS="$MISS $f"; continue; fi
  if git show "$PREV:$f" | cmp -s - "$WEB/$f"; then cp -p "$WEB/$f" "$BK/" && cp "$REPO/$f" "$WEB/$f" && OK=$((OK+1))
  else SKIP="$SKIP $f"; fi
done
echo "Backup of replaced pages: $BK"
echo "Updated: $OK page(s)"
[ -n "$SKIP" ] && echo "NOT updated (changed on the server since last deploy, left as is):$SKIP"
[ -n "$MISS" ] && echo "NOT on live site (skipped):$MISS"
echo "Undo (if ever needed): cp $BK/* $WEB/"
echo "No restart needed (pages only). Press Ctrl+Shift+R in the browser."
