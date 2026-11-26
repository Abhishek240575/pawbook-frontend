#!/bin/bash
# Read-only: checks the existing Facebook sign-in route. Prints code and column names only; secrets are never printed.
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
cd "$API" || { echo "No $API"; exit 1; }
mask() { sed -E 's/[A-Za-z0-9_+\/=-]{32,}/<masked>/g'; }
echo "== src/routes/auth.facebook.js =="; mask < src/routes/auth.facebook.js
echo; echo "== where it is mounted =="
grep -rnI "auth\.facebook\|auth.facebook" --exclude-dir=node_modules --include=*.js . | grep -v "^./src/routes/auth.facebook.js" | cut -c1-200
echo; echo "== main entry =="; grep -E '"main"|"start"' package.json
echo; echo "== users table columns (names only) =="
node -e '
const fs=require("fs"),{Client}=require("pg");
const env=Object.fromEntries(fs.readFileSync(".env","utf8").split(/\r?\n/).filter(l=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^["\x27]|["\x27]$/g,"")]}));
const c=new Client({connectionString:env.DATABASE_URL,ssl:/sslmode|neon/.test(env.DATABASE_URL||"")?{rejectUnauthorized:false}:undefined});
c.connect().then(()=>c.query("select column_name,data_type,is_nullable from information_schema.columns where table_name=$1 order by ordinal_position",["users"]))
.then(r=>{console.log(r.rows.map(x=>x.column_name+" ("+x.data_type+(x.is_nullable==="NO"?", required":"")+")").join("\n"));return c.end()})
.catch(e=>{console.log("DB check failed:",e.message);process.exit(0)})'
echo; echo "== live test with a fake token (expect an error message, not 404) =="
curl -s -m 20 -o /tmp/fbt.json -w "HTTP %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"access_token":"fake-test-token"}' https://pawbook.deemona.com/api/v1/auth/facebook; head -c 300 /tmp/fbt.json; echo; rm -f /tmp/fbt.json
