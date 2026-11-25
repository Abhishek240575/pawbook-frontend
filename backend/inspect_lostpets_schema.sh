#!/bin/bash
# READ-ONLY: what the Lost & Found pages (05, 18, 38) use on the server, plus which translation/AI service is configured.
# Prints table structures, row counts, route lines and the NAMES of settings in .env (never their values). Changes nothing.
# Usage: bash ~/pb-sync/backend/inspect_lostpets_schema.sh
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
P="psql $DATABASE_URL -X -q -P pager=off"
echo "== related tables"
$P -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '(lost|found|sighting|missing|volunteer|alert|language|translat|emergency|helpline|reunit)' ORDER BY 1" | tr '\n' ' '; echo
for t in $($P -At -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ~* '(lost|found|sighting|missing|volunteer|alert|language|translat|emergency|helpline|reunit)' ORDER BY 1"); do
  echo "== $t ($($P -At -c "SELECT COUNT(*) FROM \"$t\"") rows)"; $P -c "\d \"$t\"" 2>&1 | grep -v "^$" | grep -v "^ *Table"
done
for t in lost_pet_reports; do
  for c in status report_type type species; do
    if $P -At -c "SELECT 1 FROM information_schema.columns WHERE table_name='$t' AND column_name='$c'" | grep -q 1; then echo "== $t by $c"; $P -At -c "SELECT $c, COUNT(*) FROM \"$t\" GROUP BY 1 ORDER BY 2 DESC"; fi
  done
done
echo "== users columns about language/location"
$P -At -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' AND column_name ~* '(lang|locale|city|state|country|lat|lng|location|push|fcm|whatsapp|phone)' ORDER BY 1"
echo "== routes"
for f in "$API/src/routes/index.js" "$API/routes/index.js"; do echo "-- $f"; grep -n "lost\|found-pet\|sighting\|translat\|volunteer" "$f" | cut -c1-200 | head -30; done
echo "== controllers (function names + SQL lines)"
for f in $(grep -rli "lost_pet\|lost-pet" "$API/src/controllers" 2>/dev/null | head -4); do echo "-- $f"; grep -n "exports\.\|FROM \|INSERT INTO\|UPDATE \|JOIN \|phone" "$f" | cut -c1-200 | head -50; done
echo "== AI / translation service in use (file names and model/provider lines only)"
grep -rln "translat" "$API/src/controllers" "$API/src/services" 2>/dev/null | head -5
grep -rhno "api\.anthropic\.com\|api\.openai\.com\|generativelanguage\.googleapis\.com\|translation\.googleapis\.com\|api\.cognitive\.microsofttranslator\.com\|model: *['\"][a-z0-9.\-]*['\"]" "$API/src" 2>/dev/null | sort | uniq -c | head -10
echo "== .env setting NAMES (values are not shown)"
grep -o '^[A-Z0-9_]*=' "$API/.env" | tr -d '=' | tr '\n' ' '; echo
echo "== done (nothing was changed)"
