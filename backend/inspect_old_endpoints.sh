#!/bin/bash
# READ-ONLY: shows how the older /pets/:id/health and /vaccinations endpoints are wired on the live server.
# Changes nothing. Prints no secrets. Usage: bash ~/pb-sync/backend/inspect_old_endpoints.sh
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
cd "$API" || { echo "No $API"; exit 1; }
echo "== entry point"; grep -n '"main"\|"start"' package.json
echo "== hashes"; for f in server.js src/server.js app.js src/app.js routes/index.js src/routes/index.js routes/vaccinations.js src/routes/vaccinations.js controllers/pet.controller.js src/controllers/pet.controller.js routes/pets.js src/routes/pets.js; do [ -f "$f" ] && echo "$(sha256sum "$f" | cut -c1-16)  $(wc -l < "$f") lines  $f"; done
echo "== mounts"; for f in server.js src/server.js app.js src/app.js; do [ -f "$f" ] && grep -n "vaccination\|require('./routes\|require(\"./routes\|app.use('/api" "$f" | sed "s|^|$f:|"; done
echo "== route lines"; for f in routes/index.js src/routes/index.js; do [ -f "$f" ] && grep -n "petRouter\|/health'\|vaccination\|const router\|marketRouter = \|module.exports" "$f" | grep -v "petcareRouter\|pcCtrl" | sed "s|^|$f:|"; done
echo "== health handler"; for f in controllers/pet.controller.js src/controllers/pet.controller.js; do [ -f "$f" ] && { echo "-- $f"; sed -n '/getHealthTimeline *= *async/,/^};/p' "$f" | head -70; }; done
echo "== vaccinations routes (signatures)"; for f in routes/vaccinations.js src/routes/vaccinations.js; do [ -f "$f" ] && { echo "-- $f"; grep -n "router\.\(get\|post\|put\|patch\|delete\)\|user_id\|require(" "$f"; }; done
echo "== done (nothing was changed)"
