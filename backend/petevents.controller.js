'use strict';
/* ============================================================================
   PawBook Events 2.0 (page 30) — pet festivals, meetups, adoption drives, vet camps,
   shows, training workshops and online events.
   Uses the existing tables: events (core record), event_attendees ("interested"/"going",
   used by the older /events API) and adds (migration 014):
     pet_event_details (category, location, fees, programme, moderation…),
     pet_event_registrations (capacity, waitlist, payments), pet_event_reports.
   Fees: pay at venue (host marks paid) and/or online through Razorpay
   (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env; online is hidden until both are set).
   Moderation: a host's first event waits for an admin; after one approved event, the
   host's next events go live at once. Anyone can report an event.
   Mounted under /api/v1/petevents (see add_shop_routes.js).
   ========================================================================== */
const crypto = require('crypto');
const https = require('https');
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = u => String(u.user_id);
const fail = (res, where, e) => { console.error('[Events] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const conflict = (res, msg) => res.status(409).json({ success: false, message: msg });
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DT_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CATS = ['meetup', 'adoption', 'vet', 'show', 'training', 'online'];
const SPECIES = ['dog', 'cat', 'bird', 'rabbit', 'other'];
const AGES = ['all', 'young', 'adult', 'senior'];
const HOLD_MIN = 15;
const nowIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16);   // "YYYY-MM-DDTHH:MM" India time
const httpsUrl = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 500;

// category-specific fields (kept in pet_event_details.meta)
const META = {
  meetup: { breed_focus: 's', meeting_point: 's', activity_level: ['calm', 'moderate', 'active'] },
  adoption: { organiser_type: ['shelter', 'rescue', 'ngo', 'individual'], shelter_name: 's', animals_count: 'n', adoption_process: 's', documents_needed: 's' },
  vet: { clinic_name: 's', vet_name: 's', services: 'a', free_services: 's', slots_note: 's' },
  show: { competition_categories: 'a', prizes: 's', judges: 's', entry_deadline: 'd' },
  training: { trainer_name: 's', trainer_credentials: 's', duration: 's', sessions: 'n', batch_size: 'n', level: ['beginner', 'intermediate', 'advanced'] },
  online: { platform: ['zoom', 'meet', 'youtube', 'teams', 'other'], recording: 'b' }
};
function cleanMeta(cat, m) {
  const spec = META[cat] || {}, out = {}; m = m && typeof m === 'object' ? m : {};
  Object.keys(spec).forEach(k => {
    const t = spec[k], v = m[k]; if (v == null || v === '') return;
    if (Array.isArray(t)) { if (t.includes(v)) out[k] = v; }
    else if (t === 's') { const x = str(v, 300); if (x) out[k] = x; }
    else if (t === 'n') { const x = parseInt(v, 10); if (x > 0 && x < 100000) out[k] = x; }
    else if (t === 'b') out[k] = v === true || v === 'true' || v === 1;
    else if (t === 'd') { const x = str(v, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(x)) out[k] = x; }
    else if (t === 'a') { const a = (Array.isArray(v) ? v : String(v).split(',')).map(x => str(x, 80)).filter(Boolean).slice(0, 20); if (a.length) out[k] = a; }
  });
  return out;
}
async function isAdmin(user) {
  const { rows } = await query(`SELECT role FROM users WHERE user_id::text = $1`, [uid(user)]);
  return !!rows.length && rows[0].role === 'admin';
}
const rzpKeys = () => (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET } : null);
function rzpOrder(amountPaise, receipt) {
  const k = rzpKeys();
  if (process.env.PB_RZP_MOCK === '1') return Promise.resolve({ id: 'order_' + crypto.randomBytes(7).toString('hex'), amount: amountPaise, currency: 'INR' });
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, payment_capture: 1 });
    const rq = https.request({ hostname: 'api.razorpay.com', path: '/v1/orders', method: 'POST', timeout: 10000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: 'Basic ' + Buffer.from(k.id + ':' + k.secret).toString('base64') } }, r => {
      let d = ''; r.on('data', c => { d += c; }); r.on('end', () => { try { const j = JSON.parse(d); if (r.statusCode >= 300 || !j.id) return reject(new Error('Razorpay ' + r.statusCode + ' ' + (j.error && j.error.description || ''))); resolve(j); } catch (e) { reject(e); } });
    });
    rq.on('timeout', () => rq.destroy(new Error('Razorpay timeout'))); rq.on('error', reject); rq.write(body); rq.end();
  });
}

// ── shapes ───────────────────────────────────────────────────────────────────
const LOCAL = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); if (isNaN(d)) return null; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const BASE_SQL = `SELECT e.event_id::text AS id, e.user_id::text AS host_id, e.title, e.description, e.event_date, e.location, e.cover_image, e.max_attendees, e.status, e.created_at, d.*,
    hu.full_name AS host_user_name, hu.avatar_url AS host_avatar,
    COALESCE((SELECT SUM(r.people) FROM pet_event_registrations r WHERE r.event_id = e.event_id AND (r.status IN ('registered','checked_in') OR (r.status = 'pending_payment' AND r.hold_until > NOW()))), 0)::int AS taken,
    (SELECT COUNT(*) FROM pet_event_registrations r WHERE r.event_id = e.event_id AND r.status = 'waitlisted')::int AS waitlist,
    (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.event_id AND a.status = 'interested')::int AS interested,
    EXISTS (SELECT 1 FROM vets v WHERE v.user_id = e.user_id AND v.status = 'active') AS host_is_vet,
    EXISTS (SELECT 1 FROM pet_event_details d2 JOIN events e2 ON e2.event_id = d2.event_id WHERE e2.user_id = e.user_id AND d2.moderation = 'approved' AND e2.event_id <> e.event_id) AS host_trusted
  FROM events e JOIN pet_event_details d ON d.event_id = e.event_id LEFT JOIN users hu ON hu.user_id = e.user_id`;
function evOut(r, extra) {
  const cap = r.max_attendees || null;
  const o = {
    id: r.id, title: r.title, description: r.description, category: r.category, subtype: r.subtype,
    starts: LOCAL(r.event_date), ends: LOCAL(r.ends_at), online: r.is_online, venue: r.venue || r.location || null,
    city: r.city, state: r.state, country: r.country, lat: r.lat != null ? Number(r.lat) : null, lng: r.lng != null ? Number(r.lng) : null,
    species: r.species || [], age_group: r.age_group, fee: Number(r.fee_amount || 0), fee_mode: r.fee_mode,
    cover: httpsUrl(r.cover_image) ? r.cover_image : null, photos: (r.photos || []).filter(httpsUrl),
    capacity: cap, taken: r.taken, spots_left: cap ? Math.max(0, cap - r.taken) : null, waitlist: r.waitlist, interested: r.interested, allow_waitlist: r.allow_waitlist,
    host: { id: r.host_id, name: r.host_name || r.host_user_name || 'PawBook member', avatar: httpsUrl(r.host_avatar) ? r.host_avatar : null, verified: !!(r.host_is_vet || r.host_trusted), vet: !!r.host_is_vet },
    status: r.status === 'cancelled' ? 'cancelled' : 'active', moderation: r.moderation, meta: r.meta || {}, distance_km: r.dist != null ? Math.round(Number(r.dist) * 10) / 10 : null
  };
  return Object.assign(o, extra || {});
}
function detailOut(r) {
  return { programme: Array.isArray(r.programme) ? r.programme : [], requirements: r.requirements, eligibility: r.eligibility, safety: r.safety, cancellation: r.cancellation, host_about: r.host_about };
}

// ── GET /petevents/config ────────────────────────────────────────────────────
exports.config = async (req, res) => {
  try { const k = rzpKeys(); return R.ok(res, { online_payments: !!k, razorpay_key_id: k ? k.id : null, admin: await isAdmin(req.user) }); }
  catch (e) { return fail(res, 'config', e); }
};

// ── GET /petevents  (discovery) ──────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const q = req.query, w = [`e.status IS DISTINCT FROM 'cancelled'`, `e.status IS DISTINCT FROM 'deleted'`, `d.moderation = 'approved'`], p = [];
    const add = (sql, v) => { p.push(v); w.push(sql.replace(/\$\?/g, '$' + p.length)); };
    const now = nowIST();
    add(`COALESCE(d.ends_at, e.event_date) >= $?::timestamp`, now.replace('T', ' '));
    if (CATS.includes(q.category)) add(`d.category = $?`, q.category);
    if (str(q.country, 60)) add(`lower(d.country) = lower($?)`, str(q.country, 60));
    if (str(q.state, 80)) add(`lower(d.state) = lower($?)`, str(q.state, 80));
    if (str(q.city, 80)) add(`(lower(d.city) = lower($?) OR d.is_online)`, str(q.city, 80));
    if (SPECIES.includes(q.species)) add(`(cardinality(d.species) = 0 OR $? = ANY(d.species))`, q.species);
    if (AGES.includes(q.age) && q.age !== 'all') add(`(d.age_group = 'all' OR d.age_group = $?)`, q.age);
    if (q.price === 'free') w.push(`d.fee_amount = 0`); if (q.price === 'paid') w.push(`d.fee_amount > 0`);
    if (q.mode === 'online') w.push(`d.is_online`); if (q.mode === 'offline') w.push(`NOT d.is_online`);
    const today = now.slice(0, 10), dow = new Date(today + 'T00:00:00Z').getUTCDay();
    const plus = n => { const x = new Date(today + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const win = { today: [today, today], tomorrow: [plus(1), plus(1)], week: [today, plus(6)], weekend: dow === 0 ? [today, today] : [plus(6 - dow), plus(7 - dow)], month: [today, plus(30)] }[q.when];
    if (win) { add(`e.event_date::date >= $?::date`, win[0]); add(`e.event_date::date <= $?::date`, win[1]); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.date || '')) add(`e.event_date::date = $?::date`, q.date);
    const s = str(q.q, 80).toLowerCase(); if (s) { p.push(s); const i = '$' + p.length; w.push(`(lower(e.title) LIKE '%' || ${i} || '%' OR lower(COALESCE(d.subtype,'')) LIKE '%' || ${i} || '%' OR lower(COALESCE(d.venue,'')) LIKE '%' || ${i} || '%' OR lower(COALESCE(d.city,'')) LIKE '%' || ${i} || '%')`); }
    let dist = 'NULL::float';
    const lat = parseFloat(q.lat), lng = parseFloat(q.lng), km = parseFloat(q.km);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      p.push(lat, lng); const a = '$' + (p.length - 1), b = '$' + p.length;
      dist = `CASE WHEN d.lat IS NULL THEN NULL ELSE 6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(d.lat - ${a}) / 2), 2) + COS(RADIANS(${a})) * COS(RADIANS(d.lat)) * POWER(SIN(RADIANS(d.lng - ${b}) / 2), 2))) END`;
      if (km > 0 && km <= 500) { p.push(km); w.push(`(d.is_online OR (${dist}) <= $${p.length})`); }
    }
    const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 120));
    const { rows } = await query(`SELECT * FROM (${BASE_SQL.replace('SELECT e.event_id', `SELECT ${dist} AS dist, e.event_id`)} WHERE ${w.join(' AND ')}) x ORDER BY event_date ASC LIMIT ${limit}`, p);
    // my interest / registration, in one query
    const ids = rows.map(r => r.id); let mine = {};
    if (ids.length) {
      const { rows: m } = await query(`SELECT event_id::text AS id, (SELECT status FROM event_attendees a WHERE a.event_id = x.event_id AND a.user_id::text = $2) AS att,
        (SELECT status FROM pet_event_registrations r WHERE r.event_id = x.event_id AND r.user_id::text = $2 AND r.status <> 'cancelled' LIMIT 1) AS reg FROM events x WHERE x.event_id::text = ANY($1)`, [ids, uid(req.user)]);
      m.forEach(x => { mine[x.id] = x; });
    }
    const stats = await query(`SELECT COUNT(*)::int AS events, COUNT(DISTINCT lower(d.city)) FILTER (WHERE NOT d.is_online AND d.city IS NOT NULL)::int AS cities,
      COALESCE((SELECT COUNT(DISTINCT r.user_id) FROM pet_event_registrations r WHERE r.status IN ('registered','checked_in')), 0)::int AS parents
      FROM events e JOIN pet_event_details d ON d.event_id = e.event_id WHERE d.moderation = 'approved' AND e.status IS DISTINCT FROM 'cancelled' AND COALESCE(d.ends_at, e.event_date) >= $1::timestamp`, [now.replace('T', ' ')]);
    return R.ok(res, { events: rows.map(r => evOut(r, { interested_by_me: (mine[r.id] || {}).att === 'interested', my_registration: (mine[r.id] || {}).reg || null })), stats: stats.rows[0] });
  } catch (e) { return fail(res, 'list', e); }
};

// ── GET /petevents/mine ──────────────────────────────────────────────────────
exports.mine = async (req, res) => {
  try {
    const me = uid(req.user), now = nowIST().replace('T', ' ');
    const [regR, hostR] = await Promise.all([
      query(`${BASE_SQL.replace('SELECT e.event_id', 'SELECT r0.reg_id::text AS reg_id, r0.status AS reg_status, r0.payment AS reg_payment, r0.people AS reg_people, e.event_id')} JOIN pet_event_registrations r0 ON r0.event_id = e.event_id
        WHERE r0.user_id::text = $1 AND r0.status <> 'cancelled' ORDER BY e.event_date`, [me]),
      query(`${BASE_SQL} WHERE e.user_id::text = $1 AND e.status IS DISTINCT FROM 'deleted' ORDER BY e.event_date DESC LIMIT 100`, [me])
    ]);
    const isPast = r => LOCAL(r.ends_at || r.event_date) < now.replace(' ', 'T');
    const reg = regR.rows.map(r => evOut(r, { registration: { id: r.reg_id, status: r.reg_status, payment: r.reg_payment, people: r.reg_people } }));
    return R.ok(res, { upcoming: reg.filter((x, i) => !isPast(regR.rows[i])), past: reg.filter((x, i) => isPast(regR.rows[i])).reverse(), hosting: hostR.rows.map(r => evOut(r)) });
  } catch (e) { return fail(res, 'mine', e); }
};

// ── GET /petevents/:id ───────────────────────────────────────────────────────
exports.detail = async (req, res) => {
  try {
    const id = str(req.params.id, 40); if (!UUID_RX.test(id)) return R.notFound(res, 'Event not found');
    const { rows } = await query(`${BASE_SQL} WHERE e.event_id::text = $1 AND e.status IS DISTINCT FROM 'deleted'`, [id]);
    if (!rows.length) return R.notFound(res, 'Event not found');
    const r = rows[0], me = uid(req.user), host = r.host_id === me, admin = await isAdmin(req.user);
    if (r.moderation !== 'approved' && !host && !admin) return R.notFound(res, 'Event not found');
    const [mr, att, sim] = await Promise.all([
      query(`SELECT reg_id::text AS id, status, payment, people, pets, amount, rzp_order_id, hold_until FROM pet_event_registrations WHERE event_id::text = $1 AND user_id::text = $2 AND status <> 'cancelled' LIMIT 1`, [id, me]),
      query(`SELECT status FROM event_attendees WHERE event_id::text = $1 AND user_id::text = $2`, [id, me]),
      query(`${BASE_SQL} WHERE d.category = $1 AND e.event_id::text <> $2 AND d.moderation = 'approved' AND e.status IS DISTINCT FROM 'cancelled' AND e.event_date >= $3::timestamp AND (d.is_online OR lower(COALESCE(d.city,'')) = lower($4)) ORDER BY e.event_date LIMIT 3`, [r.category, id, nowIST().replace('T', ' '), r.city || ''])
    ]);
    const reg = mr.rows[0] || null;
    let pos = null; if (reg && reg.status === 'waitlisted') { const { rows: p } = await query(`SELECT COUNT(*)::int AS n FROM pet_event_registrations WHERE event_id::text = $1 AND status = 'waitlisted' AND reg_id <= $2`, [id, reg.id]); pos = p[0].n; }
    const out = evOut(r, Object.assign(detailOut(r), {
      is_host: host, is_admin: admin, interested_by_me: (att.rows[0] || {}).status === 'interested',
      my_registration: reg ? { id: reg.id, status: reg.status, payment: reg.payment, people: reg.people, pets: reg.pets, amount: Number(reg.amount), waitlist_position: pos, order_id: reg.status === 'pending_payment' ? reg.rzp_order_id : null } : null,
      online_url: (host || (reg && ['registered', 'checked_in'].includes(reg.status))) && httpsUrl(r.online_url) ? r.online_url : null,
      host_phone: host || (reg && ['registered', 'checked_in'].includes(reg.status)) ? r.host_phone : null,
      moderation_note: host ? r.moderation_note : undefined, similar: sim.rows.map(x => evOut(x))
    }));
    return R.ok(res, { event: out });
  } catch (e) { return fail(res, 'detail', e); }
};

// ── create / edit ────────────────────────────────────────────────────────────
function readEvent(b, partial) {
  const e = [], v = {};
  const has = k => !partial || b[k] !== undefined;
  if (has('category')) { v.category = str(b.category, 20); if (!CATS.includes(v.category)) e.push('category'); }
  if (has('title')) { v.title = str(b.title, 140); if (v.title.length < 5) e.push('title'); }
  if (has('description')) { v.description = str(b.description, 5000); if (v.description.length < 20) e.push('description'); }
  if (has('starts')) { v.starts = str(b.starts, 16); if (!DT_RX.test(v.starts) || isNaN(Date.parse(v.starts + ':00Z')) || v.starts < nowIST()) e.push('starts'); }
  if (has('ends')) { v.ends = str(b.ends, 16) || null; if (v.ends && (!DT_RX.test(v.ends) || (v.starts && v.ends <= v.starts))) e.push('ends'); }
  if (has('online')) v.online = b.online === true || b.online === 'true' || (v.category || b.category) === 'online';
  if (has('online_url')) { v.online_url = str(b.online_url, 500) || null; if (v.online_url && !httpsUrl(v.online_url)) e.push('online_url'); }
  ['venue:200', 'country:60', 'state:80', 'city:80', 'subtype:60', 'requirements:2000', 'eligibility:1000', 'safety:2000', 'cancellation:1000', 'host_name:120', 'host_about:1000', 'host_phone:30'].forEach(x => { const [k, n] = x.split(':'); if (has(k)) v[k] = str(b[k], +n) || null; });
  if (has('lat') || has('lng')) { const la = parseFloat(b.lat), lo = parseFloat(b.lng); v.lat = isFinite(la) && Math.abs(la) <= 90 ? la : null; v.lng = isFinite(lo) && Math.abs(lo) <= 180 ? lo : null; if (v.lat == null || v.lng == null) { v.lat = null; v.lng = null; } }
  if (has('species')) v.species = (Array.isArray(b.species) ? b.species : []).filter(s => SPECIES.includes(s)).slice(0, 5);
  if (has('age_group')) { v.age_group = AGES.includes(b.age_group) ? b.age_group : 'all'; }
  if (has('fee_amount')) { v.fee_amount = b.fee_amount === '' || b.fee_amount == null ? 0 : Number(b.fee_amount); if (!(v.fee_amount >= 0 && v.fee_amount <= 100000)) e.push('fee_amount'); v.fee_amount = Math.round(v.fee_amount * 100) / 100; }
  if (has('fee_mode')) { v.fee_mode = ['free', 'venue', 'online', 'both'].includes(b.fee_mode) ? b.fee_mode : 'free'; }
  if (has('capacity')) { v.capacity = b.capacity === '' || b.capacity == null ? null : parseInt(b.capacity, 10); if (v.capacity != null && !(v.capacity >= 1 && v.capacity <= 100000)) e.push('capacity'); }
  if (has('allow_waitlist')) v.allow_waitlist = b.allow_waitlist !== false && b.allow_waitlist !== 'false';
  if (has('programme')) v.programme = (Array.isArray(b.programme) ? b.programme : []).slice(0, 30).map(x => ({ time: str(x && x.time, 20), title: str(x && x.title, 160) })).filter(x => x.title);
  if (has('cover')) { v.cover = str(b.cover, 500) || null; if (v.cover && !httpsUrl(v.cover)) e.push('cover'); }
  if (has('photos')) v.photos = (Array.isArray(b.photos) ? b.photos : []).filter(httpsUrl).slice(0, 8);
  if (has('meta')) v.meta = b.meta;
  return { v, e };
}
function crossCheck(v, e) {
  if (v.fee_amount > 0 && v.fee_mode === 'free') e.push('fee_mode');
  if (!v.fee_amount && v.fee_mode && v.fee_mode !== 'free') v.fee_mode = 'free';
  if ((v.fee_mode === 'online' || v.fee_mode === 'both') && !rzpKeys()) e.push('fee_mode');
  if (v.online) { if (v.online_url === undefined || v.online_url === null) { /* link can be added later */ } }
  else if (v.city === null || v.venue === null) { if (v.city === null) e.push('city'); if (v.venue === null) e.push('venue'); }
}
// POST /petevents
exports.create = async (req, res) => {
  const client = await db.getClient();
  try {
    const b = req.body || {}, { v, e } = readEvent(b, false); crossCheck(v, e);
    if (e.length) return bad(res, [...new Set(e)], e.includes('fee_mode') && !rzpKeys() && v.fee_mode !== 'free' && v.fee_amount > 0 ? 'Online payment is not set up yet. Choose “pay at venue”.' : undefined);
    const me = uid(req.user), admin = await isAdmin(req.user);
    const { rows: tr } = await client.query(`SELECT 1 FROM pet_event_details d JOIN events e ON e.event_id = d.event_id WHERE e.user_id::text = $1 AND d.moderation = 'approved' LIMIT 1`, [me]);
    const { rows: cnt } = await client.query(`SELECT COUNT(*)::int AS n FROM events WHERE user_id::text = $1 AND created_at > NOW() - INTERVAL '1 day'`, [me]);
    if (cnt[0].n >= 10) return res.status(429).json({ success: false, message: 'You have created many events today. Please try again tomorrow.' });
    const moderation = admin || tr.length ? 'approved' : 'pending';
    await client.query('BEGIN');
    const { rows } = await client.query(`INSERT INTO events (user_id, title, description, event_date, location, event_type, cover_image, max_attendees, entry_fee, status) VALUES ($1,$2,$3,$4::timestamp,$5,$6,$7,$8,$9,'active') RETURNING event_id::text`,
      [me, v.title, v.description, v.starts.replace('T', ' '), (v.online ? 'Online' : [v.venue, v.city].filter(Boolean).join(', ')).slice(0, 255), v.category, v.cover, v.capacity, v.fee_amount ? String(v.fee_amount) : null]);
    const id = rows[0].event_id;
    await client.query(`INSERT INTO pet_event_details (event_id, category, subtype, ends_at, is_online, online_url, venue, country, state, city, lat, lng, species, age_group, fee_amount, fee_mode, allow_waitlist, programme, requirements, eligibility, safety, cancellation, host_name, host_about, host_phone, meta, photos, moderation, moderated_by, moderated_at)
      VALUES ($1,$2,$3,$4::timestamp,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
      [id, v.category, v.subtype, v.ends ? v.ends.replace('T', ' ') : null, !!v.online, v.online ? v.online_url : null, v.online ? null : v.venue, v.country || 'India', v.state, v.online ? null : v.city, v.lat, v.lng, v.species || [], v.age_group || 'all',
        v.fee_amount || 0, v.fee_mode || 'free', v.allow_waitlist !== false, JSON.stringify(v.programme || []), v.requirements, v.eligibility, v.safety, v.cancellation, v.host_name, v.host_about, v.host_phone,
        JSON.stringify(cleanMeta(v.category, v.meta)), v.photos || [], moderation, moderation === 'approved' ? me : null, moderation === 'approved' ? new Date() : null]);
    await client.query('COMMIT');
    return R.created(res, { id, moderation });
  } catch (e) { try { await client.query('ROLLBACK'); } catch (x) {} return fail(res, 'create', e); }
  finally { client.release(); }
};
// PATCH /petevents/:id  (host)
exports.update = async (req, res) => {
  try {
    const id = str(req.params.id, 40); if (!UUID_RX.test(id)) return R.notFound(res, 'Event not found');
    const { rows } = await query(`SELECT e.*, d.* FROM events e JOIN pet_event_details d ON d.event_id = e.event_id WHERE e.event_id::text = $1 AND e.user_id::text = $2 AND e.status IS DISTINCT FROM 'deleted'`, [id, uid(req.user)]);
    if (!rows.length) return R.notFound(res, 'Event not found');
    const cur = rows[0]; if (cur.status === 'cancelled') return conflict(res, 'This event was cancelled.');
    const b = Object.assign({}, req.body || {}); delete b.category;
    const { v, e } = readEvent(b, true);
    const merged = { fee_amount: v.fee_amount !== undefined ? v.fee_amount : Number(cur.fee_amount), fee_mode: v.fee_mode !== undefined ? v.fee_mode : cur.fee_mode, online: cur.is_online, city: v.city !== undefined ? v.city : cur.city, venue: v.venue !== undefined ? v.venue : cur.venue };
    if (v.fee_mode !== undefined || v.fee_amount !== undefined) crossCheck(merged, e);
    if (v.capacity != null) { const { rows: t } = await query(`SELECT COALESCE(SUM(people),0)::int AS n FROM pet_event_registrations WHERE event_id::text = $1 AND status IN ('registered','checked_in')`, [id]); if (v.capacity < t[0].n) e.push('capacity'); }
    if (e.length) return bad(res, [...new Set(e)]);
    const es = {}, ds = {};
    if (v.title !== undefined) es.title = v.title; if (v.description !== undefined) es.description = v.description; if (v.starts !== undefined) es.event_date = v.starts.replace('T', ' ');
    if (v.capacity !== undefined) es.max_attendees = v.capacity; if (v.cover !== undefined) es.cover_image = v.cover; if (v.fee_amount !== undefined) es.entry_fee = v.fee_amount ? String(v.fee_amount) : null;
    ['subtype', 'online_url', 'venue', 'country', 'state', 'city', 'lat', 'lng', 'species', 'age_group', 'fee_amount', 'fee_mode', 'allow_waitlist', 'requirements', 'eligibility', 'safety', 'cancellation', 'host_name', 'host_about', 'host_phone', 'photos'].forEach(k => { if (v[k] !== undefined) ds[k] = v[k]; });
    if (v.ends !== undefined) ds.ends_at = v.ends ? v.ends.replace('T', ' ') : null;
    if (v.programme !== undefined) ds.programme = JSON.stringify(v.programme);
    if (v.meta !== undefined) ds.meta = JSON.stringify(cleanMeta(cur.category, v.meta));
    if (merged.fee_amount === 0) ds.fee_mode = 'free';
    if (cur.moderation === 'rejected') { ds.moderation = 'pending'; ds.moderation_note = null; }
    const upd = async (t, key, set) => { const k = Object.keys(set); if (!k.length) return; await query(`UPDATE ${t} SET ${k.map((x, i) => x + ' = $' + (i + 2)).join(', ')}, updated_at = NOW() WHERE ${key}::text = $1`, [id].concat(k.map(x => set[x]))); };
    await upd('events', 'event_id', es); await upd('pet_event_details', 'event_id', ds);
    if (es.title || es.event_date || ds.venue || ds.city) await query(`UPDATE events SET location = $2 WHERE event_id::text = $1`, [id, cur.is_online ? 'Online' : [ds.venue || cur.venue, ds.city || cur.city].filter(Boolean).join(', ').slice(0, 255)]);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'update', e); }
};
// POST /petevents/:id/cancel  (host or admin)
exports.cancel = async (req, res) => {
  try {
    const id = str(req.params.id, 40); if (!UUID_RX.test(id)) return R.notFound(res, 'Event not found');
    const { rows } = await query(`SELECT user_id::text AS host, status FROM events WHERE event_id::text = $1`, [id]);
    if (!rows.length || (rows[0].host !== uid(req.user) && !(await isAdmin(req.user)))) return R.notFound(res, 'Event not found');
    if (rows[0].status === 'cancelled') return conflict(res, 'Already cancelled.');
    await query(`UPDATE events SET status = 'cancelled', updated_at = NOW() WHERE event_id::text = $1`, [id]);
    await query(`UPDATE pet_event_registrations SET status = 'cancelled', payment = CASE WHEN payment = 'paid_online' THEN 'refund_due' ELSE payment END, updated_at = NOW() WHERE event_id::text = $1 AND status <> 'cancelled'`, [id]);
    return R.ok(res, { cancelled: true });
  } catch (e) { return fail(res, 'cancel', e); }
};

// ── interest ─────────────────────────────────────────────────────────────────
exports.interest = async (req, res) => {
  try {
    const id = str(req.params.id, 40); if (!UUID_RX.test(id)) return R.notFound(res, 'Event not found');
    const { rows } = await query(`SELECT 1 FROM events e JOIN pet_event_details d ON d.event_id = e.event_id WHERE e.event_id::text = $1 AND d.moderation = 'approved'`, [id]);
    if (!rows.length) return R.notFound(res, 'Event not found');
    const on = (req.body || {}).on !== false;
    if (on) await query(`INSERT INTO event_attendees (event_id, user_id, status) VALUES ($1::uuid,$2::uuid,'interested') ON CONFLICT (event_id, user_id) DO NOTHING`, [id, uid(req.user)]);
    else await query(`DELETE FROM event_attendees WHERE event_id::text = $1 AND user_id::text = $2 AND status = 'interested'`, [id, uid(req.user)]);
    const { rows: c } = await query(`SELECT COUNT(*)::int AS n FROM event_attendees WHERE event_id::text = $1 AND status = 'interested'`, [id]);
    return R.ok(res, { interested: on, count: c[0].n });
  } catch (e) { return fail(res, 'interest', e); }
};

// ── registration ─────────────────────────────────────────────────────────────
async function promoteWaitlist(client, eventId) {
  const { rows: ev } = await client.query(`SELECT e.max_attendees, d.fee_amount FROM events e JOIN pet_event_details d ON d.event_id = e.event_id WHERE e.event_id = $1`, [eventId]);
  if (!ev.length) return;
  const cap = ev[0].max_attendees;
  const { rows: w } = await client.query(`SELECT reg_id, people, user_id FROM pet_event_registrations WHERE event_id = $1 AND status = 'waitlisted' ORDER BY reg_id`, [eventId]);
  for (const x of w) {
    if (cap) { const { rows: t } = await client.query(`SELECT COALESCE(SUM(people),0)::int AS n FROM pet_event_registrations WHERE event_id = $1 AND (status IN ('registered','checked_in') OR (status = 'pending_payment' AND hold_until > NOW()))`, [eventId]); if (t[0].n + x.people > cap) break; }
    const fee = Number(ev[0].fee_amount || 0);
    await client.query(`UPDATE pet_event_registrations SET status = 'registered', payment = $2, amount = $3, updated_at = NOW() WHERE reg_id = $1`, [x.reg_id, fee > 0 ? 'due' : 'none', fee * x.people]);
    await client.query(`INSERT INTO event_attendees (event_id, user_id, status) VALUES ($1,$2,'going') ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going'`, [eventId, x.user_id]);
  }
}
// POST /petevents/:id/register {people, pets:[{name,species}], phone, note, pay: 'venue'|'online'}
exports.register = async (req, res) => {
  const client = await db.getClient();
  try {
    const id = str(req.params.id, 40); if (!UUID_RX.test(id)) return R.notFound(res, 'Event not found');
    const b = req.body || {}, e = [], me = uid(req.user);
    const people = parseInt(b.people, 10) || 1; if (people < 1 || people > 10) e.push('people');
    const pets = (Array.isArray(b.pets) ? b.pets : []).slice(0, 10).map(p => ({ name: str(p && p.name, 60), species: SPECIES.includes(p && p.species) ? p.species : 'other' })).filter(p => p.name);
    const phone = str(b.phone, 30); if (phone && !/^[+\d][\d\s-]{6,20}$/.test(phone)) e.push('phone');
    if (e.length) return bad(res, e);
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT e.event_id, e.user_id::text AS host, e.status, e.max_attendees, e.event_date, d.* FROM events e JOIN pet_event_details d ON d.event_id = e.event_id WHERE e.event_id::text = $1 FOR UPDATE OF e`, [id]);
    if (!rows.length || rows[0].moderation !== 'approved') { await client.query('ROLLBACK'); return R.notFound(res, 'Event not found'); }
    const ev = rows[0];
    if (ev.status === 'cancelled') { await client.query('ROLLBACK'); return conflict(res, 'This event was cancelled.'); }
    if (LOCAL(ev.ends_at || ev.event_date) < nowIST()) { await client.query('ROLLBACK'); return conflict(res, 'This event has already ended.'); }
    if (ev.host === me) { await client.query('ROLLBACK'); return conflict(res, 'You are hosting this event.'); }
    const { rows: ex } = await client.query(`SELECT reg_id, status, hold_until FROM pet_event_registrations WHERE event_id = $1 AND user_id::text = $2 AND status <> 'cancelled'`, [ev.event_id, me]);
    if (ex.length) {
      // an unpaid online hold that expired can be replaced
      if (ex[0].status === 'pending_payment' && new Date(ex[0].hold_until) < new Date()) await client.query(`UPDATE pet_event_registrations SET status = 'cancelled', updated_at = NOW() WHERE reg_id = $1`, [ex[0].reg_id]);
      else { await client.query('ROLLBACK'); return conflict(res, ex[0].status === 'waitlisted' ? 'You are already on the waitlist.' : 'You are already registered for this event.'); }
    }
    const fee = Number(ev.fee_amount || 0), amount = Math.round(fee * people * 100) / 100;
    let pay = fee > 0 ? (str(b.pay, 10) || (ev.fee_mode === 'online' ? 'online' : 'venue')) : 'none';
    if (fee > 0) {
      const allowed = { venue: ['venue', 'both'], online: ['online', 'both'] }[pay];
      if (!allowed || !allowed.includes(ev.fee_mode)) { await client.query('ROLLBACK'); return bad(res, ['pay'], 'This payment option is not available for this event.'); }
      if (pay === 'online' && !rzpKeys()) { await client.query('ROLLBACK'); return bad(res, ['pay'], 'Online payment is not available right now. Please choose pay at venue.'); }
    }
    let status = 'registered';
    if (ev.max_attendees) {
      const { rows: t } = await client.query(`SELECT COALESCE(SUM(people),0)::int AS n FROM pet_event_registrations WHERE event_id = $1 AND (status IN ('registered','checked_in') OR (status = 'pending_payment' AND hold_until > NOW()))`, [ev.event_id]);
      if (t[0].n + people > ev.max_attendees) {
        if (!ev.allow_waitlist) { await client.query('ROLLBACK'); return conflict(res, t[0].n >= ev.max_attendees ? 'This event is full.' : 'Only ' + (ev.max_attendees - t[0].n) + ' spot(s) left.'); }
        status = 'waitlisted';
      }
    }
    if (status === 'registered' && pay === 'online') status = 'pending_payment';
    const payment = status === 'waitlisted' || fee === 0 ? 'none' : pay === 'online' ? 'due' : 'due';
    const { rows: ins } = await client.query(`INSERT INTO pet_event_registrations (event_id, user_id, status, people, pets, phone, note, payment, amount, hold_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING reg_id::text`,
      [ev.event_id, me, status, people, JSON.stringify(pets), phone || null, str(b.note, 300) || null, payment, status === 'waitlisted' ? 0 : amount, status === 'pending_payment' ? new Date(Date.now() + HOLD_MIN * 60000) : null]);
    const regId = ins[0].reg_id;
    let order = null;
    if (status === 'pending_payment') {
      try { order = await rzpOrder(Math.round(amount * 100), 'ev_' + regId); }
      catch (x) { await client.query('ROLLBACK'); console.error('[Events] razorpay order:', x.message); return res.status(502).json({ success: false, message: 'Could not start the online payment. Please try again or choose pay at venue.' }); }
      await client.query(`UPDATE pet_event_registrations SET rzp_order_id = $2 WHERE reg_id = $1`, [regId, order.id]);
    }
    if (status === 'registered') await client.query(`INSERT INTO event_attendees (event_id, user_id, status) VALUES ($1,$2,'going') ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going'`, [ev.event_id, me]);
    await client.query('COMMIT');
    return R.created(res, { id: regId, status, payment, amount, order: order ? { id: order.id, amount: Math.round(amount * 100), currency: 'INR', key: rzpKeys().id } : null });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (x) {}
    if (e.code === '23505') return conflict(res, 'You are already registered for this event.');
    return fail(res, 'register', e);
  } finally { client.release(); }
};
// POST /petevents/registrations/:rid/verify {razorpay_order_id, razorpay_payment_id, razorpay_signature}
exports.verifyPayment = async (req, res) => {
  try {
    const k = rzpKeys(); if (!k) return bad(res, ['payment'], 'Online payment is not set up.');
    const rid = str(req.params.rid, 20), b = req.body || {};
    const { rows } = await query(`SELECT reg_id, event_id, user_id, status, payment, rzp_order_id FROM pet_event_registrations WHERE reg_id::text = $1 AND user_id::text = $2`, [rid, uid(req.user)]);
    if (!rows.length) return R.notFound(res, 'Registration not found');
    const r = rows[0];
    if (!(r.status === 'pending_payment' || (r.status === 'registered' && r.payment === 'due'))) return r.status === 'registered' ? R.ok(res, { status: 'registered' }) : conflict(res, 'This registration is no longer waiting for payment.');
    const oid = str(b.razorpay_order_id, 60), pid = str(b.razorpay_payment_id, 60), sig = str(b.razorpay_signature, 200);
    const expect = crypto.createHmac('sha256', k.secret).update(oid + '|' + pid).digest('hex');
    const okSig = oid === r.rzp_order_id && sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
    if (!okSig) return res.status(400).json({ success: false, message: 'Payment could not be verified. If money was taken, it will be refunded by Razorpay.' });
    await query(`UPDATE pet_event_registrations SET status = 'registered', payment = 'paid_online', rzp_payment_id = $2, hold_until = NULL, updated_at = NOW() WHERE reg_id = $1 AND status IN ('pending_payment','registered')`, [r.reg_id, pid]);
    await query(`INSERT INTO event_attendees (event_id, user_id, status) VALUES ($1,$2,'going') ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going'`, [r.event_id, r.user_id]);
    return R.ok(res, { status: 'registered', payment: 'paid_online' });
  } catch (e) { return fail(res, 'verifyPayment', e); }
};
// POST /petevents/registrations/:rid/pay — online payment for a registration with the fee still due (e.g. promoted from the waitlist)
exports.payLater = async (req, res) => {
  try {
    const k = rzpKeys(); if (!k) return bad(res, ['pay'], 'Online payment is not available right now. Please pay at the venue.');
    const { rows } = await query(`SELECT r.reg_id, r.status, r.payment, r.amount, d.fee_mode FROM pet_event_registrations r JOIN pet_event_details d ON d.event_id = r.event_id WHERE r.reg_id::text = $1 AND r.user_id::text = $2`, [str(req.params.rid, 20), uid(req.user)]);
    if (!rows.length) return R.notFound(res, 'Registration not found');
    const r = rows[0];
    if (r.status !== 'registered' || r.payment !== 'due' || !['online', 'both'].includes(r.fee_mode)) return conflict(res, 'There is nothing to pay online for this registration.');
    let order; try { order = await rzpOrder(Math.round(Number(r.amount) * 100), 'ev_' + r.reg_id + '_' + Date.now().toString(36)); } catch (x) { console.error('[Events] razorpay order:', x.message); return res.status(502).json({ success: false, message: 'Could not start the online payment. Please try again.' }); }
    await query(`UPDATE pet_event_registrations SET rzp_order_id = $2, updated_at = NOW() WHERE reg_id = $1`, [r.reg_id, order.id]);
    return R.ok(res, { order: { id: order.id, amount: Math.round(Number(r.amount) * 100), currency: 'INR', key: k.id } });
  } catch (e) { return fail(res, 'payLater', e); }
};
// POST /petevents/registrations/:rid/cancel  (attendee)
exports.cancelRegistration = async (req, res) => {
  const client = await db.getClient();
  try {
    const rid = str(req.params.rid, 20);
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT r.*, e.event_date FROM pet_event_registrations r JOIN events e ON e.event_id = r.event_id WHERE r.reg_id::text = $1 AND r.user_id::text = $2 FOR UPDATE OF r`, [rid, uid(req.user)]);
    if (!rows.length) { await client.query('ROLLBACK'); return R.notFound(res, 'Registration not found'); }
    const r = rows[0];
    if (['cancelled', 'checked_in'].includes(r.status)) { await client.query('ROLLBACK'); return conflict(res, r.status === 'cancelled' ? 'Already cancelled.' : 'You have already checked in.'); }
    await client.query(`UPDATE pet_event_registrations SET status = 'cancelled', payment = CASE WHEN payment = 'paid_online' THEN 'refund_due' WHEN payment = 'due' THEN 'none' ELSE payment END, updated_at = NOW() WHERE reg_id = $1`, [r.reg_id]);
    await client.query(`DELETE FROM event_attendees WHERE event_id = $1 AND user_id = $2 AND status = 'going'`, [r.event_id, r.user_id]);
    if (r.status !== 'waitlisted') await promoteWaitlist(client, r.event_id);
    await client.query('COMMIT');
    return R.ok(res, { cancelled: true, refund: r.payment === 'paid_online' });
  } catch (e) { try { await client.query('ROLLBACK'); } catch (x) {} return fail(res, 'cancelRegistration', e); }
  finally { client.release(); }
};
// GET /petevents/:id/registrations  (host)
exports.registrations = async (req, res) => {
  try {
    const id = str(req.params.id, 40); if (!UUID_RX.test(id)) return R.notFound(res, 'Event not found');
    const { rows: ev } = await query(`SELECT 1 FROM events WHERE event_id::text = $1 AND user_id::text = $2`, [id, uid(req.user)]);
    if (!ev.length) return R.notFound(res, 'Event not found');
    const { rows } = await query(`SELECT r.reg_id::text AS id, r.status, r.people, r.pets, r.phone, r.note, r.payment, r.amount, r.created_at, u.full_name FROM pet_event_registrations r LEFT JOIN users u ON u.user_id = r.user_id
      WHERE r.event_id::text = $1 AND (r.status <> 'pending_payment' OR r.hold_until > NOW()) ORDER BY CASE r.status WHEN 'waitlisted' THEN 2 WHEN 'cancelled' THEN 3 ELSE 1 END, r.reg_id`, [id]);
    return R.ok(res, { registrations: rows.map(r => ({ id: r.id, name: r.full_name || 'PawBook member', status: r.status, people: r.people, pets: r.pets, phone: r.phone, note: r.note, payment: r.payment, amount: Number(r.amount), at: r.created_at })) });
  } catch (e) { return fail(res, 'registrations', e); }
};
// PATCH /petevents/registrations/:rid {action: mark_paid | check_in | refunded}  (host)
exports.hostAction = async (req, res) => {
  try {
    const rid = str(req.params.rid, 20), act = str((req.body || {}).action, 12);
    const { rows } = await query(`SELECT r.reg_id, r.status, r.payment FROM pet_event_registrations r JOIN events e ON e.event_id = r.event_id WHERE r.reg_id::text = $1 AND e.user_id::text = $2`, [rid, uid(req.user)]);
    if (!rows.length) return R.notFound(res, 'Registration not found');
    const r = rows[0];
    if (act === 'mark_paid') { if (r.payment !== 'due' || !['registered', 'checked_in'].includes(r.status)) return conflict(res, 'Nothing to mark as paid.'); await query(`UPDATE pet_event_registrations SET payment = 'paid_venue', updated_at = NOW() WHERE reg_id = $1`, [r.reg_id]); }
    else if (act === 'check_in') { if (r.status !== 'registered') return conflict(res, 'Only registered attendees can be checked in.'); await query(`UPDATE pet_event_registrations SET status = 'checked_in', updated_at = NOW() WHERE reg_id = $1`, [r.reg_id]); }
    else if (act === 'refunded') { if (r.payment !== 'refund_due') return conflict(res, 'No refund is due.'); await query(`UPDATE pet_event_registrations SET payment = 'refunded', updated_at = NOW() WHERE reg_id = $1`, [r.reg_id]); }
    else return bad(res, ['action']);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'hostAction', e); }
};

// ── reports + moderation ─────────────────────────────────────────────────────
const REASONS = ['spam', 'scam', 'animal_welfare', 'wrong_info', 'inappropriate', 'other'];
exports.report = async (req, res) => {
  try {
    const id = str(req.params.id, 40), b = req.body || {}; if (!UUID_RX.test(id)) return R.notFound(res, 'Event not found');
    if (!REASONS.includes(b.reason)) return bad(res, ['reason']);
    const { rows } = await query(`SELECT 1 FROM events WHERE event_id::text = $1`, [id]); if (!rows.length) return R.notFound(res, 'Event not found');
    try { await query(`INSERT INTO pet_event_reports (event_id, user_id, reason, details) VALUES ($1::uuid,$2::uuid,$3,$4)`, [id, uid(req.user), b.reason, str(b.details, 500) || null]); }
    catch (x) { if (x.code === '23505') return conflict(res, 'You have already reported this event. Our team will review it.'); throw x; }
    return R.created(res, { reported: true });
  } catch (e) { return fail(res, 'report', e); }
};
exports.adminQueue = async (req, res) => {
  try {
    if (!(await isAdmin(req.user))) return res.status(403).json({ success: false, message: 'Admins only' });
    const [pR, rR] = await Promise.all([
      query(`${BASE_SQL} WHERE d.moderation = 'pending' AND e.status IS DISTINCT FROM 'cancelled' ORDER BY d.created_at LIMIT 100`),
      query(`SELECT rp.report_id::text AS id, rp.reason, rp.details, rp.created_at, e.event_id::text AS event_id, e.title, d.moderation, u.full_name AS reporter FROM pet_event_reports rp JOIN events e ON e.event_id = rp.event_id LEFT JOIN pet_event_details d ON d.event_id = e.event_id LEFT JOIN users u ON u.user_id = rp.user_id WHERE rp.status = 'open' ORDER BY rp.created_at LIMIT 200`)
    ]);
    return R.ok(res, { pending: pR.rows.map(r => evOut(r, detailOut(r))), reports: rR.rows });
  } catch (e) { return fail(res, 'adminQueue', e); }
};
exports.moderate = async (req, res) => {
  try {
    if (!(await isAdmin(req.user))) return res.status(403).json({ success: false, message: 'Admins only' });
    const id = str(req.params.id, 40), b = req.body || {}, m = { approve: 'approved', reject: 'rejected', hide: 'hidden' }[b.action];
    if (!UUID_RX.test(id) || !m) return bad(res, ['action']);
    if (m === 'rejected' && !str(b.note, 300)) return bad(res, ['note'], 'Please tell the host why');
    const { rowCount } = await query(`UPDATE pet_event_details SET moderation = $2, moderation_note = $3, moderated_by = $4, moderated_at = NOW(), updated_at = NOW() WHERE event_id::text = $1`, [id, m, str(b.note, 300) || null, uid(req.user)]);
    if (!rowCount) return R.notFound(res, 'Event not found');
    if (m !== 'approved') await query(`UPDATE pet_event_reports SET status = 'resolved', resolved_by = $2, resolved_at = NOW() WHERE event_id::text = $1 AND status = 'open'`, [id, uid(req.user)]);
    return R.ok(res, { moderation: m });
  } catch (e) { return fail(res, 'moderate', e); }
};
exports.resolveReport = async (req, res) => {
  try {
    if (!(await isAdmin(req.user))) return res.status(403).json({ success: false, message: 'Admins only' });
    const st = { resolve: 'resolved', dismiss: 'dismissed' }[(req.body || {}).action]; if (!st) return bad(res, ['action']);
    const { rowCount } = await query(`UPDATE pet_event_reports SET status = $2, resolved_by = $3, resolved_at = NOW() WHERE report_id::text = $1 AND status = 'open'`, [str(req.params.rid, 20), st, uid(req.user)]);
    if (!rowCount) return R.notFound(res, 'Report not found');
    return R.ok(res, { status: st });
  } catch (e) { return fail(res, 'resolveReport', e); }
};
