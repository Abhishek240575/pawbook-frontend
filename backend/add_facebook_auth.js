// Adds Facebook login next to Google login: appends facebookAuth to auth.controller.js and mounts
// POST /auth/facebook in the route file(s). Safe to run twice (skips what is already there). Backs up first.
// Usage on the server:  node add_facebook_auth.js
const fs = require('fs'), path = require('path');
const API = process.env.PB_API_DIR || '/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api';
const BLOCK = fs.readFileSync(path.join(__dirname, 'facebook_auth_block.js'), 'utf8');
const MARK = '// ── FACEBOOK LOGIN (v1)';
const ROUTE_MARK = '// Facebook login (v1)';
const GOOGLE_ROUTE = /authRouter\.post\('\/google',\s*\[\s*body\('id_token'\)\.notEmpty\(\),?\s*\],\s*validate,\s*authCtrl\.googleAuth\);/;
let changed = 0;
const ctl = path.join(API, 'src/controllers/auth.controller.js');
let c = fs.readFileSync(ctl, 'utf8');
if (c.includes(MARK)) console.log('auth.controller.js: Facebook login already present');
else {
  for (const need of ['const googleAuth = async', 'signRefresh', 'getClient', 'generateUniqueUsername', 'R.ok(']) if (!c.includes(need)) { console.error('STOP: auth.controller.js does not look as expected (missing ' + need + ')'); process.exit(1); }
  fs.copyFileSync(ctl, ctl + '.bak-fb1'); fs.writeFileSync(ctl, c.replace(/\s*$/, '\n') + BLOCK); changed++;
  console.log('auth.controller.js: Facebook login added (backup .bak-fb1)');
}
let mounted = 0;
for (const f of [path.join(API, 'src/routes/index.js'), path.join(API, 'routes/index.js')]) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  if (s.includes(ROUTE_MARK)) { console.log(path.relative(API, f) + ': route already present'); mounted++; continue; }
  const m = s.match(GOOGLE_ROUTE);
  if (!m) { console.log(path.relative(API, f) + ': no Google route found here — left unchanged'); continue; }
  fs.copyFileSync(f, f + '.bak-fb1');
  const add = `\n${ROUTE_MARK}\nauthRouter.post('/facebook', [\n  body('access_token').isString().notEmpty(),\n], validate, authCtrl.facebookAuth);`;
  fs.writeFileSync(f, s.replace(m[0], m[0] + add)); changed++; mounted++;
  console.log(path.relative(API, f) + ': POST /auth/facebook mounted (backup .bak-fb1)');
}
if (!mounted) { console.error('STOP: could not find where Google login is mounted'); process.exit(1); }
console.log(changed ? 'Done.' : 'Nothing to change.');
