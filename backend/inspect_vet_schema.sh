#!/bin/bash
# READ-ONLY: prints the structure of the vet tables and a few counts (no names, emails, phones or medical data).
# Changes nothing. Usage: bash ~/pb-sync/backend/inspect_vet_schema.sh
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
export $(grep '^DATABASE_URL=' "$API/.env" | tr -d '\r' | xargs)
P="psql $DATABASE_URL -X -q -P pager=off"
for t in vets vet_availability vet_appointments prescriptions vet_reviews; do echo "== $t"; $P -c "\d $t" 2>&1 | grep -v "^$"; done
echo "== counts"
$P -c "SELECT 'vets' t, status, COUNT(*) FROM vets GROUP BY status UNION ALL SELECT 'vets with user_id', NULL, COUNT(*) FROM vets WHERE user_id IS NOT NULL UNION ALL SELECT 'appointments', status, COUNT(*) FROM vet_appointments GROUP BY status UNION ALL SELECT 'appointments with pet', NULL, COUNT(*) FROM vet_appointments WHERE pet_id IS NOT NULL UNION ALL SELECT 'availability slots', NULL, COUNT(*) FROM vet_availability UNION ALL SELECT 'prescriptions', NULL, COUNT(*) FROM prescriptions" 2>&1
$P -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' AND column_name IN ('phone','full_name','name','role','user_no','avatar_url','email') ORDER BY 1" 2>&1
echo "== done (nothing was changed)"
