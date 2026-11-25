'use strict';
/* ============================================================================
   PawBook Search (page 15) — one search across real PawBook data.
   Mounted under /api/v1/pbsearch (see add_shop_routes.js). No migration: it only READS existing tables.
   Sources (each only shows what is already public on its own page):
     pets (name / breed / species)          people (name / username — never email or phone)
     communities ("Group", visible)         vets (status = 'active')
     shelters & welfare orgs (verified)     products (is_active)
     events (approved, upcoming)            adoption (approved, available/reserved)
     lost & found (visible, open cases; area and city only — never exact location)
   Matching is word by word, ignores case, knows a few pet synonyms and allows small spelling mistakes
   (pg_trgm word_similarity, installed by migration 004). Column names are looked up so missing ones are skipped.
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const fail = (res, where, e) => { console.error('[Search] ' + where + ':', e.message); return R.serverError(res); };
const httpsUrl = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 600;
const iso = t => { if (!t) return null; const d = t instanceof Date ? t : new Date(t); return isNaN(d) ? null : d.toISOString(); };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const first = n => (n ? String(n).trim().split(/\s+/)[0] : null);
const qi = n => '"' + String(n).replace(/"/g, '') + '"';
function img(v) {   // first https image from a text / text[] / jsonb value
  if (!v) return null;
  if (typeof v === 'string') { const t = v.trim();
    if (t.startsWith('[')) { try { return img(JSON.parse(t)); } catch (e) { return null; } }
    if (t.startsWith('{')) return img(t.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')));
    return httpsUrl(t) ? t : null; }
  if (Array.isArray(v)) { for (const x of v) { const u = typeof x === 'string' ? x : x && (x.url || x.secure_url); if (httpsUrl(u)) return u; } return null; }
  if (typeof v === 'object') return httpsUrl(v.url) ? v.url : null;
  return null;
}

// ── schema lookup (cached) ───────────────────────────────────────────────────
const SCHEMA = {};
async function cols(table) {
  if (SCHEMA[table]) return SCHEMA[table];
  const { rows } = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [table]);
  const m = {}; rows.forEach(r => { m[r.column_name] = true; });
  if (rows.length) SCHEMA[table] = m; return m;
}
const has = (c, n) => !!c[n];
const pick = (c, names) => names.find(n => c[n]) || null;
let TRGM = null;
async function trgm() { if (TRGM === null) { try { const { rows } = await query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`); TRGM = rows.length > 0; } catch (e) { TRGM = false; } } return TRGM; }

// ── words, synonyms and the match expression ────────────────────────────────
const SYN = { puppy: ['dog', 'puppy', 'pup'], puppies: ['dog', 'puppy'], pup: ['dog', 'puppy', 'pup'], doggo: ['dog'], dogs: ['dog'], kitten: ['cat', 'kitten'], kittens: ['cat', 'kitten'], kitty: ['cat', 'kitten'], cats: ['cat'],
  vet: ['vet', 'veterinar', 'clinic', 'doctor'], vets: ['vet', 'veterinar', 'clinic'], doctor: ['vet', 'doctor', 'veterinar'], lab: ['lab', 'labrador'], gsd: ['german shepherd', 'gsd'], alsatian: ['german shepherd', 'alsatian'],
  indie: ['indie', 'indian', 'desi', 'street'], desi: ['indie', 'indian', 'desi'], shihtzu: ['shih tzu', 'shihtzu'], pom: ['pomeranian', 'pom'], lost: ['lost', 'missing'], missing: ['missing', 'lost'],
  adopt: ['adopt', 'adoption'], adoption: ['adopt', 'adoption'], food: ['food', 'treat', 'kibble'], toy: ['toy', 'toys'], toys: ['toy'], bird: ['bird', 'parrot', 'budgie'], birds: ['bird', 'parrot'] };
const STOP = new Set(['the', 'and', 'for', 'of', 'in', 'a', 'an', 'to', 'with', 'near', 'me', 'my', 'best', 'good', 'find', 'show']);
function wordsOf(q) {
  const all = str(q, 100).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim().split(' ').filter(w => w.length >= 2);
  const k = all.filter(w => !STOP.has(w)); return [...new Set(k.length ? k : all)].slice(0, 6);
}
// returns { where, score } SQL for a lowered document expression; params are pushed to args
function matcher(doc, words, args, any, fuzzy) {
  const conds = [], scores = [];
  for (const w of words) {
    const alts = SYN[w] || [w], parts = [];
    for (const a of alts) { args.push('%' + a + '%'); parts.push(`${doc} LIKE $${args.length}`); }
    let cond = '(' + parts.join(' OR ') + ')', sc = `(CASE WHEN ${cond} THEN 1 ELSE 0 END)`;
    if (fuzzy && w.length >= 4) { args.push(w); const ws = `word_similarity($${args.length}, ${doc})`; cond = `(${cond} OR ${ws} >= 0.3)`; sc = `GREATEST(${sc}, ${ws})`; }
    conds.push(cond); scores.push(sc);
  }
  return { where: '(' + conds.join(any ? ' OR ' : ' AND ') + ')', score: scores.join(' + ') || '0', doc };
}
// spelling check used in the typo pass: trigram finds candidates, this keeps only real near-misses
function dist(a, b, max) {   // Damerau-Levenshtein with an early exit
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let p2 = null, p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { let v = Math.min(p[j] + 1, cur[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur.push(v); if (v < best) best = v; }
    if (best > max) return max + 1; p2 = p; p = cur; }
  return p[b.length];
}
function wordHits(w, doc, toks) {
  if ((SYN[w] || [w]).some(a => doc.includes(a))) return true;
  if (w.length < 4) return false;
  const max = w.length >= 8 ? 2 : 1;
  return toks.some(k => dist(w, k, max) <= max || (k.length > w.length + 1 && w.length >= 5 && dist(w, k.slice(0, w.length), max) <= max));
}
async function qx(ctx, sql, args) {
  const r = await query(sql, args); if (!ctx.fuzzy) return r;
  const rows = r.rows.filter(row => { const d = String(row._doc || ''), toks = [...new Set(d.split(/[^a-z0-9\u0900-\u097f]+/))].filter(Boolean); const hits = ctx.words.filter(w => wordHits(w, d, toks)).length; return ctx.any ? hits > 0 : hits === ctx.words.length; });
  rows.forEach(x => { x.total = rows.length; }); return { rows };
}
const docOf = (alias, fields) => `lower(concat_ws(' ', ${fields.map(f => alias + '.' + qi(f) + (f === 'pet_types' || f === 'tags' || f === 'specialties' || f === 'animals_treated' ? '::text' : '')).join(', ')}))`;

// ── who am I ─────────────────────────────────────────────────────────────────
async function me(req) {
  const id = String(req.user.user_id), u = await cols('users');
  const { rows } = await query(`SELECT user_id::text AS id${has(u, 'user_no') ? ', user_no::text AS no' : ''} FROM users WHERE user_id::text = $1`, [id]);
  const r = rows[0] || { id }; return { id, ids: [id].concat(r.no ? [r.no] : []) };
}

// ── sources ──────────────────────────────────────────────────────────────────
// each returns { rows: [items], total }
const SOURCES = {
  async pets(ctx) {
    const c = await cols('pets'); if (!has(c, 'name')) return null;
    const id = pick(c, ['id', 'pet_id']), owner = pick(c, ['user_id', 'owner_id']), photo = pick(c, ['avatar', 'avatar_url', 'photo_url', 'image_url', 'photo']);
    const u = await cols('users'), hasNo = has(u, 'user_no');
    const fields = ['name', 'breed', 'species', 'color'].filter(f => has(c, f));
    const args = [], m = matcher(docOf('p', fields), ctx.words, args, ctx.any, ctx.fuzzy);
    const join = owner ? `LEFT JOIN users u ON ${hasNo ? `(u.user_no::text = p.${qi(owner)}::text OR u.user_id::text = p.${qi(owner)}::text)` : `u.user_id::text = p.${qi(owner)}::text`}` : '';
    const mineP = owner ? '$' + args.push(ctx.M.ids) : null, nameP = '$' + args.push(ctx.raw);
    const { rows } = await qx(ctx, `SELECT p.${qi(id)}::text AS id, p.name, ${has(c, 'breed') ? 'p.breed' : 'NULL'} AS breed, ${has(c, 'species') ? 'p.species' : 'NULL'} AS species, ${has(c, 'age') ? 'p.age::text' : 'NULL'} AS age,
        ${photo ? 'p.' + qi(photo) : 'NULL'} AS photo, ${has(c, 'photos') ? 'p.photos' : 'NULL'} AS photos, ${owner ? `(p.${qi(owner)}::text = ANY(${mineP}::text[]))` : 'FALSE'} AS mine,
        ${owner ? 'u.user_id::text' : 'NULL'} AS owner_id, ${owner ? 'u.full_name' : 'NULL'} AS owner_name, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total
      FROM pets p ${join} WHERE ${m.where} ORDER BY sc DESC, (lower(p.name) = ${nameP}::text) DESC, p.name LIMIT ${ctx.lim}`, args);
    return rows.map(r => ({ id: r.id, title: r.name, sub: [r.breed, r.species].filter(Boolean).join(' · ') || 'Pet', meta: [r.age ? r.age : null, r.mine ? 'Your pet' : (r.owner_name ? first(r.owner_name) + '\'s pet' : null)].filter(Boolean).join(' · '),
      img: img(r.photo) || img(r.photos), badge: r.mine ? 'Yours' : null, url: r.mine ? '36_pet_life_record.html?pet=' + encodeURIComponent(r.id) : (r.owner_id ? '29_user_profile.html?user=' + encodeURIComponent(r.owner_id) : null), action: r.mine ? 'Open health record' : 'View owner', total: Number(r.total) }));
  },
  async people(ctx) {
    const u = await cols('users'); if (!has(u, 'full_name')) return null;
    const fields = ['full_name', 'username'].filter(f => has(u, f)), args = [], m = matcher(docOf('u', fields), ctx.words, args, ctx.any, ctx.fuzzy);
    const w = [m.where, `u.full_name IS NOT NULL`, `u.full_name <> ''`]; args.push(ctx.M.id); w.push(`u.user_id::text <> $${args.length}`);
    if (has(u, 'is_active')) w.push(`u.is_active IS DISTINCT FROM FALSE`); if (has(u, 'is_banned')) w.push(`u.is_banned IS NOT TRUE`); if (has(u, 'deleted_at')) w.push(`u.deleted_at IS NULL`); if (has(u, 'status')) w.push(`COALESCE(u.status, 'active') NOT IN ('banned', 'deleted', 'suspended')`);
    const city = pick(u, ['city', 'location']);
    const { rows } = await qx(ctx, `SELECT u.user_id::text AS id, u.full_name, ${has(u, 'username') ? 'u.username' : 'NULL'} AS username, ${has(u, 'avatar_url') ? 'u.avatar_url' : 'NULL'} AS avatar, ${city ? 'u.' + qi(city) + '::text' : 'NULL'} AS city,
        ${has(u, 'bio') ? 'u.bio' : 'NULL'} AS bio, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total FROM users u WHERE ${w.join(' AND ')} ORDER BY sc DESC, u.full_name LIMIT ${ctx.lim}`, args);
    return rows.map(r => ({ id: r.id, title: r.full_name, sub: [r.username ? '@' + r.username : null, r.city].filter(Boolean).join(' · ') || 'PawBook member', meta: r.bio ? clip(r.bio, 90) : null,
      img: img(r.avatar), url: '29_user_profile.html?user=' + encodeURIComponent(r.id), action: 'View profile', total: Number(r.total) }));
  },
  async communities(ctx) {
    const c = await cols('Group'); if (!has(c, 'group_id')) return null;
    const fields = ['name', 'description', 'category', 'city', 'area', 'state'].filter(f => has(c, f)), args = [], m = matcher(docOf('g', fields), ctx.words, args, ctx.any, ctx.fuzzy);
    const w = [m.where, 'g.is_active']; if (has(c, 'moderation')) w.push(`g.moderation = 'visible'`);
    const near = ctx.city && has(c, 'city') ? `(lower(COALESCE(g.city, '')) = ANY($${args.push(ctx.cityAlts)}))` : 'FALSE';
    const { rows } = await qx(ctx, `SELECT g.group_id::text AS id, g.name, g.description, g.cover_url, g.category, g.group_type, ${has(c, 'city') ? 'g.city' : 'NULL'} AS city, ${has(c, 'area') ? 'g.area' : 'NULL'} AS area, ${has(c, 'is_verified') ? 'g.is_verified' : 'FALSE'} AS verified,
        (SELECT COUNT(*)::int FROM "GroupMember" m WHERE m.group_id = g.group_id) AS members, ${near} AS near, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total
      FROM "Group" g WHERE ${w.join(' AND ')} ORDER BY near DESC, sc DESC, members DESC LIMIT ${ctx.lim}`, args);
    return rows.map(r => ({ id: r.id, title: r.name, sub: (r.members || 0) + ' member' + (r.members === 1 ? '' : 's') + (r.group_type === 'private' ? ' · Private' : ' · Public'), meta: [r.area, r.city].filter(Boolean).join(', ') || null,
      text: clip(r.description, 110), img: img(r.cover_url), cat: r.category, verified: !!r.verified, near: !!r.near, url: '03_groups.html?c=' + r.id, action: 'Open community', total: Number(r.total) }));
  },
  async vets(ctx) {
    const c = await cols('vets'); if (!has(c, 'vet_id')) return null;
    const fields = ['first_name', 'last_name', 'clinic_name', 'city', 'primary_specialty', 'specialties', 'animals_treated', 'clinic_address'].filter(f => has(c, f)), args = [], m = matcher(docOf('v', fields), ctx.words, args, ctx.any, ctx.fuzzy);
    const w = [m.where]; if (has(c, 'status')) w.push(`v.status = 'active'`);
    const near = ctx.city && has(c, 'city') ? `(lower(COALESCE(v.city, '')) = ANY($${args.push(ctx.cityAlts)}))` : 'FALSE';
    const { rows } = await qx(ctx, `SELECT v.vet_id::text AS id, v.first_name, v.last_name, ${has(c, 'clinic_name') ? 'v.clinic_name' : 'NULL'} AS clinic, ${has(c, 'city') ? 'v.city' : 'NULL'} AS city, ${has(c, 'primary_specialty') ? 'v.primary_specialty' : 'NULL'} AS spec,
        ${has(c, 'experience_years') ? 'v.experience_years' : 'NULL'} AS exp, ${has(c, 'rating') ? 'v.rating' : 'NULL'} AS rating, ${has(c, 'review_count') ? 'v.review_count' : 'NULL'} AS reviews, ${has(c, 'consultation_fee') ? 'v.consultation_fee' : 'NULL'} AS fee,
        ${has(c, 'avatar_url') ? 'v.avatar_url' : 'NULL'} AS avatar, ${near} AS near, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total FROM vets v WHERE ${w.join(' AND ')} ORDER BY near DESC, sc DESC, ${has(c, 'rating') ? 'v.rating DESC NULLS LAST,' : ''} v.first_name LIMIT ${ctx.lim}`, args);
    return rows.map(r => { const nm = ('Dr. ' + [r.first_name, r.last_name].filter(Boolean).join(' ')).trim(), rv = Number(r.reviews || 0);
      return { id: r.id, title: nm, sub: [r.clinic, r.spec].filter(Boolean).join(' · ') || 'Veterinarian', meta: [r.city, r.exp ? r.exp + ' yrs experience' : null, rv > 0 && r.rating ? '★ ' + Number(r.rating).toFixed(1) + ' (' + rv + ')' : null, r.fee ? '₹' + Math.round(Number(r.fee)) + ' consult' : null].filter(Boolean).join(' · '),
        img: img(r.avatar), near: !!r.near, verified: true, url: '11_vet_booking.html?q=' + encodeURIComponent([r.first_name, r.last_name].filter(Boolean).join(' ')), action: 'Book a visit', total: Number(r.total) }; });
  },
  async shelters(ctx) {
    const out = []; let total = 0;
    const s = await cols('shelters');
    if (has(s, 'shelter_id')) {
      const fields = ['name', 'city', 'state', 'org_type', 'about', 'animals_accepted'].filter(f => has(s, f)), args = [], m = matcher(docOf('s', fields), ctx.words, args, ctx.any, ctx.fuzzy);
      const near = ctx.city && has(s, 'city') ? `(lower(COALESCE(s.city, '')) = ANY($${args.push(ctx.cityAlts)}))` : 'FALSE';
      const phone = pick(s, ['contact_phone', 'phone']);
      const { rows } = await qx(ctx, `SELECT s.shelter_id::text AS id, s.name, ${has(s, 'city') ? 's.city' : 'NULL'} AS city, ${has(s, 'state') ? 's.state' : 'NULL'} AS state, ${has(s, 'org_type') ? 's.org_type' : 'NULL'} AS kind, ${phone ? 's.' + qi(phone) : 'NULL'} AS phone,
          ${has(s, 'photo_url') ? 's.photo_url' : 'NULL'} AS photo, ${has(s, 'animals_accepted') ? 's.animals_accepted::text' : 'NULL'} AS animals, ${near} AS near, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total
        FROM shelters s WHERE ${m.where} AND ${has(s, 'is_verified') ? 's.is_verified = TRUE' : 'FALSE'} ORDER BY near DESC, sc DESC, s.name LIMIT ${ctx.lim}`, args);
      rows.forEach(r => { total = Number(r.total); out.push({ id: 's' + r.id, title: r.name, sub: [r.kind ? r.kind.replace(/_/g, ' ') : 'Shelter', r.city, r.state].filter(Boolean).join(' · '), meta: r.animals ? 'Takes in: ' + String(r.animals).replace(/[{}"]/g, '').replace(/,/g, ', ') : null,
        img: img(r.photo), phone: r.phone || null, near: !!r.near, verified: true, url: '39_adoption_matching.html', action: 'Pets for adoption' }); });
    }
    const wo = await cols('welfare_organizations');
    if (has(wo, 'org_id') && out.length < ctx.lim) {
      const fields = ['name', 'city', 'state', 'org_type', 'coverage_area'].filter(f => has(wo, f)), args = [], m = matcher(docOf('o', fields), ctx.words, args, ctx.any, ctx.fuzzy);
      const near = ctx.city && has(wo, 'city') ? `(lower(COALESCE(o.city, '')) = ANY($${args.push(ctx.cityAlts)}))` : 'FALSE';
      const { rows } = await qx(ctx, `SELECT o.org_id::text AS id, o.name, o.city, ${has(wo, 'state') ? 'o.state' : 'NULL'} AS state, o.org_type AS kind, o.phone, ${near} AS near, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total
        FROM welfare_organizations o WHERE ${m.where} AND o.is_verified = TRUE AND o.is_active IS DISTINCT FROM FALSE ORDER BY near DESC, sc DESC, o.name LIMIT ${ctx.lim - out.length}`, args);
      rows.forEach(r => { out.push({ id: 'w' + r.id, title: r.name, sub: [r.kind ? r.kind.replace(/_/g, ' ') : 'Animal welfare', r.city, r.state].filter(Boolean).join(' · '), meta: 'Animal welfare organisation', img: null, phone: r.phone || null, near: !!r.near, verified: true,
        url: '37_pet_ai_health_agent.html?tab=nearby', action: 'Nearby help' }); });
      if (rows.length) total += Number(rows[0].total);
    }
    out.forEach(x => { x.total = Math.max(total, out.length); });
    return out;
  },
  async products(ctx) {
    const c = await cols('marketplace_products'); if (!has(c, 'product_id')) return null;
    const fields = ['name', 'brand', 'category', 'subcategory', 'tags', 'pet_types'].filter(f => has(c, f)), args = [], m = matcher(docOf('p', fields), ctx.words, args, ctx.any, ctx.fuzzy);
    const w = [m.where, 'p.is_active = TRUE']; if (has(c, 'archived')) w.push('p.archived IS NOT TRUE'); if (has(c, 'store_paused')) w.push('p.store_paused IS NOT TRUE');
    const { rows } = await qx(ctx, `SELECT p.product_id::text AS id, p.name, ${has(c, 'brand') ? 'p.brand' : 'NULL'} AS brand, p.category, p.price, ${has(c, 'compare_price') ? 'p.compare_price' : 'NULL'} AS mrp, p.images, ${has(c, 'stock') ? 'p.stock' : 'NULL'} AS stock,
        (SELECT ROUND(AVG(r.rating)::numeric, 1) FROM marketplace_reviews r WHERE r.product_id = p.product_id AND COALESCE(r.status, 'published') = 'published') AS rating,
        (SELECT COUNT(*)::int FROM marketplace_reviews r WHERE r.product_id = p.product_id AND COALESCE(r.status, 'published') = 'published') AS reviews, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total
      FROM marketplace_products p WHERE ${w.join(' AND ')} ORDER BY sc DESC, ${has(c, 'is_featured') ? 'p.is_featured DESC,' : ''} p.created_at DESC LIMIT ${ctx.lim}`, args);
    return rows.map(r => ({ id: r.id, title: r.name, sub: [r.brand, r.category ? String(r.category).replace(/[-_]/g, ' ') : null].filter(Boolean).join(' · '), price: r.price != null ? Number(r.price) : null, mrp: r.mrp != null && Number(r.mrp) > Number(r.price) ? Number(r.mrp) : null,
      meta: [r.reviews > 0 ? '★ ' + r.rating + ' (' + r.reviews + ')' : null, r.stock === 0 ? 'Out of stock' : null].filter(Boolean).join(' · ') || null, img: img(r.images), url: '44_shop_product.html?id=' + encodeURIComponent(r.id), action: 'View product', total: Number(r.total) }));
  },
  async events(ctx) {
    const d = await cols('pet_event_details'); if (!has(d, 'event_id')) return null;
    const args = [], m = matcher(`lower(concat_ws(' ', e.title, e.description, e.location, d.category, d.subtype, d.city, d.venue, d.species::text))`, ctx.words, args, ctx.any, ctx.fuzzy);
    const near = ctx.city ? `(lower(COALESCE(d.city, '')) = ANY($${args.push(ctx.cityAlts)}))` : 'FALSE';
    const { rows } = await qx(ctx, `SELECT e.event_id::text AS id, e.title, e.event_date, e.cover_image, d.photos, d.city, d.venue, d.is_online, d.category, d.fee_amount, ${near} AS near, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total
      FROM events e JOIN pet_event_details d ON d.event_id = e.event_id
      WHERE ${m.where} AND d.moderation = 'approved' AND e.status IS DISTINCT FROM 'cancelled' AND e.status IS DISTINCT FROM 'deleted' AND COALESCE(d.ends_at, e.event_date) >= NOW() - INTERVAL '6 hours'
      ORDER BY near DESC, sc DESC, e.event_date LIMIT ${ctx.lim}`, args);
    return rows.map(r => ({ id: r.id, title: r.title, sub: r.is_online ? 'Online event' : [r.venue, r.city].filter(Boolean).join(', '), at: iso(r.event_date), meta: Number(r.fee_amount) > 0 ? '₹' + Math.round(Number(r.fee_amount)) : 'Free',
      img: img(r.cover_image) || img(r.photos), cat: r.category, near: !!r.near, url: '30_events.html?event=' + encodeURIComponent(r.id), action: 'See event', total: Number(r.total) }));
  },
  async adoption(ctx) {
    const c = await cols('adoptable_pets'); if (!has(c, 'id')) return null;
    const fields = ['name', 'species', 'breed', 'location_city', 'location_state', 'temperament', 'description'].filter(f => has(c, f)), args = [], m = matcher(docOf('a', fields), ctx.words, args, ctx.any, ctx.fuzzy);
    const w = [m.where, `a.status IN ('available','reserved')`]; if (has(c, 'moderation')) w.push(`a.moderation = 'approved'`);
    const near = ctx.city ? `(lower(COALESCE(a.location_city, '')) = ANY($${args.push(ctx.cityAlts)}))` : 'FALSE';
    const { rows } = await qx(ctx, `SELECT a.id::text AS id, a.name, a.species, a.breed, a.age, ${has(c, 'gender') ? 'a.gender' : 'NULL'} AS gender, a.location_city AS city, a.photo_url, ${has(c, 'photos') ? 'a.photos' : 'NULL'} AS photos, a.status,
        ${has(c, 'urgency') ? 'a.urgency' : 'NULL'} AS urgency, ${near} AS near, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total FROM adoptable_pets a WHERE ${w.join(' AND ')} ORDER BY near DESC, sc DESC, a.created_at DESC LIMIT ${ctx.lim}`, args);
    return rows.map(r => ({ id: r.id, title: r.name, sub: [r.breed || r.species, r.age, r.gender && !/^unknown$/i.test(r.gender) ? r.gender : null].filter(Boolean).join(' · '), meta: [r.city, r.status === 'reserved' ? 'Reserved' : null].filter(Boolean).join(' · ') || null,
      img: img(r.photo_url) || img(r.photos), badge: r.urgency === 'urgent' || r.urgency === 'high' ? 'Urgent' : null, near: !!r.near, url: '39_adoption_matching.html?pet=' + encodeURIComponent(r.id), action: 'Meet ' + (r.name || 'this pet'), total: Number(r.total) }));
  },
  async lost(ctx) {
    const out = []; let total = 0;
    const l = await cols('lost_pet_reports');
    if (has(l, 'case_status')) {
      const args = [], m = matcher(docOf('r', ['pet_name', 'species', 'breed', 'color', 'area', 'city'].filter(f => has(l, f))), ctx.words, args, ctx.any, ctx.fuzzy);
      const near = ctx.city ? `(lower(COALESCE(r.city, '')) = ANY($${args.push(ctx.cityAlts)}))` : 'FALSE';
      const { rows } = await qx(ctx, `SELECT r.id::text AS id, r.pet_name, r.species, r.breed, r.area, r.city, r.photos, r.case_status, r.created_at, ${near} AS near, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total
        FROM lost_pet_reports r WHERE ${m.where} AND r.moderation = 'visible' AND r.case_status IN ('active','sighted','identified') ORDER BY near DESC, sc DESC, r.created_at DESC LIMIT ${ctx.lim}`, args);
      rows.forEach(r => { total = Number(r.total); out.push({ id: 'lost-' + r.id, title: 'Missing: ' + (r.pet_name || r.species || 'pet'), sub: [r.breed || r.species, [r.area, r.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '), at: iso(r.created_at),
        img: img(r.photos), badge: 'Missing', near: !!r.near, url: '38_lost_pet_network.html?case=lost-' + r.id, action: 'I saw this pet' }); });
    }
    const f = await cols('found_pet_reports');
    if (has(f, 'case_status') && out.length < ctx.lim) {
      const args = [], m = matcher(docOf('r', ['species', 'breed_guess', 'color', 'area', 'city', 'description'].filter(x => has(f, x))), ctx.words, args, ctx.any, ctx.fuzzy);
      const near = ctx.city ? `(lower(COALESCE(r.city, '')) = ANY($${args.push(ctx.cityAlts)}))` : 'FALSE';
      const { rows } = await qx(ctx, `SELECT r.id::text AS id, r.species, r.breed_guess, r.area, r.city, r.photos, r.created_at, ${near} AS near, (${m.score}) AS sc, ${m.doc} AS _doc, COUNT(*) OVER() AS total
        FROM found_pet_reports r WHERE ${m.where} AND r.moderation = 'visible' AND r.case_status IN ('found','sheltered','owner_identified') ORDER BY near DESC, sc DESC, r.created_at DESC LIMIT ${ctx.lim - out.length}`, args);
      rows.forEach(r => { out.push({ id: 'found-' + r.id, title: 'Found: ' + (r.breed_guess || r.species || 'pet'), sub: [r.species, [r.area, r.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '), at: iso(r.created_at),
        img: img(r.photos), badge: 'Found', near: !!r.near, url: '38_lost_pet_network.html?case=found-' + r.id, action: 'Is this your pet?' }); });
      if (rows.length) total += Number(rows[0].total);
    }
    out.forEach(x => { x.total = Math.max(total, out.length); });
    return out;
  }
};
const TYPES = Object.keys(SOURCES);
const CITY_ALIASES = { 'new delhi': ['new delhi', 'delhi'], delhi: ['delhi', 'new delhi'], bangalore: ['bangalore', 'bengaluru'], bengaluru: ['bengaluru', 'bangalore'], gurgaon: ['gurgaon', 'gurugram'], gurugram: ['gurugram', 'gurgaon'], mumbai: ['mumbai', 'bombay'], kolkata: ['kolkata', 'calcutta'], chennai: ['chennai', 'madras'] };

async function runAll(ctx, types) {
  const out = {};
  await Promise.all(types.map(async t => { try { const r = await SOURCES[t](ctx); if (r) out[t] = r; } catch (e) { console.error('[Search] source ' + t + ':', e.message); } }));
  return out;
}

// GET /pbsearch?q=&type=all|pets|people|...&city=
exports.search = async (req, res) => {
  try {
    const raw = str(req.query.q, 100), words = wordsOf(raw), type = TYPES.includes(req.query.type) ? req.query.type : 'all';
    if (!words.length) return R.ok(res, { q: raw, sections: [], total: 0, match: 'none' });
    const city = str(req.query.city, 80).toLowerCase();
    const canFuzzy = await trgm();
    const ctx = { M: await me(req), words, raw: raw.toLowerCase(), city, cityAlts: CITY_ALIASES[city] || [city], lim: type === 'all' ? 6 : 40, any: false, fuzzy: false };
    const types = type === 'all' ? TYPES : [type], count = g => Object.values(g).reduce((n, l) => n + l.length, 0);
    // 1) exact words (with synonyms)  2) allow small spelling mistakes  3) any of the words
    let got = await runAll(ctx, types), match = 'exact';
    if (!count(got) && canFuzzy) { ctx.fuzzy = true; got = await runAll(ctx, types); match = 'close'; }
    if (!count(got) && words.length > 1) { ctx.any = true; got = await runAll(ctx, types); match = 'partial'; }
    if (!count(got)) match = 'none';
    const sections = types.filter(t => got[t] && got[t].length).map(t => ({ type: t, count: got[t][0].total || got[t].length, items: got[t].map(x => { const y = Object.assign({}, x); delete y.total; return y; }) }));
    return R.ok(res, { q: raw, words, city: city || null, type, sections, total: sections.reduce((n, s) => n + s.count, 0), match });
  } catch (e) { return fail(res, 'search', e); }
};

// GET /pbsearch/home — real counts for the page header and popular breeds to try
exports.home = async (req, res) => {
  try {
    const n = async (sql) => { try { const { rows } = await query(sql); return rows[0] ? Number(rows[0].n) : 0; } catch (e) { return 0; } };
    const [pets, people, communities, vets, products, events, adoption, lost] = await Promise.all([
      n(`SELECT COUNT(*) AS n FROM pets`), n(`SELECT COUNT(*) AS n FROM users`),
      n(`SELECT COUNT(*) AS n FROM "Group" WHERE is_active AND moderation = 'visible'`), n(`SELECT COUNT(*) AS n FROM vets WHERE status = 'active'`),
      n(`SELECT COUNT(*) AS n FROM marketplace_products WHERE is_active = TRUE`),
      n(`SELECT COUNT(*) AS n FROM events e JOIN pet_event_details d ON d.event_id = e.event_id WHERE d.moderation = 'approved' AND e.status IS DISTINCT FROM 'cancelled' AND e.status IS DISTINCT FROM 'deleted' AND COALESCE(d.ends_at, e.event_date) >= NOW()`),
      n(`SELECT COUNT(*) AS n FROM adoptable_pets WHERE status IN ('available','reserved') AND moderation = 'approved'`),
      n(`SELECT (SELECT COUNT(*) FROM lost_pet_reports WHERE moderation = 'visible' AND case_status IN ('active','sighted','identified')) + (SELECT COUNT(*) FROM found_pet_reports WHERE moderation = 'visible' AND case_status IN ('found','sheltered','owner_identified')) AS n`)]);
    let breeds = [];
    try { const { rows } = await query(`SELECT initcap(lower(trim(breed))) AS b, COUNT(*)::int AS n FROM (SELECT breed FROM pets UNION ALL SELECT breed FROM adoptable_pets WHERE moderation = 'approved') x
        WHERE breed IS NOT NULL AND length(trim(breed)) BETWEEN 3 AND 40 AND lower(trim(breed)) NOT IN ('mixed','mix','unknown','other','na','n/a','none') GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`); breeds = rows.map(r => ({ name: r.b, count: r.n })); } catch (e) {}
    return R.ok(res, { counts: { pets, people, communities, vets, products, events, adoption, lost }, breeds });
  } catch (e) { return fail(res, 'home', e); }
};
exports._test = { wordsOf, matcher, img };
