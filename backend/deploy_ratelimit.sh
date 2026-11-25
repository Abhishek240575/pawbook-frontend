#!/bin/bash
# Raises the API-wide rate limit from 100 to 600 requests per 15 minutes per visitor.
# 100 was too low: a few page loads (marketplace, pet health, vet booking + VetCare) used it up and the
# whole site answered "Too many requests" for 15 minutes. Login (10) and posting (20/hour) limits are unchanged.
# Changes only the generalLimiter "max" line in middleware/security.js. Backs up first.
# Usage:  bash ~/pb-sync/backend/deploy_ratelimit.sh
set -u
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
BK=~/backup-ratelimit-$(date +%Y%m%d-%H%M%S)
FILES=""
for f in "$API/src/middleware/security.js" "$API/middleware/security.js"; do [ -f "$f" ] && FILES="$FILES $f"; done
[ -n "$FILES" ] || { echo "STOPPED: security.js not found. Nothing was changed."; exit 1; }
BAD=0
for f in $FILES; do
  grep -q "const generalLimiter = rateLimit({" "$f" || { echo "  generalLimiter not found in $f"; BAD=1; }
  n=$(awk '/const generalLimiter = rateLimit\(\{/{f=1} f&&/max: *100,/{c++} f&&/\}\);/{f=0} END{print c+0}' "$f")
  [ "$n" = "1" ] || { echo "  expected one 'max: 100,' inside generalLimiter in $f (found $n)"; BAD=1; }
done
if [ "$BAD" -ne 0 ]; then echo "STOPPED: security.js is not what I expected. Nothing was changed. Send me this output."; exit 1; fi
mkdir -p "$BK"; for f in $FILES; do cp -p "$f" "$BK/$(echo "$f" | tr '/' '_')"; done; echo "Backup: $BK"
for f in $FILES; do
  awk '/const generalLimiter = rateLimit\(\{/{f=1} f&&/max: *100,/{sub(/max: *100,/,"max: 600,"); f=0} {print}' "$f" > "$f.new" && mv "$f.new" "$f"
  if node --check "$f"; then echo "Updated: $f"; grep -n "max: 600" "$f"; else echo "Syntax check failed; restoring"; cp "$BK/$(echo "$f" | tr '/' '_')" "$f"; exit 1; fi
done
echo
echo "DONE. Now restart the app from the MilesWeb Node.js panel (this also clears the current block)."
echo "Undo (if ever needed): restore the files from $BK"
