'use strict';
/* ============================================================================
   PawBook Marketplace 2.0 — Shop API
   Mounted under /api/v1/shop (see add_shop_routes.js).
   Requires migrations 003 + 004.
   Trust rules: ratings/review counts come only from marketplace_reviews,
   "sold"/"bought together" only from marketplace_order_items. Nothing invented.
   ========================================================================== */
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const R = require('../utils/response');

// ── Categories: DB-managed (004), cached; static list as a safety net ───────
const CATEGORY_ALIASES = { 'pet-products': 'accessories', 'vet-services': 'health' };
const FALLBACK_CATEGORIES = ['food','treats','toys','grooming','walk','beds','clothing','bowls','health',
                             'litter','aquarium','cages','travel','training','accessories','other'];
const PET_TYPES = ['dog','cat','bird','fish','small_pet','other'];
let catCache = { at: 0, rows: null };
async function categories(force) {
  if (!force && catCache.rows && Date.now() - catCache.at < 60000) return catCache.rows;
  try {
    const { rows } = await query(`SELECT slug, name, name_i18n, icon, image_url, sort_order, show_on_home, is_active
                                  FROM marketplace_categories ORDER BY sort_order, name`);
    catCache = { at: Date.now(), rows };
  } catch (e) {
    catCache = { at: Date.now(), rows: FALLBACK_CATEGORIES.map((s, i) => ({ slug: s, name: s, name_i18n: {}, icon: 'ti-tag', sort_order: i, show_on_home: i < 8, is_active: true })) };
  }
  return catCache.rows;
}
async function activeSlugs() { return (await categories()).filter(c => c.is_active).map(c => c.slug); }

const SORTS = {
  recommended: 'p.is_featured DESC, sold DESC, rating DESC, p.created_at DESC',
  popular:     'sold DESC, review_count DESC, p.created_at DESC',
  price_asc:   'p.price ASC',
  price_desc:  'p.price DESC',
  new:         'p.created_at DESC',
  rating:      'rating DESC, review_count DESC',
  discount:    'discount_pct DESC NULLS LAST, p.created_at DESC',
};

const BASE_SELECT = `
  SELECT p.product_id, p.seller_id, p.name, p.description, p.price, p.compare_price,
         p.category, p.subcategory, p.brand, p.images, p.stock, p.unit,
         p.pet_types, p.life_stages, p.tags, p.is_featured, p.delivery_days, p.created_at,
         CASE WHEN jsonb_typeof(p.variants::jsonb) = 'array' THEN jsonb_array_length(p.variants::jsonb) ELSE 0 END AS size_count,
         COALESCE(ss.store_name, u.full_name) AS seller_name, COALESCE(ss.is_verified, FALSE) AS seller_verified,
         COALESCE(rv.rating, 0)::float       AS rating,
         COALESCE(rv.review_count, 0)::int   AS review_count,
         COALESCE(so.sold, 0)::int           AS sold,
         CASE WHEN p.compare_price > p.price AND p.compare_price > 0
              THEN ROUND((1 - p.price / p.compare_price) * 100)::int END AS discount_pct
  FROM marketplace_products p
  LEFT JOIN users u ON u.user_id = p.seller_id
  LEFT JOIN marketplace_sellers ss ON ss.user_id::text = p.seller_id::text
  LEFT JOIN (SELECT product_id::text AS pid, AVG(rating) AS rating, COUNT(*) AS review_count
             FROM marketplace_reviews WHERE COALESCE(status, 'published') = 'published' GROUP BY product_id) rv ON rv.pid = p.product_id::text
  LEFT JOIN (SELECT product_id::text AS pid, SUM(quantity) AS sold
             FROM marketplace_order_items WHERE product_id IS NOT NULL AND COALESCE(fulfil_status, 'pending') <> 'cancelled' GROUP BY product_id) so ON so.pid = p.product_id::text`;

function alnumLen(s) { return String(s || '').replace(/[^\p{L}\p{N}]/gu, '').length; }
function csv(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }
function normCat(c) { return CATEGORY_ALIASES[c] || c; }
function slugify(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 120); }

// Optional login: personalise when a valid token is present, otherwise treat as guest.
function optionalUser(req) {
  try {
    const h = req.headers.authorization;
    const token = (h && h.startsWith('Bearer ')) ? h.split(' ')[1] : (req.cookies && req.cookies.pb_token);
    if (!token) return null;
    const p = jwt.verify(token, process.env.JWT_SECRET);
    return p && p.user_id ? { user_id: p.user_id } : null;
  } catch (e) { return null; }
}

// ── Search helpers: synonyms + typo tolerance (pg_trgm) ─────────────────────
let trgm = null;
async function hasTrgm() {
  if (trgm !== null) return trgm;
  try { const { rows } = await query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`); trgm = rows.length > 0; } catch (e) { trgm = false; }
  return trgm;
}
async function expandTerms(q) {
  const base = String(q || '').toLowerCase().trim().slice(0, 80);
  if (!base) return [];
  const words = base.split(/\s+/).filter(Boolean).slice(0, 6);
  const keys = [base].concat(words);
  const syn = {};
  try {
    const { rows } = await query(`SELECT term, expands FROM marketplace_search_synonyms WHERE term = ANY($1)`, [keys]);
    rows.forEach(r => { syn[r.term] = (r.expands || []).map(e => String(e).toLowerCase()); });
  } catch (e) { /* synonyms table missing: plain search */ }
  const phrase = Array.from(new Set([base].concat(syn[base] || []))).slice(0, 8);
  // Multi-word queries: every word (or one of its synonyms) must match, so
  // "kutta khana" finds dog food, not every dog product plus every food.
  const groups = words.length > 1
    ? words.filter(w => alnumLen(w) >= 2).map(w => Array.from(new Set([w].concat(syn[w] || []))).slice(0, 6))
    : [];
  const flat = Array.from(new Set(phrase.concat(...groups))).slice(0, 16);
  flat.phrase = phrase; flat.groups = groups;
  return flat;
}

// Word-aware patterns: short words match whole words (cat ≠ category), longer ones match
// word starts (kibble → "Kibble"), non-Latin scripts fall back to substring match.
function termPatterns(terms) {
  const rx = [], lk = [];
  terms.forEach(t => {
    if (/^[\x00-\x7f]+$/.test(t)) {
      const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      rx.push(t.length <= 3 ? '\\m' + e + '(s|es)?\\M' : '\\m' + e);
    } else lk.push('%' + t + '%');
  });
  return { rx, lk };
}

// WHERE builder. qs._terms (from expandTerms) and qs._fuzzy enable search.
async function buildFilters(qs) {
  const where = ['p.is_active = TRUE'];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$?', '$' + params.length)); };

  if (qs._terms && qs._terms.length) {
    const txt = `(p.name || ' ' || coalesce(p.description,'') || ' ' || coalesce(p.brand,'') || ' ' || array_to_string(p.tags, ' ') || ' ' || array_to_string(p.pet_types, ' ') || ' ' || p.category)`;
    const match = list => {
      const { rx, lk } = termPatterns(list);
      params.push(rx); const i = params.length; params.push(lk); const k = params.length;
      return `(${txt} ~* ANY($${i}::text[]) OR ${txt} ILIKE ANY($${k}::text[]))`;
    };
    const groups = qs._terms.groups || [];
    let cond = match(qs._terms.phrase || qs._terms);
    if (groups.length > 1) cond = `(${cond} OR (${groups.map(match).join(' AND ')}))`;
    if (qs._fuzzy) {
      params.push(String(qs.q).toLowerCase().slice(0, 80));
      const j = params.length;
      cond = `(${cond} OR word_similarity($${j}, lower(p.name)) > 0.45 OR similarity(lower(coalesce(p.brand,'')), $${j}) > 0.4)`;
    }
    where.push(cond);
  }
  const allowed = await activeSlugs();
  const cats = csv(qs.category).filter(c => allowed.includes(c) || FALLBACK_CATEGORIES.includes(c));
  if (cats.length) {
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
  const out = {
    ...row,
    category: normCat(row.category),
    images: images.filter(Boolean),
    price: Number(row.price),
    compare_price: row.compare_price != null ? Number(row.compare_price) : null,
    rating: Math.round(Number(row.rating) * 10) / 10,
  };
  delete out.rel; delete out.score; delete out.match; delete out.pop;
  return out;
}

// "Did you mean …?" — corrects each word against the catalogue vocabulary
async function didYouMean(q) {
  if (!(await hasTrgm())) return null;
  const words = String(q).toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 3);
  if (!words.length) return null;
  const out = []; let changed = false;
  for (const w of words) {
    const { rows } = await query(`
      SELECT v.w, similarity(v.w, $1) AS s FROM (
        SELECT DISTINCT lower(x) AS w FROM marketplace_products p,
               unnest(regexp_split_to_array(p.name || ' ' || coalesce(p.brand,''), '[^[:alnum:]]+')) x
        WHERE p.is_active = TRUE
        UNION SELECT lower(name) FROM marketplace_categories WHERE is_active = TRUE
        UNION SELECT term FROM marketplace_search_synonyms) v
      WHERE length(v.w) > 2 AND v.w <> $1 AND similarity(v.w, $1) > 0.3
      ORDER BY s DESC LIMIT 1`, [w]).catch(() => ({ rows: [] }));
    if (rows.length && rows[0].s > 0.3) { out.push(rows[0].w); changed = true; } else out.push(w);
  }
  return changed ? out.join(' ') : null;
}

// ── GET /shop/products ───────────────────────────────────────────────────────
exports.listProducts = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 60);
    const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const sort  = SORTS[req.query.sort] ? req.query.sort : 'recommended';
    const q = String(req.query.q || '').trim();
    const fuzzy = alnumLen(q) >= 3 && await hasTrgm();
    const terms = q ? await expandTerms(q) : [];
    const { where, params } = await buildFilters({ ...req.query, _terms: terms, _fuzzy: fuzzy });

    let having = '';
    if (req.query.rating && !isNaN(req.query.rating)) { params.push(Number(req.query.rating)); having = ` WHERE rating >= $${params.length}`; }
    let relSel = '', order = SORTS[sort];
    if (q && fuzzy) {
      params.push(q.toLowerCase());
      relSel = `, word_similarity($${params.length}, lower(p.name)) AS rel`;
      if (sort === 'recommended') order = 'rel DESC, ' + order;
    }
    const inner = `${BASE_SELECT} WHERE ${where}`;
    const countSql = `SELECT COUNT(*)::int AS total FROM (${inner}) t${having.replace('rating', 't.rating')}`;
    const listSql  = `SELECT p.*${relSel} FROM (${inner}) p${having} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
    const countParams = relSel ? params.slice(0, -1) : params;
    const [{ rows: [{ total }] }, { rows }] = await Promise.all([query(countSql, countParams), query(listSql, params)]);

    // Facets over the q/category/pet scope
    const s1 = await buildFilters({ _terms: terms, _fuzzy: fuzzy, q, pet: req.query.pet });
    const s2 = await buildFilters({ _terms: terms, _fuzzy: fuzzy, q, category: req.query.category, pet: req.query.pet });
    const [cats, brands, price] = await Promise.all([
      query(`SELECT category, COUNT(*)::int AS n FROM marketplace_products p WHERE ${s1.where} GROUP BY category ORDER BY n DESC`, s1.params),
      query(`SELECT brand, COUNT(*)::int AS n FROM marketplace_products p WHERE ${s2.where} AND brand IS NOT NULL AND brand <> '' GROUP BY brand ORDER BY n DESC LIMIT 30`, s2.params),
      query(`SELECT COALESCE(MIN(price),0)::float AS min, COALESCE(MAX(price),0)::float AS max FROM marketplace_products p WHERE ${s2.where}`, s2.params),
    ]);
    const catCounts = {};
    cats.rows.forEach(r => { const c = normCat(r.category); catCounts[c] = (catCounts[c] || 0) + r.n; });

    let did_you_mean = null, showing_for = null;
    if (q && total === 0) did_you_mean = await didYouMean(q);
    else if (q && fuzzy && page === 1) {
      const exact = await buildFilters({ ...req.query, _terms: terms, _fuzzy: false });
      const { rows: [{ n }] } = await query(`SELECT COUNT(*)::int AS n FROM marketplace_products p WHERE ${exact.where}`, exact.params);
      if (n === 0) showing_for = await didYouMean(q);
    }
    if (q && page === 1 && q.length >= 2) query(`INSERT INTO marketplace_search_log (q, results) VALUES ($1,$2)`, [q.toLowerCase().slice(0, 80), total]).catch(() => {});

    return R.ok(res, {
      products: rows.map(shape), total, page, limit, sort, did_you_mean, showing_for,
      facets: { categories: Object.entries(catCounts).map(([category, n]) => ({ category, n })), brands: brands.rows, price: price.rows[0] },
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
      brandRows(12),
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
      brands,
    });
  } catch (e) { console.error('[Shop] home:', e.message); return R.serverError(res); }
};

// ── GET /shop/products/:id ───────────────────────────────────────────────────
exports.getProduct = async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await query(`SELECT * FROM (${BASE_SELECT} WHERE p.product_id::text = $1 AND p.is_active = TRUE) p`, [id]);
    if (!rows.length) return R.notFound(res, 'Product not found');
    const p = shape(rows[0]);
    const extra = await query(`SELECT specs, ingredients, usage_instructions, variants FROM marketplace_products WHERE product_id::text = $1`, [id]);
    Object.assign(p, extra.rows[0] || {});
    const [reviews, related, sellerStats, brand] = await Promise.all([
      query(`SELECT r.rating, r.title, r.comment, COALESCE(r.verified, FALSE) AS verified, r.created_at, u.full_name AS user_name, u.avatar_url
             FROM marketplace_reviews r LEFT JOIN users u ON u.user_id = r.user_id
             WHERE r.product_id::text = $1 AND COALESCE(r.status, 'published') = 'published' ORDER BY COALESCE(r.verified, FALSE) DESC, r.created_at DESC LIMIT 30`, [id]),
      query(`SELECT * FROM (${BASE_SELECT} WHERE p.is_active = TRUE AND p.product_id::text <> $1
               AND (p.category = $2 OR p.pet_types && $3::text[])) p
             ORDER BY (p.category = $2) DESC, sold DESC, p.created_at DESC LIMIT 12`, [id, rows[0].category, p.pet_types || []]),
      query(`SELECT (SELECT COUNT(*)::int FROM marketplace_products WHERE seller_id::text = $1 AND is_active = TRUE) AS products,
                    s.is_verified, s.city, s.ships_in_days, s.created_at AS since
             FROM (SELECT 1) x LEFT JOIN marketplace_sellers s ON s.user_id::text = $1`, [String(rows[0].seller_id)]),
      p.brand ? query(`SELECT slug, logo_url, is_verified FROM marketplace_brands WHERE name = $1`, [p.brand]).catch(() => ({ rows: [] })) : { rows: [] },
    ]);
    const dist = [5, 4, 3, 2, 1].map(s => ({ stars: s, n: reviews.rows.filter(r => Number(r.rating) === s).length }));
    if (p.brand) p.brand_info = brand.rows[0] || { slug: slugify(p.brand), logo_url: null, is_verified: false };
    return R.ok(res, {
      product: p, reviews: reviews.rows, rating_breakdown: dist,
      related: related.rows.map(shape),
      seller: Object.assign({ seller_id: rows[0].seller_id, name: rows[0].seller_name }, sellerStats.rows[0], { is_verified: !!sellerStats.rows[0].is_verified }),
    });
  } catch (e) { console.error('[Shop] getProduct:', e.message); return R.serverError(res); }
};

// ── GET /shop/suggest?q=  (empty q → popular searches) ───────────────────────
exports.suggest = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) {
      const pop = await query(`SELECT q, COUNT(*)::int AS n FROM marketplace_search_log
                               WHERE created_at > NOW() - INTERVAL '30 days' AND results > 0
                               GROUP BY q ORDER BY n DESC LIMIT 8`).catch(() => ({ rows: [] }));
      return R.ok(res, { products: [], brands: [], popular: pop.rows.map(r => r.q) });
    }
    const terms = await expandTerms(q);
    const fuzzy = alnumLen(q) >= 3 && await hasTrgm();
    const { rx, lk } = termPatterns(terms);
    const m = `((name || ' ' || coalesce(brand,'')) ~* ANY($1::text[]) OR (name || ' ' || coalesce(brand,'')) ILIKE ANY($2::text[]))`;
    const prodSql = fuzzy
      ? `SELECT product_id, name, price, images, category FROM marketplace_products
         WHERE is_active = TRUE AND (${m} OR word_similarity($3, lower(name)) > 0.45)
         ORDER BY word_similarity($3, lower(name)) DESC, created_at DESC LIMIT 6`
      : `SELECT product_id, name, price, images, category FROM marketplace_products
         WHERE is_active = TRUE AND ${m} ORDER BY created_at DESC LIMIT 6`;
    const [p, b] = await Promise.all([
      query(prodSql, fuzzy ? [rx, lk, q.toLowerCase()] : [rx, lk]),
      query(`SELECT DISTINCT brand FROM marketplace_products WHERE is_active = TRUE AND (brand ~* ANY($1::text[]) OR brand ILIKE ANY($2::text[])) LIMIT 4`, [rx, lk]),
    ]);
    return R.ok(res, { products: p.rows.map(shape), brands: b.rows.map(r => r.brand), expanded: terms.slice(1) });
  } catch (e) { console.error('[Shop] suggest:', e.message); return R.serverError(res); }
};

// ── Categories ───────────────────────────────────────────────────────────────
exports.listCategories = async (req, res) => {
  try {
    const all = await categories();
    const { rows } = await query(`SELECT category, COUNT(*)::int AS n FROM marketplace_products WHERE is_active = TRUE GROUP BY category`);
    const counts = {}; rows.forEach(r => { const c = normCat(r.category); counts[c] = (counts[c] || 0) + r.n; });
    return R.ok(res, { categories: all.filter(c => c.is_active).map(c => ({ ...c, n: counts[c.slug] || 0 })) });
  } catch (e) { console.error('[Shop] listCategories:', e.message); return R.serverError(res); }
};

// ── Brands ───────────────────────────────────────────────────────────────────
async function brandRows(limit) {
  const { rows } = await query(`
    SELECT p.brand AS name, COALESCE(b.slug, '') AS slug, b.logo_url, b.cover_url, b.tagline,
           COALESCE(b.is_verified, FALSE) AS is_verified, COUNT(*)::int AS n,
           ROUND(COALESCE(AVG(rv.rating), 0)::numeric, 1)::float AS rating,
           ARRAY_AGG(DISTINCT p.category) AS categories,
           (SELECT ARRAY_AGG(DISTINCT t) FROM marketplace_products p2, unnest(p2.pet_types) t
             WHERE p2.brand = p.brand AND p2.is_active = TRUE) AS pet_types
    FROM marketplace_products p
    LEFT JOIN marketplace_brands b ON b.name = p.brand AND b.is_active = TRUE
    LEFT JOIN (SELECT product_id::text AS pid, AVG(rating) AS rating FROM marketplace_reviews WHERE COALESCE(status, 'published') = 'published' GROUP BY product_id) rv ON rv.pid = p.product_id::text
    WHERE p.is_active = TRUE AND p.brand IS NOT NULL AND p.brand <> ''
    GROUP BY p.brand, b.slug, b.logo_url, b.cover_url, b.tagline, b.is_verified
    ORDER BY COALESCE(b.is_verified, FALSE) DESC, n DESC, p.brand
    ${limit ? 'LIMIT ' + Number(limit) : ''}`);
  return rows.map(r => ({ ...r, slug: r.slug || slugify(r.name), categories: (r.categories || []).map(normCat) }));
}
exports.listBrands = async (req, res) => {
  try { return R.ok(res, { brands: await brandRows(0) }); }
  catch (e) { console.error('[Shop] listBrands:', e.message); return R.serverError(res); }
};
exports.getBrand = async (req, res) => {
  try {
    const slug = String(req.params.slug).toLowerCase();
    const all = await brandRows(0);
    const b = all.find(x => x.slug === slug);
    if (!b) return R.notFound(res, 'Brand not found');
    const meta = await query(`SELECT description, website, country, cover_url, logo_url, tagline FROM marketplace_brands WHERE name = $1`, [b.name]);
    const stats = await query(`
      SELECT (SELECT COUNT(*)::int FROM marketplace_reviews r JOIN marketplace_products p ON p.product_id::text = r.product_id::text
                WHERE p.is_active = TRUE AND p.brand = $1 AND COALESCE(r.status, 'published') = 'published') AS reviews,
             (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM marketplace_order_items oi JOIN marketplace_products p ON p.product_id::text = oi.product_id::text
                WHERE p.is_active = TRUE AND p.brand = $1 AND COALESCE(oi.fulfil_status, 'pending') <> 'cancelled') AS sold,
             (SELECT COUNT(DISTINCT seller_id)::int FROM marketplace_products WHERE is_active = TRUE AND brand = $1) AS sellers`, [b.name]);
    const pets = await query(`SELECT DISTINCT unnest(pet_types) AS pet FROM marketplace_products WHERE is_active = TRUE AND brand = $1`, [b.name]);
    return R.ok(res, { brand: { ...b, ...(meta.rows[0] || {}), ...stats.rows[0], pets: pets.rows.map(r => r.pet) } });
  } catch (e) { console.error('[Shop] getBrand:', e.message); return R.serverError(res); }
};

// ── Compare: GET /shop/compare?ids=a,b,c,d ───────────────────────────────────
exports.compare = async (req, res) => {
  try {
    const ids = csv(req.query.ids).slice(0, 4);
    if (!ids.length) return R.ok(res, { products: [] });
    const { rows } = await query(`SELECT * FROM (${BASE_SELECT} WHERE p.is_active = TRUE AND p.product_id::text = ANY($1)) p`, [ids]);
    const extra = await query(`SELECT product_id::text AS id, specs, ingredients, variants FROM marketplace_products WHERE product_id::text = ANY($1)`, [ids]);
    const ex = {}; extra.rows.forEach(r => { ex[r.id] = r; });
    const byId = {}; rows.forEach(r => { byId[String(r.product_id)] = { ...shape(r), ...(ex[String(r.product_id)] || {}) }; delete byId[String(r.product_id)].id; });
    return R.ok(res, { products: ids.map(i => byId[i]).filter(Boolean) });
  } catch (e) { console.error('[Shop] compare:', e.message); return R.serverError(res); }
};

// ── Product Q&A ──────────────────────────────────────────────────────────────
exports.listQuestions = async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows: qs } = await query(`
      SELECT q.question_id, q.question, q.created_at, u.full_name AS user_name
      FROM marketplace_questions q LEFT JOIN users u ON u.user_id = q.user_id
      WHERE q.product_id = $1 AND q.status = 'published' ORDER BY q.created_at DESC LIMIT 50`, [id]);
    if (!qs.length) return R.ok(res, { questions: [] });
    const { rows: as } = await query(`
      SELECT a.answer_id, a.question_id, a.answer, a.is_seller, a.created_at, u.full_name AS user_name
      FROM marketplace_answers a LEFT JOIN users u ON u.user_id = a.user_id
      WHERE a.question_id = ANY($1) AND a.status = 'published' ORDER BY a.is_seller DESC, a.created_at ASC`, [qs.map(q => q.question_id)]);
    const by = {}; as.forEach(a => { (by[a.question_id] = by[a.question_id] || []).push(a); });
    return R.ok(res, { questions: qs.map(q => ({ ...q, answers: by[q.question_id] || [] })) });
  } catch (e) { console.error('[Shop] listQuestions:', e.message); return R.serverError(res); }
};
exports.askQuestion = async (req, res) => {
  try {
    const text = String(req.body.question || '').trim();
    if (text.length < 5 || text.length > 500) return R.badRequest(res, 'Question must be 5–500 characters');
    const p = await query(`SELECT seller_id, name FROM marketplace_products WHERE product_id::text = $1 AND is_active = TRUE`, [String(req.params.id)]);
    if (!p.rows.length) return R.notFound(res, 'Product not found');
    const { rows } = await query(`INSERT INTO marketplace_questions (product_id, user_id, question) VALUES ($1,$2,$3) RETURNING question_id, created_at`,
      [String(req.params.id), req.user.user_id, text]);
    if (String(p.rows[0].seller_id) !== String(req.user.user_id)) require('./experience.controller').notify(p.rows[0].seller_id, { type: 'shop_question', icon: '❓', title: 'New question on ' + p.rows[0].name, body: text.slice(0, 140), link: '50_seller_hub.html?tab=questions' });
    return R.created(res, rows[0]);
  } catch (e) { console.error('[Shop] askQuestion:', e.message); return R.serverError(res); }
};
exports.answerQuestion = async (req, res) => {
  try {
    const text = String(req.body.answer || '').trim();
    if (text.length < 2 || text.length > 1000) return R.badRequest(res, 'Answer must be 2–1000 characters');
    const { rows: q } = await query(`
      SELECT q.question_id, q.user_id AS asker, q.product_id, p.seller_id, p.name FROM marketplace_questions q
      JOIN marketplace_products p ON p.product_id::text = q.product_id
      WHERE q.question_id = $1 AND q.status = 'published'`, [Number(req.params.qid)]);
    if (!q.length) return R.notFound(res, 'Question not found');
    const isSeller = String(q[0].seller_id) === String(req.user.user_id);
    const { rows } = await query(`INSERT INTO marketplace_answers (question_id, user_id, answer, is_seller) VALUES ($1,$2,$3,$4) RETURNING answer_id, is_seller, created_at`,
      [q[0].question_id, req.user.user_id, text, isSeller]);
    if (String(q[0].asker) !== String(req.user.user_id)) require('./experience.controller').notify(q[0].asker, { type: 'shop_question', icon: '💬', title: (isSeller ? 'The seller answered' : 'New answer to') + ' your question on ' + q[0].name, body: text.slice(0, 140), link: '44_shop_product.html?id=' + encodeURIComponent(q[0].product_id) });
    return R.created(res, rows[0]);
  } catch (e) { console.error('[Shop] answerQuestion:', e.message); return R.serverError(res); }
};

// ── Recommendations ──────────────────────────────────────────────────────────
function speciesKey(s) {
  s = String(s || '').toLowerCase();
  if (/dog|puppy|canine/.test(s)) return 'dog'; if (/cat|kitten|feline/.test(s)) return 'cat';
  if (/bird|parrot|budgie|parakeet|cockatiel/.test(s)) return 'bird'; if (/fish/.test(s)) return 'fish';
  if (/rabbit|hamster|guinea|small/.test(s)) return 'small_pet'; return null;
}
// GET /shop/recommendations?recent=id1,id2  (works for guests; richer when logged in)
exports.recommendations = async (req, res) => {
  try {
    const user = optionalUser(req);
    const recent = csv(req.query.recent).slice(0, 12);
    let pets = [], petTypes = new Set(), cats = new Set(), brands = new Set(), bought = [];
    if (user) {
      const pr = await query(`SELECT p.name, p.species FROM pets p JOIN users u ON u.user_no = p.user_id WHERE u.user_id = $1 LIMIT 10`, [user.user_id])
        .catch(() => query(`SELECT name, species FROM pets WHERE user_id::text = $1 LIMIT 10`, [user.user_id]).catch(() => ({ rows: [] })));
      pets = pr.rows.map(r => ({ name: r.name, species: speciesKey(r.species) })).filter(r => r.species);
      pets.forEach(p => petTypes.add(p.species));
      const hist = await query(`
        SELECT DISTINCT p.product_id::text AS id, p.category, p.brand, p.pet_types FROM marketplace_products p
        WHERE p.product_id::text IN (
          SELECT oi.product_id::text FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id WHERE o.buyer_id = $1
          UNION SELECT product_id FROM marketplace_wishlist WHERE user_id = $1)`, [user.user_id]).catch(() => ({ rows: [] }));
      hist.rows.forEach(r => { cats.add(normCat(r.category)); if (r.brand) brands.add(r.brand); (r.pet_types || []).forEach(t => petTypes.add(t)); });
      const b = await query(`SELECT DISTINCT oi.product_id::text AS id FROM marketplace_order_items oi JOIN marketplace_orders o ON o.order_id = oi.order_id WHERE o.buyer_id = $1`, [user.user_id]).catch(() => ({ rows: [] }));
      bought = b.rows.map(r => r.id);
    }
    if (recent.length) {
      const rv = await query(`SELECT category, brand, pet_types FROM marketplace_products WHERE product_id::text = ANY($1)`, [recent]);
      rv.rows.forEach(r => { cats.add(normCat(r.category)); if (r.brand) brands.add(r.brand); (r.pet_types || []).forEach(t => petTypes.add(t)); });
    }
    const personal = petTypes.size + cats.size + brands.size > 0;
    const catList = Array.from(cats), legacy = Object.keys(CATEGORY_ALIASES).filter(k => cats.has(CATEGORY_ALIASES[k]));
    const { rows } = await query(`
      SELECT * FROM (
        SELECT b.*, (CASE WHEN b.pet_types && $1::text[] THEN 3 ELSE 0 END
                   + CASE WHEN b.category = ANY($2) THEN 2 ELSE 0 END
                   + CASE WHEN b.brand = ANY($3) THEN 2 ELSE 0 END) AS match,
                    (b.rating / 5.0 + LN(b.sold + 1) / 3.0) AS pop
        FROM (${BASE_SELECT} WHERE p.is_active = TRUE AND p.stock > 0 AND NOT (p.product_id::text = ANY($4))) b
      ) p
      ORDER BY p.match DESC, p.pop DESC, p.created_at DESC LIMIT 12`,
      [Array.from(petTypes), catList.concat(legacy), Array.from(brands), bought.concat(recent)]);
    return R.ok(res, { personal, pets: pets.map(p => p.name), pet_types: Array.from(petTypes), products: rows.map(shape) });
  } catch (e) { console.error('[Shop] recommendations:', e.message); return R.serverError(res); }
};
// GET /shop/loved — "Loved by pet parents": real ratings + real wishlist saves
exports.loved = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT * FROM (
        SELECT b.*, COALESCE(w.saves, 0)::int AS saves,
               (b.rating * LN(b.review_count + 1) + COALESCE(w.saves, 0) * 0.5) AS score
        FROM (${BASE_SELECT} WHERE p.is_active = TRUE) b
        LEFT JOIN (SELECT product_id, COUNT(*) AS saves FROM marketplace_wishlist GROUP BY product_id) w ON w.product_id = b.product_id::text
      ) p WHERE (p.review_count > 0 AND p.rating >= 4) OR p.saves >= 2
      ORDER BY p.score DESC LIMIT 12`);
    return R.ok(res, { products: rows.map(r => ({ ...shape(r), saves: r.saves })) });
  } catch (e) { console.error('[Shop] loved:', e.message); return R.serverError(res); }
};
// GET /shop/products/:id/together — co-purchased in the same real orders
exports.boughtTogether = async (req, res) => {
  try {
    const id = String(req.params.id);
    const { rows } = await query(`
      SELECT * FROM (${BASE_SELECT} WHERE p.is_active = TRUE AND p.stock > 0) p
      JOIN (SELECT b.product_id::text AS pid, COUNT(DISTINCT b.order_id)::int AS together
            FROM marketplace_order_items a JOIN marketplace_order_items b ON b.order_id = a.order_id
            WHERE a.product_id::text = $1 AND b.product_id IS NOT NULL AND b.product_id::text <> $1
            GROUP BY b.product_id) t ON t.pid = p.product_id::text
      ORDER BY t.together DESC, p.rating DESC LIMIT 6`, [id]);
    return R.ok(res, { products: rows.map(r => ({ ...shape(r), together: r.together })) });
  } catch (e) { console.error('[Shop] boughtTogether:', e.message); return R.serverError(res); }
};

// ── Wishlist (auth) ──────────────────────────────────────────────────────────
exports.getWishlist = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM (${BASE_SELECT} WHERE p.product_id::text IN
         (SELECT product_id FROM marketplace_wishlist WHERE user_id = $1)) p ORDER BY p.created_at DESC`, [req.user.user_id]);
    return R.ok(res, { products: rows.map(shape), ids: rows.map(r => String(r.product_id)) });
  } catch (e) { console.error('[Shop] getWishlist:', e.message); return R.serverError(res); }
};
exports.addWishlist = async (req, res) => {
  try {
    await query(`INSERT INTO marketplace_wishlist (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user.user_id, String(req.params.id)]);
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
    await query(`INSERT INTO marketplace_newsletter (email, pet_types) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET pet_types = EXCLUDED.pet_types`, [email, pets]);
    return R.ok(res, { subscribed: true });
  } catch (e) { console.error('[Shop] newsletter:', e.message); return R.serverError(res); }
};

/* ============================================================================
   ADMIN (requireRole('admin') in routes)
   ========================================================================== */
const ICON_RE = /^ti-[a-z0-9-]{1,50}$/;
exports.adminCategories = async (req, res) => {
  try {
    const all = await categories(true);
    const { rows } = await query(`SELECT category, COUNT(*)::int AS n FROM marketplace_products GROUP BY category`);
    const counts = {}; rows.forEach(r => { const c = normCat(r.category); counts[c] = (counts[c] || 0) + r.n; });
    return R.ok(res, { categories: all.map(c => ({ ...c, n: counts[c.slug] || 0 })) });
  } catch (e) { console.error('[Shop] adminCategories:', e.message); return R.serverError(res); }
};
exports.adminSaveCategory = async (req, res) => {
  try {
    const b = req.body || {};
    const slug = slugify(req.params.slug || b.slug || b.name).slice(0, 40);
    if (!slug) return R.badRequest(res, 'slug required');
    const name = String(b.name || '').trim().slice(0, 80);
    if (!req.params.slug && !name) return R.badRequest(res, 'name required');
    if (b.icon && !ICON_RE.test(b.icon)) return R.badRequest(res, 'icon must be a Tabler class like ti-bone');
    const i18n = b.name_i18n && typeof b.name_i18n === 'object' ? b.name_i18n : null;
    const img = b.image_url ? String(b.image_url).slice(0, 1000) : null;
    if (img && !/^https:\/\//.test(img)) return R.badRequest(res, 'image_url must be https');
    if (req.params.slug) {
      const { rowCount } = await query(`
        UPDATE marketplace_categories SET
          name = COALESCE(NULLIF($2,''), name), name_i18n = COALESCE($3, name_i18n), icon = COALESCE($4, icon),
          image_url = CASE WHEN $5::boolean THEN $6 ELSE image_url END,
          sort_order = COALESCE($7, sort_order), show_on_home = COALESCE($8, show_on_home), is_active = COALESCE($9, is_active), updated_at = NOW()
        WHERE slug = $1`,
        [slug, name, i18n, b.icon || null, 'image_url' in b, img,
         b.sort_order != null ? Number(b.sort_order) : null, typeof b.show_on_home === 'boolean' ? b.show_on_home : null,
         typeof b.is_active === 'boolean' ? b.is_active : null]);
      if (!rowCount) return R.notFound(res, 'Category not found');
    } else {
      await query(`INSERT INTO marketplace_categories (slug, name, name_i18n, icon, image_url, sort_order, show_on_home)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [slug, name, i18n || {}, b.icon || 'ti-tag', img, Number(b.sort_order) || 100, !!b.show_on_home]);
    }
    await categories(true);
    return R.ok(res, { slug });
  } catch (e) {
    if (e.code === '23505') return R.badRequest(res, 'A category with this slug already exists');
    console.error('[Shop] adminSaveCategory:', e.message); return R.serverError(res);
  }
};
exports.adminSaveBrand = async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 120);
    if (!name) return R.badRequest(res, 'name required');
    for (const k of ['logo_url', 'cover_url', 'website']) if (b[k] && !/^https:\/\//.test(String(b[k]))) return R.badRequest(res, k + ' must start with https://');
    const slug = slugify(b.slug || name);
    await query(`
      INSERT INTO marketplace_brands (name, slug, logo_url, cover_url, description, tagline, website, country, is_verified, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,FALSE),COALESCE($10,TRUE),NOW())
      ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug, logo_url = EXCLUDED.logo_url, cover_url = EXCLUDED.cover_url,
        description = EXCLUDED.description, tagline = EXCLUDED.tagline, website = EXCLUDED.website, country = EXCLUDED.country,
        is_verified = EXCLUDED.is_verified, is_active = EXCLUDED.is_active, updated_at = NOW()`,
      [name, slug, b.logo_url || null, b.cover_url || null, b.description ? String(b.description).slice(0, 4000) : null,
       b.tagline ? String(b.tagline).slice(0, 160) : null, b.website || null, b.country ? String(b.country).slice(0, 80) : null,
       typeof b.is_verified === 'boolean' ? b.is_verified : null, typeof b.is_active === 'boolean' ? b.is_active : null]);
    return R.ok(res, { name, slug });
  } catch (e) {
    if (e.code === '23505') return R.badRequest(res, 'Another brand already uses this slug');
    console.error('[Shop] adminSaveBrand:', e.message); return R.serverError(res);
  }
};
exports.adminBrands = async (req, res) => {
  try {
    const live = await brandRows(0);
    const meta = await query(`SELECT name, slug, logo_url, cover_url, description, tagline, website, country, is_verified, is_active FROM marketplace_brands`);
    const byName = {}; meta.rows.forEach(m => { byName[m.name] = m; });
    const names = new Set(live.map(b => b.name).concat(meta.rows.map(m => m.name)));
    return R.ok(res, { brands: Array.from(names).sort().map(n => ({ name: n, n: (live.find(b => b.name === n) || {}).n || 0, ...(byName[n] || { slug: slugify(n), is_verified: false, is_active: true }) })) });
  } catch (e) { console.error('[Shop] adminBrands:', e.message); return R.serverError(res); }
};
exports.adminQuestions = async (req, res) => {
  try {
    const status = ['published', 'hidden'].includes(req.query.status) ? req.query.status : null;
    const { rows } = await query(`
      SELECT q.question_id, q.product_id, q.question, q.status, q.created_at, u.full_name AS user_name, p.name AS product_name,
             COALESCE(json_agg(json_build_object('answer_id', a.answer_id, 'answer', a.answer, 'status', a.status, 'is_seller', a.is_seller)
                      ORDER BY a.created_at) FILTER (WHERE a.answer_id IS NOT NULL), '[]') AS answers
      FROM marketplace_questions q
      LEFT JOIN users u ON u.user_id = q.user_id
      LEFT JOIN marketplace_products p ON p.product_id::text = q.product_id
      LEFT JOIN marketplace_answers a ON a.question_id = q.question_id
      ${status ? 'WHERE q.status = $1' : ''}
      GROUP BY q.question_id, u.full_name, p.name ORDER BY q.created_at DESC LIMIT 200`, status ? [status] : []);
    return R.ok(res, { questions: rows });
  } catch (e) { console.error('[Shop] adminQuestions:', e.message); return R.serverError(res); }
};
exports.adminModerate = async (req, res) => {
  try {
    const status = req.body.status;
    if (!['published', 'hidden'].includes(status)) return R.badRequest(res, 'status must be published or hidden');
    const isAnswer = /\/admin\/answers\//.test(req.originalUrl || req.url || '');
    const table = isAnswer ? 'marketplace_answers' : 'marketplace_questions';
    const col = isAnswer ? 'answer_id' : 'question_id';
    const { rowCount } = await query(`UPDATE ${table} SET status = $1 WHERE ${col} = $2`, [status, Number(req.params.id)]);
    if (!rowCount) return R.notFound(res, 'Not found');
    return R.ok(res, { status });
  } catch (e) { console.error('[Shop] adminModerate:', e.message); return R.serverError(res); }
};
exports.adminSynonyms = async (req, res) => {
  try {
    const { rows } = await query(`SELECT term, expands FROM marketplace_search_synonyms ORDER BY term`);
    const pop = await query(`SELECT q, COUNT(*)::int AS n, ROUND(AVG(results))::int AS avg_results FROM marketplace_search_log
                             WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY q ORDER BY n DESC LIMIT 30`).catch(() => ({ rows: [] }));
    return R.ok(res, { synonyms: rows, searches: pop.rows });
  } catch (e) { console.error('[Shop] adminSynonyms:', e.message); return R.serverError(res); }
};
exports.adminSaveSynonym = async (req, res) => {
  try {
    const term = String(req.body.term || '').trim().toLowerCase().slice(0, 60);
    const expands = (Array.isArray(req.body.expands) ? req.body.expands : csv(req.body.expands)).map(s => String(s).trim().toLowerCase().slice(0, 60)).filter(Boolean).slice(0, 10);
    if (!term) return R.badRequest(res, 'term required');
    if (!expands.length) { await query(`DELETE FROM marketplace_search_synonyms WHERE term = $1`, [term]); return R.ok(res, { deleted: term }); }
    await query(`INSERT INTO marketplace_search_synonyms (term, expands) VALUES ($1,$2) ON CONFLICT (term) DO UPDATE SET expands = EXCLUDED.expands`, [term, expands]);
    return R.ok(res, { term, expands });
  } catch (e) { console.error('[Shop] adminSaveSynonym:', e.message); return R.serverError(res); }
};
