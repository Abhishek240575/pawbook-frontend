'use strict';
/* ============================================================================
   My PawBook (page 31): My Collection, PawBook Memories, My Journey, Paw Celebrations.
   Mounted under /api/v1/mypawbook (see add_shop_routes.js). Migration 015 adds only new tables.
   Reads the existing tables without changing them:
     saved_posts / posts / likes / comments / follows (integer user ids = users.user_no)
     marketplace_wishlist, event_attendees, pet_event_registrations, marketplace_orders,
     vet_appointments, pet_vaccinations, pet_health_logs (memories), media, activity_log,
     group memberships and lost-pet reports (column names looked up from information_schema).
   The old routes (/saved, /memories, /activity, /birthdays) are left as they are.
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const fail = (res, where, e) => { console.error('[MyPawBook] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const conflict = (res, msg) => res.status(409).json({ success: false, message: msg });
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const httpsUrl = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 500;
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const istDay = t => { if (!t) return null; const d = t instanceof Date ? t : new Date(t); return isNaN(d) ? null : new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10); };
const d10 = v => { if (!v) return null; if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10); return String(v).slice(0, 10); };
const iso = t => { if (!t) return null; const d = t instanceof Date ? t : new Date(t); return isNaN(d) ? null : d.toISOString(); };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const q = n => '"' + String(n).replace(/"/g, '') + '"';

// ── schema lookup (cached) ───────────────────────────────────────────────────
const SCHEMA = {};
async function cols(table) {
  if (SCHEMA[table]) return SCHEMA[table];
  const { rows } = await query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [table]);
  const m = {}; rows.forEach(r => { m[r.column_name] = r.data_type; });
  SCHEMA[table] = m; return m;
}
const pick = (c, names) => names.find(n => c[n] !== undefined) || null;
async function safe(label, fn, dflt) { try { return await fn(); } catch (e) { console.error('[MyPawBook] source ' + label + ':', e.message); return dflt === undefined ? [] : dflt; } }

// who am I: UUID plus the integer user number used by posts/pets/likes/follows
async function me(req) {
  const id = String(req.user.user_id), u = await cols('users');
  const { rows } = await query(`SELECT user_id::text AS id${u.user_no !== undefined ? ', user_no::text AS no' : ''}, ${u.full_name !== undefined ? 'full_name' : 'NULL'} AS name FROM users WHERE user_id::text = $1`, [id]);
  const r = rows[0] || { id };
  return { id, no: r.no || null, ids: [id].concat(r.no ? [r.no] : []), name: r.name || null, hasNo: u.user_no !== undefined };
}
// my pets (any owner column naming)
async function petCols() {
  const c = await cols('pets');
  return { c, id: pick(c, ['id', 'pet_id']), owner: pick(c, ['user_id', 'owner_id']), name: pick(c, ['name']), species: pick(c, ['species', 'type', 'pet_type']), breed: pick(c, ['breed']),
    photo: pick(c, ['avatar', 'avatar_url', 'photo_url', 'image_url', 'profile_photo', 'photo']), created: pick(c, ['created_at']) };
}
function normPet(P, r) {
  const photos = Array.isArray(r.photos) ? r.photos.filter(httpsUrl) : [];
  const ph = P.photo && httpsUrl(r[P.photo]) ? r[P.photo] : photos[0] || null;
  return { id: String(r[P.id]), name: r[P.name] || 'My pet', species: P.species ? r[P.species] || '' : '', breed: P.breed ? r[P.breed] || null : null, photo: ph, photos: photos.slice(0, 6), created: P.created ? iso(r[P.created]) : null };
}
async function myPets(M) {
  const P = await petCols(); if (!P.id || !P.owner) return { P, pets: [] };
  const { rows } = await query(`SELECT p.* FROM pets p WHERE p.${q(P.owner)}::text = ANY($1) ORDER BY p.${q(P.id)} LIMIT 50`, [M.ids]);
  return { P, pets: rows.map(r => normPet(P, r)) };
}
async function milestones(petIds) {
  if (!petIds.length) return {};
  const { rows } = await query(`SELECT * FROM pb_pet_milestones WHERE pet_id = ANY($1)`, [petIds]);
  const m = {}; rows.forEach(r => { m[r.pet_id] = r; }); return m;
}

// ── GET /mypawbook/summary ───────────────────────────────────────────────────
exports.summary = async (req, res) => {
  try {
    const M = await me(req), { pets } = await myPets(M);
    const [col, mem, cel] = await Promise.all([
      collectionCounts(M), safe('mem count', async () => (await query(`SELECT COUNT(*)::int AS n FROM pet_health_logs WHERE kind = 'memory' AND pet_id = ANY($1)`, [pets.map(p => p.id)])).rows[0].n, 0),
      safe('reminders', () => birthdayReminders(M, pets), null)
    ]);
    return R.ok(res, { me: { name: M.name }, pets, counts: { saved: Object.values(col).reduce((a, b) => a + b, 0), by_kind: col, memories: mem } });
  } catch (e) { return fail(res, 'summary', e); }
};

/* ═══════════════════════════════ MY COLLECTION ═══════════════════════════════ */
const KINDS = ['post', 'product', 'event', 'vet', 'tip', 'training', 'place'];
const OWN_KINDS = ['vet', 'tip', 'training', 'place'];
async function collectionCounts(M) {
  const out = { post: 0, product: 0, event: 0, vet: 0, tip: 0, training: 0, place: 0 };
  await Promise.all([
    safe('cnt post', async () => { if (M.no) out.post = (await query(`SELECT COUNT(*)::int AS n FROM saved_posts WHERE user_id::text = ANY($1)`, [M.ids])).rows[0].n; }, null),
    safe('cnt product', async () => { out.product = (await query(`SELECT COUNT(*)::int AS n FROM marketplace_wishlist WHERE user_id::text = $1`, [M.id])).rows[0].n; }, null),
    safe('cnt event', async () => { out.event = (await query(`SELECT COUNT(*)::int AS n FROM event_attendees a JOIN events e ON e.event_id = a.event_id WHERE a.user_id::text = $1 AND a.status = 'interested' AND e.status IS DISTINCT FROM 'deleted'`, [M.id])).rows[0].n; }, null),
    safe('cnt own', async () => { (await query(`SELECT kind, COUNT(*)::int AS n FROM pb_saved_items WHERE user_id::text = $1 GROUP BY kind`, [M.id])).rows.forEach(r => { out[r.kind] = r.n; }); }, null)
  ]);
  return out;
}
function firstImg(arr) { if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = [arr]; } } if (!Array.isArray(arr)) return null; const x = arr.map(v => (v && typeof v === 'object' ? v.url : v)).find(httpsUrl); return x || null; }
async function savedPosts(M) {
  if (!M.no) return [];
  const u = await cols('users'), p = await cols('posts');
  const vis = p.visibility !== undefined ? 'p.visibility' : `'public'`;
  const { rows } = await query(`SELECT sp.post_id::text AS ref, sp.created_at AS saved_at, p.content, p.images, ${p.media_urls !== undefined ? 'p.media_urls' : 'NULL'} AS media_urls, p.created_at, ${vis} AS visibility, p.user_id::text AS author_no,
      ${u.user_no !== undefined ? `(SELECT full_name FROM users au WHERE au.user_no = p.user_id LIMIT 1)` : 'NULL'} AS author, ${p.pet_id !== undefined ? '(SELECT name FROM pets x WHERE x.id = p.pet_id)' : 'NULL'} AS pet_name
    FROM saved_posts sp JOIN posts p ON p.id = sp.post_id WHERE sp.user_id::text = ANY($1) ORDER BY sp.created_at DESC LIMIT 300`, [M.ids]);
  return rows.map(r => {
    const mine = M.ids.includes(r.author_no), ok = mine || !r.visibility || r.visibility === 'public';
    const imgs = [].concat(r.images || [], r.media_urls || []).filter(httpsUrl).slice(0, 4);
    return { kind: 'post', ref: r.ref, saved_at: iso(r.saved_at), available: ok, title: ok ? clip(r.content, 90) || (r.pet_name ? 'A post about ' + r.pet_name : 'A post') : 'This post is no longer visible',
      text: ok ? clip(r.content, 800) : null, image: ok ? imgs[0] || null : null, images: ok ? imgs : [], sub: ok ? [r.author, r.pet_name].filter(Boolean).join(' · ') : null, at: iso(r.created_at), url: null };
  });
}
async function savedProducts(M) {
  const c = await cols('marketplace_products'); if (!Object.keys(c).length) return [];
  const { rows } = await query(`SELECT w.product_id AS ref, w.created_at AS saved_at, pr.name, pr.price, ${c.images !== undefined ? 'pr.images' : 'NULL'} AS images, ${c.status !== undefined ? 'pr.status' : 'NULL'} AS status
    FROM marketplace_wishlist w LEFT JOIN marketplace_products pr ON pr.product_id::text = w.product_id WHERE w.user_id::text = $1 ORDER BY w.created_at DESC LIMIT 300`, [M.id]);
  return rows.map(r => ({ kind: 'product', ref: String(r.ref), saved_at: iso(r.saved_at), available: !!r.name && r.status !== 'removed', title: r.name || 'Product no longer available', image: firstImg(r.images),
    sub: r.price != null ? '₹' + Number(r.price).toLocaleString('en-IN') : null, url: r.name ? '44_shop_product.html?id=' + encodeURIComponent(r.ref) : null }));
}
async function savedEvents(M) {
  const d = await cols('pet_event_details'), has = Object.keys(d).length;
  const { rows } = await query(`SELECT e.event_id::text AS ref, a.joined_at AS saved_at, e.title, e.event_date, e.cover_image, e.status ${has ? ', d.city, d.is_online, d.category, d.moderation' : ''}
    FROM event_attendees a JOIN events e ON e.event_id = a.event_id ${has ? 'LEFT JOIN pet_event_details d ON d.event_id = e.event_id' : ''} WHERE a.user_id::text = $1 AND a.status = 'interested' AND e.status IS DISTINCT FROM 'deleted' ORDER BY e.event_date LIMIT 300`, [M.id]);
  const now = todayIST();
  return rows.map(r => { const day = d10(r.event_date), ok = r.status !== 'cancelled' && (!has || !r.moderation || r.moderation === 'approved');
    return { kind: 'event', ref: r.ref, saved_at: iso(r.saved_at), available: ok, title: r.title, image: httpsUrl(r.cover_image) ? r.cover_image : null, category: r.category || null,
      sub: [day, r.is_online ? 'Online' : r.city].filter(Boolean).join(' · ') + (r.status === 'cancelled' ? ' · cancelled' : day && day < now ? ' · ended' : ''), date: day, url: '30_events.html?event=' + r.ref }; });
}
async function savedOwn(M) {
  const { rows } = await query(`SELECT kind, ref, title, image, url, note, created_at FROM pb_saved_items WHERE user_id::text = $1 ORDER BY created_at DESC LIMIT 500`, [M.id]);
  return rows.map(r => ({ kind: r.kind, ref: r.ref, saved_at: iso(r.created_at), available: true, title: r.title, image: httpsUrl(r.image) ? r.image : null, sub: r.note || null, url: r.url || null }));
}
// GET /mypawbook/collection
exports.collection = async (req, res) => {
  try {
    const M = await me(req);
    const [a, b, c, d, cl, ci] = await Promise.all([safe('posts', () => savedPosts(M)), safe('products', () => savedProducts(M)), safe('events', () => savedEvents(M)), safe('own', () => savedOwn(M)),
      query(`SELECT collection_id::text AS id, name, emoji, created_at FROM pb_collections WHERE user_id::text = $1 ORDER BY created_at`, [M.id]),
      query(`SELECT ci.collection_id::text AS id, ci.kind, ci.ref FROM pb_collection_items ci JOIN pb_collections c ON c.collection_id = ci.collection_id WHERE c.user_id::text = $1`, [M.id])]);
    const inCol = {}; ci.rows.forEach(r => { const k = r.kind + ':' + r.ref; (inCol[k] = inCol[k] || []).push(r.id); });
    const items = a.concat(b, c, d).map(x => Object.assign(x, { collections: inCol[x.kind + ':' + x.ref] || [] })).sort((x, y) => String(y.saved_at).localeCompare(String(x.saved_at)));
    const present = {}; items.forEach(x => { present[x.kind + ':' + x.ref] = 1; });
    const collections = cl.rows.map(r => { const its = ci.rows.filter(x => x.id === r.id && present[x.kind + ':' + x.ref]); const cover = items.find(x => its.some(y => y.kind === x.kind && y.ref === x.ref) && x.image);
      return { id: r.id, name: r.name, emoji: r.emoji, count: its.length, cover: cover ? cover.image : null }; });
    return R.ok(res, { items, collections });
  } catch (e) { return fail(res, 'collection', e); }
};
// POST /mypawbook/collection/items  {kind, ref, title, image, url, note}
exports.saveItem = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, kind = str(b.kind, 12), ref = str(b.ref, 120);
    if (!KINDS.includes(kind) || !ref) return bad(res, ['kind']);
    if (kind === 'post') { if (!M.no || !/^\d+$/.test(ref)) return bad(res, ['ref']); const { rows } = await query(`SELECT 1 FROM posts WHERE id = $1`, [+ref]); if (!rows.length) return R.notFound(res, 'Post not found'); await query(`INSERT INTO saved_posts (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [+M.no, +ref]); }
    else if (kind === 'product') await query(`INSERT INTO marketplace_wishlist (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [M.id, ref]);
    else if (kind === 'event') { if (!/^[0-9a-f-]{36}$/i.test(ref)) return bad(res, ['ref']); const { rows } = await query(`SELECT 1 FROM events WHERE event_id::text = $1`, [ref]); if (!rows.length) return R.notFound(res, 'Event not found');
      await query(`INSERT INTO event_attendees (event_id, user_id, status) VALUES ($1::uuid,$2::uuid,'interested') ON CONFLICT (event_id, user_id) DO NOTHING`, [ref, M.id]); }
    else {
      const title = str(b.title, 160); if (!title) return bad(res, ['title']);
      const url = str(b.url, 500); if (url && !/^(https:\/\/|[\w-]+\.html)/.test(url)) return bad(res, ['url']);
      const { rows } = await query(`SELECT COUNT(*)::int AS n FROM pb_saved_items WHERE user_id::text = $1`, [M.id]); if (rows[0].n >= 2000) return conflict(res, 'Your collection is full. Remove a few items first.');
      await query(`INSERT INTO pb_saved_items (user_id, kind, ref, title, image, url, note) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id, kind, ref) DO UPDATE SET title = EXCLUDED.title, image = EXCLUDED.image, url = EXCLUDED.url`,
        [M.id, kind, ref, title, httpsUrl(b.image) ? b.image : null, url || null, str(b.note, 300) || null]);
    }
    return R.created(res, { saved: true });
  } catch (e) { return fail(res, 'saveItem', e); }
};
// DELETE /mypawbook/collection/items/:kind/:ref
exports.removeItem = async (req, res) => {
  try {
    const M = await me(req), kind = str(req.params.kind, 12), ref = str(req.params.ref, 120);
    if (!KINDS.includes(kind)) return bad(res, ['kind']);
    if (kind === 'post') { if (/^\d+$/.test(ref)) await query(`DELETE FROM saved_posts WHERE user_id::text = ANY($1) AND post_id = $2`, [M.ids, +ref]); }
    else if (kind === 'product') await query(`DELETE FROM marketplace_wishlist WHERE user_id::text = $1 AND product_id = $2`, [M.id, ref]);
    else if (kind === 'event') await query(`DELETE FROM event_attendees WHERE user_id::text = $1 AND event_id::text = $2 AND status = 'interested'`, [M.id, ref]);
    else await query(`DELETE FROM pb_saved_items WHERE user_id::text = $1 AND kind = $2 AND ref = $3`, [M.id, kind, ref]);
    await query(`DELETE FROM pb_collection_items ci USING pb_collections c WHERE c.collection_id = ci.collection_id AND c.user_id::text = $1 AND ci.kind = $2 AND ci.ref = $3`, [M.id, kind, ref]);
    return R.ok(res, { removed: true });
  } catch (e) { return fail(res, 'removeItem', e); }
};
// POST /mypawbook/collections {name, emoji}   PATCH /collections/:id   DELETE /collections/:id
exports.createCollection = async (req, res) => {
  try {
    const M = await me(req), name = str((req.body || {}).name, 60), emoji = str((req.body || {}).emoji, 8) || null;
    if (name.length < 2) return bad(res, ['name'], 'Please give the collection a name');
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM pb_collections WHERE user_id::text = $1`, [M.id]); if (n[0].n >= 50) return conflict(res, 'You can have up to 50 collections.');
    try { const { rows } = await query(`INSERT INTO pb_collections (user_id, name, emoji) VALUES ($1,$2,$3) RETURNING collection_id::text AS id`, [M.id, name, emoji]); return R.created(res, { id: rows[0].id }); }
    catch (x) { if (x.code === '23505') return conflict(res, 'You already have a collection with this name.'); throw x; }
  } catch (e) { return fail(res, 'createCollection', e); }
};
exports.updateCollection = async (req, res) => {
  try {
    const M = await me(req), name = str((req.body || {}).name, 60), emoji = str((req.body || {}).emoji, 8) || null;
    if (name.length < 2) return bad(res, ['name']);
    try { const { rowCount } = await query(`UPDATE pb_collections SET name = $3, emoji = $4 WHERE collection_id::text = $1 AND user_id::text = $2`, [str(req.params.id, 20), M.id, name, emoji]); if (!rowCount) return R.notFound(res, 'Collection not found'); }
    catch (x) { if (x.code === '23505') return conflict(res, 'You already have a collection with this name.'); throw x; }
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'updateCollection', e); }
};
exports.deleteCollection = async (req, res) => {
  try {
    const M = await me(req); const { rowCount } = await query(`DELETE FROM pb_collections WHERE collection_id::text = $1 AND user_id::text = $2`, [str(req.params.id, 20), M.id]);
    if (!rowCount) return R.notFound(res, 'Collection not found'); return R.ok(res, { deleted: true });
  } catch (e) { return fail(res, 'deleteCollection', e); }
};
// PUT /mypawbook/collections/:id/items {kind, ref, on}
exports.collectionItem = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, kind = str(b.kind, 12), ref = str(b.ref, 120), id = str(req.params.id, 20);
    if (!KINDS.includes(kind) || !ref) return bad(res, ['kind']);
    const { rows } = await query(`SELECT 1 FROM pb_collections WHERE collection_id::text = $1 AND user_id::text = $2`, [id, M.id]); if (!rows.length) return R.notFound(res, 'Collection not found');
    if (b.on === false) await query(`DELETE FROM pb_collection_items WHERE collection_id::text = $1 AND kind = $2 AND ref = $3`, [id, kind, ref]);
    else await query(`INSERT INTO pb_collection_items (collection_id, kind, ref) VALUES ($1::bigint,$2,$3) ON CONFLICT DO NOTHING`, [id, kind, ref]);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'collectionItem', e); }
};

/* ═══════════════════════════════ MEMORIES ═══════════════════════════════ */
const MTYPES = ['moment', 'home', 'trip', 'grooming', 'vet', 'achievement', 'adoption', 'birthday', 'meetup', 'other'];
const VIS = ['private', 'followers', 'public'];
function addYears(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + n); return x.toISOString().slice(0, 10); }
async function vaxFor(petIds) {
  const c = await cols('pet_vaccinations'); if (!Object.keys(c).length || !petIds.length) return [];
  const idc = pick(c, ['id', 'vaccination_id', 'record_id']), name = pick(c, ['vaccine_name', 'name', 'vaccine']), given = pick(c, ['given_date', 'administered_at', 'date_given', 'vaccinated_on', 'date']);
  if (!name || !given) return [];
  const { rows } = await query(`SELECT ${idc ? q(idc) + '::text' : 'NULL'} AS id, pet_id::text AS pet_id, ${q(name)} AS name, ${q(given)} AS given FROM pet_vaccinations WHERE pet_id::text = ANY($1) AND ${q(given)} IS NOT NULL ORDER BY ${q(given)} LIMIT 2000`, [petIds]);
  return rows.map(r => ({ id: r.id, pet_id: r.pet_id, name: r.name, given: d10(r.given) }));
}
async function memoryItems(M, pets) {
  const ids = pets.map(p => p.id), byId = {}; pets.forEach(p => { byId[p.id] = p; });
  const today = todayIST(), items = [];
  if (!ids.length) return items;
  const [logs, ms, vax, appts, posts, regs] = await Promise.all([
    safe('mem logs', async () => (await query(`SELECT log_id::text AS id, pet_id, kind, logged_at, title, details, data FROM pet_health_logs WHERE pet_id = ANY($1) AND kind IN ('memory','event') ORDER BY logged_at LIMIT 3000`, [ids])).rows),
    safe('milestones', () => milestones(ids), {}),
    safe('vax', () => vaxFor(ids)),
    safe('appts', async () => (await query(`SELECT pet_id::text AS pet_id, MIN(appt_date) AS d FROM vet_appointments WHERE pet_id::text = ANY($1) AND status = 'completed' GROUP BY pet_id`, [ids])).rows),
    safe('posts', async () => { const p = await cols('posts'); if (p.pet_id === undefined) return []; return (await query(`SELECT DISTINCT ON (pet_id) pet_id::text AS pet_id, id::text AS id, created_at, images, content FROM posts WHERE pet_id::text = ANY($1) ORDER BY pet_id, created_at`, [ids])).rows; }),
    safe('regs', async () => (await query(`SELECT e.event_id::text AS id, e.title, e.event_date FROM pet_event_registrations r JOIN events e ON e.event_id = r.event_id WHERE r.user_id::text = $1 AND r.status IN ('registered','checked_in') AND e.event_date < NOW() ORDER BY e.event_date LIMIT 1`, [M.id])).rows)
  ]);
  // the owner's own memories
  logs.filter(l => l.kind === 'memory').forEach(l => {
    const d = l.data || {}, photos = (Array.isArray(d.photos) ? d.photos : []).concat(d.photo_url ? [d.photo_url] : []).filter(httpsUrl);
    items.push({ key: 'log:' + l.id, id: l.id, own: true, pet_id: l.pet_id, date: istDay(l.logged_at), title: l.title, story: l.details || null, photos: [...new Set(photos)].slice(0, 8), mtype: MTYPES.includes(d.mtype) ? d.mtype : 'moment', visibility: VIS.includes(d.visibility) ? d.visibility : 'private' });
  });
  const auto = (key, pid, date, mtype, title, story, extra) => { if (date && date <= today) items.push(Object.assign({ key: 'auto:' + key, auto: true, pet_id: pid, date, mtype, title, story: story || null, photos: [], visibility: 'private' }, extra || {})); };
  const firstEv = {}; logs.filter(l => l.kind === 'event').forEach(l => { const t = (l.data || {}).event_type || 'other', k = l.pet_id + ':' + t; if (!firstEv[k]) firstEv[k] = l; });
  pets.forEach(p => {
    const m = ms[p.id] || {}, b = m.birth_precision !== 'unknown' ? d10(m.birth_date) : null, g = d10(m.gotcha_date), est = m.birth_precision === 'estimated';
    if (b) { auto('born:' + p.id, p.id, b, 'birthday', (est ? 'Around now, ' : '') + p.name + ' was born', est ? 'Estimated birth date' : null);
      for (let y = 1; y < 40; y++) { const d = addYears(b, y); if (d > today) break; auto('bday' + y + ':' + p.id, p.id, d, 'birthday', p.name + "'s " + ordinal(y) + ' birthday' + (y === 1 ? '!' : ''), y === 1 ? 'The very first birthday.' : y + ' years of love and paw prints.', { years: y }); } }
    if (g) { auto('home:' + p.id, p.id, g, m.gotcha_kind === 'adoption' ? 'adoption' : 'home', m.gotcha_kind === 'adoption' ? p.name + ' was adopted' : p.name + ' came home', 'The first day together.');
      for (let y = 1; y < 40; y++) { const d = addYears(g, y); if (d > today) break; auto('gotcha' + y + ':' + p.id, p.id, d, 'adoption', (m.gotcha_kind === 'adoption' ? 'Adoption anniversary · ' : 'Gotcha day · ') + y + ' year' + (y > 1 ? 's' : '') + ' together', null, { years: y }); } }
    if (p.created) auto('joined:' + p.id, p.id, istDay(p.created), 'pawbook', p.name + ' joined PawBook', null);
    const fv = vax.find(v => v.pet_id === p.id); if (fv) auto('vax:' + p.id, p.id, fv.given, 'vet', 'First vaccination', fv.name + ' — a brave first health milestone.');
    const ap = appts.find(a => a.pet_id === p.id), lv = firstEv[p.id + ':vet_visit'], vd = [ap && d10(ap.d), lv && istDay(lv.logged_at)].filter(Boolean).sort()[0];
    if (vd) auto('vet:' + p.id, p.id, vd, 'vet', 'First vet visit', 'A first check-up with the vet.');
    const gr = firstEv[p.id + ':grooming']; if (gr) auto('groom:' + p.id, p.id, istDay(gr.logged_at), 'grooming', 'First grooming session', gr.title || null, { photos: (gr.data && httpsUrl(gr.data.photo_url)) ? [gr.data.photo_url] : [] });
    const po = posts.find(x => x.pet_id === p.id); if (po) { const img = (po.images || []).find(httpsUrl); auto('post:' + p.id, p.id, istDay(po.created_at), 'moment', 'First post about ' + p.name, clip(po.content, 160) || null, { photos: img ? [img] : [] }); }
  });
  if (regs[0]) auto('event:first', null, d10(regs[0].event_date), 'meetup', 'Your first PawBook event', regs[0].title, { url: '30_events.html?event=' + regs[0].id });
  return items;
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
// GET /mypawbook/memories?pet=
exports.memories = async (req, res) => {
  try {
    const M = await me(req), { pets } = await myPets(M), pf = str(req.query.pet, 40);
    let items = await memoryItems(M, pets);
    const { rows: fl } = await query(`SELECT mkey, highlighted, hidden FROM pb_memory_flags WHERE user_id::text = $1`, [M.id]); const F = {}; fl.forEach(r => { F[r.mkey] = r; });
    const byId = {}; pets.forEach(p => { byId[p.id] = p; });
    items.forEach(x => { const f = F[x.key] || {}; x.highlighted = !!f.highlighted; x.hidden = !!f.hidden; x.pet = x.pet_id && byId[x.pet_id] ? { id: x.pet_id, name: byId[x.pet_id].name, photo: byId[x.pet_id].photo } : null; if (!x.photos.length && x.pet && x.pet.photo && x.auto) x.pet_photo = true; });
    if (pf) items = items.filter(x => x.pet_id === pf || x.pet_id == null);
    const hiddenCount = items.filter(x => x.hidden).length;
    if (req.query.hidden !== '1') items = items.filter(x => !x.hidden);
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (a.auto ? 1 : -1));
    const t = todayIST(), md = t.slice(5);
    const onThisDay = items.filter(x => x.date && x.date.slice(5) === md && x.date < t.slice(0, 4));
    const years = {}; items.forEach(x => { const y = x.date.slice(0, 4); const Y = years[y] = years[y] || { year: +y, count: 0, photos: 0, firsts: 0, birthdays: 0, highlights: 0, cover: null };
      Y.count++; Y.photos += x.photos.length; if (/^auto:(vax|vet|groom|post|event|home|born)/.test(x.key)) Y.firsts++; if (x.mtype === 'birthday') Y.birthdays++; if (x.highlighted) Y.highlights++; if (!Y.cover && x.photos[0]) Y.cover = x.photos[0]; });
    return R.ok(res, { pets, items, on_this_day: onThisDay, years: Object.values(years).sort((a, b) => b.year - a.year), hidden_count: hiddenCount, today: t });
  } catch (e) { return fail(res, 'memories', e); }
};
function readMemory(b, partial) {
  const e = [], v = {}, has = k => !partial || b[k] !== undefined;
  if (has('title')) { v.title = str(b.title, 120); if (v.title.length < 2) e.push('title'); }
  if (has('story')) v.story = str(b.story, 2000) || null;
  if (has('date')) { v.date = str(b.date, 10); if (!DATE_RX.test(v.date) || v.date > todayIST() || v.date < '1990-01-01' || isNaN(Date.parse(v.date))) e.push('date'); }
  if (has('mtype')) v.mtype = MTYPES.includes(b.mtype) ? b.mtype : 'moment';
  if (has('visibility')) v.visibility = VIS.includes(b.visibility) ? b.visibility : 'private';
  if (has('photos')) { const a = Array.isArray(b.photos) ? b.photos : []; if (a.some(u => !httpsUrl(u))) e.push('photos'); v.photos = a.filter(httpsUrl).slice(0, 8); }
  return { v, e };
}
async function ownPet(M, petId) { const P = await petCols(); const { rows } = await query(`SELECT p.* FROM pets p WHERE p.${q(P.id)}::text = $1 AND p.${q(P.owner)}::text = ANY($2)`, [String(petId).slice(0, 40), M.ids]); return rows.length ? normPet(P, rows[0]) : null; }
// POST /mypawbook/memories {pet_id, title, story, date, mtype, visibility, photos}
exports.createMemory = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, pet = await ownPet(M, b.pet_id); if (!pet) return bad(res, ['pet_id'], 'Choose one of your pets');
    const { v, e } = readMemory(b, false); if (e.length) return bad(res, e);
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM pet_health_logs WHERE owner_id = $1 AND kind = 'memory' AND created_at > NOW() - INTERVAL '1 day'`, [M.id]); if (n[0].n >= 50) return res.status(429).json({ success: false, message: 'You have added many memories today. Please try again tomorrow.' });
    const { rows } = await query(`INSERT INTO pet_health_logs (pet_id, owner_id, kind, logged_at, title, details, data) VALUES ($1,$2,'memory',$3::date + TIME '12:00' - INTERVAL '330 minutes',$4,$5,$6) RETURNING log_id::text AS id`,
      [pet.id, M.id, v.date, v.title, v.story, JSON.stringify({ photo_url: v.photos[0] || undefined, photos: v.photos, mtype: v.mtype, visibility: v.visibility })]);
    return R.created(res, { id: rows[0].id });
  } catch (e) { return fail(res, 'createMemory', e); }
};
async function myMemory(M, id) {
  const { pets } = await myPets(M); const ids = pets.map(p => p.id);
  const { rows } = await query(`SELECT log_id, pet_id, data FROM pet_health_logs WHERE log_id::text = $1 AND kind = 'memory' AND pet_id = ANY($2)`, [str(id, 20), ids]); return rows[0] || null;
}
exports.updateMemory = async (req, res) => {
  try {
    const M = await me(req), m = await myMemory(M, req.params.id); if (!m) return R.notFound(res, 'Memory not found');
    const { v, e } = readMemory(req.body || {}, true); if (e.length) return bad(res, e);
    const d = Object.assign({}, m.data || {}); if (v.photos) { d.photos = v.photos; d.photo_url = v.photos[0] || undefined; } if (v.mtype) d.mtype = v.mtype; if (v.visibility) d.visibility = v.visibility;
    const set = ['data = $2'], args = [m.log_id, JSON.stringify(d)];
    if (v.title !== undefined) { args.push(v.title); set.push('title = $' + args.length); }
    if (v.story !== undefined) { args.push(v.story); set.push('details = $' + args.length); }
    if (v.date !== undefined) { args.push(v.date); set.push(`logged_at = $${args.length}::date + TIME '12:00' - INTERVAL '330 minutes'`); }
    await query(`UPDATE pet_health_logs SET ${set.join(', ')} WHERE log_id = $1`, args);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'updateMemory', e); }
};
exports.deleteMemory = async (req, res) => {
  try {
    const M = await me(req), m = await myMemory(M, req.params.id); if (!m) return R.notFound(res, 'Memory not found');
    await query(`DELETE FROM pet_health_logs WHERE log_id = $1`, [m.log_id]); await query(`DELETE FROM pb_memory_flags WHERE user_id::text = $1 AND mkey = $2`, [M.id, 'log:' + m.log_id]);
    return R.ok(res, { deleted: true });
  } catch (e) { return fail(res, 'deleteMemory', e); }
};
// POST /mypawbook/memories/flag {key, highlighted?, hidden?}
exports.flagMemory = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, key = str(b.key, 80);
    if (!/^(log:\d+|auto:[\w:-]+)$/.test(key)) return bad(res, ['key']);
    if (key.startsWith('log:') && !(await myMemory(M, key.slice(4)))) return R.notFound(res, 'Memory not found');
    await query(`INSERT INTO pb_memory_flags (user_id, mkey, highlighted, hidden) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, mkey) DO UPDATE SET highlighted = COALESCE($5, pb_memory_flags.highlighted), hidden = COALESCE($6, pb_memory_flags.hidden), updated_at = NOW()`,
      [M.id, key, b.highlighted === true, b.hidden === true, typeof b.highlighted === 'boolean' ? b.highlighted : null, typeof b.hidden === 'boolean' ? b.hidden : null]);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'flagMemory', e); }
};

/* ═══════════════════════════════ MY JOURNEY ═══════════════════════════════ */
const CATS = ['social', 'care', 'shopping', 'appointments', 'community', 'events', 'lost', 'photos', 'saved'];
async function detect(table, users, times) { const c = await cols(table); if (!Object.keys(c).length) return null; const u = pick(c, users), t = pick(c, times); return u && t ? { c, u, t } : null; }
async function journeyItems(M, o) {
  const lim = o.limit, before = o.before, want = c => !o.cat || o.cat === c, out = [];
  const W = (t, n) => `${t} < $${n}::timestamptz`;
  const run = (label, cats, fn) => (cats.some(want) ? safe(label, fn) : Promise.resolve([]));
  const { pets } = await myPets(M), pids = pets.map(p => p.id), pname = {}; pets.forEach(p => { pname[p.id] = p.name; });
  const lists = await Promise.all([
    run('posts', ['social', 'photos'], async () => { if (!M.no) return []; const p = await cols('posts');
      const { rows } = await query(`SELECT id::text AS id, content, images, created_at AS at${p.pet_id !== undefined ? ', pet_id::text AS pet_id' : ''} FROM posts WHERE user_id::text = ANY($1) AND ${W('created_at', 2)} ORDER BY created_at DESC LIMIT ${lim}`, [M.ids, before]);
      return rows.map(r => { const img = (r.images || []).find(httpsUrl); return { key: 'post:' + r.id, cat: img ? 'photos' : 'social', icon: img ? 'camera' : 'message', title: img ? 'You shared a photo' + (r.pet_id && pname[r.pet_id] ? ' of ' + pname[r.pet_id] : '') : 'You shared a post', detail: clip(r.content, 140), image: img || null, at: r.at, pet_id: r.pet_id || null }; }); }),
    run('likes', ['social'], async () => { if (!M.no) return [];
      const { rows } = await query(`SELECT l.id::text AS id, l.created_at AS at, CASE WHEN ${(await cols('posts')).visibility !== undefined ? "COALESCE(p.visibility,'public') = 'public' OR " : ''}p.user_id::text = ANY($1) THEN p.content END AS content FROM likes l JOIN posts p ON p.id = l.post_id WHERE l.user_id::text = ANY($1) AND ${W('l.created_at', 2)} ORDER BY l.created_at DESC LIMIT ${lim}`, [M.ids, before]);
      return rows.map(r => ({ key: 'like:' + r.id, cat: 'social', icon: 'heart', title: 'You liked a post', detail: clip(r.content, 120), at: r.at })); }),
    run('comments', ['social'], async () => { if (!M.no) return [];
      const { rows } = await query(`SELECT id::text AS id, content, created_at AS at FROM comments WHERE user_id::text = ANY($1) AND ${W('created_at', 2)} ORDER BY created_at DESC LIMIT ${lim}`, [M.ids, before]);
      return rows.map(r => ({ key: 'cmt:' + r.id, cat: 'social', icon: 'message-circle', title: 'You commented', detail: clip(r.content, 140), at: r.at })); }),
    run('follows', ['social'], async () => { if (!M.no) return [];
      const { rows } = await query(`SELECT f.id::text AS id, f.created_at AS at, (SELECT full_name FROM users u WHERE u.user_no = f.following_id LIMIT 1) AS name FROM follows f WHERE f.follower_id::text = ANY($1) AND ${W('f.created_at', 2)} ORDER BY f.created_at DESC LIMIT ${lim}`, [M.ids, before]);
      return rows.map(r => ({ key: 'fol:' + r.id, cat: 'social', icon: 'user-plus', title: 'You started following ' + (r.name || 'a pet parent'), at: r.at })); }),
    run('saved', ['saved'], async () => { const out = [];
      if (M.no) (await query(`SELECT id::text AS id, created_at AS at FROM saved_posts WHERE user_id::text = ANY($1) AND ${W('created_at', 2)} ORDER BY created_at DESC LIMIT ${lim}`, [M.ids, before])).rows.forEach(r => out.push({ key: 'sp:' + r.id, cat: 'saved', icon: 'bookmark', title: 'You saved a post', at: r.at, url: '31_saved.html?tab=collection' }));
      (await query(`SELECT w.product_id AS id, w.created_at AS at, (SELECT name FROM marketplace_products p WHERE p.product_id::text = w.product_id) AS name FROM marketplace_wishlist w WHERE w.user_id::text = $1 AND ${W('w.created_at', 2)} ORDER BY w.created_at DESC LIMIT ${lim}`, [M.id, before])).rows.forEach(r => out.push({ key: 'wl:' + r.id, cat: 'saved', icon: 'heart', title: 'You saved ' + (r.name || 'a product'), at: r.at, url: '44_shop_product.html?id=' + encodeURIComponent(r.id) }));
      (await query(`SELECT item_id::text AS id, kind, title, url, created_at AS at FROM pb_saved_items WHERE user_id::text = $1 AND ${W('created_at', 2)} ORDER BY created_at DESC LIMIT ${lim}`, [M.id, before])).rows.forEach(r => out.push({ key: 'si:' + r.id, cat: 'saved', icon: 'bookmark', title: 'You saved ' + r.title, at: r.at, url: r.url || null }));
      return out; }),
    run('orders', ['shopping'], async () => { const c = await cols('marketplace_orders'); if (!Object.keys(c).length) return [];
      const { rows } = await query(`SELECT order_id::text AS id, ${c.order_number !== undefined ? 'order_number' : 'NULL'} AS num, ${c.status !== undefined ? 'status' : 'NULL'} AS status, ${c.total !== undefined ? 'total' : 'NULL'} AS total, created_at AS at FROM marketplace_orders WHERE buyer_id::text = $1 AND ${W('created_at', 2)} ORDER BY created_at DESC LIMIT ${lim}`, [M.id, before]);
      return rows.map(r => ({ key: 'ord:' + r.id, cat: 'shopping', icon: 'shopping-bag', title: 'You placed order ' + (r.num || ''), detail: [r.status ? 'Status: ' + String(r.status).replace(/_/g, ' ') : null, r.total != null ? '₹' + Number(r.total).toLocaleString('en-IN') : null].filter(Boolean).join(' · '), at: r.at, url: '53_shop_orders.html?id=' + encodeURIComponent(r.id) })); }),
    run('appts', ['appointments'], async () => {
      const { rows } = await query(`SELECT a.appointment_id::text AS id, a.appt_date, a.status, a.pet_id::text AS pet_id, a.created_at AS at, v.first_name, v.last_name, v.clinic_name FROM vet_appointments a LEFT JOIN vets v ON v.vet_id = a.vet_id WHERE a.user_id::text = $1 AND ${W('a.created_at', 2)} ORDER BY a.created_at DESC LIMIT ${lim}`, [M.id, before]);
      return rows.map(r => ({ key: 'va:' + r.id, cat: 'appointments', icon: 'stethoscope', title: 'You booked a vet appointment' + (r.pet_id && pname[r.pet_id] ? ' for ' + pname[r.pet_id] : ''), detail: [r.first_name ? 'Dr. ' + [r.first_name, r.last_name].filter(Boolean).join(' ') : null, r.clinic_name, d10(r.appt_date), r.status].filter(Boolean).join(' · '), at: r.at, pet_id: r.pet_id, url: '11_vet_booking.html?tab=appointments' })); }),
    run('vax', ['care'], async () => { if (!pids.length) return []; const c = await cols('pet_vaccinations'); const cr = c.created_at !== undefined; const v = await vaxFor(pids); const ids = v.map(x => x.id).filter(Boolean);
      let created = {}; if (cr && ids.length) (await query(`SELECT id::text AS id, created_at FROM pet_vaccinations WHERE id::text = ANY($1)`, [ids])).rows.forEach(r => { created[r.id] = r.created_at; });
      return v.map(x => ({ key: 'vx:' + (x.id || x.pet_id + x.given), cat: 'care', icon: 'vaccine', title: (pname[x.pet_id] || 'Your pet') + ' — ' + x.name + ' recorded', detail: 'Given ' + x.given, at: created[x.id] || new Date(x.given + 'T06:30:00Z'), pet_id: x.pet_id, url: '10_vaccination.html?pet=' + x.pet_id }))
        .filter(x => new Date(x.at) < new Date(before)); }),
    run('logs', ['care', 'photos'], async () => { if (!pids.length) return [];
      const { rows } = await query(`SELECT log_id::text AS id, pet_id, kind, title, data, created_at AS at FROM pet_health_logs WHERE pet_id = ANY($1) AND kind IN ('event','memory') AND ${W('created_at', 2)} ORDER BY created_at DESC LIMIT ${lim}`, [pids, before]);
      return rows.map(r => { const d = r.data || {}, img = httpsUrl(d.photo_url) ? d.photo_url : null; return r.kind === 'memory' ? { key: 'log:' + r.id, cat: 'photos', icon: 'heart', title: 'You added a memory of ' + (pname[r.pet_id] || 'your pet'), detail: r.title, image: img, at: r.at, pet_id: r.pet_id, url: '31_saved.html?tab=memories' }
        : { key: 'log:' + r.id, cat: 'care', icon: 'heartbeat', title: (pname[r.pet_id] || 'Your pet') + ' — ' + (r.title || String(d.event_type || 'health event').replace(/_/g, ' ')), detail: d.clinic || null, at: r.at, pet_id: r.pet_id, url: '36_pet_life_record.html?pet=' + r.pet_id }; }); }),
    run('events', ['events'], async () => { const out = [];
      (await query(`SELECT r.reg_id::text AS id, r.status, r.created_at AS at, e.event_id::text AS eid, e.title FROM pet_event_registrations r JOIN events e ON e.event_id = r.event_id WHERE r.user_id::text = $1 AND ${W('r.created_at', 2)} ORDER BY r.created_at DESC LIMIT ${lim}`, [M.id, before])).rows
        .forEach(r => out.push({ key: 'reg:' + r.id, cat: 'events', icon: 'ticket', title: (r.status === 'waitlisted' ? 'You joined the waitlist for ' : r.status === 'cancelled' ? 'You cancelled your spot at ' : 'You registered for ') + r.title, at: r.at, url: '30_events.html?event=' + r.eid }));
      (await query(`SELECT event_id::text AS id, title, created_at AS at FROM events WHERE user_id::text = $1 AND status IS DISTINCT FROM 'deleted' AND ${W('created_at', 2)} ORDER BY created_at DESC LIMIT ${lim}`, [M.id, before])).rows
        .forEach(r => out.push({ key: 'host:' + r.id, cat: 'events', icon: 'confetti', title: 'You created the event ' + r.title, at: r.at, url: '30_events.html?event=' + r.id }));
      return out; }),
    run('groups', ['community'], async () => { for (const t of ['group_memberships', 'GroupMember', 'group_members']) { const s = await detect(t, ['user_id', 'member_id', 'userId'], ['joined_at', 'created_at', 'joinedAt', 'createdAt']); if (!s) continue;
        const g = pick(s.c, ['group_id', 'groupId']), G = await cols('groups'), gn = pick(G, ['name', 'title']), gid = pick(G, ['group_id', 'id']);
        const { rows } = await query(`SELECT m.${q(g || s.u)}::text AS gid, m.${q(s.t)} AS at${g && gn && gid ? `, (SELECT x.${q(gn)} FROM groups x WHERE x.${q(gid)}::text = m.${q(g)}::text LIMIT 1) AS name` : ''} FROM ${q(t)} m WHERE m.${q(s.u)}::text = ANY($1) AND m.${q(s.t)} < $2::timestamptz ORDER BY m.${q(s.t)} DESC LIMIT ${lim}`, [M.ids, before]);
        return rows.map(r => ({ key: 'grp:' + t + ':' + r.gid, cat: 'community', icon: 'users-group', title: 'You joined ' + (r.name || 'a group'), at: r.at, url: g ? '17_group_detail.html?id=' + encodeURIComponent(r.gid) : '03_groups.html' })); } return []; }),
    run('lost', ['lost'], async () => { const out = [], c = await cols('lost_pet_reports'); if (!Object.keys(c).length) return [];
      const own = c.reporter_uuid !== undefined ? `(reporter_uuid::text = $1 OR (reporter_uuid IS NULL AND user_id::text = ANY($3)))` : `user_id::text = ANY($3) AND $1::text IS NOT NULL`;
      (await query(`SELECT id::text AS id, pet_name, ${c.case_status !== undefined ? 'case_status' : 'status'} AS status, created_at AS at FROM lost_pet_reports WHERE ${own} AND created_at < $2::timestamptz ORDER BY created_at DESC LIMIT ${lim}`, [M.id, before, M.ids])).rows
        .forEach(r => out.push({ key: 'lost:' + r.id, cat: 'lost', icon: 'alert-triangle', title: 'You reported ' + (r.pet_name || 'your pet') + ' missing', detail: r.status ? 'Status: ' + String(r.status).replace(/_/g, ' ') : null, at: r.at, url: '38_lost_pet_network.html?case=lost-' + r.id }));
      if (Object.keys(await cols('found_pet_reports')).length) (await query(`SELECT id::text AS id, species, area, case_status, created_at AS at FROM found_pet_reports WHERE finder_id::text = $1 AND created_at < $2::timestamptz ORDER BY created_at DESC LIMIT ${lim}`, [M.id, before])).rows
        .forEach(r => out.push({ key: 'found:' + r.id, cat: 'lost', icon: 'heart-handshake', title: 'You reported a found ' + (r.species || 'pet'), detail: [r.area, r.case_status ? 'Status: ' + String(r.case_status).replace(/_/g, ' ') : null].filter(Boolean).join(' · '), at: r.at, url: '38_lost_pet_network.html?case=found-' + r.id }));
      if (Object.keys(await cols('pet_sightings')).length) (await query(`SELECT id::text AS id, case_type, case_id::text AS case_id, area, created_at AS at FROM pet_sightings WHERE user_id::text = $1 AND created_at < $2::timestamptz ORDER BY created_at DESC LIMIT ${lim}`, [M.id, before])).rows
        .forEach(r => out.push({ key: 'sight:' + r.id, cat: 'lost', icon: 'eye', title: 'You shared a sighting', detail: r.area, at: r.at, url: '38_lost_pet_network.html?case=' + r.case_type + '-' + r.case_id }));
      return out; }),
    run('care2', ['care'], async () => { if (!pids.length) return []; const out = [];
      (await query(`SELECT log_id::text AS id, pet_id, value::float AS kg, created_at AS at FROM pet_health_logs WHERE pet_id = ANY($1) AND kind = 'weight' AND created_at < $2::timestamptz ORDER BY created_at DESC LIMIT ${lim}`, [pids, before])).rows
        .forEach(r => out.push({ key: 'w:' + r.id, cat: 'care', icon: 'scale', title: (pname[r.pet_id] || 'Your pet') + ' weighed ' + r.kg + ' kg', at: r.at, pet_id: String(r.pet_id), url: '36_pet_life_record.html?pet=' + r.pet_id }));
      if (Object.keys(await cols('pet_medicines')).length) (await query(`SELECT med_id::text AS id, pet_id, name, dose, created_at AS at FROM pet_medicines WHERE pet_id = ANY($1) AND created_at < $2::timestamptz ORDER BY created_at DESC LIMIT ${lim}`, [pids, before])).rows
        .forEach(r => out.push({ key: 'med:' + r.id, cat: 'care', icon: 'pill', title: (pname[r.pet_id] || 'Your pet') + ' — started ' + r.name, detail: r.dose || null, at: r.at, pet_id: String(r.pet_id), url: '36_pet_life_record.html?pet=' + r.pet_id }));
      const ps = pids.map(String);
      if (Object.keys(await cols('pb_pet_vitals')).length) (await query(`SELECT id::text AS id, pet_id, heart_rate, resp_rate, temp_f, created_at AS at FROM pb_pet_vitals WHERE pet_id = ANY($1) AND user_id::text = $3 AND created_at < $2::timestamptz ORDER BY created_at DESC LIMIT ${lim}`, [ps, before, M.id])).rows
        .forEach(r => out.push({ key: 'vit:' + r.id, cat: 'care', icon: 'heart-rate-monitor', title: 'You logged ' + (pname[r.pet_id] || 'your pet') + '\'s vitals', detail: [r.heart_rate ? 'Heart ' + r.heart_rate + '/min' : null, r.resp_rate ? 'Breathing ' + r.resp_rate + '/min' : null, r.temp_f ? r.temp_f + '°F' : null].filter(Boolean).join(' · ') || null, at: r.at, pet_id: String(r.pet_id), url: '37_pet_ai_health_agent.html?pet=' + r.pet_id + '&tab=vitals' }));
      if (Object.keys(await cols('pb_symptom_checks')).length) (await query(`SELECT id::text AS id, pet_id, level, created_at AS at FROM pb_symptom_checks WHERE pet_id = ANY($1) AND user_id::text = $3 AND created_at < $2::timestamptz ORDER BY created_at DESC LIMIT ${lim}`, [ps, before, M.id])).rows
        .forEach(r => out.push({ key: 'chk:' + r.id, cat: 'care', icon: 'stethoscope', title: 'You checked ' + (pname[r.pet_id] || 'your pet') + '\'s symptoms', detail: { emergency: 'Advice: see a vet now', urgent: 'Advice: vet within 24 hours', monitor: 'Advice: watch closely', mild: 'Advice: home care' }[r.level] || null, at: r.at, pet_id: String(r.pet_id), url: '37_pet_ai_health_agent.html?pet=' + r.pet_id + '&tab=history' }));
      return out; }),
    run('media', ['photos'], async () => {
      const { rows } = await query(`SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, COUNT(*)::int AS n, MAX(created_at) AS at, (ARRAY_AGG(COALESCE(thumbnail_url, url) ORDER BY created_at DESC))[1] AS img FROM media WHERE user_id::text = $1 AND ${W('created_at', 2)} GROUP BY 1 ORDER BY 3 DESC LIMIT ${lim}`, [M.id, before]);
      return rows.map(r => ({ key: 'med:' + r.day, cat: 'photos', icon: 'photo', title: 'You uploaded ' + r.n + ' photo' + (r.n > 1 ? 's' : '') + ' to your gallery', image: httpsUrl(r.img) ? r.img : null, at: r.at, url: '32_gallery.html' })); }),
    run('log', ['social', 'photos', 'saved', 'community'], async () => {
      const { rows } = await query(`SELECT activity_id::text AS id, action_type, target_label, created_at AS at FROM activity_log WHERE user_id::text = $1 AND ${W('created_at', 2)} ORDER BY created_at DESC LIMIT ${lim}`, [M.id, before]);
      const map = { like: ['social', 'heart'], comment: ['social', 'message-circle'], follow: ['social', 'user-plus'], post: ['photos', 'camera'], save: ['saved', 'bookmark'], join: ['community', 'users-group'] };
      return rows.map(r => { const m = map[String(r.action_type).toLowerCase()] || ['social', 'paw']; return { key: 'al:' + r.id, cat: m[0], icon: m[1], title: r.target_label || cap(String(r.action_type).replace(/_/g, ' ')), at: r.at }; }); })
  ]);
  lists.forEach(l => l.forEach(x => { if (want(x.cat)) out.push(Object.assign(x, { at: iso(x.at) })); }));
  return out.filter(x => x.at);
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
// GET /mypawbook/journey?cat=&pet=&from=&to=&q=&before=
exports.journey = async (req, res) => {
  try {
    const M = await me(req), qq = req.query, cat = CATS.includes(qq.cat) ? qq.cat : '';
    let before = qq.before && !isNaN(Date.parse(qq.before)) ? new Date(qq.before).toISOString() : new Date(Date.now() + 60000).toISOString();
    const to = DATE_RX.test(qq.to || '') ? new Date(Date.parse(qq.to + 'T23:59:59+05:30')).toISOString() : null; if (to && to < before) before = to;
    const from = DATE_RX.test(qq.from || '') ? new Date(Date.parse(qq.from + 'T00:00:00+05:30')).toISOString() : null;
    const s = str(qq.q, 60).toLowerCase(), pet = str(qq.pet, 40), page = 40;
    const [items, hid, pref] = await Promise.all([journeyItems(M, { cat, before, limit: s || pet ? 200 : 60 }),
      query(`SELECT ikey FROM pb_journey_hidden WHERE user_id::text = $1`, [M.id]), query(`SELECT cleared_before FROM pb_journey_prefs WHERE user_id::text = $1`, [M.id])]);
    const H = new Set(hid.rows.map(r => r.ikey)), cleared = pref.rows[0] && pref.rows[0].cleared_before ? iso(pref.rows[0].cleared_before) : null;
    let list = items.filter(x => !H.has(x.key) && (!cleared || x.at > cleared) && (!from || x.at >= from) && (!pet || x.pet_id === pet) && (!s || (x.title + ' ' + (x.detail || '')).toLowerCase().includes(s)));
    const seen = new Set(); list = list.filter(x => (seen.has(x.key) ? false : seen.add(x.key)));
    list.sort((a, b) => b.at.localeCompare(a.at));
    const more = list.length > page; list = list.slice(0, page);
    const counts = {}; if (!qq.before) items.forEach(x => { if (!H.has(x.key) && (!cleared || x.at > cleared)) counts[x.cat] = (counts[x.cat] || 0) + 1; });
    return R.ok(res, { items: list, next_before: more ? list[list.length - 1].at : null, counts: qq.before ? null : counts, cleared_before: cleared });
  } catch (e) { return fail(res, 'journey', e); }
};
// POST /mypawbook/journey/hide {key} · POST /journey/clear · DELETE /journey/clear
exports.hideJourney = async (req, res) => {
  try { const M = await me(req), key = str((req.body || {}).key, 80); if (!key) return bad(res, ['key']);
    await query(`INSERT INTO pb_journey_hidden (user_id, ikey) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [M.id, key]); return R.ok(res, { hidden: true }); }
  catch (e) { return fail(res, 'hideJourney', e); }
};
exports.clearJourney = async (req, res) => {
  try { const M = await me(req), undo = req.method === 'DELETE';
    await query(`INSERT INTO pb_journey_prefs (user_id, cleared_before) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET cleared_before = $2, updated_at = NOW()`, [M.id, undo ? null : new Date()]);
    if (undo) await query(`DELETE FROM pb_journey_hidden WHERE user_id::text = $1`, [M.id]);
    return R.ok(res, { cleared: !undo }); }
  catch (e) { return fail(res, 'clearJourney', e); }
};
// GET /mypawbook/journey/export  — everything, as JSON (the page turns it into a CSV/JSON download)
exports.exportJourney = async (req, res) => {
  try {
    const M = await me(req), items = await journeyItems(M, { cat: '', before: new Date(Date.now() + 60000).toISOString(), limit: 2000 });
    items.sort((a, b) => b.at.localeCompare(a.at));
    return R.ok(res, { exported_at: new Date().toISOString(), items: items.map(x => ({ when: x.at, category: x.cat, what: x.title, detail: x.detail || '', link: x.url || '' })) });
  } catch (e) { return fail(res, 'exportJourney', e); }
};

/* ═══════════════════════════════ PAW CELEBRATIONS ═══════════════════════════════ */
function nextOccurrence(date, today) {   // next yyyy-mm-dd on/after today for the month-day of `date` (29 Feb → 28 Feb in other years)
  const y = +today.slice(0, 4), md = date.slice(5);
  const mk = yy => { let s = yy + '-' + md; if (md === '02-29' && !((yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0)) s = yy + '-02-28'; return s; };
  const t = mk(y); return t >= today ? t : mk(y + 1);
}
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
async function notify(userId, title, body, link, emoji) {
  await safe('notify', () => query(`INSERT INTO notifications (user_id, type, title, body, link_url, icon_emoji) VALUES ($1,'system',$2,$3,$4,$5)`, [userId, title.slice(0, 200), body || null, link || null, emoji || '🎂']), null);
}
// birthday reminders for the user's own pets (sent when they use PawBook; once per year each)
async function birthdayReminders(M, pets) {
  if (!pets.length) return;
  const today = todayIST(), ms = await milestones(pets.map(p => p.id));
  for (const p of pets) {
    const m = ms[p.id]; if (!m) continue;
    const b = m.birth_precision !== 'unknown' ? d10(m.birth_date) : null; if (!b) continue;
    const nx = nextOccurrence(b, today), d = daysBetween(today, nx), yr = +nx.slice(0, 4);
    if (d === 0 && m.remind_day && m.day_reminded !== yr) { await query(`UPDATE pb_pet_milestones SET day_reminded = $2 WHERE pet_id = $1`, [p.id, yr]); await notify(M.id, 'Happy birthday, ' + p.name + '! 🎉', 'Celebrate with a birthday card or a memory.', '31_saved.html?tab=celebrations', '🎂'); }
    else if (d > 0 && d <= 7 && m.remind_week && m.week_reminded !== yr) { await query(`UPDATE pb_pet_milestones SET week_reminded = $2 WHERE pet_id = $1`, [p.id, yr]); await notify(M.id, p.name + "'s birthday is " + (d === 1 ? 'tomorrow' : 'in ' + d + ' days'), 'Plan a little celebration 🎈', '31_saved.html?tab=celebrations', '🎈'); }
  }
}
// GET /mypawbook/celebrations
exports.celebrations = async (req, res) => {
  try {
    const M = await me(req), { P, pets } = await myPets(M), today = todayIST(), year = +today.slice(0, 4);
    await safe('reminders', () => birthdayReminders(M, pets), null);
    const ms = await milestones(pets.map(p => p.id));
    const entries = [];
    const mine = pets.map(p => {
      const m = ms[p.id] || {}, b = m.birth_precision && m.birth_precision !== 'unknown' ? d10(m.birth_date) : null, g = d10(m.gotcha_date);
      const o = { id: p.id, name: p.name, species: p.species, breed: p.breed, photo: p.photo, birth_date: b, birth_precision: m.birth_precision || 'unknown', gotcha_date: g, gotcha_kind: m.gotcha_kind || 'home',
        share_birthday: m.share_birthday !== false, remind_week: m.remind_week !== false, remind_day: m.remind_day !== false, wishes_notify: m.wishes_notify !== false };
      if (b) { const nx = nextOccurrence(b, today); o.next_birthday = nx; o.days_until = daysBetween(today, nx); o.turning = +nx.slice(0, 4) - +b.slice(0, 4); entries.push({ type: 'birthday', mine: true, pet_id: p.id, name: p.name, photo: p.photo, species: p.species, date: nx, days: o.days_until, turning: o.turning, estimated: o.birth_precision === 'estimated' }); }
      if (g) { const nx = nextOccurrence(g, today), yrs = +nx.slice(0, 4) - +g.slice(0, 4); if (yrs > 0) entries.push({ type: o.gotcha_kind === 'adoption' ? 'adoption' : 'gotcha', mine: true, pet_id: p.id, name: p.name, photo: p.photo, species: p.species, date: nx, days: daysBetween(today, nx), years: yrs }); }
      return o;
    });
    // pets of people I follow who share their birthday (day and month only)
    await safe('friends', async () => {
      if (!M.no || !P.id || !P.owner) return;
      const u = await cols('users');
      const { rows } = await query(`SELECT p.*, m.birth_date AS m_birth, ${u.user_no !== undefined ? '(SELECT full_name FROM users ou WHERE ou.user_no::text = p.' + q(P.owner) + '::text LIMIT 1)' : 'NULL'} AS owner_name,
          (SELECT 1 FROM pb_birthday_wishes w WHERE w.pet_id = m.pet_id AND w.from_user::text = $2 AND w.year = $3) AS wished
        FROM pb_pet_milestones m JOIN pets p ON p.${q(P.id)}::text = m.pet_id
        WHERE m.share_birthday AND m.birth_precision <> 'unknown' AND m.birth_date IS NOT NULL AND p.${q(P.owner)}::text IN (SELECT following_id::text FROM follows WHERE follower_id::text = ANY($1)) LIMIT 500`, [M.ids, M.id, year]);
      rows.forEach(r => { const pt = normPet(P, r), nx = nextOccurrence(d10(r.m_birth), today); entries.push({ type: 'birthday', mine: false, pet_id: pt.id, name: pt.name, photo: pt.photo, species: pt.species, breed: pt.breed, owner: r.owner_name || null, date: nx, days: daysBetween(today, nx), wished: !!r.wished }); });
    });
    entries.sort((a, b) => a.days - b.days || (a.mine ? -1 : 1));
    const ids = pets.map(p => p.id);
    const wishes = ids.length ? (await query(`SELECT w.wish_id::text AS id, w.pet_id, w.message, w.created_at, u.full_name AS from_name, u.avatar_url FROM pb_birthday_wishes w LEFT JOIN users u ON u.user_id = w.from_user WHERE w.pet_id = ANY($1) AND w.year = $2 ORDER BY w.created_at DESC LIMIT 200`, [ids, year])).rows
      .map(r => ({ id: r.id, pet_id: r.pet_id, message: r.message, at: iso(r.created_at), from: r.from_name || 'A PawBook friend', avatar: httpsUrl(r.avatar_url) ? r.avatar_url : null })) : [];
    return R.ok(res, { today, pets: mine, today_list: entries.filter(e => e.days === 0), upcoming: entries.filter(e => e.days > 0 && e.days <= 60), calendar: entries, wishes });
  } catch (e) { return fail(res, 'celebrations', e); }
};
// PUT /mypawbook/celebrations/pets/:id
exports.setMilestones = async (req, res) => {
  try {
    const M = await me(req), pet = await ownPet(M, req.params.id); if (!pet) return R.notFound(res, 'Pet not found');
    const b = req.body || {}, e = [], t = todayIST();
    const prec = ['exact', 'estimated', 'unknown'].includes(b.birth_precision) ? b.birth_precision : 'unknown';
    const bd = prec === 'unknown' ? null : str(b.birth_date, 10); if (prec !== 'unknown' && (!DATE_RX.test(bd) || bd > t || bd < '1980-01-01' || isNaN(Date.parse(bd)))) e.push('birth_date');
    const gd = str(b.gotcha_date, 10) || null; if (gd && (!DATE_RX.test(gd) || gd > t || gd < '1980-01-01' || isNaN(Date.parse(gd)) || (bd && gd < bd))) e.push('gotcha_date');
    if (e.length) return bad(res, e);
    const bool = (k, d) => (typeof b[k] === 'boolean' ? b[k] : d);
    await query(`INSERT INTO pb_pet_milestones (pet_id, owner_id, birth_date, birth_precision, gotcha_date, gotcha_kind, share_birthday, remind_week, remind_day, wishes_notify)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (pet_id) DO UPDATE SET owner_id = $2, birth_date = $3, birth_precision = $4, gotcha_date = $5, gotcha_kind = $6, share_birthday = $7, remind_week = $8, remind_day = $9, wishes_notify = $10,
        week_reminded = CASE WHEN pb_pet_milestones.birth_date IS DISTINCT FROM $3 THEN NULL ELSE pb_pet_milestones.week_reminded END, day_reminded = CASE WHEN pb_pet_milestones.birth_date IS DISTINCT FROM $3 THEN NULL ELSE pb_pet_milestones.day_reminded END, updated_at = NOW()`,
      [pet.id, M.id, bd, prec, gd, b.gotcha_kind === 'adoption' ? 'adoption' : 'home', bool('share_birthday', true), bool('remind_week', true), bool('remind_day', true), bool('wishes_notify', true)]);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'setMilestones', e); }
};
// POST /mypawbook/celebrations/wish {pet_id, message}
exports.wish = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, petId = str(b.pet_id, 40), msg = str(b.message, 300), year = +todayIST().slice(0, 4);
    if (msg.length < 2) return bad(res, ['message'], 'Please write a short wish');
    const P = await petCols();
    const { rows } = await query(`SELECT p.*, p.${q(P.owner)}::text AS owner_ref, m.share_birthday, m.birth_precision, m.wishes_notify, m.owner_id FROM pets p JOIN pb_pet_milestones m ON m.pet_id = p.${q(P.id)}::text WHERE p.${q(P.id)}::text = $1`, [petId]);
    if (!rows.length) return R.notFound(res, 'Pet not found');
    const r = rows[0], mine = M.ids.includes(r.owner_ref);
    let allowed = mine;
    if (!allowed && r.share_birthday && r.birth_precision !== 'unknown' && M.no) { const { rows: f } = await query(`SELECT 1 FROM follows WHERE follower_id::text = ANY($1) AND following_id::text = $2`, [M.ids, r.owner_ref]); allowed = f.length > 0; }
    if (!allowed) return R.notFound(res, 'Pet not found');
    try { await query(`INSERT INTO pb_birthday_wishes (pet_id, from_user, year, message) VALUES ($1,$2,$3,$4)`, [petId, M.id, year, msg]); }
    catch (x) { if (x.code === '23505') return conflict(res, 'You already sent a wish this year 🎂'); throw x; }
    if (!mine && r.wishes_notify !== false && r.owner_id) await notify(r.owner_id, (M.name || 'A friend') + ' sent ' + (r[P.name] || 'your pet') + ' a birthday wish 🎂', clip(msg, 140), '31_saved.html?tab=celebrations', '🎁');
    return R.created(res, { sent: true });
  } catch (e) { return fail(res, 'wish', e); }
};
