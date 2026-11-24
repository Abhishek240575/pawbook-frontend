'use strict';
/* ============================================================================
   PawBook Marketplace 2.0 — Shop API (Phase 1: discovery)
   Routes are mounted under /api/v1/shop (see shop_routes_block.js).
   Reads marketplace_products + reviews + order items. Requires migration 003.
   No ratings/reviews are ever invented: rating and review_count come only from
   marketplace_reviews; "sold" comes only from marketplace_order_items.
   ========================================================================== */
const { query } = require('../config/db');
const R = require('../utils/response');

// 2.0 taxonomy + legacy aliases (old values stay in the DB untouched)
const CATEGORY_ALIASES = { 'pet-products': 'accessories', 'vet-services': 'health' };
const CATEGORIES = ['food','treats','toys','grooming','walk','beds','clothing','bowls','health',
                    'litter','aquarium','cages','travel','training','accessories','other'];
const PET_TYPES = ['dog','cat','bird','fish','small_pet','other'];
const SORTS = {
  recommended: 'p.is_featured DESC, sold DESC, rating DESC, p.created_at DESC',
  popular:     'sold DESC, review_count DESC, p.created_at DESC',
  price_asc:   'p.price ASC',
  price_desc:  'p.price DESC',
  new:         'p.created_at DESC',
  rating:      'rating DESC, review_count DESC',
  discount:    'discount_pct DESC NULLS LAST, p.created_at DESC',
};

// Shared SELECT with rating/sold aggregates (no row duplication)
const BASE_SELECT = `
  SELECT p.product_id, p.seller_id, p.name, p.description, p.price, p.compare_price,
         p.category, p.subcategory, p.brand, p.images, p.stock, p.unit,
         p.pet_types, p.life_stages, p.tags, p.is_featured, p.delivery_days, p.created_at,
         u.full_name AS seller_name,
         COALESCE(rv.rating, 0)::float       AS rating,
         COALESCE(rv.review_count, 0)::int   AS review_count,
         COALESCE(so.sold, 0)::int           AS sold,
         CASE WHEN p.compare_price > p.price AND p.compare_price > 0
              THEN ROUND((1 - p.price / p.compare_price) * 100)::int END AS discount_pct
  FROM marketplace_products p
  LEFT JOIN users u ON u.user_id = p.seller_id
  LEFT JOIN (SELECT product_id::text AS pid, AVG(rating) AS rating, COUNT(*) AS review_count
             FROM marketplace_reviews GROUP BY product_id) rv ON rv.pid = p.product_id::text
  LEFT JOIN (SELECT product_id::text AS pid, SUM(quantity) AS sold
             FROM marketplace_order_items WHERE product_id IS NOT NULL GROUP BY product_id) so ON so.pid = p.product_id::text`;

function csv(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }
function normCat(c) { return CATEGORY_ALIASES[c] || c; }

// Builds WHERE clause + params from query-string filters
function buildFilters(qs) {
  const where = ['p.is_active = TRUE'];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$?', '$' + params.length)); };

  if (qs.q) {
    const q = '%' + String(qs.q).slice(0, 80) + '%';
    params.push(q);
    const i = params.length;
    where.push(`(p.name ILIKE $${i} OR p.description ILIKE $${i} OR p.brand ILIKE $${i} OR array_to_string(p.tags, ' ') ILIKE $${i})`);
  }
  const cats = csv(qs.category).filter(c => CATEGORIES.includes(c));
  if (cats.length) {
    // include legacy aliases mapping to the requested categories
    const withLegacy = cats.concat(Object.keys(CATEGORY_ALIASES).filter(k => cats.includes(CATEGORY_ALIASES[k])));
    add('p.category = ANY($?)', withLegacy);
  }
  const pets = csv(qs.pet).filter(p => PET_TYPES.includes(p));
  if (pets.length) add('p.pet_types && $?::text[]', pets);
  const brands = csv(qs.brand).slice(0, 20);
  if (brands.length) add('p.brand = ANY($?)', brands);
  const stages = csv(qs.life_stage).slice(0, 5);
  if (stages.length) add(`(p.life_stages && $?::text[] OR 'all' = ANY(p.life_stages))`, stages);
  if (qs.min_price && !isNaN(qs.min_price)) add('p.price >= $?', Number(qs.min_price));
  if (qs.max_price && !isNaN(qs.max_price)) add('p.price <= $?', Number(qs.max_price));
  if (qs.in_stock === '1' || qs.in_stock === 'true') where.push('p.stock > 0');
  if (qs.on_sale === '1' || qs.on_sale === 'true') where.push('p.compare_price > p.price');
  if (qs.seller) add('p.seller_id::text = $?', String(qs.seller));
  return { where: where.join(' AND '), params };
}

function shape(row) {
  let images = row.images;
  if (typeof images === 'string') { try { images = JSON.parse(images); } catch (e) { images = images ? [images] : []; } }
  if (!Array.isArray(images)) images = [];
  return {
    ...row,
    category: normCat(row.category),
    images: images.filter(Boolean),
    price: Number(row.price),
    compare_price: row.compare_price != null ? Number(row.compare_price) : null,
    rating: Math.round(Number(row.rating) * 10) / 10,
  };
}

// ── GET /shop/products ───────────────────────────────────────────────────────
exports.listProducts = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 60);
    const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const sort  = SORTS[req.query.sort] ? req.query.sort : 'recommended';
    const { where, params } = buildFilters(req.query);
    let having = '';
    if (req.query.rating && !isNaN(req.query.rating)) {
      params.push(Number(req.query.rating));
      having = ` WHERE rating >= $${params.length}`;
    }

    const inner = `${BASE_SELECT} WHERE ${where}`;
    const countSql = `SELECT COUNT(*)::int AS total FROM (${inner}) t${having}`;
    const listSql  = `SELECT * FROM (${inner}) p${having} ORDER BY ${SORTS[sort].replace(/p\./g, 'p.')}
                      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;

    const [{ rows: [{ total }] }, { rows }] = await Promise.all([query(countSql, params), query(listSql, params)]);

    // Facets for the filter sidebar (computed over the q/category/pet scope, not every filter,
    // so options don't disappear as soon as one is ticked)
    const scope = buildFilters({ q: req.query.q, category: req.query.category, pet: req.query.pet });
    const [cats, brands, price] = await Promise.all([
      query(`SELECT category, COUNT(*)::int AS n FROM marketplace_products p WHERE ${buildFilters({ q: req.query.q, pet: req.query.pet }).where} GROUP BY category ORDER BY n DESC`,
            buildFilters({ q: req.query.q, pet: req.query.pet }).params),
      query(`SELECT brand, COUNT(*)::int AS n FROM marketplace_products p WHERE ${scope.where} AND brand IS NOT NULL AND brand <> '' GROUP BY brand ORDER BY n DESC LIMIT 30`, scope.params),
      query(`SELECT COALESCE(MIN(price),0)::float AS min, COALESCE(MAX(price),0)::float AS max FROM marketplace_products p WHERE ${scope.where}`, scope.params),
    ]);
    const catCounts = {};
    cats.rows.forEach(r => { const c = normCat(r.category); catCounts[c] = (catCounts[c] || 0) + r.n; });

    return R.ok(res, {
      products: rows.map(shape), total, page, limit, sort,
      facets: {
        categories: Object.entries(catCounts).map(([category, n]) => ({ category, n })),
        brands: brands.rows, price: price.rows[0],
      },
    });
  } catch (e) { console.error('[Shop] listProducts:', e.message); return R.serverError(res); }
};

// ── GET /shop/home ───────────────────────────────────────────────────────────
exports.home = async (req, res) => {
  try {
    const run = (order, extra = '', n = 12) =>
      query(`SELECT * FROM (${BASE_SELECT} WHERE p.is_active = TRUE ${extra}) p ORDER BY ${order} LIMIT ${n}`);
    const [best, fresh, deals, featured, cats, brands, total] = await Promise.all([
      run('sold DESC, review_count DESC, p.created_at DESC', 'AND p.stock > 0'),
      run('p.created_at DESC'),
      run('discount_pct DESC NULLS LAST', 'AND p.compare_price > p.price'),
      run('p.created_at DESC', 'AND p.is_featured = TRUE'),
      query(`SELECT category, COUNT(*)::int AS n FROM marketplace_products WHERE is_active = TRUE GROUP BY category`),
      query(`SELECT p.brand AS name, b.slug, b.logo_url, COALESCE(b.is_verified, FALSE) AS is_verified, COUNT(*)::int AS n
             FROM marketplace_products p LEFT JOIN marketplace_brands b ON b.name = p.brand
             WHERE p.is_active = TRUE AND p.brand IS NOT NULL AND p.brand <> ''
             GROUP BY p.brand, b.slug, b.logo_url, b.is_verified ORDER BY n DESC LIMIT 12`),
      query(`SELECT COUNT(*)::int AS n FROM marketplace_products WHERE is_active = TRUE`),
    ]);
    const catCounts = {};
    cats.rows.forEach(r => { const c = normCat(r.category); catCounts[c] = (catCounts[c] || 0) + r.n; });
    return R.ok(res, {
      total_products: total.rows[0].n,
      best_sellers: best.rows.filter(r => r.sold > 0).map(shape),
      new_arrivals: fresh.rows.map(shape),
      deals: deals.rows.map(shape),
      featured: featured.rows.map(shape),
      categories: catCounts,
      brands: brands.rows,
    });
  } catch (e) { console.error('[Shop] home:', e.message); return R.serverError(res); }
};

// ── GET /shop/products/:id ───────────────────────────────────────────────────
exports.getProduct = async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await query(
      `SELECT * FROM (${BASE_SELECT} WHERE p.product_id::text = $1 AND p.is_active = TRUE) p`, [id]);
    if (!rows.length) return R.notFound(res, 'Product not found');
    const p = shape(rows[0]);
    const extra = await query(
      `SELECT specs, ingredients, usage_instructions, variants FROM marketplace_products WHERE product_id::text = $1`, [id]);
    Object.assign(p, extra.rows[0] || {});

    const [reviews, related, sellerStats] = await Promise.all([
      query(`SELECT r.rating, r.comment, r.created_at, u.full_name AS user_name, u.avatar_url
             FROM marketplace_reviews r LEFT JOIN users u ON u.user_id = r.user_id
             WHERE r.product_id::text = $1 ORDER BY r.created_at DESC LIMIT 20`, [id]),
      query(`SELECT * FROM (${BASE_SELECT} WHERE p.is_active = TRUE AND p.product_id::text <> $1
               AND (p.category = $2 OR p.pet_types && $3::text[])) p
             ORDER BY (p.category = $2) DESC, sold DESC, p.created_at DESC LIMIT 12`,
            [id, rows[0].category, p.pet_types || []]),
      query(`SELECT COUNT(*)::int AS products FROM marketplace_products WHERE seller_id = $1 AND is_active = TRUE`, [rows[0].seller_id]),
    ]);
    const dist = [5, 4, 3, 2, 1].map(s => ({ stars: s, n: reviews.rows.filter(r => Number(r.rating) === s).length }));
    return R.ok(res, {
      product: p,
      reviews: reviews.rows, rating_breakdown: dist,
      related: related.rows.map(shape),
      seller: { seller_id: rows[0].seller_id, name: rows[0].seller_name, products: sellerStats.rows[0].products },
    });
  } catch (e) { console.error('[Shop] getProduct:', e.message); return R.serverError(res); }
};

// ── GET /shop/suggest?q= ─────────────────────────────────────────────────────
exports.suggest = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return R.ok(res, { products: [], brands: [] });
    const like = '%' + q + '%';
    const [p, b] = await Promise.all([
      query(`SELECT product_id, name, price, images, category FROM marketplace_products
             WHERE is_active = TRUE AND (name ILIKE $1 OR brand ILIKE $1) ORDER BY created_at DESC LIMIT 6`, [like]),
      query(`SELECT DISTINCT brand FROM marketplace_products WHERE is_active = TRUE AND brand ILIKE $1 LIMIT 4`, [like]),
    ]);
    return R.ok(res, { products: p.rows.map(shape), brands: b.rows.map(r => r.brand) });
  } catch (e) { console.error('[Shop] suggest:', e.message); return R.serverError(res); }
};

// ── Wishlist (auth) ──────────────────────────────────────────────────────────
exports.getWishlist = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM (${BASE_SELECT} WHERE p.product_id::text IN
         (SELECT product_id FROM marketplace_wishlist WHERE user_id = $1)) p ORDER BY p.created_at DESC`,
      [req.user.user_id]);
    return R.ok(res, { products: rows.map(shape), ids: rows.map(r => String(r.product_id)) });
  } catch (e) { console.error('[Shop] getWishlist:', e.message); return R.serverError(res); }
};
exports.addWishlist = async (req, res) => {
  try {
    await query(`INSERT INTO marketplace_wishlist (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.user.user_id, String(req.params.id)]);
    return R.ok(res, { saved: true });
  } catch (e) { console.error('[Shop] addWishlist:', e.message); return R.serverError(res); }
};
exports.removeWishlist = async (req, res) => {
  try {
    await query(`DELETE FROM marketplace_wishlist WHERE user_id = $1 AND product_id = $2`, [req.user.user_id, String(req.params.id)]);
    return R.ok(res, { saved: false });
  } catch (e) { console.error('[Shop] removeWishlist:', e.message); return R.serverError(res); }
};

// ── POST /shop/newsletter ────────────────────────────────────────────────────
exports.newsletter = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 255) return R.badRequest(res, 'Valid email required');
    const pets = (Array.isArray(req.body.pet_types) ? req.body.pet_types : []).filter(p => PET_TYPES.includes(p));
    await query(`INSERT INTO marketplace_newsletter (email, pet_types) VALUES ($1,$2)
                 ON CONFLICT (email) DO UPDATE SET pet_types = EXCLUDED.pet_types`, [email, pets]);
    return R.ok(res, { subscribed: true });
  } catch (e) { console.error('[Shop] newsletter:', e.message); return R.serverError(res); }
};
