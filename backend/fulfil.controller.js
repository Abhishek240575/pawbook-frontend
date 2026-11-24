'use strict';
/* ============================================================================
   PawBook Marketplace — Phase 5 (rest) + Phase 8
   Returns & refunds, payout deductions, ship-by deadline, packing slip data,
   health check, product sitemap, simple rate limiter.
   Mounted under /api/v1/shop (see add_shop_routes.js). Requires migrations 003–010.
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');
const getClient = db.getClient || (() => db.pool.connect());
const exp = () => require('./experience.controller');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = u => String(u.user_id);
const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const money = n => Math.round((Number(n) || 0) * 100) / 100;
const parseJ = (v, d) => { if (v == null) return d; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return d; } } return v; };
const fail = (res, where, e) => { console.error('[Fulfil] ' + where + ':', e.message); return R.serverError(res); };
const SELLER = `COALESCE(oi.seller_id, p.seller_id)::text`;
const REASONS = ['damaged', 'wrong_item', 'not_as_described', 'quality', 'other'];
const UPI_RX = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/;
const LIVE = ['requested', 'approved', 'received', 'refunded'];     // statuses that block a payout for the item

async function setting(key, d) {
  try { const { rows } = await query(`SELECT value FROM marketplace_settings WHERE key = $1`, [key]); return rows.length ? rows[0].value : d; } catch (e) { return d; }
}
async function fulfilSettings() {
  return {
    return_window_days: Math.min(60, Math.max(0, toInt(await setting('return_window_days', '7'), 7))),
    dispatch_days: Math.min(15, Math.max(1, toInt(await setting('dispatch_days', '2'), 2)))
  };
}
exports.fulfilSettings = fulfilSettings;
async function admins() { const { rows } = await query(`SELECT user_id::text AS id FROM users WHERE role = 'admin' LIMIT 20`).catch(() => ({ rows: [] })); return rows.map(r => r.id); }
function tell(ids, n) { (Array.isArray(ids) ? ids : [ids]).filter(Boolean).forEach(id => exp().notify(id, n)); }

// ═══ Settings (admin) ═══════════════════════════════════════════════════════
exports.adminGetFulfil = async (req, res) => { try { return R.ok(res, await fulfilSettings()); } catch (e) { return fail(res, 'adminGetFulfil', e); } };
exports.adminSaveFulfil = async (req, res) => {
  try {
    const b = req.body || {}, rw = Number(b.return_window_days), dd = Number(b.dispatch_days), e = [];
    if (!(Number.isInteger(rw) && rw >= 0 && rw <= 60)) e.push('return_window_days');
    if (!(Number.isInteger(dd) && dd >= 1 && dd <= 15)) e.push('dispatch_days');
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    for (const [k, v] of [['return_window_days', rw], ['dispatch_days', dd]])
      await query(`INSERT INTO marketplace_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [k, String(v)]);
    return R.ok(res, await fulfilSettings());
  } catch (e) { return fail(res, 'adminSaveFulfil', e); }
};
// public: lets order pages show the return window / ship-by rules
exports.publicSettings = async (req, res) => { try { res.setHeader('Cache-Control', 'public, max-age=300'); return R.ok(res, await fulfilSettings()); } catch (e) { return fail(res, 'publicSettings', e); } };

// ═══ Returns: buyer ═════════════════════════════════════════════════════════
const RET_COLS = `r.return_id, r.order_id, r.item_id, r.amount::float AS amount, r.reason, r.details, r.status, r.refund_to, r.seller_note, r.admin_note,
  r.refund_method, r.refund_ref, r.created_at, r.decided_at, r.received_at, r.refunded_at, o.order_number, o.payment_method,
  oi.name, oi.variant, oi.quantity, oi.price::float AS price, COALESCE(oi.image_url, p.images->>0) AS image_url, COALESCE(s.store_name, su.full_name) AS store_name`;
const RET_FROM = `FROM marketplace_returns r JOIN marketplace_orders o ON o.order_id = r.order_id
  JOIN marketplace_order_items oi ON oi.item_id::text = r.item_id LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
  LEFT JOIN marketplace_sellers s ON s.user_id::text = r.seller_id LEFT JOIN users su ON su.user_id::text = r.seller_id`;

// GET /shop/returns?order_id=   (the buyer's own) — also tells which items can still be returned
exports.myReturns = async (req, res) => {
  try {
    const me = uid(req.user), oid = str(req.query.order_id, 64), set = await fulfilSettings();
    const p = [me]; let w = 'r.buyer_id = $1';
    if (oid) { p.push(oid); w += ' AND r.order_id = $2'; }
    const { rows } = await query(`SELECT ${RET_COLS} ${RET_FROM} WHERE ${w} ORDER BY r.created_at DESC LIMIT 100`, p);
    let eligible = [];
    if (oid) {
      const { rows: it } = await query(`SELECT oi.item_id::text AS item_id, oi.status_updated_at FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id
        WHERE o.order_id = $1 AND o.buyer_id::text = $2 AND oi.fulfil_status = 'delivered'
          AND NOT EXISTS (SELECT 1 FROM marketplace_returns r WHERE r.item_id = oi.item_id::text AND r.status <> 'cancelled')
          AND COALESCE(oi.status_updated_at, o.created_at) > NOW() - ($3::int * INTERVAL '1 day')`, [oid, me, set.return_window_days]);
      eligible = it.map(r => ({ item_id: r.item_id, until: new Date(new Date(r.status_updated_at).getTime() + set.return_window_days * 86400000) }));
    }
    return R.ok(res, { returns: rows, eligible, settings: set, reasons: REASONS });
  } catch (e) { return fail(res, 'myReturns', e); }
};

// POST /shop/orders/:id/returns {item_id, reason, details, refund_to}
exports.createReturn = async (req, res) => {
  try {
    const me = uid(req.user), oid = str(req.params.id, 64), b = req.body || {}, set = await fulfilSettings();
    if (!set.return_window_days) return res.status(409).json({ success: false, message: 'Returns are not available right now' });
    const { rows } = await query(`SELECT oi.item_id::text AS item_id, oi.price, oi.quantity, oi.fulfil_status, oi.status_updated_at, oi.name, ${SELLER} AS seller,
        o.order_number, o.payment_method, o.created_at
      FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
      WHERE o.order_id = $1 AND o.buyer_id::text = $2 AND oi.item_id::text = $3`, [oid, me, str(b.item_id, 64)]);
    if (!rows.length) return R.notFound(res, 'Item not found in your order');
    const it = rows[0];
    if (it.fulfil_status !== 'delivered') return res.status(409).json({ success: false, message: 'Only delivered items can be returned' });
    if (new Date(it.status_updated_at || it.created_at).getTime() + set.return_window_days * 86400000 < Date.now())
      return res.status(409).json({ success: false, code: 'window_closed', message: `The ${set.return_window_days}-day return window for this item has closed` });
    const reason = str(b.reason, 30), details = str(b.details, 1000), refundTo = str(b.refund_to, 80), e = [];
    if (!REASONS.includes(reason)) e.push('reason');
    if (details.length < 10) e.push('details');
    if (it.payment_method === 'cod' && !UPI_RX.test(refundTo)) e.push('refund_to');
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    const { rows: prev } = await query(`SELECT status FROM marketplace_returns WHERE item_id = $1 AND status <> 'cancelled' LIMIT 1`, [it.item_id]);
    if (prev.length) return res.status(409).json({ success: false, message: prev[0].status === 'rejected' ? 'A return for this item was already declined. Please contact support@deemona.com if you need help.' : 'A return has already been requested for this item' });
    let r;
    try {
      r = await query(`INSERT INTO marketplace_returns (order_id, item_id, buyer_id, seller_id, amount, reason, details, refund_to)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING return_id, status`, [oid, it.item_id, me, it.seller, money(Number(it.price) * it.quantity), reason, details, refundTo || null]);
    } catch (x) {
      if (x.code === '23505') return res.status(409).json({ success: false, message: 'A return has already been requested for this item' });
      throw x;
    }
    const n = { type: 'shop_return', icon: '↩️', title: 'Return requested · ' + it.order_number, body: it.name + ' — ' + reason.replace(/_/g, ' '), link: '50_seller_hub.html?tab=orders&f=returns' };
    tell(it.seller, n); tell(await admins(), Object.assign({}, n, { link: '48_shop_admin.html?tab=returns' }));
    return R.created(res, { return_id: r.rows[0].return_id, status: r.rows[0].status });
  } catch (e) { return fail(res, 'createReturn', e); }
};

// POST /shop/returns/:id/cancel  (buyer, while still requested)
exports.cancelReturn = async (req, res) => {
  try {
    const { rows } = await query(`UPDATE marketplace_returns SET status = 'cancelled', updated_at = NOW() WHERE return_id = $1 AND buyer_id = $2 AND status = 'requested' RETURNING return_id`,
      [toInt(req.params.id, 0), uid(req.user)]);
    if (!rows.length) return res.status(409).json({ success: false, message: 'This return can no longer be withdrawn' });
    return R.ok(res, { cancelled: true });
  } catch (e) { return fail(res, 'cancelReturn', e); }
};

// ═══ Returns: seller + admin ════════════════════════════════════════════════
const MOVES = { approve: ['requested', 'approved'], reject: ['requested', 'rejected'], received: ['approved', 'received'] };
async function listReturns(where, params, status) {
  const p = params.slice(); let w = where;
  if (status === 'open') w += ` AND r.status IN ('requested','approved','received')`;
  else if (['requested', 'approved', 'received', 'refunded', 'rejected', 'cancelled'].includes(status)) { p.push(status); w += ` AND r.status = $${p.length}`; }
  const { rows } = await query(`SELECT ${RET_COLS}, u.full_name AS buyer_name, o.delivery_address->>'city' AS city, o.delivery_address->>'pincode' AS pincode
    ${RET_FROM} LEFT JOIN users u ON u.user_id::text = r.buyer_id WHERE ${w} ORDER BY r.created_at DESC LIMIT 200`, p);
  const { rows: c } = await query(`SELECT r.status, COUNT(*)::int AS n FROM marketplace_returns r WHERE ${where} GROUP BY 1`, params);
  const counts = {}; c.forEach(x => { counts[x.status] = x.n; });
  counts.open = (counts.requested || 0) + (counts.approved || 0) + (counts.received || 0);
  return { returns: rows, counts };
}
exports.sellerReturns = async (req, res) => { try { return R.ok(res, await listReturns('r.seller_id = $1', [uid(req.user)], str(req.query.status, 20) || 'open')); } catch (e) { return fail(res, 'sellerReturns', e); } };
exports.adminReturns = async (req, res) => { try { return R.ok(res, await listReturns('TRUE', [], str(req.query.status, 20) || 'open')); } catch (e) { return fail(res, 'adminReturns', e); } };

async function decide(req, res, asAdmin) {
  const id = toInt(req.params.id, 0), b = req.body || {}, action = str(b.action, 20), note = str(b.note, 500) || null;
  let client;
  try {
    if (!MOVES[action] && !(asAdmin && action === 'refunded')) return R.badRequest(res, 'Unknown action');
    if (action === 'reject' && (!note || note.length < 5)) return res.status(422).json({ success: false, message: 'Please give the buyer a reason', fields: ['note'] });
    client = await getClient();
    const q = (t, p) => client.query(t, p);
    await q('BEGIN');
    const { rows } = await q(`SELECT r.*, o.order_number, o.payment_method, oi.name, oi.payout_id FROM marketplace_returns r JOIN marketplace_orders o ON o.order_id = r.order_id
      JOIN marketplace_order_items oi ON oi.item_id::text = r.item_id WHERE r.return_id = $1 ${asAdmin ? '' : 'AND r.seller_id = $2'} FOR UPDATE OF r`, asAdmin ? [id] : [id, uid(req.user)]);
    if (!rows.length) { await q('ROLLBACK'); return R.notFound(res, 'Return not found'); }
    const r = rows[0];
    let to;
    if (action === 'refunded') {
      if (!['approved', 'received'].includes(r.status)) { await q('ROLLBACK'); return res.status(409).json({ success: false, message: 'Refund only after the return is approved' }); }
      const ref = str(b.refund_ref, 80), method = str(b.refund_method, 20);
      if (ref.length < 4 || !['upi', 'bank', 'other'].includes(method)) { await q('ROLLBACK'); return res.status(422).json({ success: false, message: 'Please enter how the refund was sent and its reference', fields: ref.length < 4 ? ['refund_ref'] : ['refund_method'] }); }
      to = 'refunded';
      await q(`UPDATE marketplace_returns SET status = 'refunded', refund_ref = $2, refund_method = $3, admin_note = COALESCE($4::text, admin_note), refunded_at = NOW(), updated_at = NOW() WHERE return_id = $1`, [id, ref, method, note]);
      // seller was already paid for this item → take it back from the next payout (what they actually received for it)
      if (r.payout_id && r.seller_id) {
        const { rows: py } = await q(`SELECT commission_pct FROM marketplace_payouts WHERE payout_id = $1`, [r.payout_id]);
        const pct = py.length ? Number(py[0].commission_pct) : 0, amt = money(Number(r.amount) * (1 - pct / 100));
        if (amt > 0) await q(`INSERT INTO marketplace_payout_adjustments (seller_id, amount, reason, return_id) VALUES ($1,$2,$3,$4) ON CONFLICT (return_id) DO NOTHING`,
          [r.seller_id, amt, 'Refund for ' + r.order_number + ' · ' + r.name, id]);
      }
    } else {
      const [from, next] = MOVES[action];
      if (r.status !== from) { await q('ROLLBACK'); return res.status(409).json({ success: false, message: `This return is ${r.status}; it can't be ${next} now` }); }
      to = next;
      await q(`UPDATE marketplace_returns SET status = $2::text, ${asAdmin ? 'admin_note' : 'seller_note'} = COALESCE($3::text, ${asAdmin ? 'admin_note' : 'seller_note'}),
          decided_by = COALESCE(decided_by, $4::text), decided_at = CASE WHEN $2::text IN ('approved','rejected') THEN NOW() ELSE decided_at END,
          received_at = CASE WHEN $2::text = 'received' THEN NOW() ELSE received_at END, updated_at = NOW() WHERE return_id = $1`, [id, to, note, uid(req.user)]);
    }
    await q('COMMIT');
    const M = { approved: ['✅', 'Return approved', 'Keep the item packed; the seller will arrange pickup.'], rejected: ['❌', 'Return not accepted', note],
      received: ['📦', 'Returned item received', 'Your refund is being processed.'], refunded: ['💸', 'Refund sent', 'Reference: ' + str(b.refund_ref, 80)] };
    tell(r.buyer_id, { type: 'shop_return', icon: M[to][0], title: M[to][1] + ' · ' + r.order_number, body: M[to][2] || null, link: '53_shop_orders.html?id=' + encodeURIComponent(r.order_id) });
    if (to === 'received') tell(await admins(), { type: 'shop_return', icon: '💸', title: 'Refund due · ' + r.order_number, body: r.name, link: '48_shop_admin.html?tab=returns' });
    if (to === 'refunded' && r.seller_id) tell(r.seller_id, { type: 'shop_return', icon: '💸', title: 'Refund issued · ' + r.order_number, body: r.name + (r.payout_id ? ' — will be deducted from your next payout' : ''), link: '50_seller_hub.html?tab=earnings' });
    return R.ok(res, { return_id: id, status: to });
  } catch (e) { if (client) { try { await client.query('ROLLBACK'); } catch (x) {} } return fail(res, 'decide', e); }
  finally { if (client) client.release(); }
}
exports.sellerDecide = (req, res) => decide(req, res, false);
exports.adminDecide = (req, res) => decide(req, res, true);

// ═══ Packing slip (seller's part of one order) ══════════════════════════════
// GET /shop/seller/orders/:id
exports.sellerOrder = async (req, res) => {
  try {
    const me = uid(req.user), set = await fulfilSettings();
    const { rows } = await query(`SELECT o.order_id, o.order_number, o.created_at, o.delivery_address, o.payment_method, o.payment_status, u.full_name AS buyer_name,
        json_agg(json_build_object('item_id', oi.item_id, 'name', oi.name, 'variant', oi.variant, 'quantity', oi.quantity, 'price', oi.price, 'status', COALESCE(oi.fulfil_status, 'pending'),
          'tracking', oi.tracking, 'sku', p.sku) ORDER BY oi.item_id) AS items
      FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
      LEFT JOIN users u ON u.user_id::text = o.buyer_id::text
      WHERE o.order_id = $1 AND ${SELLER} = $2 GROUP BY o.order_id, u.full_name`, [str(req.params.id, 64), me]);
    if (!rows.length) return R.notFound(res, 'Order not found');
    const o = rows[0]; o.delivery_address = parseJ(o.delivery_address, {}); o.items = parseJ(o.items, []);
    o.amount = money(o.items.filter(i => i.status !== 'cancelled').reduce((s, i) => s + Number(i.price) * i.quantity, 0));
    o.ship_by = new Date(new Date(o.created_at).getTime() + set.dispatch_days * 86400000);
    // for the COD label: the courier collects the whole order total only when this seller ships everything in it
    const { rows: tt } = await query(`SELECT o.total::float AS total, COUNT(DISTINCT ${SELLER})::int AS sellers FROM marketplace_orders o JOIN marketplace_order_items oi ON oi.order_id = o.order_id
      LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text WHERE o.order_id = $1 AND COALESCE(oi.fulfil_status, 'pending') <> 'cancelled' GROUP BY o.total`, [o.order_id]);
    o.single_seller = !tt.length || tt[0].sellers <= 1;
    o.collect = o.payment_method === 'cod' ? (o.single_seller && tt.length ? money(tt[0].total) : o.amount) : 0;
    // COD: the courier collects only this seller's share when orders ship separately — show it on the slip
    const { rows: st } = await query(`SELECT store_name, phone, pickup_address, city, state, pincode, gstin FROM marketplace_sellers WHERE user_id::text = $1`, [me]);
    o.store = st[0] || null;
    return R.ok(res, { order: o });
  } catch (e) { return fail(res, 'sellerOrder', e); }
};

// ═══ Payout deductions (used by reports.controller) ═════════════════════════
async function openDeductions(sellerIds) {
  if (!sellerIds.length) return {};
  const { rows } = await query(`SELECT seller_id, SUM(amount)::float AS amount, COUNT(*)::int AS n FROM marketplace_payout_adjustments WHERE payout_id IS NULL AND seller_id = ANY($1::text[]) GROUP BY 1`, [sellerIds]);
  const by = {}; rows.forEach(r => { by[r.seller_id] = { amount: money(r.amount), n: r.n }; }); return by;
}
exports.openDeductions = openDeductions;
// SQL fragment: item has no live return (so it can be paid out)
exports.NO_LIVE_RETURN = `NOT EXISTS (SELECT 1 FROM marketplace_returns rr WHERE rr.item_id = oi.item_id::text AND rr.status IN ('${LIVE.join("','")}'))`;

// ═══ Phase 8: health, sitemap, rate limit ═══════════════════════════════════
// GET /shop/health
exports.health = async (req, res) => {
  const t0 = Date.now();
  try {
    const { rows } = await query(`SELECT to_regclass('marketplace_products') IS NOT NULL AS products, to_regclass('marketplace_orders') IS NOT NULL AS orders,
      to_regclass('marketplace_coupons') IS NOT NULL AS m007, to_regclass('marketplace_seller_kyc') IS NOT NULL AS m008,
      to_regclass('marketplace_payouts') IS NOT NULL AS m009, to_regclass('marketplace_returns') IS NOT NULL AS m010`);
    const m = rows[0], ok = Object.values(m).every(Boolean);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(ok ? 200 : 503).json({ success: ok, data: { ok, db_ms: Date.now() - t0, schema: m, uptime_s: Math.round(process.uptime()), time: new Date().toISOString() } });
  } catch (e) {
    console.error('[Fulfil] health:', e.message);
    return res.status(503).json({ success: false, data: { ok: false, db: 'unreachable' } });
  }
};

// GET /shop/sitemap.xml
const SITE = 'https://pawbook.deemona.com';
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
exports.sitemap = async (req, res) => {
  try {
    const urls = [[SITE + '/42_shop.html', null, 'daily', '1.0'], [SITE + '/45_shop_brands.html', null, 'weekly', '0.6']];
    const pets = ['dog', 'cat', 'bird', 'fish', 'small_pet'];
    pets.forEach(p => urls.push([SITE + '/43_shop_list.html?pet=' + p, null, 'daily', '0.7']));
    const [pr, br] = await Promise.all([
      query(`SELECT product_id::text AS id, updated_at FROM marketplace_products WHERE is_active = TRUE AND COALESCE(moderation, 'approved') = 'approved' ORDER BY updated_at DESC NULLS LAST LIMIT 45000`),
      query(`SELECT slug FROM marketplace_brands WHERE is_active = TRUE LIMIT 2000`).catch(() => ({ rows: [] }))
    ]);
    pr.rows.forEach(r => urls.push([SITE + '/44_shop_product.html?id=' + encodeURIComponent(r.id), r.updated_at, 'weekly', '0.8']));
    br.rows.forEach(r => r.slug && urls.push([SITE + '/46_shop_brand.html?b=' + encodeURIComponent(r.slug), null, 'weekly', '0.5']));
    const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + urls.map(u => '  <url><loc>' + xmlEsc(u[0]) + '</loc>' + (u[1] ? '<lastmod>' + new Date(u[1]).toISOString().slice(0, 10) + '</lastmod>' : '') + '<changefreq>' + u[2] + '</changefreq><priority>' + u[3] + '</priority></url>').join('\n')
      + '\n</urlset>\n';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(body);
  } catch (e) { return fail(res, 'sitemap', e); }
};

// Simple in-memory limiter (one Node process on shared hosting). Keyed by user when logged in, else IP.
const HITS = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of HITS) if (v.reset < now) HITS.delete(k); }, 60000).unref();
exports.limit = (name, max, windowSec) => (req, res, next) => {
  const who = req.user && req.user.user_id ? 'u:' + req.user.user_id : 'ip:' + (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  const k = name + '|' + who, now = Date.now();
  let h = HITS.get(k);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowSec * 1000 }; HITS.set(k, h); }
  h.n++;
  if (h.n > max) {
    const wait = Math.ceil((h.reset - now) / 1000);
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ success: false, code: 'rate_limited', message: `Too many attempts. Please try again in ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'}.` });
  }
  return next();
};
