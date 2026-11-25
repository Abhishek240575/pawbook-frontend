#!/bin/bash
# Removes the old Emergency Services page (06_emergency.html) and points every link to it at the SOS screen
# of the AI Health Agent page (37_pet_ai_health_agent.html?sos=1). Only the exact link text is changed in each page.
# Every changed page and page 06 itself are backed up first. Usage:  bash ~/pb-sync/backend/deploy_remove06.sh
set -u
REPO=~/pb-sync
WEB=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/public_html
BK=~/backup-remove06-$(date +%Y%m%d-%H%M%S)
cd "$REPO" || { echo "No $REPO"; exit 1; }
git pull -q || { echo "git pull failed"; exit 1; }
[ -f "$WEB/37_pet_ai_health_agent.html" ] || { echo "STOPPED: $WEB/37_pet_ai_health_agent.html not found. Nothing was changed."; exit 1; }
grep -q "function openSOS" "$WEB/37_pet_ai_health_agent.html" || { echo "STOPPED: the live page 37 has no SOS screen yet — run deploy_healthagent.sh first. Nothing was changed."; exit 1; }
mkdir -p "$BK"
N=0
for f in "$WEB"/*.html "$WEB"/*.js; do
  [ -f "$f" ] || continue; b=$(basename "$f"); [ "$b" = "06_emergency.html" ] && continue
  grep -q "06_emergency\.html" "$f" || continue
  cp -p "$f" "$BK/$b"
  sed -i "s#goTo('06_emergency.html')#goTo('37_pet_ai_health_agent.html?sos=1')#g; s#page:'06_emergency.html', pageLabel:'Emergency Services'#page:'37_pet_ai_health_agent.html?sos=1', pageLabel:'Emergency SOS'#g; s#page:'06_emergency.html'#page:'37_pet_ai_health_agent.html?sos=1'#g" "$f"
  N=$((N+1))
  if grep -q "06_emergency\.html" "$f"; then echo "  note: $b still mentions 06_emergency.html in a form not changed automatically:"; grep -n "06_emergency\.html" "$f" | cut -c1-160; fi
done
echo "Links updated in $N files (backups in $BK)."
if [ -f "$WEB/06_emergency.html" ]; then mv "$WEB/06_emergency.html" "$BK/06_emergency.html"; echo "Page 06 removed from the site (kept in $BK)."; else echo "Page 06 was already gone."; fi
echo
echo "DONE. No restart needed. Check: open https://pawbook.deemona.com/07_home.html → side menu → Emergency Services (opens SOS)."
echo "Undo (if ever needed): cp $BK/* $WEB/"
