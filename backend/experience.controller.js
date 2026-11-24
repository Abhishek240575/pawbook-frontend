'use strict';
/* ============================================================================
   PawBook Marketplace — Phase 6: verified reviews, coupons, order notifications
   Mounted under /api/v1/shop (see add_shop_routes.js). Requires migrations 003–007.
   ========================================================================== */
const crypto = require('crypto');
const { query } = require('../config/db');
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const money = n => Math.round(Number(n) * 100) / 100;
const uid = u => String(u.user_id);
const fail = (res, where, e) => { console.error('[Shop+] ' + where + ':', e.message); return R.serverError(res); };

// ── notifications (best effort: never breaks the action that triggered it) ──
let notifCols = null;
async function notifInfo() {
  if (notifCols) return notifCols;
  try {
    const { rows } = await query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'notifications'`);
    notifCols = {}; rows.forEach(r => { notifCols[r.column_name] = r.data_type; });
  } catch (e) { notifCols = {}; }
  return notifCols;
}
async function notify(userId, n) {
  try {
    if (!userId) return;
    const c = await notifInfo();
    if (!c.user_id || !c.title) return;
    let who = String(userId);
    if (/int/.test(c.user_id)) {   // table keyed by the numeric user number
      const { rows } = await query(`SELECT user_no FROM users WHERE user_id::text = $1`, [who]);
      if (!rows.length || rows[0].user_no == null) return; who = rows[0].user_no;
    }
    const cols = ['user_id', 'title'], vals = [who, str(n.title, 200)];
    if (c.type) { cols.push('type'); vals.push(n.type || 'shop'); }
    if (c.body) { cols.push('body'); vals.push(n.body || null); }
    if (c.link_url) { cols.push('link_url'); vals.push(n.link || null); }
    if (c.icon_emoji) { cols.push('icon_emoji'); vals.push(n.icon || '🛍️'); }
    await query(`INSERT INTO notifications (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
  } catch (e) { console.error('[Shop+] notify:', e.message); }
}
exports.notify = notify;

// ── reviews ─────────────────────────────────────────────────────────────────
// A review is allowed once the person has an order item for this product that was delivered.
async function deliveredOrder(userId, productId) {
  const { rows } = await query(`SELECT o.order_id FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id
    WHERE o.buyer_id::text = $1 AND oi.product_id::text = $2 AND COALESCE(oi.fulfil_status, '') = 'delivered' ORDER BY o.created_at DESC LIMIT 1`, [userId, productId]);
  return rows[0] ? rows[0].order_id : null;
}
async function eligibility(userId, productId) {
  const { rows: p } = await query(`SELECT seller_id FROM marketplace_products WHERE product_id::text = $1`, [productId]);
  if (!p.length) return { can: false, reason: 'not_found' };
  if (String(p[0].seller_id) === userId) return { can: false, reason: 'own_product' };
  const { rows: mine } = await query(`SELECT rating, title, comment, verified, status, created_at FROM marketplace_reviews WHERE product_id::text = $1 AND user_id::text = $2`, [productId, userId]);
  const order = await deliveredOrder(userId, productId);
  if (!order) {
    const { rows: pend } = await query(`SELECT 1 FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id
      WHERE o.buyer_id::text = $1 AND oi.product_id::text = $2 AND COALESCE(oi.fulfil_status, 'pending') NOT IN ('delivered','cancelled') LIMIT 1`, [userId, productId]);
    return { can: false, reason: pend.length ? 'not_delivered' : 'not_bought', mine: mine[0] || null };
  }
  return { can: true, order_id: order, mine: mine[0] || null };
}

// GET /shop/products/:id/review-eligibility
exports.reviewEligibility = async (req, res) => {
  try { return R.ok(res, await eligibility(uid(req.user), str(req.params.id, 64))); }
  catch (e) { return fail(res, 'reviewEligibility', e); }
};

async function saveReview(userId, productId, b) {
  const rating = toInt(b.rating, 0), title = str(b.title, 120), comment = str(b.comment, 2000);
  if (rating < 1 || rating > 5) return { status: 422, message: 'Please choose 1 to 5 stars', fields: ['rating'] };
  if (comment.length < 10) return { status: 422, message: 'Please write at least 10 characters', fields: ['comment'] };
  const el = await eligibility(userId, productId);
  if (!el.can) return { status: 403, message: el.reason === 'own_product' ? 'You cannot review your own product' : el.reason === 'not_delivered' ? 'You can review this once your order is delivered' : 'Only customers who bought and received this product can review it', reason: el.reason };
  const { rows: ex } = await query(`SELECT review_id FROM marketplace_reviews WHERE product_id::text = $1 AND user_id::text = $2`, [productId, userId]);
  if (ex.length) {
    await query(`UPDATE marketplace_reviews SET rating = $2, title = $3, comment = $4, verified = TRUE, order_id = $5, updated_at = NOW() WHERE review_id = $1`, [ex[0].review_id, rating, title || null, comment, el.order_id]);
    return { status: 200, data: { updated: true } };
  }
  await query(`INSERT INTO marketplace_reviews (review_id, product_id, user_id, rating, title, comment, verified, status, order_id)
    VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'published', $7)`, ['rev_' + crypto.randomUUID().replace(/-/g, ''), productId, userId, rating, title || null, comment, el.order_id]);
  return { status: 201, data: { created: true } };
}
// POST /shop/products/:id/reviews  {rating, title, comment}
exports.postReview = async (req, res) => {
  try {
    const r = await saveReview(uid(req.user), str(req.params.id, 64), req.body || {});
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.message, fields: r.fields, reason: r.reason });
    return res.status(r.status).json({ success: true, message: 'Thanks for your review', data: r.data });
  } catch (e) { return fail(res, 'postReview', e); }
};
// old POST /marketplace/listings/:id/reviews → same verified rules, old handler never runs
exports.legacyReview = async (req, res) => {
  try {
    const b = req.body || {};
    const r = await saveReview(uid(req.user), str(req.params.listing_id, 64), { rating: b.rating, title: b.title, comment: b.comment });
    if (r.status >= 400) return res.status(r.status).json({ success: false, message: r.message });
    return res.status(r.status).json({ success: true, data: { reviewed: true } });
  } catch (e) { return fail(res, 'legacyReview', e); }
};

// GET /shop/reviews/pending → delivered items I have not reviewed yet
exports.pendingReviews = async (req, res) => {
  try {
    const { rows } = await query(`SELECT DISTINCT ON (oi.product_id) oi.product_id::text AS product_id, p.name, COALESCE(oi.image_url, p.images->>0) AS image_url, p.category, o.created_at
      FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
      WHERE o.buyer_id::text = $1 AND oi.fulfil_status = 'delivered'
        AND NOT EXISTS (SELECT 1 FROM marketplace_reviews r WHERE r.product_id::text = oi.product_id::text AND r.user_id::text = $1)
      ORDER BY oi.product_id, o.created_at DESC LIMIT 20`, [uid(req.user)]);
    return R.ok(res, { items: rows });
  } catch (e) { return fail(res, 'pendingReviews', e); }
};

// admin moderation
exports.adminReviews = async (req, res) => {
  try {
    const st = ['published','hidden'].includes(req.query.status) ? req.query.status : null;
    const { rows } = await query(`SELECT r.review_id, r.rating, r.title, r.comment, r.verified, COALESCE(r.status,'published') AS status, r.created_at, r.product_id::text AS product_id,
        p.name AS product_name, u.full_name AS user_name
      FROM marketplace_reviews r LEFT JOIN marketplace_products p ON p.product_id::text = r.product_id::text LEFT JOIN users u ON u.user_id::text = r.user_id::text
      ${st ? 'WHERE COALESCE(r.status,\'published\') = $1' : ''} ORDER BY r.created_at DESC LIMIT 300`, st ? [st] : []);
    return R.ok(res, { reviews: rows });
  } catch (e) { return fail(res, 'adminReviews', e); }
};
exports.adminModerateReview = async (req, res) => {
  try {
    const st = (req.body || {}).status;
    if (!['published','hidden'].includes(st)) return R.badRequest(res, 'Invalid status');
    const { rowCount } = await query(`UPDATE marketplace_reviews SET status = $2, updated_at = NOW() WHERE review_id = $1`, [str(req.params.id, 64), st]);
    if (!rowCount) return R.notFound(res, 'Review not found');
    return R.ok(res, { status: st });
  } catch (e) { return fail(res, 'adminModerateReview', e); }
};

// ── coupons ─────────────────────────────────────────────────────────────────
const COUPON_COLS = 'code, description, kind, value, min_order, max_discount, starts_at, ends_at, usage_limit, per_user_limit, first_order_only, is_public, is_active';
function couponDiscount(c, subtotal) {
  const v = Number(c.value);
  let d = c.kind === 'flat' ? v : subtotal * v / 100;
  if (c.kind === 'percent' && c.max_discount != null) d = Math.min(d, Number(c.max_discount));
  return money(Math.min(d, subtotal));
}
// Check a code for this user and subtotal. q lets it run inside the order transaction.
async function checkCoupon(q, userId, code, subtotal, lock) {
  code = str(code, 20).toUpperCase();
  if (!code) return { error: 'Enter a coupon code' };
  const { rows } = await q(`SELECT ${COUPON_COLS} FROM marketplace_coupons WHERE code = $1` + (lock ? ' FOR UPDATE' : ''), [code]);
  const c = rows[0], now = Date.now();
  if (!c || !c.is_active) return { error: 'This coupon code is not valid' };
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return { error: 'This coupon is not active yet' };
  if (c.ends_at && new Date(c.ends_at).getTime() < now) return { error: 'This coupon has expired' };
  if (subtotal < Number(c.min_order)) return { error: 'Add items worth ₹' + money(Number(c.min_order) - subtotal) + ' more to use this coupon', min_order: Number(c.min_order) };
  const { rows: u } = await q(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE user_id = $2)::int AS mine FROM marketplace_coupon_redemptions WHERE code = $1`, [code, userId]);
  if (c.usage_limit != null && u[0].total >= c.usage_limit) return { error: 'This coupon has been fully used' };
  if (u[0].mine >= Number(c.per_user_limit || 1)) return { error: 'You have already used this coupon' };
  if (c.first_order_only) {
    const { rows: o } = await q(`SELECT 1 FROM marketplace_orders WHERE buyer_id::text = $1 AND COALESCE(status,'') <> 'cancelled' LIMIT 1`, [userId]);
    if (o.length) return { error: 'This coupon is for your first order only' };
  }
  return { coupon: c, code, discount: couponDiscount(c, subtotal) };
}
exports.checkCoupon = checkCoupon;

// GET /shop/coupons?subtotal= → public coupons, marked usable or not for this cart
exports.listCoupons = async (req, res) => {
  try {
    const sub = Math.max(0, Number(req.query.subtotal) || 0), me = uid(req.user);
    const { rows } = await query(`SELECT ${COUPON_COLS} FROM marketplace_coupons WHERE is_active AND is_public
      AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at > NOW()) ORDER BY value DESC LIMIT 20`);
    const out = [];
    for (const c of rows) {
      const r = await checkCoupon(query, me, c.code, sub, false);
      if (r.error === 'This coupon has been fully used' || r.error === 'You have already used this coupon' || r.error === 'This coupon is for your first order only') continue;
      out.push({ code: c.code, description: c.description, kind: c.kind, value: Number(c.value), min_order: Number(c.min_order), max_discount: c.max_discount == null ? null : Number(c.max_discount),
        ends_at: c.ends_at, usable: !r.error, discount: r.discount || 0, note: r.error || null });
    }
    return R.ok(res, { coupons: out });
  } catch (e) { return fail(res, 'listCoupons', e); }
};

// admin coupons
exports.adminCoupons = async (req, res) => {
  try {
    const { rows } = await query(`SELECT ${COUPON_COLS}, created_at, (SELECT COUNT(*)::int FROM marketplace_coupon_redemptions r WHERE r.code = c.code) AS used,
        (SELECT COALESCE(SUM(discount),0)::float FROM marketplace_coupon_redemptions r WHERE r.code = c.code) AS given
      FROM marketplace_coupons c ORDER BY created_at DESC`);
    return R.ok(res, { coupons: rows });
  } catch (e) { return fail(res, 'adminCoupons', e); }
};
exports.adminSaveCoupon = async (req, res) => {
  try {
    const b = req.body || {}, e = [];
    const code = str(b.code || req.params.code, 20).toUpperCase();
    const kind = b.kind === 'flat' ? 'flat' : 'percent';
    const value = Number(b.value), minOrder = b.min_order === '' || b.min_order == null ? 0 : Number(b.min_order);
    const maxD = b.max_discount === '' || b.max_discount == null ? null : Number(b.max_discount);
    const lim = b.usage_limit === '' || b.usage_limit == null ? null : toInt(b.usage_limit, -1);
    const per = toInt(b.per_user_limit, 1);
    const starts = b.starts_at ? new Date(b.starts_at) : null, ends = b.ends_at ? new Date(b.ends_at) : null;
    if (!/^[A-Z0-9]{4,20}$/.test(code)) e.push('code');
    if (!(value > 0) || (kind === 'percent' && value > 90) || (kind === 'flat' && value > 100000)) e.push('value');
    if (!(minOrder >= 0)) e.push('min_order');
    if (maxD != null && !(maxD > 0)) e.push('max_discount');
    if (lim != null && !(lim >= 1)) e.push('usage_limit');
    if (!(per >= 1 && per <= 100)) e.push('per_user_limit');
    if ((starts && isNaN(starts)) || (ends && isNaN(ends)) || (starts && ends && ends <= starts)) e.push('ends_at');
    if (kind === 'flat' && !(minOrder > value)) e.push('min_order');   // a flat coupon needs a minimum order above its value
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    const vals = [code, str(b.description, 160) || null, kind, value, minOrder, kind === 'percent' ? maxD : null, starts, ends, lim, per, b.first_order_only === true, b.is_public !== false, b.is_active !== false];
    if (req.method === 'POST') {
      const { rows: ex } = await query(`SELECT 1 FROM marketplace_coupons WHERE code = $1`, [code]);
      if (ex.length) return R.badRequest(res, 'A coupon with this code already exists');
      await query(`INSERT INTO marketplace_coupons (code, description, kind, value, min_order, max_discount, starts_at, ends_at, usage_limit, per_user_limit, first_order_only, is_public, is_active, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, vals.concat([uid(req.user)]));
      return R.created(res, { code });
    }
    const { rowCount } = await query(`UPDATE marketplace_coupons SET description=$2, kind=$3, value=$4, min_order=$5, max_discount=$6, starts_at=$7, ends_at=$8,
        usage_limit=$9, per_user_limit=$10, first_order_only=$11, is_public=$12, is_active=$13, updated_at=NOW() WHERE code = $1`, vals);
    if (!rowCount) return R.notFound(res, 'Coupon not found');
    return R.ok(res, { code });
  } catch (e) { return fail(res, 'adminSaveCoupon', e); }
};
