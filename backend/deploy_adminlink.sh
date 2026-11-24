#!/bin/bash
# Adds an admin-only "Shop admin" link (with a count of items waiting for review) to the sidebar of the main PawBook pages.
# Frontend only. Live files are compared with the last deployed version (5e8ea72) first; if any differ, nothing is changed.
# Usage:  bash ~/pb-sync/backend/deploy_adminlink.sh
set -u
PREV=5e8ea72
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-adminlink-$(date +%Y%m%d-%H%M%S)
FRONT="01_login.html 02_onboarding.html 03_groups.html 04_adoption.html 05_lost_pet.html 06_emergency.html 07_home.html 08_pet_profile.html 09_marketplace.html 10_vaccination.html 11_vet_booking.html 12_notifications.html 13_messages.html 14_settings.html 17_group_detail.html 21_pet_insurance.html 22_training.html 23_nutrition.html 24_pet_travel.html 25_analytics.html 26_discover.html 27_stories.html 28_reels.html 29_user_profile.html 30_events.html 31_saved.html 32_gallery.html 33_breeds.html 34_live.html 35_pawmatch.html 36_pet_life_record.html 37_pet_ai_health_agent.html 38_lost_pet_network.html 39_adoption_matching.html 40_voice_pet_assistant.html 41_vet_portal.html "
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
git cat-file -e "$PREV" 2>/dev/null || { echo "Commit $PREV not found"; exit 1; }
BAD=0
for f in $FRONT; do git show "$PREV:$f" | cmp -s - "$WEB/$f" || { echo "  DIFFERS from $PREV: $WEB/$f"; BAD=1; }; done
[ "$BAD" -ne 0 ] && { echo "STOPPED: live files are not what was deployed. Nothing was changed. Send me this output."; exit 1; }
echo "Check OK: all live files match $PREV."
mkdir -p "$BK" && for f in $FRONT; do cp -p "$WEB/$f" "$BK/"; done && echo "Backup: $BK"
for f in $FRONT; do cp "$REPO/$f" "$WEB/$f"; done
echo "DONE (no restart needed). Updated $(echo $FRONT | wc -w) pages. Press Ctrl+F5 once."
echo "Undo (if ever needed): cp $BK/* $WEB/"
