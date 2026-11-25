#!/bin/bash
# READ-ONLY: what the current Saved / Memories / Activity / Birthdays page (31) uses on the server.
# Prints table structures, route lines and row counts only (no names, emails, posts or other personal data). Changes nothing.
# Usage: bash ~/pb-sync/backend/inspect_mypawbook_schema.sh
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
P="psql $DATABASE_URL -X -q -P pager=off"
echo "== related tables"
$P -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '(save|bookmark|collect|memor|activit|birthday|milestone|wish|highlight|post|like|comment|follow|friend|pet|notif|order|appoint|group|lost|media|photo)' ORDER BY 1" | tr '\n' ' '; echo
for t in $($P -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '(save|bookmark|collect|memor|activit|birthday|milestone|wish|highlight)' ORDER BY 1") pets posts post_likes likes comments post_comments follows followers friendships notifications group_members media; do
  if $P -At -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t'" | grep -q 1; then
    echo "== $t ($($P -At -c "SELECT COUNT(*) FROM \"$t\"") rows)"; $P -c "\d \"$t\"" 2>&1 | grep -v "^$" | grep -v "^ *Table"; fi
done
echo "== routes for the page"
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do echo "-- $f"; grep -n "'/saved\|'/memories\|'/activity\|'/birthdays\|/save'\|/bookmark\|unsave" "$f" | head -20; done
echo "== controllers that serve them (function names + SQL lines)"
for c in $(grep -ho "[A-Za-z]*Ctrl\.\(getSaved\|getMemories\|getActivity\|getBirthdays\)[A-Za-z]*\|[a-zA-Z]*Ctrl\.[a-zA-Z]*\(aved\|emor\|ctivit\|irthday\|ookmark\)[a-zA-Z]*" "$API/src/routes/index.js" | sort -u); do echo "  $c"; done
grep -n "require(.*controller" "$API/src/routes/index.js" | grep -i "save\|memor\|activ\|birth\|post\|social\|user\|misc\|feature" | head -12
for f in $(grep -rl "birthdays\|memories\|getSaved\|getActivity" "$API/src/controllers" 2>/dev/null | head -5); do echo "-- $f"; grep -n "exports\.\|FROM \|INSERT INTO\|UPDATE \|DELETE FROM" "$f" | grep -i "saved\|memor\|activ\|birth\|bookmark\|exports" | cut -c1-220 | head -40; done
echo "== done (nothing was changed)"
