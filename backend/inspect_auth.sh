#!/bin/bash
# Read-only: shows how sign-in works on the server so Facebook login can be added the same way as Google.
# Prints code and setting NAMES only. Long key-like strings are masked; secret values are never printed.
API=/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api
cd "$API" || { echo "No $API"; exit 1; }
mask() { sed -E 's/[A-Za-z0-9_+\/=-]{32,}/<masked>/g'; }
echo "== .env setting names (values hidden) =="
grep -hoE '^[A-Za-z_][A-Za-z0-9_]*=' .env 2>/dev/null | tr -d '=' | grep -iE 'FB|FACEBOOK|GOOGLE|JWT|APPLE|FRONT|CLIENT|URL' | sort -u
v=$(grep -E '^FB_APP_ID=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')
[ -n "$v" ] && echo "FB_APP_ID (public app id) = $v"
echo; echo "== files mentioning facebook =="
grep -rniI "facebook\|FB_APP" --exclude-dir=node_modules --exclude-dir=.git . | cut -c1-200 | mask | head -30
echo; echo "== auth routes =="
F=$(grep -rlI "auth/google\|'/google'\|\"/google\"" --exclude-dir=node_modules . | head -5); echo "$F"
for f in $F; do echo "--- $f"; grep -nE "router\.(get|post|put|patch|delete)|app\.(get|post|use)" "$f" | cut -c1-200 | mask | head -40; done
echo; echo "== Google sign-in handler =="
G=$(grep -rlI "verifyIdToken\|id_token\|oauth2/v3/tokeninfo" --exclude-dir=node_modules . | head -3); echo "$G"
for f in $G; do n=$(grep -nE "verifyIdToken|id_token|tokeninfo" "$f" | head -1 | cut -d: -f1); s=$(( n>60 ? n-60 : 1 )); echo "--- $f (lines $s-$((n+110)))"; sed -n "${s},$((n+110))p" "$f" | mask; done
echo; echo "== token helpers =="
grep -rnI "function \(sign\|issue\|generate\|create\)[A-Za-z]*Token\|const \(sign\|issue\|generate\|create\)[A-Za-z]*Token" --exclude-dir=node_modules . | cut -c1-200 | head -10
echo; echo "== node / packages =="; node -v; grep -E '"(google-auth-library|passport[^"]*|jsonwebtoken|axios|node-fetch|express)"' package.json
