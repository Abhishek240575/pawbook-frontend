'use strict';
/* ============================================================================
   PawBook Marketplace — Phase 7: admin orders, reports, CSV exports, seller payouts
   Mounted under /api/v1/shop (see add_shop_routes.js). Requires migrations 003–009.
   Money rules
   - Seller earnings = item price x quantity for DELIVERED items. Coupon discounts are paid by PawBook.
   - Commission % and the waiting period after delivery are admin settings (both start at 0).
   - An item can be in at most one payout (order_items.payout_id), locked in a transaction.
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
const fail = (res, where, e) => { console.error('[Reports] ' + where + ':', e.message); return R.serverError(res); };
const TZ = 'Asia/Kolkata';
const FLOW = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
const NEXT = { pending: ['confirmed', 'cancelled'], confirmed: ['packed', 'cancelled'], packed: ['shipped', 'cancelled'], shipped: ['delivered', 'cancelled'], delivered: [], cancelled: [] };
const ORDER_STATUS = { pending: 'pending', confirmed: 'confirmed', packed: 'processing', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled' };
const SELLER = `COALESCE(oi.seller_id, p.seller_id)::text`;
// item has no return in progress / refunded (those are never paid out)
const NLR = `NOT EXISTS (SELECT 1 FROM marketplace_returns rr WHERE rr.item_id = oi.item_id::text AND rr.status IN ('requested','approved','received','refunded'))`;

// YYYY-MM-DD range in Indian time; default = last 30 days
function range(q) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  let to = ok(q.to) ? q.to : today;
  let from = ok(q.from) ? q.from : new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
  if (from > to) { const t = from; from = to; to = t; }
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 731) from = new Date(Date.parse(to) - 731 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}
const IN_RANGE = (col, a, b) => `(${col} AT TIME ZONE '${TZ}')::date BETWEEN $${a}::date AND $${b}::date`;

function overall(items) {
  const live = items.map(i => i.status || 'pending').filter(s => s !== 'cancelled');
  if (!live.length) return 'cancelled';
  return live.reduce((a, b) => (FLOW.indexOf(a) <= FLOW.indexOf(b) ? a : b));
}

async function setting(key, d) {
  try { const { rows } = await query(`SELECT value FROM marketplace_settings WHERE key = $1`, [key]); return rows.length ? rows[0].value : d; } catch (e) { return d; }
}
async function payoutSettings() {
  const pct = Math.min(50, Math.max(0, Number(await setting('commission_pct', '0')) || 0));
  const hold = Math.min(60, Math.max(0, toInt(await setting('payout_hold_days', '0'), 0)));
  return { commission_pct: pct, payout_hold_days: hold };
}
exports.payoutSettings = payoutSettings;

// ═══ Admin: orders ══════════════════════════════════════════════════════════
const ITEMS_JSON = `COALESCE((SELECT json_agg(json_build_object('item_id', oi.item_id, 'product_id', oi.product_id, 'name', oi.name, 'variant', oi.variant,
    'image_url', COALESCE(oi.image_url, p.images->>0), 'price', oi.price, 'quantity', oi.quantity, 'status', COALESCE(oi.fulfil_status, 'pending'),
    'tracking', oi.tracking, 'status_updated_at', oi.status_updated_at, 'payout_id', oi.payout_id, 'seller_id', ${SELLER}, 'store_name', COALESCE(s.store_name, su.full_name)) ORDER BY oi.item_id)
  FROM marketplace_order_items oi LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
  LEFT JOIN marketplace_sellers s ON s.user_id::text = ${SELLER} LEFT JOIN users su ON su.user_id::text = ${SELLER}
  WHERE oi.order_id = o.order_id), '[]')`;

// GET /shop/admin/orders?state=&q=&from=&to=&page=
exports.adminOrders = async (req, res) => {
  try {
    const { from, to } = range(req.query), page = Math.max(1, toInt(req.query.page, 1)), per = 30;
    const p = [from, to], w = [IN_RANGE('o.created_at', 1, 2)];
    const q = str(req.query.q, 60);
    if (q) { p.push('%' + q.toLowerCase() + '%'); w.push(`(LOWER(o.order_number) LIKE $${p.length} OR LOWER(COALESCE(u.full_name, '')) LIKE $${p.length} OR LOWER(COALESCE(o.delivery_address->>'phone', '')) LIKE $${p.length} OR COALESCE(o.delivery_address->>'pincode', '') LIKE $${p.length})`); }
    const { rows } = await query(`SELECT o.order_id, o.order_number, o.created_at, o.total, o.discount, o.coupon_code, o.payment_method, o.payment_status, o.cod_collected_at,
        o.delivery_address->>'city' AS city, o.delivery_address->>'pincode' AS pincode, u.full_name AS buyer_name, ${ITEMS_JSON} AS items
      FROM marketplace_orders o LEFT JOIN users u ON u.user_id::text = o.buyer_id::text
      WHERE ${w.join(' AND ')} ORDER BY o.created_at DESC LIMIT 1000`, p);
    let dd = 2; try { dd = (await require('./fulfil.controller').fulfilSettings()).dispatch_days; } catch (e) {}
    const now = Date.now();
    rows.forEach(o => { o.items = parseJ(o.items, []); o.total = Number(o.total); o.discount = Number(o.discount || 0); o.state = overall(o.items);
      o.ship_by = new Date(new Date(o.created_at).getTime() + dd * 86400000); o.late = ['pending', 'confirmed', 'packed'].includes(o.state) && o.ship_by.getTime() < now; });
    const st = str(req.query.state, 20);
    const counts = { all: rows.length };
    rows.forEach(o => { counts[o.state] = (counts[o.state] || 0) + 1; });
    const list = st === 'to_ship' ? rows.filter(o => ['pending', 'confirmed', 'packed'].includes(o.state))
      : st === 'late' ? rows.filter(o => o.late)
      : st === 'cod_due' ? rows.filter(o => o.state === 'delivered' && o.payment_method === 'cod' && !o.cod_collected_at)
      : (st && FLOW.concat('cancelled').includes(st) ? rows.filter(o => o.state === st) : rows);
    counts.late = rows.filter(o => o.late).length;
    counts.to_ship = rows.filter(o => ['pending', 'confirmed', 'packed'].includes(o.state)).length;
    counts.cod_due = rows.filter(o => o.state === 'delivered' && o.payment_method === 'cod' && !o.cod_collected_at).length;
    return R.ok(res, { orders: list.slice((page - 1) * per, page * per), total: list.length, page, per_page: per, counts, from, to });
  } catch (e) { return fail(res, 'adminOrders', e); }
};

// GET /shop/admin/orders/:id
exports.adminOrder = async (req, res) => {
  try {
    const { rows } = await query(`SELECT o.order_id, o.order_number, o.created_at, o.subtotal, o.delivery_fee, o.total, o.discount, o.coupon_code, o.payment_method, o.payment_status,
        o.cod_collected_at, o.estimated_delivery, o.delivery_address, o.cancel_reason, o.cancelled_at, o.buyer_id::text AS buyer_id, u.full_name AS buyer_name, ${ITEMS_JSON} AS items
      FROM marketplace_orders o LEFT JOIN users u ON u.user_id::text = o.buyer_id::text WHERE o.order_id = $1`, [str(req.params.id, 64)]);
    if (!rows.length) return R.notFound(res, 'Order not found');
    const o = rows[0];
    o.items = parseJ(o.items, []); o.delivery_address = parseJ(o.delivery_address, {});
    ['subtotal', 'delivery_fee', 'total', 'discount'].forEach(k => { o[k] = o[k] == null ? null : Number(o[k]); });
    o.state = overall(o.items);
    o.items.forEach(i => { i.next = NEXT[i.status] || []; });
    return R.ok(res, { order: o });
  } catch (e) { return fail(res, 'adminOrder', e); }
};

// PATCH /shop/admin/orders/:id  {action: 'status', item_ids, status, tracking, reason} | {action: 'cod_collected'}
exports.adminUpdateOrder = async (req, res) => {
  const oid = str(req.params.id, 64), b = req.body || {};
  let client;
  try {
    if (b.action === 'cod_collected') {
      const { rows } = await query(`UPDATE marketplace_orders SET cod_collected_at = NOW(), payment_status = 'paid', updated_at = NOW()
        WHERE order_id = $1 AND payment_method = 'cod' AND cod_collected_at IS NULL RETURNING order_id`, [oid]);
      if (!rows.length) return res.status(409).json({ success: false, message: 'Not a COD order, or already marked as received' });
      return R.ok(res, { cod_collected: true });
    }
    if (b.action !== 'status') return R.badRequest(res, 'Unknown action');
    const to = str(b.status, 20), reason = str(b.reason, 300) || null, tracking = str(b.tracking, 200) || null;
    if (!NEXT.pending.concat(FLOW).includes(to)) return R.badRequest(res, 'Invalid status');
    if (to === 'cancelled' && (!reason || reason.length < 5)) return res.status(422).json({ success: false, message: 'Please give a reason for cancelling', fields: ['reason'] });
    client = await getClient();
    const q = (t, p) => client.query(t, p);
    await q('BEGIN');
    const { rows: o } = await q(`SELECT order_id, order_number, buyer_id::text AS buyer FROM marketplace_orders WHERE order_id = $1 FOR UPDATE`, [oid]);
    if (!o.length) { await q('ROLLBACK'); return R.notFound(res, 'Order not found'); }
    const { rows: all } = await q(`SELECT oi.item_id, COALESCE(oi.fulfil_status, 'pending') AS st, oi.product_id, oi.variant, oi.quantity, ${SELLER} AS seller
      FROM marketplace_order_items oi LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text WHERE oi.order_id = $1 FOR UPDATE OF oi`, [oid]);
    const want = Array.isArray(b.item_ids) && b.item_ids.length ? b.item_ids.map(String) : null;
    const ids = all.filter(i => (want ? want.includes(String(i.item_id)) : i.st !== 'cancelled' && i.st !== 'delivered'));
    const bad = ids.filter(i => !(NEXT[i.st] || []).includes(to));
    if (!ids.length || bad.length) { await q('ROLLBACK'); return res.status(409).json({ success: false, message: bad.length ? `Cannot move an item from ${bad[0].st} to ${to}` : 'Nothing to update' }); }
    await q(`UPDATE marketplace_order_items SET fulfil_status = $2, status_updated_at = NOW(), tracking = COALESCE($3, tracking) WHERE item_id = ANY($1::text[])`,
      [ids.map(i => String(i.item_id)), to, tracking]);
    if (to === 'cancelled') { const { moveStock } = require('./checkout.controller'); for (const i of ids) if (i.product_id) await moveStock(q, i.product_id, i.variant || '', i.quantity); }
    const { rows: sts } = await q(`SELECT DISTINCT COALESCE(fulfil_status, 'pending') AS s FROM marketplace_order_items WHERE order_id = $1`, [oid]);
    if (sts.length === 1) {
      const s = sts[0].s;
      await q(`UPDATE marketplace_orders SET status = $2, updated_at = NOW()${s === 'cancelled' ? `, payment_status = 'cancelled', cancel_reason = COALESCE($3, cancel_reason), cancelled_at = NOW()` : ''} WHERE order_id = $1`,
        s === 'cancelled' ? [oid, ORDER_STATUS[s], reason] : [oid, ORDER_STATUS[s]]);
      if (s === 'cancelled') await q(`DELETE FROM marketplace_coupon_redemptions WHERE order_id = $1`, [oid]);
    }
    await q('COMMIT');
    const M = { confirmed: ['✅', 'confirmed'], packed: ['📦', 'packed'], shipped: ['🚚', 'shipped'], delivered: ['🏠', 'delivered'], cancelled: ['❌', 'cancelled'] };
    exp().notify(o[0].buyer, { type: 'shop_order', icon: M[to][0], title: 'Order ' + o[0].order_number + ' ' + M[to][1],
      body: to === 'cancelled' ? reason : (to === 'shipped' && tracking ? 'Tracking: ' + tracking : null), link: '53_shop_orders.html?id=' + encodeURIComponent(oid) });
    if (to === 'cancelled') Array.from(new Set(ids.map(i => i.seller).filter(Boolean))).forEach(sid => exp().notify(sid, { type: 'shop_order', icon: '❌', title: 'Order ' + o[0].order_number + ' cancelled by PawBook', body: reason, link: '50_seller_hub.html?tab=orders' }));
    return R.ok(res, { updated: ids.length, status: to });
  } catch (e) { if (client) { try { await client.query('ROLLBACK'); } catch (x) {} } return fail(res, 'adminUpdateOrder', e); }
  finally { if (client) client.release(); }
};

// ═══ Admin: reports ═════════════════════════════════════════════════════════
// GET /shop/admin/reports?from=&to=
exports.adminReports = async (req, res) => {
  try {
    const { from, to } = range(req.query), P = [from, to];
    const R_O = IN_RANGE('o.created_at', 1, 2);
    const LINES = `FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text WHERE ${R_O}`;
    const [kpi, ord, days, cats, prods, sellers, statuses, coupons, cod, buyers, refunds, openRet] = await Promise.all([
      query(`SELECT COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.fulfil_status <> 'cancelled'), 0)::float AS gmv,
          COALESCE(SUM(oi.quantity) FILTER (WHERE oi.fulfil_status <> 'cancelled'), 0)::int AS units,
          COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.fulfil_status = 'delivered'), 0)::float AS delivered_value,
          COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.fulfil_status = 'cancelled'), 0)::float AS cancelled_value ${LINES}`, P),
      query(`SELECT COUNT(*)::int AS orders, COUNT(*) FILTER (WHERE live)::int AS live_orders, COUNT(*) FILTER (WHERE NOT live)::int AS cancelled_orders,
          COALESCE(SUM(o.discount) FILTER (WHERE live), 0)::float AS discounts, COALESCE(SUM(o.delivery_fee) FILTER (WHERE live), 0)::float AS delivery_fees,
          COUNT(DISTINCT o.buyer_id) FILTER (WHERE live)::int AS buyers
        FROM (SELECT o.*, EXISTS (SELECT 1 FROM marketplace_order_items oi WHERE oi.order_id = o.order_id AND oi.fulfil_status <> 'cancelled') AS live
              FROM marketplace_orders o WHERE ${R_O}) o`, P),
      query(`SELECT (o.created_at AT TIME ZONE '${TZ}')::date::text AS day, COUNT(DISTINCT o.order_id)::int AS orders,
          COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.fulfil_status <> 'cancelled'), 0)::float AS gmv ${LINES} GROUP BY 1 ORDER BY 1`, P),
      query(`SELECT COALESCE(p.category, 'other') AS category, COALESCE(SUM(oi.price * oi.quantity), 0)::float AS gmv, SUM(oi.quantity)::int AS units
          ${LINES} AND oi.fulfil_status <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, P),
      query(`SELECT oi.product_id::text AS product_id, MAX(COALESCE(p.name, oi.name)) AS name, SUM(oi.quantity)::int AS units, SUM(oi.price * oi.quantity)::float AS gmv
          ${LINES} AND oi.fulfil_status <> 'cancelled' GROUP BY 1 ORDER BY 4 DESC LIMIT 10`, P),
      query(`SELECT ${SELLER} AS seller_id, MAX(COALESCE(s.store_name, su.full_name)) AS store_name, COUNT(DISTINCT o.order_id)::int AS orders,
          COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.fulfil_status <> 'cancelled'), 0)::float AS gmv,
          COUNT(*) FILTER (WHERE oi.fulfil_status = 'cancelled')::int AS cancelled_items, COUNT(*)::int AS items
        FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
        LEFT JOIN marketplace_sellers s ON s.user_id::text = ${SELLER} LEFT JOIN users su ON su.user_id::text = ${SELLER}
        WHERE ${R_O} GROUP BY 1 ORDER BY 4 DESC LIMIT 10`, P),
      query(`SELECT COALESCE(oi.fulfil_status, 'pending') AS status, COUNT(*)::int AS n ${LINES} GROUP BY 1`, P),
      query(`SELECT o.coupon_code AS code, COUNT(*)::int AS uses, SUM(o.discount)::float AS discount FROM marketplace_orders o
        WHERE ${R_O} AND o.coupon_code IS NOT NULL AND COALESCE(o.status, '') <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, P),
      query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(o.total), 0)::float AS amount FROM marketplace_orders o
        WHERE o.payment_method = 'cod' AND o.cod_collected_at IS NULL AND COALESCE(o.status, '') = 'delivered'`),
      query(`SELECT COUNT(*)::int AS new_buyers FROM (SELECT buyer_id, MIN(created_at) AS first FROM marketplace_orders GROUP BY buyer_id) f WHERE ${IN_RANGE('f.first', 1, 2)}`, P),
      query(`SELECT COUNT(*)::int AS refunds, COALESCE(SUM(amount), 0)::float AS refunded FROM marketplace_returns r WHERE r.status = 'refunded' AND ${IN_RANGE('r.refunded_at', 1, 2)}`, P).catch(() => ({ rows: [{ refunds: 0, refunded: 0 }] })),
      query(`SELECT COUNT(*)::int AS n FROM marketplace_returns WHERE status IN ('requested','approved','received')`).catch(() => ({ rows: [{ n: 0 }] }))
    ]);
    const k = Object.assign({}, kpi.rows[0], ord.rows[0], buyers.rows[0], refunds.rows[0], { open_returns: openRet.rows[0].n });
    k.aov = k.live_orders ? money(k.gmv / k.live_orders) : 0;
    k.cancel_rate = k.orders ? Math.round(k.cancelled_orders * 1000 / k.orders) / 10 : 0;
    // fill missing days so the chart has no gaps
    const byDay = {}; days.rows.forEach(d => { byDay[d.day] = d; });
    const series = [];
    for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) { const d = new Date(t).toISOString().slice(0, 10); series.push(byDay[d] || { day: d, orders: 0, gmv: 0 }); }
    const st = {}; statuses.rows.forEach(r => { st[r.status] = r.n; });
    return R.ok(res, { from, to, kpi: k, series, categories: cats.rows, top_products: prods.rows, top_sellers: sellers.rows, item_status: st, coupons: coupons.rows, cod_due: cod.rows[0] });
  } catch (e) { return fail(res, 'adminReports', e); }
};

// ── CSV ─────────────────────────────────────────────────────────────────────
function csvCell(v) {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;          // no spreadsheet formulas
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function sendCsv(res, name, head, rows) {
  const body = '﻿' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  return res.status(200).send(body);
}
const ist = d => d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().replace('T', ' ').slice(0, 16) : '';

// GET /shop/admin/export?type=orders|payouts&from=&to=
exports.adminExport = async (req, res) => {
  try {
    const { from, to } = range(req.query), type = req.query.type;
    if (type === 'orders') {
      const { rows } = await query(`SELECT o.order_number, o.created_at, u.full_name AS buyer, o.delivery_address->>'city' AS city, o.delivery_address->>'state' AS state,
          o.delivery_address->>'pincode' AS pincode, COALESCE(s.store_name, su.full_name) AS seller, oi.name, oi.variant, oi.quantity, oi.price, oi.price * oi.quantity AS line_total,
          COALESCE(oi.fulfil_status, 'pending') AS item_status, oi.tracking, oi.status_updated_at, oi.payout_id, o.coupon_code, o.discount, o.delivery_fee, o.total,
          o.payment_method, o.payment_status, o.cod_collected_at
        FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
        LEFT JOIN users u ON u.user_id::text = o.buyer_id::text LEFT JOIN marketplace_sellers s ON s.user_id::text = ${SELLER} LEFT JOIN users su ON su.user_id::text = ${SELLER}
        WHERE ${IN_RANGE('o.created_at', 1, 2)} ORDER BY o.created_at, oi.item_id LIMIT 50000`, [from, to]);
      return sendCsv(res, `pawbook-orders-${from}-to-${to}.csv`,
        ['Order', 'Date (IST)', 'Buyer', 'City', 'State', 'PIN', 'Seller', 'Item', 'Size', 'Qty', 'Price', 'Line total', 'Item status', 'Tracking', 'Status updated (IST)', 'Payout #', 'Coupon', 'Order discount', 'Delivery fee', 'Order total', 'Payment', 'Payment status', 'COD received (IST)'],
        rows.map(r => [r.order_number, ist(r.created_at), r.buyer, r.city, r.state, r.pincode, r.seller, r.name, r.variant, r.quantity, Number(r.price), money(r.line_total), r.item_status, r.tracking, ist(r.status_updated_at), r.payout_id,
          r.coupon_code, Number(r.discount || 0), Number(r.delivery_fee || 0), Number(r.total || 0), r.payment_method, r.payment_status, ist(r.cod_collected_at)]));
    }
    if (type === 'payouts') {
      const { rows } = await query(`SELECT py.*, COALESCE(s.store_name, su.full_name) AS store_name FROM marketplace_payouts py
        LEFT JOIN marketplace_sellers s ON s.user_id::text = py.seller_id LEFT JOIN users su ON su.user_id::text = py.seller_id
        WHERE ${IN_RANGE('py.paid_at', 1, 2)} ORDER BY py.paid_at`, [from, to]);
      return sendCsv(res, `pawbook-payouts-${from}-to-${to}.csv`, ['Payout #', 'Paid (IST)', 'Seller', 'Items', 'Gross', 'Commission %', 'Commission', 'Net paid', 'Reference', 'Note'],
        rows.map(r => [r.payout_id, ist(r.paid_at), r.store_name, r.items_count, Number(r.gross), Number(r.commission_pct), Number(r.commission), Number(r.net), r.reference, r.note]));
    }
    return R.badRequest(res, 'type must be orders or payouts');
  } catch (e) { return fail(res, 'adminExport', e); }
};

// ═══ Payouts ════════════════════════════════════════════════════════════════
// Items a seller can be paid for now: delivered, not yet in a payout, past the waiting period
const DUE = (sellerParam, holdParam) => `FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id
  LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
  WHERE oi.fulfil_status = 'delivered' AND oi.payout_id IS NULL AND ${NLR} ${sellerParam ? `AND ${SELLER} = $${sellerParam}` : ''}
    AND COALESCE(oi.status_updated_at, o.created_at) <= NOW() - ($${holdParam}::int * INTERVAL '1 day')`;

// GET /shop/admin/payouts  → due per seller + recent payouts + settings
exports.adminPayouts = async (req, res) => {
  try {
    const set = await payoutSettings();
    const { rows: due } = await query(`SELECT ${SELLER} AS seller_id, COUNT(*)::int AS items, SUM(oi.price * oi.quantity)::float AS gross,
        MIN(COALESCE(oi.status_updated_at, o.created_at)) AS oldest ${DUE(0, 1)} GROUP BY 1 ORDER BY 3 DESC`, [set.payout_hold_days]);
    const { rows: wait } = await query(`SELECT ${SELLER} AS seller_id, COUNT(*)::int AS items, SUM(oi.price * oi.quantity)::float AS gross
      FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
      WHERE oi.fulfil_status = 'delivered' AND oi.payout_id IS NULL AND ${NLR} AND COALESCE(oi.status_updated_at, o.created_at) > NOW() - ($1::int * INTERVAL '1 day') GROUP BY 1`, [set.payout_hold_days]);
    const { rows: adj } = await query(`SELECT seller_id, SUM(amount)::float AS amount, COUNT(*)::int AS n FROM marketplace_payout_adjustments WHERE payout_id IS NULL GROUP BY 1`).catch(() => ({ rows: [] }));
    const ded = {}; adj.forEach(r => { ded[r.seller_id] = money(r.amount); });
    const ids = Array.from(new Set(due.map(r => r.seller_id).concat(wait.map(r => r.seller_id), adj.map(r => r.seller_id)).filter(Boolean)));
    const { rows: info } = ids.length ? await query(`SELECT u.user_id::text AS seller_id, COALESCE(s.store_name, u.full_name) AS store_name, s.phone, s.email, s.is_verified,
        k.legal_name FROM users u LEFT JOIN marketplace_sellers s ON s.user_id::text = u.user_id::text LEFT JOIN marketplace_seller_kyc k ON k.user_id = u.user_id::text
        WHERE u.user_id::text = ANY($1::text[])`, [ids]) : { rows: [] };
    const by = {}; info.forEach(r => { by[r.seller_id] = r; });
    const rowsOut = ids.map(id => {
      const d = due.find(r => r.seller_id === id) || { items: 0, gross: 0, oldest: null }, w = wait.find(r => r.seller_id === id) || { items: 0, gross: 0 };
      const gross = money(d.gross), commission = money(gross * set.commission_pct / 100);
      return Object.assign({ seller_id: id, store_name: (by[id] || {}).store_name || 'Seller', legal_name: (by[id] || {}).legal_name || null, phone: (by[id] || {}).phone || null, is_verified: !!(by[id] || {}).is_verified },
        { items: d.items, gross, commission, deductions: ded[id] || 0, net: money(gross - commission - (ded[id] || 0)), oldest: d.oldest, waiting_items: w.items, waiting_gross: money(w.gross) });
    }).sort((a, b) => b.net - a.net);
    const { rows: recent } = await query(`SELECT py.payout_id, py.seller_id, py.items_count, py.gross::float, py.commission_pct::float, py.commission::float, COALESCE(py.deductions, 0)::float AS deductions, py.net::float, py.reference, py.note, py.paid_at,
        COALESCE(s.store_name, su.full_name) AS store_name FROM marketplace_payouts py LEFT JOIN marketplace_sellers s ON s.user_id::text = py.seller_id
        LEFT JOIN users su ON su.user_id::text = py.seller_id ORDER BY py.paid_at DESC LIMIT 50`);
    return R.ok(res, { settings: set, sellers: rowsOut, recent });
  } catch (e) { return fail(res, 'adminPayouts', e); }
};

// PUT /shop/admin/payouts/settings {commission_pct, payout_hold_days}
exports.adminPayoutSettings = async (req, res) => {
  try {
    const b = req.body || {}, pct = Number(b.commission_pct), hold = Number(b.payout_hold_days), e = [];
    if (!(pct >= 0 && pct <= 50)) e.push('commission_pct');
    if (!(Number.isInteger(hold) && hold >= 0 && hold <= 60)) e.push('payout_hold_days');
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    for (const [k, v] of [['commission_pct', String(Math.round(pct * 100) / 100)], ['payout_hold_days', String(hold)]])
      await query(`INSERT INTO marketplace_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [k, v]);
    return R.ok(res, await payoutSettings());
  } catch (e) { return fail(res, 'adminPayoutSettings', e); }
};

// POST /shop/admin/payouts {seller_id, reference, note, expected_net}
exports.adminCreatePayout = async (req, res) => {
  const b = req.body || {}, sid = str(b.seller_id, 64), ref = str(b.reference, 80), note = str(b.note, 300) || null;
  if (!sid) return R.badRequest(res, 'seller_id is required');
  if (ref.length < 4) return res.status(422).json({ success: false, message: 'Please enter the bank reference (UTR) of the transfer', fields: ['reference'] });
  let client;
  try {
    const set = await payoutSettings();
    client = await getClient();
    const q = (t, p) => client.query(t, p);
    await q('BEGIN');
    const { rows } = await q(`SELECT oi.item_id, oi.price, oi.quantity ${DUE(1, 2)} FOR UPDATE OF oi`, [sid, set.payout_hold_days]);
    if (!rows.length) { await q('ROLLBACK'); return res.status(409).json({ success: false, message: 'Nothing is due for this seller right now' }); }
    const { rows: adj } = await q(`SELECT adj_id, amount FROM marketplace_payout_adjustments WHERE seller_id = $1 AND payout_id IS NULL FOR UPDATE`, [sid]).catch(() => ({ rows: [] }));
    const deductions = money(adj.reduce((s, r) => s + Number(r.amount), 0));
    const gross = money(rows.reduce((s, r) => s + Number(r.price) * r.quantity, 0)), commission = money(gross * set.commission_pct / 100), net = money(gross - commission - deductions);
    if (net <= 0) { await q('ROLLBACK'); return res.status(409).json({ success: false, code: 'deductions_exceed', message: 'Refund deductions (₹' + deductions + ') are more than the amount due. They will carry over to the next payout.' }); }
    if (b.expected_net != null && Math.abs(Number(b.expected_net) - net) > 0.009) {
      await q('ROLLBACK'); return res.status(409).json({ success: false, code: 'amount_changed', message: 'The amount due changed (₹' + net + '). Please check again before recording.', data: { net } });
    }
    const { rows: py } = await q(`INSERT INTO marketplace_payouts (seller_id, items_count, gross, commission_pct, commission, net, reference, note, created_by, deductions)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING payout_id, paid_at`, [sid, rows.length, gross, set.commission_pct, commission, net, ref, note, uid(req.user), deductions]);
    if (adj.length) await q(`UPDATE marketplace_payout_adjustments SET payout_id = $1 WHERE adj_id = ANY($2::bigint[])`, [py[0].payout_id, adj.map(r => r.adj_id)]);
    await q(`UPDATE marketplace_order_items SET payout_id = $1 WHERE item_id = ANY($2::text[])`, [py[0].payout_id, rows.map(r => String(r.item_id))]);
    await q('COMMIT');
    exp().notify(sid, { type: 'shop_order', icon: '💰', title: 'Payout of ₹' + net.toLocaleString('en-IN') + ' sent', body: 'Reference: ' + ref, link: '50_seller_hub.html?tab=earnings' });
    return R.created(res, { payout_id: py[0].payout_id, items: rows.length, gross, commission, deductions, net });
  } catch (e) { if (client) { try { await client.query('ROLLBACK'); } catch (x) {} } return fail(res, 'adminCreatePayout', e); }
  finally { if (client) client.release(); }
};

async function payoutItems(payoutId, sellerId) {
  const p = [payoutId], extra = sellerId ? (p.push(sellerId), ' AND py.seller_id = $2') : '';
  const { rows: py } = await query(`SELECT py.payout_id, py.seller_id, py.items_count, py.gross::float, py.commission_pct::float, py.commission::float, COALESCE(py.deductions, 0)::float AS deductions, py.net::float, py.reference, py.note, py.paid_at,
      COALESCE(s.store_name, su.full_name) AS store_name FROM marketplace_payouts py LEFT JOIN marketplace_sellers s ON s.user_id::text = py.seller_id
      LEFT JOIN users su ON su.user_id::text = py.seller_id WHERE py.payout_id = $1${extra}`, p);
  if (!py.length) return null;
  const { rows: items } = await query(`SELECT o.order_number, o.created_at, oi.name, oi.quantity, oi.price::float, (oi.price * oi.quantity)::float AS line_total, oi.status_updated_at AS delivered_at
    FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id WHERE oi.payout_id = $1 ORDER BY o.created_at`, [payoutId]);
  const { rows: adj } = await query(`SELECT amount::float AS amount, reason FROM marketplace_payout_adjustments WHERE payout_id = $1 ORDER BY adj_id`, [payoutId]).catch(() => ({ rows: [] }));
  return Object.assign(py[0], { items, adjustments: adj });
}
// GET /shop/admin/payouts/:id
exports.adminPayout = async (req, res) => {
  try { const d = await payoutItems(toInt(req.params.id, 0)); return d ? R.ok(res, { payout: d }) : R.notFound(res, 'Payout not found'); }
  catch (e) { return fail(res, 'adminPayout', e); }
};

// ═══ Seller: earnings ═══════════════════════════════════════════════════════
// GET /shop/seller/earnings
exports.sellerEarnings = async (req, res) => {
  try {
    const me = uid(req.user), set = await payoutSettings();
    const { rows } = await query(`SELECT
        COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.fulfil_status IN ('pending','confirmed','packed','shipped')), 0)::float AS in_progress,
        COUNT(*) FILTER (WHERE oi.fulfil_status IN ('pending','confirmed','packed','shipped'))::int AS in_progress_items,
        COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.fulfil_status = 'delivered' AND oi.payout_id IS NULL AND ${NLR} AND COALESCE(oi.status_updated_at, o.created_at) <= NOW() - ($2::int * INTERVAL '1 day')), 0)::float AS ready,
        COUNT(*) FILTER (WHERE oi.fulfil_status = 'delivered' AND oi.payout_id IS NULL AND ${NLR} AND COALESCE(oi.status_updated_at, o.created_at) <= NOW() - ($2::int * INTERVAL '1 day'))::int AS ready_items,
        COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE oi.fulfil_status = 'delivered' AND oi.payout_id IS NULL AND ${NLR} AND COALESCE(oi.status_updated_at, o.created_at) > NOW() - ($2::int * INTERVAL '1 day')), 0)::float AS waiting,
        COUNT(*) FILTER (WHERE oi.fulfil_status = 'delivered' AND oi.payout_id IS NULL AND ${NLR} AND COALESCE(oi.status_updated_at, o.created_at) > NOW() - ($2::int * INTERVAL '1 day'))::int AS waiting_items
      FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
      WHERE ${SELLER} = $1`, [me, set.payout_hold_days]);
    const s = rows[0], c = v => money(v * set.commission_pct / 100);
    const { rows: paid } = await query(`SELECT payout_id, items_count, gross::float, commission_pct::float, commission::float, COALESCE(deductions, 0)::float AS deductions, net::float, reference, paid_at FROM marketplace_payouts WHERE seller_id = $1 ORDER BY paid_at DESC LIMIT 100`, [me]);
    const { rows: tot } = await query(`SELECT COALESCE(SUM(net), 0)::float AS paid FROM marketplace_payouts WHERE seller_id = $1`, [me]);
    const { rows: dd } = await query(`SELECT COALESCE(SUM(amount), 0)::float AS amount FROM marketplace_payout_adjustments WHERE seller_id = $1 AND payout_id IS NULL`, [me]).catch(() => ({ rows: [{ amount: 0 }] }));
    return R.ok(res, { settings: set,
      in_progress: { items: s.in_progress_items, gross: money(s.in_progress), net: money(s.in_progress - c(s.in_progress)) },
      waiting: { items: s.waiting_items, gross: money(s.waiting), net: money(s.waiting - c(s.waiting)) },
      ready: { items: s.ready_items, gross: money(s.ready), commission: c(s.ready), net: money(s.ready - c(s.ready)) },
      deductions: money(dd[0].amount), paid_total: money(tot[0].paid), payouts: paid });
  } catch (e) { return fail(res, 'sellerEarnings', e); }
};
// GET /shop/seller/payouts/:id
exports.sellerPayout = async (req, res) => {
  try { const d = await payoutItems(toInt(req.params.id, 0), uid(req.user)); return d ? R.ok(res, { payout: d }) : R.notFound(res, 'Payout not found'); }
  catch (e) { return fail(res, 'sellerPayout', e); }
};
