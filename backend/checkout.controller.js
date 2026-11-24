'use strict';
/* ============================================================================
   PawBook Marketplace — Cart, addresses, checkout and buyer orders (Phase 3, Cash on Delivery)
   Mounted under /api/v1/shop (see add_shop_routes.js). Requires migrations 003–006.
   Prices, stock, delivery fee and totals are always worked out here, never taken from the browser.
   ========================================================================== */
const crypto = require('crypto');
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');
const getClient = db.getClient || (() => db.pool.connect());

const FREE_DELIVERY_FROM = 499;   // same rule the shop has always shown
const DELIVERY_FEE = 49;
const COD_MAX = 20000;            // cash on delivery limit per order
const MAX_QTY = 20;
const MAX_ADDRESSES = 10;
const CANCELLABLE = ['pending', 'confirmed'];
const ORDER_STATUS = { pending: 'pending', confirmed: 'confirmed', packed: 'processing', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled' };

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const money = n => Math.round(Number(n) * 100) / 100;
const uid = u => String(u.user_id);
const parseJ = (v, d) => { if (v == null) return d; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return d; } } return v; };
const fail = (res, where, e) => { console.error('[Checkout] ' + where + ':', e.message); return R.serverError(res); };

// ── pricing ─────────────────────────────────────────────────────────────────
// One cart line → current price/stock for the chosen size, plus any problem with it.
function priceLine(row) {
  const variants = parseJ(row.variants, []) || [];
  const images = parseJ(row.images, []) || [];
  const line = {
    product_id: String(row.product_id), variant: row.variant || '', quantity: Number(row.quantity),
    name: row.name, brand: row.brand, image: images[0] || null, category: row.category,
    seller_id: row.seller_id ? String(row.seller_id) : null, seller_name: row.seller_name || null,
    delivery_days: Number(row.delivery_days) || 4, issue: null,
  };
  if (!row.p_exists) { line.issue = 'unavailable'; line.price = 0; line.stock = 0; return line; }
  if (variants.length) {
    const v = variants.find(x => String(x.label) === line.variant);
    if (!v) { line.issue = line.variant ? 'size_gone' : 'pick_size'; line.price = Number(variants[0].price) || 0; line.stock = 0; return line; }
    line.price = Number(v.price); line.mrp = v.compare_price != null ? Number(v.compare_price) : null; line.stock = Number(v.stock) || 0;
  } else {
    if (line.variant) { line.issue = 'size_gone'; }
    line.price = Number(row.price); line.mrp = row.compare_price != null ? Number(row.compare_price) : null; line.stock = Number(row.stock) || 0;
  }
  if (!row.is_active || row.archived || (row.store_status && row.store_status !== 'active')) line.issue = 'unavailable';
  else if (line.stock <= 0) line.issue = line.issue || 'out_of_stock';
  else if (line.quantity > line.stock) line.issue = line.issue || 'low_stock';
  line.line_total = money(line.price * line.quantity);
  return line;
}
function summarise(lines) {
  const ok = lines.filter(l => !l.issue);
  const subtotal = money(ok.reduce((s, l) => s + l.price * l.quantity, 0));
  const mrpTotal = money(ok.reduce((s, l) => s + (l.mrp && l.mrp > l.price ? l.mrp : l.price) * l.quantity, 0));
  const delivery_fee = ok.length && subtotal < FREE_DELIVERY_FROM ? DELIVERY_FEE : 0;
  const total = money(subtotal + delivery_fee);
  const days = ok.length ? Math.max.apply(null, ok.map(l => l.delivery_days)) : 0;
  const eta = new Date(Date.now() + days * 86400000);
  return {
    items: ok.reduce((s, l) => s + l.quantity, 0), subtotal, savings: money(mrpTotal - subtotal), delivery_fee, total,
    free_delivery_from: FREE_DELIVERY_FROM, add_for_free: ok.length && subtotal < FREE_DELIVERY_FROM ? money(FREE_DELIVERY_FROM - subtotal) : 0,
    estimated_delivery: days ? eta.toISOString().slice(0, 10) : null,
    issues: lines.filter(l => l.issue).length, cod_available: total > 0 && total <= COD_MAX, cod_max: COD_MAX,
  };
}
const CART_SQL = (lock) => `
  SELECT c.product_id, c.variant, c.quantity, c.added_at,
         (p.product_id IS NOT NULL) AS p_exists, p.name, p.brand, p.category, p.images, p.price, p.compare_price, p.stock, p.variants,
         p.delivery_days, p.is_active, COALESCE(p.archived, FALSE) AS archived, p.seller_id,
         s.status AS store_status, COALESCE(s.store_name, u.full_name) AS seller_name
  FROM shop_cart_items c
  LEFT JOIN marketplace_products p ON p.product_id::text = c.product_id
  LEFT JOIN marketplace_sellers s ON s.user_id::text = p.seller_id::text
  LEFT JOIN users u ON u.user_id::text = p.seller_id::text
  WHERE c.user_id = $1 ORDER BY c.added_at` + (lock ? ' FOR UPDATE OF c' : '');

async function cartLines(q, userId) { const { rows } = await q(CART_SQL(false), [userId]); return rows.map(priceLine); }

// ── cart ────────────────────────────────────────────────────────────────────
exports.getCart = async (req, res) => {
  try { const lines = await cartLines(query, uid(req.user)); return R.ok(res, { items: lines, summary: summarise(lines) }); }
  catch (e) { return fail(res, 'getCart', e); }
};

async function checkProduct(productId, variant) {
  const { rows } = await query(`SELECT p.product_id, p.stock, p.variants, p.is_active, COALESCE(p.archived, FALSE) AS archived FROM marketplace_products p WHERE p.product_id::text = $1`, [productId]);
  if (!rows.length || !rows[0].is_active || rows[0].archived) return { err: 'This product is not available' };
  const vs = parseJ(rows[0].variants, []) || [];
  if (vs.length) {
    const v = vs.find(x => String(x.label) === variant);
    if (!v) return { err: 'Please choose a size' };
    return { stock: Number(v.stock) || 0 };
  }
  if (variant) return { err: 'This product has no sizes' };
  return { stock: Number(rows[0].stock) || 0 };
}

// POST /shop/cart  {product_id, variant, quantity}  → adds to what is already there
exports.addToCart = async (req, res) => {
  try {
    const b = req.body || {}, pid = str(b.product_id, 64), variant = str(b.variant, 40), add = Math.max(1, Math.min(MAX_QTY, toInt(b.quantity, 1)));
    if (!pid) return R.badRequest(res, 'product_id required');
    const c = await checkProduct(pid, variant);
    if (c.err) return R.badRequest(res, c.err);
    if (c.stock <= 0) return res.status(409).json({ success: false, message: 'Out of stock' });
    const { rows } = await query(`SELECT quantity FROM shop_cart_items WHERE user_id = $1 AND product_id = $2 AND variant = $3`, [uid(req.user), pid, variant]);
    const qty = Math.min((rows[0] ? rows[0].quantity : 0) + add, c.stock, MAX_QTY);
    await query(`INSERT INTO shop_cart_items (user_id, product_id, variant, quantity) VALUES ($1,$2,$3,$4)
      ON CONFLICT (user_id, product_id, variant) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`, [uid(req.user), pid, variant, qty]);
    return R.ok(res, { quantity: qty, limited: qty < (rows[0] ? rows[0].quantity : 0) + add });
  } catch (e) { return fail(res, 'addToCart', e); }
};

// PUT /shop/cart  {product_id, variant, quantity}  → sets the quantity (0 removes)
exports.setCartQty = async (req, res) => {
  try {
    const b = req.body || {}, pid = str(b.product_id, 64), variant = str(b.variant, 40), want = toInt(b.quantity, -1);
    if (!pid || want < 0) return R.badRequest(res, 'product_id and quantity required');
    if (want === 0) { await query(`DELETE FROM shop_cart_items WHERE user_id = $1 AND product_id = $2 AND variant = $3`, [uid(req.user), pid, variant]); return R.ok(res, { quantity: 0 }); }
    const c = await checkProduct(pid, variant);
    if (c.err) return R.badRequest(res, c.err);
    const qty = Math.max(1, Math.min(want, c.stock || 1, MAX_QTY));
    const r = await query(`UPDATE shop_cart_items SET quantity = $4, updated_at = NOW() WHERE user_id = $1 AND product_id = $2 AND variant = $3`, [uid(req.user), pid, variant, qty]);
    if (!r.rowCount) return R.notFound(res, 'Not in cart');
    return R.ok(res, { quantity: qty, limited: qty < want });
  } catch (e) { return fail(res, 'setCartQty', e); }
};

// DELETE /shop/cart?product_id=&variant=
exports.removeFromCart = async (req, res) => {
  try {
    await query(`DELETE FROM shop_cart_items WHERE user_id = $1 AND product_id = $2 AND variant = $3`, [uid(req.user), str(req.query.product_id, 64), str(req.query.variant, 40)]);
    return R.ok(res, { removed: true });
  } catch (e) { return fail(res, 'removeFromCart', e); }
};

// POST /shop/cart/merge  {items:[{product_id, variant, quantity}]}  — guest cart after login
exports.mergeCart = async (req, res) => {
  try {
    const items = Array.isArray((req.body || {}).items) ? req.body.items.slice(0, 50) : [];
    let added = 0;
    for (const it of items) {
      const pid = str(it && it.product_id, 64), variant = str(it && it.variant, 40), add = Math.max(1, Math.min(MAX_QTY, toInt(it && it.quantity, 1)));
      if (!pid) continue;
      const c = await checkProduct(pid, variant); if (c.err || c.stock <= 0) continue;
      await query(`INSERT INTO shop_cart_items (user_id, product_id, variant, quantity) VALUES ($1,$2,$3,LEAST($4,$5,${MAX_QTY}))
        ON CONFLICT (user_id, product_id, variant) DO UPDATE SET quantity = LEAST(shop_cart_items.quantity + $4, $5, ${MAX_QTY}), updated_at = NOW()`,
        [uid(req.user), pid, variant, add, c.stock]);
      added++;
    }
    return R.ok(res, { merged: added });
  } catch (e) { return fail(res, 'mergeCart', e); }
};

// ── addresses ───────────────────────────────────────────────────────────────
function validAddress(b) {
  const e = [];
  const out = {
    label: ['home','work','other'].includes(b.label) ? b.label : 'home', name: str(b.name, 80),
    phone: str(b.phone, 20).replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''),
    line1: str(b.line1, 200), line2: str(b.line2, 200) || null, landmark: str(b.landmark, 120) || null,
    city: str(b.city, 80), state: str(b.state, 80), pincode: str(b.pincode, 6), is_default: b.is_default === true,
  };
  if (out.name.length < 2) e.push('name');
  if (!/^[6-9]\d{9}$/.test(out.phone)) e.push('phone');
  if (out.line1.length < 5) e.push('line1');
  if (out.city.length < 2) e.push('city');
  if (out.state.length < 2) e.push('state');
  if (!/^[1-9]\d{5}$/.test(out.pincode)) e.push('pincode');
  return { e, out };
}
const ADDR_COLS = 'address_id, label, name, phone, line1, line2, landmark, city, state, pincode, is_default';
exports.listAddresses = async (req, res) => {
  try { const { rows } = await query(`SELECT ${ADDR_COLS} FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC`, [uid(req.user)]); return R.ok(res, { addresses: rows }); }
  catch (e) { return fail(res, 'listAddresses', e); }
};
exports.saveAddress = async (req, res) => {
  try {
    const me = uid(req.user), id = req.params.id ? toInt(req.params.id, 0) : null;
    const { e, out } = validAddress(req.body || {});
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    const { rows: cnt } = await query(`SELECT COUNT(*)::int AS n FROM user_addresses WHERE user_id = $1`, [me]);
    if (!id && cnt[0].n >= MAX_ADDRESSES) return R.badRequest(res, 'You can save up to ' + MAX_ADDRESSES + ' addresses');
    const makeDefault = out.is_default || cnt[0].n === 0;
    if (makeDefault) await query(`UPDATE user_addresses SET is_default = FALSE WHERE user_id = $1`, [me]);
    let rows;
    if (id) {
      ({ rows } = await query(`UPDATE user_addresses SET label=$3, name=$4, phone=$5, line1=$6, line2=$7, landmark=$8, city=$9, state=$10, pincode=$11,
          is_default = (is_default OR $12), updated_at = NOW() WHERE address_id = $1 AND user_id = $2 RETURNING ${ADDR_COLS}`,
        [id, me, out.label, out.name, out.phone, out.line1, out.line2, out.landmark, out.city, out.state, out.pincode, makeDefault]));
      if (!rows.length) return R.notFound(res, 'Address not found');
    } else {
      ({ rows } = await query(`INSERT INTO user_addresses (user_id, label, name, phone, line1, line2, landmark, city, state, pincode, is_default)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${ADDR_COLS}`,
        [me, out.label, out.name, out.phone, out.line1, out.line2, out.landmark, out.city, out.state, out.pincode, makeDefault]));
    }
    return (id ? R.ok : R.created)(res, { address: rows[0] });
  } catch (e) { return fail(res, 'saveAddress', e); }
};
exports.deleteAddress = async (req, res) => {
  try {
    const me = uid(req.user);
    const { rows } = await query(`DELETE FROM user_addresses WHERE address_id = $1 AND user_id = $2 RETURNING is_default`, [toInt(req.params.id, 0), me]);
    if (!rows.length) return R.notFound(res, 'Address not found');
    if (rows[0].is_default) await query(`UPDATE user_addresses SET is_default = TRUE WHERE address_id = (SELECT address_id FROM user_addresses WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1)`, [me]);
    return R.ok(res, { deleted: true });
  } catch (e) { return fail(res, 'deleteAddress', e); }
};

// ── checkout ────────────────────────────────────────────────────────────────
// POST /shop/checkout/quote → what the order would cost right now
exports.quote = async (req, res) => {
  try { const lines = await cartLines(query, uid(req.user)); return R.ok(res, { items: lines, summary: summarise(lines) }); }
  catch (e) { return fail(res, 'quote', e); }
};

// stock change for one product row (handles sizes). delta < 0 takes stock, > 0 returns it.
async function moveStock(q, productId, variant, delta) {
  const { rows } = await q(`SELECT stock, variants FROM marketplace_products WHERE product_id::text = $1 FOR UPDATE`, [String(productId)]);
  if (!rows.length) return false;
  const vs = parseJ(rows[0].variants, []) || [];
  if (vs.length && variant) {
    let hit = false;
    const nv = vs.map(v => { if (String(v.label) !== variant) return v; hit = true; return Object.assign({}, v, { stock: Math.max(0, (Number(v.stock) || 0) + delta) }); });
    if (!hit) return false;
    await q(`UPDATE marketplace_products SET variants = $2, stock = $3, updated_at = NOW() WHERE product_id::text = $1`,
      [String(productId), JSON.stringify(nv), nv.reduce((s, v) => s + (Number(v.stock) || 0), 0)]);
  } else {
    await q(`UPDATE marketplace_products SET stock = GREATEST(stock + $2, 0), updated_at = NOW() WHERE product_id::text = $1`, [String(productId), delta]);
  }
  return true;
}
exports.moveStock = moveStock;

// POST /shop/orders  {address_id, payment_method:'cod', expected_total, client_ref}
exports.placeOrder = async (req, res) => {
  const me = uid(req.user), b = req.body || {};
  const clientRef = str(b.client_ref, 64) || null;
  if ((b.payment_method || 'cod') !== 'cod') return R.badRequest(res, 'Only cash on delivery is available right now');
  const addressId = toInt(b.address_id, 0);
  if (!addressId) return R.badRequest(res, 'Please choose a delivery address');
  let client;
  try {
    client = await getClient();
    const q = (t, p) => client.query(t, p);
    await q('BEGIN');
    if (clientRef) {   // double-click / retry → same order
      const { rows } = await q(`SELECT order_id, order_number, total FROM marketplace_orders WHERE buyer_id::text = $1 AND client_ref = $2`, [me, clientRef]);
      if (rows.length) { await q('ROLLBACK'); return R.ok(res, { order_id: rows[0].order_id, order_number: rows[0].order_number, total: Number(rows[0].total), repeated: true }); }
    }
    const { rows: ar } = await q(`SELECT name, phone, line1, line2, landmark, city, state, pincode, label FROM user_addresses WHERE address_id = $1 AND user_id = $2`, [addressId, me]);
    if (!ar.length) { await q('ROLLBACK'); return R.badRequest(res, 'Please choose a delivery address'); }
    await q(CART_SQL(true), [me]);                       // lock this cart
    const { rows: cr } = await q(CART_SQL(false), [me]);
    if (!cr.length) { await q('ROLLBACK'); return R.badRequest(res, 'Your cart is empty'); }
    // lock product rows, then price again with the locked values
    const pids = Array.from(new Set(cr.map(r => String(r.product_id))));
    await q(`SELECT product_id FROM marketplace_products WHERE product_id::text = ANY($1::text[]) ORDER BY product_id FOR UPDATE`, [pids]);
    const lines = (await q(CART_SQL(false), [me])).rows.map(priceLine);
    const bad = lines.filter(l => l.issue);
    const sum = summarise(lines);
    if (bad.length) { await q('ROLLBACK'); return res.status(409).json({ success: false, code: 'cart_changed', message: 'Some items in your cart changed. Please review.', data: { items: lines, summary: sum } }); }
    if (b.expected_total != null && Math.abs(Number(b.expected_total) - sum.total) > 0.009) {
      await q('ROLLBACK'); return res.status(409).json({ success: false, code: 'price_changed', message: 'Prices changed since you opened checkout. Please review the new total.', data: { items: lines, summary: sum } });
    }
    if (!sum.cod_available) { await q('ROLLBACK'); return R.badRequest(res, 'Cash on delivery is available for orders up to ₹' + COD_MAX); }
    const { rows: sr } = await q(`SELECT nextval('marketplace_order_seq') AS n`);
    const orderId = 'ord_' + crypto.randomUUID().replace(/-/g, '');
    const d = new Date();
    const orderNumber = 'PB' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + '-' + sr[0].n;
    const addr = Object.assign({}, ar[0]);
    await q(`INSERT INTO marketplace_orders (order_id, order_number, buyer_id, subtotal, delivery_fee, total, delivery_address, estimated_delivery,
        status, payment_method, payment_status, client_ref, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending','cod','cod_pending',$9,NOW())`,
      [orderId, orderNumber, me, sum.subtotal, sum.delivery_fee, sum.total, JSON.stringify(addr), sum.estimated_delivery, clientRef]);
    for (const l of lines) {
      await q(`INSERT INTO marketplace_order_items (item_id, order_id, product_id, name, image_url, price, quantity, seller_id, fulfil_status, variant, mrp)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)`,
        ['oi_' + crypto.randomUUID().replace(/-/g, ''), orderId, l.product_id, l.name + (l.variant ? ' — ' + l.variant : ''), l.image, l.price, l.quantity, l.seller_id, l.variant || null, l.mrp && l.mrp > l.price ? l.mrp : null]);
      await moveStock(q, l.product_id, l.variant, -l.quantity);
    }
    await q(`DELETE FROM shop_cart_items WHERE user_id = $1`, [me]);
    await q('COMMIT');
    return R.created(res, { order_id: orderId, order_number: orderNumber, total: sum.total, estimated_delivery: sum.estimated_delivery, payment_method: 'cod' });
  } catch (e) {
    if (client) { try { await client.query('ROLLBACK'); } catch (x) {} }
    if (e.code === '23505' && clientRef) {   // two requests with the same ref at once
      const { rows } = await query(`SELECT order_id, order_number, total FROM marketplace_orders WHERE buyer_id::text = $1 AND client_ref = $2`, [me, clientRef]).catch(() => ({ rows: [] }));
      if (rows.length) return R.ok(res, { order_id: rows[0].order_id, order_number: rows[0].order_number, total: Number(rows[0].total), repeated: true });
    }
    return fail(res, 'placeOrder', e);
  } finally { if (client) client.release(); }
};

// ── buyer orders ────────────────────────────────────────────────────────────
function buyerStatus(items) {
  const flow = ['pending','confirmed','packed','shipped','delivered'];
  const live = items.map(i => i.status || 'pending').filter(s => s !== 'cancelled');
  if (!live.length) return 'cancelled';
  return live.reduce((a, b) => (flow.indexOf(a) <= flow.indexOf(b) ? a : b));
}
const ITEMS_SQL = `COALESCE((SELECT json_agg(json_build_object('item_id', oi.item_id, 'product_id', oi.product_id, 'name', oi.name, 'variant', oi.variant,
    'image_url', COALESCE(oi.image_url, p.images->>0), 'price', oi.price, 'mrp', oi.mrp, 'quantity', oi.quantity, 'status', COALESCE(oi.fulfil_status, 'pending'),
    'tracking', oi.tracking, 'seller_name', COALESCE(s.store_name, su.full_name), 'category', p.category) ORDER BY oi.item_id)
  FROM marketplace_order_items oi LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
  LEFT JOIN marketplace_sellers s ON s.user_id::text = COALESCE(oi.seller_id, p.seller_id)::text
  LEFT JOIN users su ON su.user_id::text = COALESCE(oi.seller_id, p.seller_id)::text
  WHERE oi.order_id = o.order_id), '[]')`;

// GET /shop/orders
exports.myOrders = async (req, res) => {
  try {
    const { rows } = await query(`SELECT o.order_id, o.order_number, o.created_at, o.total, o.status, o.payment_method, o.estimated_delivery, ${ITEMS_SQL} AS items
      FROM marketplace_orders o WHERE o.buyer_id::text = $1 ORDER BY o.created_at DESC LIMIT 100`, [uid(req.user)]);
    rows.forEach(o => { o.items = parseJ(o.items, []); o.total = Number(o.total); o.state = buyerStatus(o.items); });
    return R.ok(res, { orders: rows });
  } catch (e) { return fail(res, 'myOrders', e); }
};

// GET /shop/orders/:id
exports.myOrder = async (req, res) => {
  try {
    const { rows } = await query(`SELECT o.order_id, o.order_number, o.created_at, o.subtotal, o.delivery_fee, o.total, o.status, o.payment_method, o.payment_status,
        o.estimated_delivery, o.delivery_address, o.cancel_reason, o.cancelled_at, ${ITEMS_SQL} AS items
      FROM marketplace_orders o WHERE o.order_id = $1 AND o.buyer_id::text = $2`, [str(req.params.id, 64), uid(req.user)]);
    if (!rows.length) return R.notFound(res, 'Order not found');
    const o = rows[0];
    o.items = parseJ(o.items, []); o.delivery_address = parseJ(o.delivery_address, {});
    ['subtotal','delivery_fee','total'].forEach(k => { o[k] = o[k] == null ? null : Number(o[k]); });
    o.state = buyerStatus(o.items);
    o.can_cancel = o.items.some(i => i.status !== 'cancelled') && o.items.every(i => i.status === 'cancelled' || CANCELLABLE.includes(i.status));
    return R.ok(res, { order: o });
  } catch (e) { return fail(res, 'myOrder', e); }
};

// POST /shop/orders/:id/cancel  {reason}
exports.cancelOrder = async (req, res) => {
  const me = uid(req.user), oid = str(req.params.id, 64), reason = str((req.body || {}).reason, 300) || null;
  let client;
  try {
    client = await getClient();
    const q = (t, p) => client.query(t, p);
    await q('BEGIN');
    const { rows: o } = await q(`SELECT order_id FROM marketplace_orders WHERE order_id = $1 AND buyer_id::text = $2 FOR UPDATE`, [oid, me]);
    if (!o.length) { await q('ROLLBACK'); return R.notFound(res, 'Order not found'); }
    const { rows: items } = await q(`SELECT item_id, product_id, variant, quantity, COALESCE(fulfil_status, 'pending') AS st FROM marketplace_order_items WHERE order_id = $1 FOR UPDATE`, [oid]);
    const open = items.filter(i => i.st !== 'cancelled');
    if (!open.length) { await q('ROLLBACK'); return res.status(409).json({ success: false, message: 'This order is already cancelled' }); }
    if (open.some(i => !CANCELLABLE.includes(i.st))) { await q('ROLLBACK'); return res.status(409).json({ success: false, message: 'Part of this order has already been packed or shipped, so it can no longer be cancelled here.' }); }
    for (const i of open) if (i.product_id) await moveStock(q, i.product_id, i.variant || '', i.quantity);
    await q(`UPDATE marketplace_order_items SET fulfil_status = 'cancelled', status_updated_at = NOW() WHERE order_id = $1 AND COALESCE(fulfil_status, 'pending') <> 'cancelled'`, [oid]);
    await q(`UPDATE marketplace_orders SET status = 'cancelled', payment_status = 'cancelled', cancel_reason = $2, cancelled_at = NOW(), updated_at = NOW() WHERE order_id = $1`, [oid, reason]);
    await q('COMMIT');
    return R.ok(res, { cancelled: true });
  } catch (e) { if (client) { try { await client.query('ROLLBACK'); } catch (x) {} } return fail(res, 'cancelOrder', e); }
  finally { if (client) client.release(); }
};

// ── guard for the old /marketplace endpoints ───────────────────────────────
// Old POST /marketplace/orders trusted prices from the browser. This puts the real prices in before it runs.
exports.legacyOrderPrices = async (req, res, next) => {
  try {
    const items = Array.isArray((req.body || {}).items) ? req.body.items.slice(0, 50) : [];
    if (!items.length) return next();
    const ids = items.map(i => String(i && (i.product_id || i.listing_id) || '')).filter(Boolean);
    const { rows } = await query(`SELECT product_id::text AS id, name, price, stock, is_active, COALESCE(archived, FALSE) AS archived FROM marketplace_products WHERE product_id::text = ANY($1::text[])`, [ids]);
    const byId = {}; rows.forEach(r => { byId[r.id] = r; });
    const clean = [];
    for (const it of items) {
      const p = byId[String(it && (it.product_id || it.listing_id) || '')];
      if (!p || !p.is_active || p.archived) return R.badRequest(res, 'An item in your cart is no longer available');
      const qty = toInt(it.quantity, 1);
      if (qty < 1 || qty > MAX_QTY) return R.badRequest(res, 'Quantity must be between 1 and ' + MAX_QTY);
      if (qty > Number(p.stock)) return res.status(409).json({ success: false, message: p.name + ': only ' + p.stock + ' left' });
      clean.push({ product_id: p.id, name: p.name, price: Number(p.price), quantity: qty, image_url: it.image_url || null });
    }
    req.body.items = clean;
    return next();
  } catch (e) { return fail(res, 'legacyOrderPrices', e); }
};
