
// ── GOOGLE REDIRECT SIGN-IN (v1) ── added by add_google_redirect.js ──
// For phones / the Play Store app, where Google's popup cannot report back to the page. Google sends the person back
// here with a form POST { credential, g_csrf_token }; we run the SAME checks as googleAuth above (it is called as-is),
// then send them to the login page with the result in the URL #fragment (never sent to any server or written to logs).
const GSI_RETURN = 'https://pawbook.deemona.com/01_login.html';
const googleRedirect = async (req, res) => {
  const back = (frag) => res.redirect(303, GSI_RETURN + '#' + frag);
  try {
    const body = req.body || {};
    const credential = String(body.credential || '');
    if (!credential || credential.length > 5000) return back('gerr=' + encodeURIComponent('Google sign-in did not complete. Please try again.'));
    // CSRF check recommended by Google: the cookie and the posted value must match (when the browser sent the cookie)
    const ck = String(req.headers.cookie || '').split(/;\s*/).map((s) => s.split('=')).find((p) => p[0] === 'g_csrf_token');
    if (ck && ck[1] !== String(body.g_csrf_token || '')) return back('gerr=' + encodeURIComponent('Google sign-in could not be verified. Please try again.'));
    let status = 200, out = null, failed = null;
    const shim = { status(c) { status = c; return shim; }, json(o) { out = o; return shim; } };
    await googleAuth({ body: { id_token: credential }, headers: req.headers, ip: req.ip }, shim, (e) => { failed = e || new Error('failed'); });
    if (failed || !out || !out.success || !out.data || !out.data.token) {
      if (failed) logger.error('Google redirect sign-in failed', { message: failed.message });
      return back('gerr=' + encodeURIComponent((out && out.message) || 'Google sign-in failed. Please try again.'));
    }
    const payload = Buffer.from(JSON.stringify({ token: out.data.token, refresh: out.data.refresh, user: out.data.user })).toString('base64url');
    res.set('Cache-Control', 'no-store');
    return back('g=' + payload);
  } catch (err) {
    logger.error('Google redirect sign-in error', { message: err && err.message });
    return back('gerr=' + encodeURIComponent('Google sign-in failed. Please try again.'));
  }
};
module.exports.googleRedirect = googleRedirect;
// ── END GOOGLE REDIRECT SIGN-IN ──
