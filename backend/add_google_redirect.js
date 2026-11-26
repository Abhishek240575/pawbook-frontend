// Adds POST /auth/google/redirect (Google "redirect" sign-in for phones / the Play Store app) next to Google login.
// Appends googleRedirect to auth.controller.js and mounts the route. Safe to run twice. Backs up first.
// Usage on the server:  node add_google_redirect.js
const fs = require('fs'), path = require('path');
const API = process.env.PB_API_DIR || '/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api';
const BLOCK = fs.readFileSync(path.join(__dirname, 'google_redirect_block.js'), 'utf8');
const MARK = '// ── GOOGLE REDIRECT SIGN-IN (v1)', ROUTE_MARK = '// Google redirect sign-in (v1)';
const GOOGLE_ROUTE = /authRouter\.post\('\/google',\s*\[\s*body\('id_token'\)\.notEmpty\(\),?\s*\],\s*validate,\s*authCtrl\.googleAuth\);/;
let changed = 0;
const ctl = path.join(API, 'src/controllers/auth.controller.js');
const c = fs.readFileSync(ctl, 'utf8');
if (c.includes(MARK)) console.log('auth.controller.js: Google redirect sign-in already present');
else {
  for (const need of ['const googleAuth = async', 'R.ok(', 'logger']) if (!c.includes(need)) { console.error('STOP: auth.controller.js does not look as expected (missing ' + need + ')'); process.exit(1); }
  fs.copyFileSync(ctl, ctl + '.bak-gr1'); fs.writeFileSync(ctl, c.replace(/\s*$/, '\n') + BLOCK); changed++;
  console.log('auth.controller.js: Google redirect sign-in added (backup .bak-gr1)');
}
let mounted = 0;
for (const f of [path.join(API, 'src/routes/index.js'), path.join(API, 'routes/index.js')]) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  if (s.includes(ROUTE_MARK)) { console.log(path.relative(API, f) + ': route already present'); mounted++; continue; }
  const m = s.match(GOOGLE_ROUTE);
  if (!m) { console.log(path.relative(API, f) + ': no Google route found here — left unchanged'); continue; }
  fs.copyFileSync(f, f + '.bak-gr1');
  const add = `\n${ROUTE_MARK}\nauthRouter.post('/google/redirect', require('express').urlencoded({ extended: false, limit: '20kb' }), authCtrl.googleRedirect);`;
  fs.writeFileSync(f, s.replace(m[0], m[0] + add)); changed++; mounted++;
  console.log(path.relative(API, f) + ': POST /auth/google/redirect mounted (backup .bak-gr1)');
}
if (!mounted) { console.error('STOP: could not find where Google login is mounted'); process.exit(1); }
console.log(changed ? 'Done.' : 'Nothing to change.');
