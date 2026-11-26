// Tests the Google key(s) in the API .env from the SERVER, without ever printing a key.
// Prints only the variable NAME and whether Google accepted it for Places API (New) and Geocoding.
// Usage: node check_google_key.js /path/to/api/.env
const fs = require('fs');
const NAMES = ['GOOGLE_MAPS_SERVER_KEY', 'GOOGLE_PLACES_API_KEY', 'GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_KEY', 'GOOGLE_API_KEY', 'MAPS_API_KEY', 'GMAPS_KEY', 'GOOGLE_KEY'];
const env = {};
try { fs.readFileSync(process.argv[2] || '.env', 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }); }
catch (e) { console.log('Could not read .env'); process.exit(1); }
const other = Object.keys(env).filter(k => /GOOGLE|MAP|PLACE/i.test(k) && !NAMES.includes(k));
if (other.length) console.log('Other Google/Maps-looking names in .env (not used): ' + other.join(', '));
const found = NAMES.filter(n => env[n] && env[n].length > 20);
if (!found.length) { console.log('No Google key found under these names: ' + NAMES.join(', ')); process.exit(0); }
(async () => {
  let first = true;
  for (const n of found) {
    const k = env[n];
    let places = '?', geo = '?';
    try {
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'X-Goog-Api-Key': k, 'X-Goog-FieldMask': 'places.id', 'content-type': 'application/json' }, body: JSON.stringify({ textQuery: 'veterinary clinic New Delhi', maxResultCount: 1 }), signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => ({}));
      places = r.ok ? 'OK' : ('FAILED ' + r.status + ' ' + ((j.error && j.error.status) || '') + ' — ' + String((j.error && j.error.message) || '').replace(/key[=:]\s*\S+/gi, 'key=…').slice(0, 140));
    } catch (e) { places = 'FAILED (no connection: ' + e.message + ')'; }
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/geocode/json?address=110075%20India&key=' + encodeURIComponent(k), { signal: AbortSignal.timeout(10000) });
      const j = await r.json(); geo = j.status === 'OK' ? 'OK' : ('FAILED ' + j.status + ' — ' + String(j.error_message || '').slice(0, 140));
    } catch (e) { geo = 'FAILED (no connection: ' + e.message + ')'; }
    console.log((first ? '[USED] ' : '[spare] ') + n + ': Places API (New) ' + places + ' · Geocoding ' + geo);
    first = false;
  }
})();
