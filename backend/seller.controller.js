'use strict';
/* ============================================================================
   PawBook Marketplace — Seller API (Phase 2)
   Mounted under /api/v1/shop/seller and /api/v1/shop/admin/sellers (see add_shop_routes.js).
   Requires migrations 003, 004, 005.
   Every write checks that the product / order item belongs to the signed-in seller.
   ========================================================================== */
const { query } = require('../config/db');
const R = require('../utils/response');

const PET_TYPES = ['dog','cat','bird','fish','small_pet','other'];
const LIFE_STAGES = ['puppy','kitten','adult','senior','all'];
const BUSINESS_TYPES = ['individual','retailer','brand','manufacturer'];
const FULFIL = ['pending','confirmed','packed','shipped','delivered','cancelled'];
// allowed next steps for a seller
const NEXT = { pending: ['confirmed','cancelled'], confirmed: ['packed','cancelled'], packed: ['shipped','cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] };
const ORDER_STATUS = { pending: 'pending', confirmed: 'confirmed', packed: 'processing', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled' };

function slugify(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80); }
const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const isHttps = u => /^https:\/\/[^\s"'<>]+$/i.test(String(u || ''));
const toInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const toNum = v => (v === '' || v == null ? null : Number(v));

async function sellerOf(userId) {
  const { rows } = await query(`SELECT * FROM marketplace_sellers WHERE user_id::text = $1`, [String(userId)]);
  return rows[0] || null;
}
async function activeCategories() {
  try { const { rows } = await query(`SELECT slug FROM marketplace_categories WHERE is_active = TRUE`); return rows.map(r => r.slug); }
  catch (e) { return ['food','treats','toys','grooming','walk','beds','clothing','bowls','health','litter','aquarium','cages','travel','training','accessories','other']; }
}

// ── Store profile ────────────────────────────────────────────────────────────
function validateStore(b, isNew) {
  const e = [];
  const out = {
    store_name: str(b.store_name, 80), about: str(b.about, 2000), logo_url: str(b.logo_url, 500) || null,
    business_type: BUSINESS_TYPES.includes(b.business_type) ? b.business_type : 'individual',
    phone: str(b.phone, 20).replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''),
    email: str(b.email, 160) || null, gstin: str(b.gstin, 15).toUpperCase() || null,
    pickup_address: str(b.pickup_address, 400), city: str(b.city, 80) || null, state: str(b.state, 80) || null,
    pincode: str(b.pincode, 6), ships_in_days: Math.min(Math.max(toInt(b.ships_in_days, 2), 1), 10),
  };
  if (out.store_name.length < 3) e.push('store_name');
  if (!/^[6-9]\d{9}$/.test(out.phone)) e.push('phone');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) e.push('email');
  if (out.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(out.gstin)) e.push('gstin');
  if (out.pickup_address.length < 10) e.push('pickup_address');
  if (!/^[1-9]\d{5}$/.test(out.pincode)) e.push('pincode');
  if (out.logo_url && !isHttps(out.logo_url)) e.push('logo_url');
  if (isNew && b.agree !== true) e.push('agree');
  return { e, out };
}

async function storeStats(uid) {
  const [p, o, q, r] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE is_active)::int AS live,
                  COUNT(*) FILTER (WHERE stock <= 0)::int AS out_of_stock,
                  COUNT(*) FILTER (WHERE stock > 0 AND stock <= low_stock_at)::int AS low_stock
           FROM marketplace_products WHERE seller_id::text = $1 AND NOT archived`, [uid]),
    query(`SELECT COUNT(DISTINCT oi.order_id) FILTER (WHERE oi.fulfil_status IN ('pending','confirmed','packed'))::int AS to_ship,
                  COUNT(DISTINCT oi.order_id) FILTER (WHERE o.created_at > NOW() - INTERVAL '30 days')::int AS orders_30d,
                  COALESCE(SUM(oi.price * oi.quantity) FILTER (WHERE o.created_at > NOW() - INTERVAL '30 days' AND oi.fulfil_status <> 'cancelled'), 0)::float AS sales_30d,
                  COALESCE(SUM(oi.quantity) FILTER (WHERE oi.fulfil_status <> 'cancelled'), 0)::int AS units_sold
           FROM marketplace_order_items oi
           JOIN marketplace_orders o ON o.order_id = oi.order_id
           LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
           WHERE COALESCE(oi.seller_id, p.seller_id)::text = $1`, [uid]),
    query(`SELECT COUNT(*)::int AS unanswered FROM marketplace_questions q
           JOIN marketplace_products p ON p.product_id::text = q.product_id
           WHERE p.seller_id::text = $1 AND q.status = 'published'
             AND NOT EXISTS (SELECT 1 FROM marketplace_answers a WHERE a.question_id = q.question_id AND a.is_seller AND a.status = 'published')`, [uid]),
    query(`SELECT COALESCE(AVG(r.rating), 0)::float AS rating, COUNT(*)::int AS reviews FROM marketplace_reviews r
           JOIN marketplace_products p ON p.product_id::text = r.product_id::text WHERE p.seller_id::text = $1`, [uid]),
  ]);
  return Object.assign({}, p.rows[0], o.rows[0], q.rows[0], r.rows[0]);
}

// GET /shop/seller/me
exports.me = async (req, res) => {
  try {
    const uid = String(req.user.user_id);
    const s = await sellerOf(uid);
    if (!s) {
      const { rows } = await query(`SELECT to_jsonb(u) AS j FROM users u WHERE u.user_id::text = $1`, [uid]).catch(() => ({ rows: [] }));
      const j = (rows[0] && rows[0].j) || {};
      return R.ok(res, { seller: null, prefill: { full_name: j.full_name || '', email: j.email || '', phone: j.phone || j.mobile || '' } });
    }
    return R.ok(res, { seller: s, stats: await storeStats(uid) });
  } catch (e) { console.error('[Seller] me:', e.message); return R.serverError(res); }
};

// POST /shop/seller/register
exports.register = async (req, res) => {
  try {
    const uid = String(req.user.user_id);
    if (await sellerOf(uid)) return R.badRequest(res, 'You already have a store');
    const { e, out } = validateStore(req.body || {}, true);
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    let base = slugify(out.store_name) || 'store', slug = base, n = 1;
    while ((await query(`SELECT 1 FROM marketplace_sellers WHERE slug = $1`, [slug])).rows.length) slug = base + '-' + (++n);
    const { rows } = await query(`INSERT INTO marketplace_sellers (user_id, store_name, slug, about, logo_url, business_type, phone, email, gstin, pickup_address, city, state, pincode, ships_in_days)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [uid, out.store_name, slug, out.about || null, out.logo_url, out.business_type, out.phone, out.email, out.gstin, out.pickup_address, out.city, out.state, out.pincode, out.ships_in_days]);
    return R.created(res, { seller: rows[0] });
  } catch (e) { console.error('[Seller] register:', e.message); return R.serverError(res); }
};

// PATCH /shop/seller/me   (profile fields, or {status:'paused'|'active'})
exports.update = async (req, res) => {
  try {
    const uid = String(req.user.user_id);
    const s = await sellerOf(uid);
    if (!s) return R.notFound(res, 'No store yet');
    const b = req.body || {};
    if (b.status !== undefined) {
      if (s.status === 'suspended') return res.status(403).json({ success: false, message: 'Your store is suspended. Please contact PawBook support.' });
      if (!['active','paused'].includes(b.status)) return R.badRequest(res, 'Invalid status');
      await setStoreVisibility(uid, b.status);
      return R.ok(res, { status: b.status });
    }
    const { e, out } = validateStore(Object.assign({}, s, b), false);
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    const { rows } = await query(`UPDATE marketplace_sellers SET store_name=$2, about=$3, logo_url=$4, business_type=$5, phone=$6, email=$7, gstin=$8,
        pickup_address=$9, city=$10, state=$11, pincode=$12, ships_in_days=$13, updated_at=NOW() WHERE user_id::text=$1 RETURNING *`,
      [uid, out.store_name, out.about || null, out.logo_url, out.business_type, out.phone, out.email, out.gstin, out.pickup_address, out.city, out.state, out.pincode, out.ships_in_days]);
    return R.ok(res, { seller: rows[0] });
  } catch (e) { console.error('[Seller] update:', e.message); return R.serverError(res); }
};

// Hide / show all of a store's products when it is paused, resumed or suspended
async function setStoreVisibility(uid, status) {
  await query(`UPDATE marketplace_sellers SET status=$2, updated_at=NOW() WHERE user_id::text=$1`, [uid, status]);
  if (status === 'active') await query(`UPDATE marketplace_products SET is_active=TRUE, store_paused=FALSE, updated_at=NOW() WHERE seller_id::text=$1 AND store_paused`, [uid]);
  else await query(`UPDATE marketplace_products SET is_active=FALSE, store_paused=TRUE, updated_at=NOW() WHERE seller_id::text=$1 AND is_active AND NOT archived`, [uid]);
}

// ── Products ────────────────────────────────────────────────────────────────
async function validateProduct(b) {
  const e = [];
  const cats = await activeCategories();
  const list = (v, allowed) => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(x => allowed.includes(x));
  const out = {
    name: str(b.name, 150), description: str(b.description, 5000), brand: str(b.brand, 120) || null,
    category: String(b.category || ''), subcategory: str(b.subcategory, 60) || null,
    pet_types: Array.from(new Set(list(b.pet_types, PET_TYPES))), life_stages: Array.from(new Set(list(b.life_stages, LIFE_STAGES))),
    tags: (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',')).map(t => str(t, 30).toLowerCase()).filter(Boolean).slice(0, 10),
    ingredients: str(b.ingredients, 3000) || null, usage_instructions: str(b.usage_instructions, 3000) || null,
    unit: str(b.unit, 20) || null, sku: str(b.sku, 60) || null,
    price: toNum(b.price), compare_price: toNum(b.compare_price), stock: toInt(b.stock, 0),
    delivery_days: Math.min(Math.max(toInt(b.delivery_days, 4), 1), 15), low_stock_at: Math.min(Math.max(toInt(b.low_stock_at, 5), 0), 1000),
    images: (Array.isArray(b.images) ? b.images : []).map(String).filter(isHttps).slice(0, 8),
    specs: {}, variants: [],
  };
  if (out.name.length < 3) e.push('name');
  if (out.description.length < 20) e.push('description');
  if (!cats.includes(out.category)) e.push('category');
  if (!out.pet_types.length) e.push('pet_types');
  if (!out.images.length) e.push('images');
  if (b.specs && typeof b.specs === 'object' && !Array.isArray(b.specs)) {
    Object.keys(b.specs).slice(0, 20).forEach(k => { const key = str(k, 40), v = str(b.specs[k], 120); if (key && v) out.specs[key] = v; });
  }
  if (Array.isArray(b.variants) && b.variants.length) {
    const seen = new Set();
    b.variants.slice(0, 12).forEach((v, i) => {
      const label = str(v && v.label, 40), price = toNum(v && v.price), cp = toNum(v && v.compare_price), stock = toInt(v && v.stock, 0);
      if (!label || seen.has(label.toLowerCase()) || !(price > 0) || price > 1000000 || (cp != null && !(cp > price)) || stock < 0 || stock > 100000) { e.push('variants.' + i); return; }
      seen.add(label.toLowerCase());
      out.variants.push({ label, price, compare_price: cp, stock });
    });
    if (out.variants.length) {
      const cheapest = out.variants.reduce((a, v) => (v.price < a.price ? v : a));
      out.price = cheapest.price; out.compare_price = cheapest.compare_price;
      out.stock = out.variants.reduce((s, v) => s + v.stock, 0);
    }
  } else {
    if (!(out.price > 0) || out.price > 1000000) e.push('price');
    if (out.compare_price != null && !(out.compare_price > out.price)) e.push('compare_price');
    if (out.stock < 0 || out.stock > 100000) e.push('stock');
  }
  return { e, out };
}

const PRODUCT_COLS = `p.product_id, p.name, p.description, p.brand, p.category, p.subcategory, p.pet_types, p.life_stages, p.tags,
  p.specs, p.ingredients, p.usage_instructions, p.variants, p.images, p.price, p.compare_price, p.stock, p.unit, p.sku,
  p.delivery_days, p.low_stock_at, p.is_active, p.store_paused, p.created_at, p.updated_at`;

// GET /shop/seller/products?status=live|hidden|out|low&q=
exports.listProducts = async (req, res) => {
  try {
    const uid = String(req.user.user_id);
    const where = ['p.seller_id::text = $1', 'NOT p.archived'], params = [uid];
    const st = req.query.status;
    if (st === 'live') where.push('p.is_active');
    else if (st === 'hidden') where.push('NOT p.is_active');
    else if (st === 'out') where.push('p.stock <= 0');
    else if (st === 'low') where.push('p.stock > 0 AND p.stock <= p.low_stock_at');
    if (req.query.q) { params.push('%' + str(req.query.q, 80) + '%'); where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.brand ILIKE $${params.length})`); }
    const { rows } = await query(`SELECT ${PRODUCT_COLS},
        COALESCE((SELECT SUM(oi.quantity) FROM marketplace_order_items oi WHERE oi.product_id::text = p.product_id::text AND oi.fulfil_status <> 'cancelled'), 0)::int AS sold,
        COALESCE((SELECT AVG(r.rating) FROM marketplace_reviews r WHERE r.product_id::text = p.product_id::text), 0)::float AS rating,
        (SELECT COUNT(*) FROM marketplace_reviews r WHERE r.product_id::text = p.product_id::text)::int AS review_count
      FROM marketplace_products p WHERE ${where.join(' AND ')} ORDER BY p.is_active DESC, p.updated_at DESC LIMIT 500`, params);
    return R.ok(res, { products: rows });
  } catch (e) { console.error('[Seller] listProducts:', e.message); return R.serverError(res); }
};

// GET /shop/seller/products/:id
exports.getProduct = async (req, res) => {
  try {
    const { rows } = await query(`SELECT ${PRODUCT_COLS} FROM marketplace_products p WHERE p.product_id::text = $1 AND p.seller_id::text = $2 AND NOT p.archived`, [String(req.params.id), String(req.user.user_id)]);
    if (!rows.length) return R.notFound(res, 'Product not found');
    return R.ok(res, { product: rows[0] });
  } catch (e) { console.error('[Seller] getProduct:', e.message); return R.serverError(res); }
};

async function requireActiveStore(req, res) {
  const s = await sellerOf(req.user.user_id);
  if (!s) { R.badRequest(res, 'Please set up your store first'); return null; }
  if (s.status === 'suspended') { res.status(403).json({ success: false, message: 'Your store is suspended. Please contact PawBook support.' }); return null; }
  return s;
}

// POST /shop/seller/products
exports.createProduct = async (req, res) => {
  try {
    const s = await requireActiveStore(req, res); if (!s) return;
    const { e, out } = await validateProduct(req.body || {});
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    const live = req.body.is_active !== false && s.status === 'active';
    const { rows } = await query(`INSERT INTO marketplace_products (seller_id, name, description, brand, category, subcategory, pet_types, life_stages, tags,
        specs, ingredients, usage_instructions, variants, images, price, compare_price, stock, unit, sku, delivery_days, low_stock_at, is_active, store_paused)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING product_id`,
      [String(req.user.user_id), out.name, out.description, out.brand, out.category, out.subcategory, out.pet_types, out.life_stages, out.tags,
       JSON.stringify(out.specs), out.ingredients, out.usage_instructions, JSON.stringify(out.variants), JSON.stringify(out.images),
       out.price, out.compare_price, out.stock, out.unit, out.sku, out.delivery_days, out.low_stock_at, live, req.body.is_active !== false && s.status === 'paused']);
    return R.created(res, { product_id: rows[0].product_id, is_active: live });
  } catch (e) { console.error('[Seller] createProduct:', e.message); return R.serverError(res); }
};

// PUT /shop/seller/products/:id   (full edit)
exports.updateProduct = async (req, res) => {
  try {
    const s = await requireActiveStore(req, res); if (!s) return;
    const id = String(req.params.id), uid = String(req.user.user_id);
    const own = await query(`SELECT is_active, store_paused FROM marketplace_products WHERE product_id::text = $1 AND seller_id::text = $2 AND NOT archived`, [id, uid]);
    if (!own.rows.length) return R.notFound(res, 'Product not found');
    const { e, out } = await validateProduct(req.body || {});
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    const want = req.body.is_active === undefined ? (own.rows[0].is_active || own.rows[0].store_paused) : req.body.is_active === true;
    await query(`UPDATE marketplace_products SET name=$3, description=$4, brand=$5, category=$6, subcategory=$7, pet_types=$8, life_stages=$9, tags=$10,
        specs=$11, ingredients=$12, usage_instructions=$13, variants=$14, images=$15, price=$16, compare_price=$17, stock=$18, unit=$19, sku=$20,
        delivery_days=$21, low_stock_at=$22, is_active=$23, store_paused=$24, updated_at=NOW()
      WHERE product_id::text = $1 AND seller_id::text = $2`,
      [id, uid, out.name, out.description, out.brand, out.category, out.subcategory, out.pet_types, out.life_stages, out.tags,
       JSON.stringify(out.specs), out.ingredients, out.usage_instructions, JSON.stringify(out.variants), JSON.stringify(out.images),
       out.price, out.compare_price, out.stock, out.unit, out.sku, out.delivery_days, out.low_stock_at, want && s.status === 'active', want && s.status === 'paused']);
    return R.ok(res, { updated: true });
  } catch (e) { console.error('[Seller] updateProduct:', e.message); return R.serverError(res); }
};

// PATCH /shop/seller/products/:id   quick edits: {stock} {price} {is_active} {variant_stock:{label:n}}
exports.quickUpdate = async (req, res) => {
  try {
    const s = await requireActiveStore(req, res); if (!s) return;
    const id = String(req.params.id), uid = String(req.user.user_id), b = req.body || {};
    const { rows } = await query(`SELECT price, compare_price, stock, variants FROM marketplace_products WHERE product_id::text = $1 AND seller_id::text = $2 AND NOT archived`, [id, uid]);
    if (!rows.length) return R.notFound(res, 'Product not found');
    const p = rows[0]; let variants = Array.isArray(p.variants) ? p.variants : [];
    const sets = [], params = [id, uid];
    const set = (col, v) => { params.push(v); sets.push(`${col}=$${params.length}`); };
    if (b.variant_stock && typeof b.variant_stock === 'object' && variants.length) {
      variants = variants.map(v => (b.variant_stock[v.label] !== undefined ? Object.assign({}, v, { stock: Math.max(0, Math.min(100000, toInt(b.variant_stock[v.label], v.stock))) }) : v));
      set('variants', JSON.stringify(variants)); set('stock', variants.reduce((a, v) => a + (v.stock || 0), 0));
    } else if (b.stock !== undefined) {
      if (variants.length) return R.badRequest(res, 'This product has sizes. Update stock per size.');
      const n = toInt(b.stock, -1); if (n < 0 || n > 100000) return R.badRequest(res, 'Invalid stock');
      set('stock', n);
    }
    if (b.price !== undefined) {
      if (variants.length) return R.badRequest(res, 'This product has sizes. Edit prices in the product form.');
      const pr = toNum(b.price), cp = b.compare_price !== undefined ? toNum(b.compare_price) : p.compare_price;
      if (!(pr > 0) || pr > 1000000 || (cp != null && !(Number(cp) > pr))) return R.badRequest(res, 'Invalid price');
      set('price', pr); set('compare_price', cp);
    }
    if (b.is_active !== undefined) { const on = b.is_active === true; set('is_active', on && s.status === 'active'); set('store_paused', on && s.status === 'paused'); }
    if (!sets.length) return R.badRequest(res, 'Nothing to update');
    await query(`UPDATE marketplace_products SET ${sets.join(', ')}, updated_at=NOW() WHERE product_id::text = $1 AND seller_id::text = $2`, params);
    return R.ok(res, { updated: true });
  } catch (e) { console.error('[Seller] quickUpdate:', e.message); return R.serverError(res); }
};

// DELETE /shop/seller/products/:id   (archive: hidden everywhere, kept for past orders)
exports.archiveProduct = async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE marketplace_products SET archived = TRUE, is_active = FALSE, store_paused = FALSE, updated_at = NOW()
      WHERE product_id::text = $1 AND seller_id::text = $2 AND NOT archived`, [String(req.params.id), String(req.user.user_id)]);
    if (!rowCount) return R.notFound(res, 'Product not found');
    return R.ok(res, { archived: true });
  } catch (e) { console.error('[Seller] archiveProduct:', e.message); return R.serverError(res); }
};

// ── Orders (only this seller's items) ───────────────────────────────────────
// GET /shop/seller/orders?status=to_ship|shipped|delivered|cancelled
exports.listOrders = async (req, res) => {
  try {
    const uid = String(req.user.user_id);
    const params = [uid]; let f = '';
    const st = req.query.status;
    if (st === 'to_ship') f = ` AND oi.fulfil_status IN ('pending','confirmed','packed')`;
    else if (FULFIL.includes(st)) { params.push(st); f = ` AND oi.fulfil_status = $2`; }
    const { rows } = await query(`
      SELECT o.order_id, o.order_number, o.created_at, o.delivery_address, u.full_name AS buyer_name,
             json_agg(json_build_object('item_id', oi.item_id, 'product_id', oi.product_id, 'name', oi.name, 'image_url', COALESCE(oi.image_url, p.images->>0),
               'price', oi.price, 'quantity', oi.quantity, 'status', oi.fulfil_status, 'tracking', oi.tracking) ORDER BY oi.item_id) AS items,
             SUM(oi.price * oi.quantity)::float AS amount
      FROM marketplace_order_items oi
      JOIN marketplace_orders o ON o.order_id = oi.order_id
      LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
      LEFT JOIN users u ON u.user_id::text = o.buyer_id::text
      WHERE COALESCE(oi.seller_id, p.seller_id)::text = $1 ${f}
      GROUP BY o.order_id, u.full_name ORDER BY o.created_at DESC LIMIT 200`, params);
    // only what the seller needs to ship: name, city, PIN and address; no buyer email
    rows.forEach(r => { let a = r.delivery_address; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = {}; } } r.delivery_address = a || {}; });
    return R.ok(res, { orders: rows });
  } catch (e) { console.error('[Seller] listOrders:', e.message); return R.serverError(res); }
};

// PATCH /shop/seller/orders/:order_id   {status, tracking?, item_ids?}
exports.updateOrder = async (req, res) => {
  try {
    const uid = String(req.user.user_id), oid = String(req.params.order_id), b = req.body || {};
    const to = String(b.status || '');
    if (!FULFIL.includes(to)) return R.badRequest(res, 'Invalid status');
    const { rows } = await query(`SELECT oi.item_id, oi.fulfil_status, oi.product_id, oi.quantity, oi.variant FROM marketplace_order_items oi
      LEFT JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
      WHERE oi.order_id = $1 AND COALESCE(oi.seller_id, p.seller_id)::text = $2`, [oid, uid]);
    if (!rows.length) return R.notFound(res, 'Order not found');
    const ids = Array.isArray(b.item_ids) && b.item_ids.length ? rows.filter(r => b.item_ids.map(String).includes(String(r.item_id))) : rows;
    const bad = ids.filter(r => !(NEXT[r.fulfil_status] || []).includes(to));
    if (!ids.length || bad.length) return res.status(409).json({ success: false, message: `Cannot move from ${bad.length ? bad[0].fulfil_status : '?'} to ${to}` });
    const tracking = str(b.tracking, 200) || null;
    await query(`UPDATE marketplace_order_items SET fulfil_status = $2, seller_id = $3, status_updated_at = NOW(), tracking = COALESCE($4, tracking)
      WHERE item_id = ANY($1::text[])`, [ids.map(r => String(r.item_id)), to, uid, tracking]);
    if (to === 'cancelled') {   // put stock back
      const { moveStock } = require('./checkout.controller');
      for (const r of ids) if (r.product_id) await moveStock(query, r.product_id, r.variant || '', r.quantity);
    }
    // keep the buyer-facing order status in step when every item in the order agrees
    const all = await query(`SELECT DISTINCT fulfil_status FROM marketplace_order_items WHERE order_id = $1`, [oid]);
    if (all.rows.length === 1) await query(`UPDATE marketplace_orders SET status = $2 WHERE order_id = $1`, [oid, ORDER_STATUS[all.rows[0].fulfil_status]]).catch(() => {});
    return R.ok(res, { updated: ids.length, status: to });
  } catch (e) { console.error('[Seller] updateOrder:', e.message); return R.serverError(res); }
};

// ── Questions on my products ────────────────────────────────────────────────
// GET /shop/seller/questions?unanswered=1
exports.listQuestions = async (req, res) => {
  try {
    const un = req.query.unanswered === '1';
    const { rows } = await query(`
      SELECT q.question_id, q.question, q.created_at, q.product_id, p.name AS product_name, u.full_name AS user_name,
             COALESCE((SELECT json_agg(json_build_object('answer', a.answer, 'is_seller', a.is_seller, 'created_at', a.created_at) ORDER BY a.created_at)
                       FROM marketplace_answers a WHERE a.question_id = q.question_id AND a.status = 'published'), '[]') AS answers,
             EXISTS (SELECT 1 FROM marketplace_answers a WHERE a.question_id = q.question_id AND a.is_seller AND a.status = 'published') AS seller_answered
      FROM marketplace_questions q
      JOIN marketplace_products p ON p.product_id::text = q.product_id
      LEFT JOIN users u ON u.user_id::text = q.user_id::text
      WHERE p.seller_id::text = $1 AND q.status = 'published'
      ORDER BY seller_answered ASC, q.created_at DESC LIMIT 200`, [String(req.user.user_id)]);
    return R.ok(res, { questions: un ? rows.filter(r => !r.seller_answered) : rows });
  } catch (e) { console.error('[Seller] listQuestions:', e.message); return R.serverError(res); }
};

// ── Admin ───────────────────────────────────────────────────────────────────
// GET /shop/admin/sellers
exports.adminList = async (req, res) => {
  try {
    const { rows } = await query(`SELECT s.user_id, s.store_name, s.slug, s.business_type, s.phone, s.email, s.gstin, s.city, s.state, s.pincode,
        s.status, s.is_verified, s.admin_note, s.created_at, u.full_name AS owner_name,
        (SELECT COUNT(*) FROM marketplace_products p WHERE p.seller_id::text = s.user_id::text AND NOT p.archived)::int AS products
      FROM marketplace_sellers s LEFT JOIN users u ON u.user_id::text = s.user_id::text ORDER BY s.created_at DESC LIMIT 500`);
    return R.ok(res, { sellers: rows });
  } catch (e) { console.error('[Seller] adminList:', e.message); return R.serverError(res); }
};

// PATCH /shop/admin/sellers/:user_id   {status?: active|suspended, is_verified?, admin_note?}
exports.adminUpdate = async (req, res) => {
  try {
    const uid = String(req.params.user_id), b = req.body || {};
    const s = await sellerOf(uid);
    if (!s) return R.notFound(res, 'Seller not found');
    if (b.status !== undefined) {
      if (!['active','suspended'].includes(b.status)) return R.badRequest(res, 'Invalid status');
      await setStoreVisibility(uid, b.status);
    }
    if (b.is_verified !== undefined || b.admin_note !== undefined) {
      await query(`UPDATE marketplace_sellers SET is_verified = COALESCE($2, is_verified), admin_note = COALESCE($3, admin_note), updated_at = NOW() WHERE user_id::text = $1`,
        [uid, b.is_verified === undefined ? null : b.is_verified === true, b.admin_note === undefined ? null : str(b.admin_note, 500)]);
    }
    return R.ok(res, { seller: await sellerOf(uid) });
  } catch (e) { console.error('[Seller] adminUpdate:', e.message); return R.serverError(res); }
};
