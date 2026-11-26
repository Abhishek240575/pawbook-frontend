
// ── FACEBOOK LOGIN (v1) ── added by add_facebook_auth.js; same flow as googleAuth above ──
// The page sends the short-lived access token from Facebook's own sign-in window. We check it with Facebook
// using the app secret (kept in .env, never sent to the browser), then log the person in or create the account.
const fbCrypto = require('crypto');
const FB_GRAPH = 'https://graph.facebook.com/v26.0';
const fbGet = async (url) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try { const r = await fetch(url, { signal: ctl.signal }); return await r.json().catch(() => ({})); }
  finally { clearTimeout(t); }
};
const facebookAuth = async (req, res, next) => {
  const access_token = String((req.body && req.body.access_token) || '').trim();
  if (!access_token || access_token.length > 1000) return R.badRequest(res, 'Facebook access token required');
  const appId = String(process.env.FB_APP_ID || '').trim(), appSecret = String(process.env.FB_APP_SECRET || '').trim();
  if (!appId || !appSecret) { logger.error('Facebook login: FB_APP_ID / FB_APP_SECRET missing'); return res.status(503).json({ success: false, message: 'Facebook login is not available right now.' }); }
  try {
    // 1. Is this token real, unexpired and issued for OUR app?
    const dbg = await fbGet(`${FB_GRAPH}/debug_token?input_token=${encodeURIComponent(access_token)}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`);
    const d = (dbg && dbg.data) || {};
    if (!d.is_valid || String(d.app_id) !== appId || !d.user_id) return R.unauthorized(res, 'Facebook sign-in could not be verified. Please try again.');
    // 2. Profile (appsecret_proof proves the call comes from our server)
    const proof = fbCrypto.createHmac('sha256', appSecret).update(access_token).digest('hex');
    const p = await fbGet(`${FB_GRAPH}/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(access_token)}&appsecret_proof=${proof}`);
    if (!p || !p.id || String(p.id) !== String(d.user_id)) return R.unauthorized(res, 'Could not read your Facebook profile. Please try again.');
    const facebook_id = String(p.id), email = p.email ? String(p.email).toLowerCase() : null;
    const name = String(p.name || '').trim() || 'Pet Parent';
    const picture = (p.picture && p.picture.data && !p.picture.data.is_silhouette && p.picture.data.url) || '';

    const client = await getClient();
    let user;
    try {
      await client.query('BEGIN');
      // 3. Find by Facebook id first, then by email (links an existing PawBook account)
      let { rows } = await client.query(
        `SELECT user_id, username, email, full_name, role, status, is_verified, avatar_url
           FROM users WHERE facebook_id = $1 AND deleted_at IS NULL LIMIT 1`, [facebook_id]);
      if (!rows.length && email) {
        ({ rows } = await client.query(
          `SELECT user_id, username, email, full_name, role, status, is_verified, avatar_url
             FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL LIMIT 1`, [email]));
      }
      if (rows.length) {
        user = rows[0];
        await client.query(
          `UPDATE users
              SET facebook_id = $1, avatar_url = COALESCE(NULLIF(avatar_url,''), NULLIF($2,'')),
                  status = CASE WHEN status='pending_verify' THEN 'active' ELSE status END,
                  last_login_at = NOW(), updated_at = NOW()
            WHERE user_id = $3`, [facebook_id, picture, user.user_id]);
        if (user.status === 'pending_verify') user.status = 'active';
      } else {
        if (!email) { await client.query('ROLLBACK'); return R.badRequest(res, 'Your Facebook account did not share an email address. Please allow email access, or sign up with email instead.'); }
        const username = await generateUniqueUsername(client, /[a-z0-9]{3}/i.test(name) ? name : 'pet_parent');
        const result = await client.query(
          `INSERT INTO users (username, email, full_name, avatar_url, facebook_id, role, status, is_verified, password_hash)
           VALUES ($1, $2, $3, $4, $5, 'pet_owner', 'active', true, '')
           RETURNING user_id, user_no, username, email, full_name, role, status, is_verified, avatar_url`,
          [username, email, name, picture, facebook_id]);
        user = result.rows[0];
        logger.info('New user via Facebook login', { user_id: user.user_id });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    if (user.status === 'suspended') return R.forbidden(res, 'Account suspended. Contact support@deemona.com');
    if (user.status === 'deactivated') return R.forbidden(res, 'Account deactivated.');
    const token = signToken(user.user_id, user.role);
    const refresh = signRefresh(user.user_id);
    return R.ok(res, { user, token, refresh }, 'Facebook login successful');
  } catch (err) {
    if (err && err.name === 'AbortError') return res.status(504).json({ success: false, message: 'Facebook did not respond. Please try again.' });
    next(err);
  }
};
module.exports.facebookAuth = facebookAuth;
// ── END FACEBOOK LOGIN ──
