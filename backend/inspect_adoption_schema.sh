#!/bin/bash
# READ-ONLY: what the adoption pages (04, 20, 39) use on the server. Prints table structures, routes and row counts only
# (no names, phone numbers, addresses or other personal data). Changes nothing.
# Usage: bash ~/pb-sync/backend/inspect_adoption_schema.sh
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
P="psql $DATABASE_URL -X -q -P pager=off"
echo "== related tables"
$P -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '(adopt|shelter|foster|rescue|inquir|welfare|abuse|report|ngo)' ORDER BY 1" | tr '\n' ' '; echo
for t in $($P -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '(adopt|shelter|foster|rescue|inquir|welfare|abuse|ngo)' ORDER BY 1"); do
  echo "== $t ($($P -At -c "SELECT COUNT(*) FROM \"$t\"") rows)"; $P -c "\d \"$t\"" 2>&1 | grep -v "^$" | grep -v "^ *Table"
done
for t in adoptable_pets shelters adoption_inquiries; do
  if $P -At -c "SELECT 1 FROM information_schema.columns WHERE table_name='$t' AND column_name='status'" | grep -q 1; then
    echo "== $t by status"; $P -At -c "SELECT status, COUNT(*) FROM \"$t\" GROUP BY 1 ORDER BY 2 DESC"; fi
done
echo "== routes"
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do echo "-- $f"; grep -n "adopt\|shelter\|foster\|welfare\|abuse" "$f" | cut -c1-200 | head -40; done
echo "== controllers (function names + SQL lines)"
for f in $(grep -rli "adopt\|shelter" "$API/src/controllers" 2>/dev/null | grep -v "petevents\|mypawbook\|vetcare\|petcare" | head -6); do echo "-- $f"; grep -n "exports\.\|FROM \|INSERT INTO\|UPDATE \|JOIN " "$f" | cut -c1-200 | head -50; done
echo "== users.role values"; $P -At -c "SELECT role, COUNT(*) FROM users GROUP BY 1" 2>/dev/null
echo "== done (nothing was changed)"
