#!/bin/bash
# READ-ONLY: structure of the event tables and a few counts (no names, emails or other personal data). Changes nothing.
# Usage: bash ~/pb-sync/backend/inspect_events_schema.sh
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
P="psql $DATABASE_URL -X -q -P pager=off"
$P -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%event%' ORDER BY 1"
for t in events event_attendees event_rsvps; do echo "== $t"; $P -c "\d $t" 2>&1 | grep -v "^$"; done
echo "== counts"
$P -c "SELECT 'events' t, COALESCE(status,'(null)') s, COALESCE(event_type,'(null)') ty, COUNT(*) FROM events GROUP BY 2,3 ORDER BY 1,2,3" 2>&1
$P -c "SELECT 'event_attendees' t, status, COUNT(*) FROM event_attendees GROUP BY 2" 2>&1
$P -c "SELECT 'event_rsvps' t, status, COUNT(*) FROM event_rsvps GROUP BY 2" 2>&1
echo "== which code serves /events"
grep -n "events" "$API/src/routes/index.js" | grep -v "MARKETPLACE\|shop" | head -12
ls "$API/src/controllers" | grep -i event
echo "== done (nothing was changed)"
