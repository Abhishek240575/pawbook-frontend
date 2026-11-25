#!/bin/bash
# READ-ONLY: what the Groups / Communities page (03) and group detail page (17) can build on.
# Prints table structures, row counts, routes and controller SQL lines. No personal data, no .env values. Changes nothing.
# Usage: bash ~/pb-sync/backend/inspect_groups_schema.sh
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
P="psql $DATABASE_URL -X -q -P pager=off"
RX='(group|communit|member|club|meetup|forum|channel)'
echo "== related tables"
$P -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '$RX' ORDER BY 1" | tr '\n' ' '; echo
for t in $($P -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '$RX' ORDER BY 1"); do
  echo "== $t ($($P -At -c "SELECT COUNT(*) FROM \"$t\"") rows)"; $P -c "\d \"$t\"" 2>&1 | grep -v "^$" | grep -v "^ *Table"
done
for t in groups Group communities; do
  for c in category cat privacy type status is_verified verified city state country; do
    if $P -At -c "SELECT 1 FROM information_schema.columns WHERE table_name='$t' AND column_name='$c'" | grep -q 1; then echo "== $t by $c"; $P -At -c "SELECT \"$c\", COUNT(*) FROM \"$t\" GROUP BY 1 ORDER BY 2 DESC LIMIT 15"; fi
  done
done
echo "== posts columns (for group posts)"
$P -At -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='posts' ORDER BY ordinal_position" | tr '\n' ' '; echo
echo "== routes"
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do echo "-- $f"; grep -n "group\|communit" "$f" | cut -c1-200 | head -30; done
ls -la "$API/src/routes" "$API/routes" 2>/dev/null | grep -i "group\|communit"
echo "== controllers (function names + SQL lines)"
for f in $(grep -rli "groups\|group_memberships\|\"Group\"\|communit" "$API/src/controllers" "$API/src/routes" 2>/dev/null | grep -v "shop\|mypawbook\|lostfound\|healthagent\|adopt\|petevents\|vetcare\|petcare" | head -6); do echo "-- $f"; grep -n "exports\.\|router\.\(get\|post\|put\|patch\|delete\)\|FROM \|INSERT INTO\|UPDATE \|JOIN " "$f" | cut -c1-180 | head -40; done
echo "== recent API log lines about groups (no request bodies)"
for l in ~/.pm2/logs/*error*.log "$API"/logs/*.log; do [ -f "$l" ] && grep -i "group\|communit" "$l" | tail -5 | cut -c1-200; done 2>/dev/null
echo "== done (nothing was changed)"
