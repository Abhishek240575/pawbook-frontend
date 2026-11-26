'use strict';
/* ============================================================================
   PawMatch 2.0 (page 35) — swipe-style matchmaking for pets. Mounted under /api/v1/matchmaking (add_shop_routes.js).
   Migration 022. Every pet profile can switch on several match types (playdate, walk buddy, companion, breeding).
   Swipes are per match type; a mutual like is a match. Matched owners chat and fix a date: one side offers up to
   three date/time options and a place, the other picks one (or declines); either side can cancel; after the date
   it can be marked done. Others only ever see an owner's first name and the pet's city/area — never phone, email
   or exact location. Distances are rounded to whole kilometres.
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = req => String(req.user.user_id);
const fail = (res, where, e) => { console.error('[PawMatch] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const conflict = (res, msg) => res.status(409).json({ success: false, message: msg });
const forbid = (res, msg) => res.status(403).json({ success: false, message: msg || 'Not allowed' });
const notFound = (res, msg) => res.status(404).json({ success: false, message: msg || 'Not found' });
const iso = t => (t ? new Date(t).toISOString() : null);
const httpsUrl = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 600;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = n => (n ? String(n).trim().split(/\s+/)[0] : 'Pet parent');
const q = n => '"' + String(n).replace(/"/g, '') + '"';

const SPECIES = ['dog', 'cat', 'rabbit', 'bird', 'other'];
const INTENTS = ['playdate', 'walk', 'companion', 'breeding'];
const INTENT_LABEL = { playdate: 'Playdate', walk: 'Walk buddy', companion: 'Companion', breeding: 'Breeding' };
const SIZES = ['small', 'medium', 'large'];
const ENERGY = ['calm', 'moderate', 'high'];
const TRAITS = ['friendly', 'playful', 'gentle', 'shy', 'good_with_kids', 'good_with_dogs', 'good_with_cats', 'trained', 'loves_water', 'loves_fetch'];
const REASONS = ['fake', 'unsafe', 'rude', 'selling', 'spam', 'other'];
const MIN_BREED_MONTHS = 12, MAX_BREED_MONTHS = 96;

// ── schema helpers (users / pets columns differ between installs) ──
const SCHEMA = {};
async function cols(table) {
  if (SCHEMA[table]) return SCHEMA[table];
  const { rows } = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [table]);
  const m = {}; rows.forEach(r => { m[r.column_name] = true; }); SCHEMA[table] = m; return m;
}
const pick = (c, names) => names.find(n => c[n]) || null;
async function notify(userId, title, body, link) {
  if (!userId) return;
  try { await query(`INSERT INTO notifications (user_id, type, title, body, link_url, icon_emoji) VALUES ($1,'system',$2,$3,$4,'💞')`, [userId, String(title).slice(0, 200), body ? String(body).slice(0, 500) : null, link || null]); }
  catch (e) { console.error('[PawMatch] notify:', e.message); }
}
async function userIds(req) {
  const id = uid(req), u = await cols('users');
  const { rows } = await query(`SELECT user_id::text AS id${u.user_no ? ', user_no::text AS no' : ''} FROM users WHERE user_id::text = $1`, [id]);
  const r = rows[0] || {}; return [id].concat(r.no ? [r.no] : []);
}

// ── age / distance / scoring ──
function ageMonths(bm) {
  if (!bm) return null; const d = new Date(bm), n = new Date();
  return (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth());
}
function ageLabel(m) {
  if (m == null) return null; if (m < 1) return 'Under 1 month';
  if (m < 12) return m + (m === 1 ? ' month' : ' months');
  const y = Math.floor(m / 12); return y + (y === 1 ? ' year' : ' years');
}
function km(a, b) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R0 = 6371, r = x => Number(x) * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R0 * Math.asin(Math.sqrt(h));
}
const sameCity = (a, b) => a.city && b.city && a.city.trim().toLowerCase() === b.city.trim().toLowerCase();
function breedingOk(p) {
  const m = ageMonths(p.birth_month);
  return p.vaccinated && !p.neutered && m != null && m >= MIN_BREED_MONTHS && m <= MAX_BREED_MONTHS;
}
function compat(me, o, intent) {
  let s = 30; const why = [];
  const d = km(me, o);
  if (d != null) { if (d <= 3) { s += 15; why.push('Very close by'); } else if (d <= 10) { s += 10; why.push('Nearby'); } else s += 4; }
  else if (sameCity(me, o)) { s += 8; why.push('Same city'); }
  if (me.energy && o.energy) {
    const g = Math.abs(ENERGY.indexOf(me.energy) - ENERGY.indexOf(o.energy));
    if (g === 0) { s += intent === 'breeding' ? 6 : 18; why.push('Same energy level'); } else if (g === 1) s += intent === 'breeding' ? 3 : 9;
  }
  if (me.size && o.size) {
    const g = Math.abs(SIZES.indexOf(me.size) - SIZES.indexOf(o.size));
    if (g === 0) { s += 12; why.push('Similar size'); } else if (g === 1) s += 5;
  }
  const am = ageMonths(me.birth_month), ao = ageMonths(o.birth_month);
  if (am != null && ao != null) { const g = Math.abs(am - ao); if (g <= 12) { s += 8; why.push('Similar age'); } else if (g <= 36) s += 4; }
  if (me.breed && o.breed && me.breed.trim().toLowerCase() === o.breed.trim().toLowerCase()) { s += intent === 'breeding' ? 20 : 4; why.push('Same breed'); }
  if (o.vaccinated) { s += 6; why.push('Vaccinated'); }
  const shared = (me.traits || []).filter(t => (o.traits || []).includes(t));
  if (shared.length) { s += Math.min(8, shared.length * 3); why.push('Both ' + shared[0].replace(/_/g, ' ')); }
  return { score: Math.max(0, Math.min(99, Math.round(s))), why: why.slice(0, 4), km: d == null ? null : Math.max(1, Math.round(d)) };
}

// ── shapes ──
const PCOLS = `p.profile_id, p.owner_id, p.pet_ref, p.name, p.species, p.breed, p.gender, p.birth_month, p.size, p.energy, p.traits, p.bio, p.photos,
  p.city, p.area, p.state, p.lat, p.lng, p.vaccinated, p.neutered, p.intents, p.max_km, p.is_active, p.created_at, p.updated_at`;
function pub(p, extra) {   // what OTHER owners may see
  const m = ageMonths(p.birth_month);
  return Object.assign({
    id: p.profile_id, name: p.name, species: p.species, breed: p.breed || null, gender: p.gender, age: ageLabel(m), age_months: m,
    size: p.size, energy: p.energy, traits: p.traits || [], bio: p.bio || '', photos: (p.photos || []).filter(httpsUrl).slice(0, 6),
    city: p.city, area: p.area || null, vaccinated: !!p.vaccinated, neutered: !!p.neutered, intents: p.intents || [],
    owner: first(p.owner_name), owner_avatar: httpsUrl(p.owner_avatar) ? p.owner_avatar : null,
  }, extra || {});
}
function mine(p) {   // the owner's own view
  const m = ageMonths(p.birth_month), bm = p.birth_month ? new Date(p.birth_month) : null;
  return Object.assign(pub(p), {
    owner: undefined, owner_avatar: undefined, pet_ref: p.pet_ref, state: p.state || null, has_location: p.lat != null,
    birth_year: bm ? bm.getFullYear() : null, birth_month: bm ? bm.getMonth() + 1 : null, max_km: p.max_km, is_active: p.is_active,
    breeding_ready: breedingOk(p), age_months: m,
  });
}
async function ownerJoin() {
  const u = await cols('users'); const nm = pick(u, ['full_name', 'name', 'username']), av = pick(u, ['avatar_url', 'avatar', 'profile_photo']);
  return { sel: `${nm ? 'u.' + q(nm) : 'NULL'} AS owner_name, ${av ? 'u.' + q(av) : 'NULL'} AS owner_avatar`, join: 'LEFT JOIN users u ON u.user_id = p.owner_id' };
}
async function myProfile(req, id) {
  if (!UUID_RX.test(String(id || ''))) return null;
  const { rows } = await query(`SELECT ${PCOLS} FROM pm_profiles p WHERE p.profile_id = $1 AND p.owner_id::text = $2`, [id, uid(req)]);
  return rows[0] || null;
}

// ── validation of a profile body ──
function readProfile(b) {
  const out = {}, errs = [];
  out.name = str(b.name, 60); if (out.name.length < 1) errs.push('name');
  out.species = str(b.species, 20).toLowerCase(); if (!SPECIES.includes(out.species)) errs.push('species');
  out.breed = str(b.breed, 80) || null;
  out.gender = str(b.gender, 10).toLowerCase(); if (!['male', 'female'].includes(out.gender)) errs.push('gender');
  const by = Number(b.birth_year), bmn = Number(b.birth_month || 1), nowY = new Date().getFullYear();
  if (b.birth_year != null && b.birth_year !== '') {
    if (!(by >= nowY - 30 && by <= nowY) || !(bmn >= 1 && bmn <= 12)) errs.push('birth_year');
    else { out.birth_month = `${by}-${String(bmn).padStart(2, '0')}-01`; if (new Date(out.birth_month) > new Date()) errs.push('birth_month'); }
  } else out.birth_month = null;
  out.size = b.size ? str(b.size, 10).toLowerCase() : null; if (out.size && !SIZES.includes(out.size)) errs.push('size');
  out.energy = b.energy ? str(b.energy, 10).toLowerCase() : null; if (out.energy && !ENERGY.includes(out.energy)) errs.push('energy');
  out.traits = Array.isArray(b.traits) ? [...new Set(b.traits.map(t => String(t)).filter(t => TRAITS.includes(t)))].slice(0, 6) : [];
  out.bio = str(b.bio, 500) || null;
  out.photos = Array.isArray(b.photos) ? b.photos.filter(httpsUrl).slice(0, 6) : [];
  out.city = str(b.city, 80); if (out.city.length < 2) errs.push('city');
  out.area = str(b.area, 80) || null; out.state = str(b.state, 80) || null;
  const la = Number(b.lat), ln = Number(b.lng);
  if (b.lat != null && b.lat !== '' && b.lng != null && b.lng !== '') {
    if (!(la >= 6 && la <= 38 && ln >= 68 && ln <= 98)) errs.push('location');   // India
    else { out.lat = Math.round(la * 1000) / 1000; out.lng = Math.round(ln * 1000) / 1000; }
  } else { out.lat = null; out.lng = null; }
  out.vaccinated = !!b.vaccinated; out.neutered = !!b.neutered;
  out.intents = Array.isArray(b.intents) ? [...new Set(b.intents.map(String).filter(i => INTENTS.includes(i)))] : [];
  if (!out.intents.length) errs.push('intents');
  out.max_km = Math.max(1, Math.min(200, Math.round(Number(b.max_km) || 15)));
  out.pet_ref = b.pet_ref != null && b.pet_ref !== '' ? str(b.pet_ref, 40) : null;
  return { out, errs };
}
function breedingProblem(p) {
  if (!p.intents.includes('breeding')) return null;
  if (!['dog', 'cat', 'rabbit'].includes(p.species)) return 'Breeding matches are only for dogs, cats and rabbits.';
  if (p.neutered) return 'A neutered / spayed pet can’t be listed for breeding.';
  if (!p.vaccinated) return 'Only fully vaccinated pets can be listed for breeding.';
  const m = ageMonths(p.birth_month);
  if (m == null) return 'Add your pet’s birth month and year to list for breeding.';
  if (m < MIN_BREED_MONTHS) return 'Pets must be at least 1 year old to be listed for breeding.';
  if (m > MAX_BREED_MONTHS) return 'Pets older than 8 years can’t be listed for breeding.';
  return null;
}

// ═════════════ profiles ═════════════
exports.me = async (req, res) => {
  try {
    const { rows } = await query(`SELECT ${PCOLS} FROM pm_profiles p WHERE p.owner_id::text = $1 ORDER BY p.created_at`, [uid(req)]);
    // pets from My Pets that don't have a PawMatch profile yet (to fill the form quickly)
    let pets = [];
    try {
      const c = await cols('pets'), id = pick(c, ['id', 'pet_id']), owner = pick(c, ['user_id', 'owner_id']), nm = pick(c, ['name']);
      if (id && owner && nm) {
        const sp = pick(c, ['species', 'type', 'pet_type']), br = pick(c, ['breed']), gd = pick(c, ['gender', 'sex']), ph = pick(c, ['avatar_url', 'photo_url', 'avatar', 'image_url', 'profile_photo', 'photo']);
        const ids = await userIds(req);
        const r = await query(`SELECT ${q(id)}::text AS id, ${q(nm)} AS name${sp ? ', ' + q(sp) + ' AS species' : ''}${br ? ', ' + q(br) + ' AS breed' : ''}${gd ? ', ' + q(gd) + ' AS gender' : ''}${ph ? ', ' + q(ph) + ' AS photo' : ''}
          FROM pets WHERE ${q(owner)}::text = ANY($1) ORDER BY ${q(id)} LIMIT 20`, [ids]);
        const used = new Set(rows.map(p => p.pet_ref).filter(Boolean));
        pets = r.rows.filter(p => !used.has(p.id)).map(p => ({ id: p.id, name: p.name, species: String(p.species || '').toLowerCase(), breed: p.breed || null, gender: String(p.gender || '').toLowerCase(), photo: httpsUrl(p.photo) ? p.photo : null }));
      }
    } catch (e) { console.error('[PawMatch] my pets:', e.message); }
    // counts for badges
    const ids = rows.map(p => p.profile_id);
    let counts = { matches: 0, unread: 0, liked_you: 0, to_answer: 0, upcoming: 0 };
    if (ids.length) {
      const c = await query(`
        WITH m AS (SELECT match_id FROM pm_matches WHERE status = 'matched' AND (profile_a = ANY($1) OR profile_b = ANY($1)))
        SELECT (SELECT COUNT(*)::int FROM m) AS matches,
          (SELECT COUNT(*)::int FROM pm_messages x JOIN m ON m.match_id = x.match_id
             LEFT JOIN pm_reads r ON r.match_id = x.match_id AND r.user_id::text = $2
             WHERE x.sender_id::text <> $2 AND x.message_id > COALESCE(r.last_read_id, 0)) AS unread,
          (SELECT COUNT(DISTINCT s.from_profile || s.intent)::int FROM pm_swipes s
             WHERE s.to_profile = ANY($1) AND s.action = 'like'
               AND NOT EXISTS (SELECT 1 FROM pm_swipes y WHERE y.from_profile = s.to_profile AND y.to_profile = s.from_profile AND y.intent = s.intent)) AS liked_you,
          (SELECT COUNT(*)::int FROM pm_dates d JOIN m ON m.match_id = d.match_id WHERE d.status = 'pending' AND d.proposed_by::text <> $2) AS to_answer,
          (SELECT COUNT(*)::int FROM pm_dates d JOIN m ON m.match_id = d.match_id WHERE d.status = 'confirmed' AND d.starts_at > NOW()) AS upcoming`, [ids, uid(req)]);
      counts = c.rows[0];
    }
    return R.ok(res, { profiles: rows.map(mine), pets, counts, intents: INTENT_LABEL, traits: TRAITS });
  } catch (e) { return fail(res, 'me', e); }
};

exports.saveProfile = async (req, res) => {
  try {
    const id = req.params.id || null;
    const prev = id ? await myProfile(req, id) : null;
    if (id && !prev) return notFound(res, 'Profile not found');
    const { out: p, errs } = readProfile(req.body || {});
    if (errs.length) return bad(res, errs);
    if (prev && p.lat == null && req.body && req.body.keep_location) { p.lat = prev.lat; p.lng = prev.lng; }   // edited without re-sharing location
    const bp = breedingProblem(p); if (bp) return bad(res, ['intents'], bp);
    if (!id) {
      const n = await query(`SELECT COUNT(*)::int AS n FROM pm_profiles WHERE owner_id::text = $1`, [uid(req)]);
      if (n.rows[0].n >= 10) return conflict(res, 'You can have up to 10 PawMatch profiles.');
    }
    const vals = [p.name, p.species, p.breed, p.gender, p.birth_month, p.size, p.energy, p.traits, p.bio, p.photos, p.city, p.area, p.state, p.lat, p.lng, p.vaccinated, p.neutered, p.intents, p.max_km];
    let row;
    if (id) {
      row = (await query(`UPDATE pm_profiles SET name=$1, species=$2, breed=$3, gender=$4, birth_month=$5, size=$6, energy=$7, traits=$8, bio=$9, photos=$10,
        city=$11, area=$12, state=$13, lat=$14, lng=$15, vaccinated=$16, neutered=$17, intents=$18, max_km=$19, is_active=TRUE, updated_at=NOW()
        WHERE profile_id=$20 AND owner_id::text=$21 RETURNING *`, vals.concat([id, uid(req)]))).rows[0];
    } else {
      try {
        row = (await query(`INSERT INTO pm_profiles (name, species, breed, gender, birth_month, size, energy, traits, bio, photos, city, area, state, lat, lng, vaccinated, neutered, intents, max_km, owner_id, pet_ref)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`, vals.concat([uid(req), p.pet_ref]))).rows[0];
      } catch (e) { if (e.code === '23505') return conflict(res, 'This pet already has a PawMatch profile.'); throw e; }
    }
    return R.ok(res, { profile: mine(row) });
  } catch (e) { return fail(res, 'saveProfile', e); }
};

exports.pauseProfile = async (req, res) => {
  try {
    const p = await myProfile(req, req.params.id); if (!p) return notFound(res, 'Profile not found');
    const active = !!(req.body && req.body.active);
    await query(`UPDATE pm_profiles SET is_active = $1, updated_at = NOW() WHERE profile_id = $2`, [active, p.profile_id]);
    return R.ok(res, { active });
  } catch (e) { return fail(res, 'pauseProfile', e); }
};

exports.deleteProfile = async (req, res) => {
  try {
    const p = await myProfile(req, req.params.id); if (!p) return notFound(res, 'Profile not found');
    await query(`DELETE FROM pm_profiles WHERE profile_id = $1`, [p.profile_id]);   // swipes, matches, chats and dates go with it
    return R.ok(res, { deleted: true });
  } catch (e) { return fail(res, 'deleteProfile', e); }
};

// ═════════════ discover ═════════════
// profiles this one must never see again: own profiles, anything already swiped for this intent, reported, unmatched
const HIDE = `p.owner_id <> $2 AND p.is_active = TRUE
  AND NOT EXISTS (SELECT 1 FROM pm_reports rp WHERE rp.reporter_id = $2 AND rp.profile_id = p.profile_id)
  AND NOT EXISTS (SELECT 1 FROM pm_reports rp JOIN pm_profiles mine ON mine.owner_id = $2 WHERE rp.reporter_id = p.owner_id AND rp.profile_id = mine.profile_id)
  AND NOT EXISTS (SELECT 1 FROM pm_matches um WHERE um.status = 'unmatched' AND ((um.profile_a = $1 AND um.profile_b = p.profile_id) OR (um.profile_b = $1 AND um.profile_a = p.profile_id)))`;

exports.deck = async (req, res) => {
  try {
    const me = await myProfile(req, req.query.profile); if (!me) return notFound(res, 'Choose one of your pets first');
    const intent = String(req.query.intent || '');
    if (!INTENTS.includes(intent) || !(me.intents || []).includes(intent)) return bad(res, ['intent'], 'Switch on this match type for your pet first.');
    if (!me.is_active) return conflict(res, 'This profile is paused. Resume it to see new pets.');
    if (intent === 'breeding' && !breedingOk(me)) return bad(res, ['intents'], 'Your pet’s profile no longer meets the breeding rules (vaccinated, not neutered, 1–8 years old).');
    const O = await ownerJoin();
    const params = [me.profile_id, me.owner_id, intent, me.species];
    let extra = '';
    if (intent === 'breeding') { params.push(me.gender); extra = ` AND p.gender <> $5 AND p.vaccinated = TRUE AND p.neutered = FALSE AND p.birth_month IS NOT NULL
      AND p.birth_month <= (CURRENT_DATE - INTERVAL '${MIN_BREED_MONTHS} months') AND p.birth_month >= (CURRENT_DATE - INTERVAL '${MAX_BREED_MONTHS} months')`; }
    const { rows } = await query(`
      SELECT ${PCOLS}, ${O.sel},
        EXISTS (SELECT 1 FROM pm_swipes l WHERE l.from_profile = p.profile_id AND l.to_profile = $1 AND l.intent = $3 AND l.action = 'like') AS liked_me
      FROM pm_profiles p ${O.join}
      WHERE ${HIDE} AND p.species = $4 AND $3 = ANY(p.intents) ${extra}
        AND NOT EXISTS (SELECT 1 FROM pm_swipes s WHERE s.from_profile = $1 AND s.to_profile = p.profile_id AND s.intent = $3)
      ORDER BY p.updated_at DESC LIMIT 400`, params);
    const maxKm = me.max_km || 15;
    const list = rows.map(p => ({ p, c: compat(me, p, intent) }))
      .filter(x => (x.c.km != null ? x.c.km <= maxKm : sameCity(me, x.p)))
      .sort((a, b) => b.c.score - a.c.score || (a.c.km || 999) - (b.c.km || 999))
      .slice(0, 40)
      .map(x => pub(x.p, { score: x.c.score, why: x.c.why, km: x.c.km, liked_me: !!x.p.liked_me }));
    return R.ok(res, { intent, pets: list, radius_km: maxKm, using: me.lat != null ? 'distance' : 'city' });
  } catch (e) { return fail(res, 'deck', e); }
};

exports.swipe = async (req, res) => {
  try {
    const b = req.body || {};
    const me = await myProfile(req, b.profile); if (!me) return notFound(res, 'Choose one of your pets first');
    const intent = String(b.intent || ''), action = String(b.action || '');
    if (!INTENTS.includes(intent) || !(me.intents || []).includes(intent)) return bad(res, ['intent']);
    if (!['like', 'pass'].includes(action)) return bad(res, ['action']);
    if (!UUID_RX.test(String(b.target || ''))) return bad(res, ['target']);
    const t = (await query(`SELECT ${PCOLS} FROM pm_profiles p WHERE p.profile_id = $1`, [b.target])).rows[0];
    if (!t || !t.is_active || String(t.owner_id) === uid(req)) return notFound(res, 'This pet is no longer available');
    if (t.species !== me.species || !(t.intents || []).includes(intent)) return bad(res, ['target'], 'This pet isn’t looking for this kind of match.');
    if (intent === 'breeding' && (t.gender === me.gender || !breedingOk(t) || !breedingOk(me))) return bad(res, ['target'], 'This pair can’t be matched for breeding.');
    await query(`INSERT INTO pm_swipes (from_profile, to_profile, intent, action) VALUES ($1,$2,$3,$4)
      ON CONFLICT (from_profile, to_profile, intent) DO UPDATE SET action = EXCLUDED.action, created_at = NOW()`, [me.profile_id, t.profile_id, intent, action]);
    if (action !== 'like') return R.ok(res, { matched: false });
    const back = await query(`SELECT 1 FROM pm_swipes WHERE from_profile = $1 AND to_profile = $2 AND intent = $3 AND action = 'like'`, [t.profile_id, me.profile_id, intent]);
    if (!back.rows.length) return R.ok(res, { matched: false });
    const [a, z] = [String(me.profile_id), String(t.profile_id)].sort();
    const m = await query(`INSERT INTO pm_matches (profile_a, profile_b, intent) VALUES ($1,$2,$3)
      ON CONFLICT (profile_a, profile_b, intent) DO UPDATE SET updated_at = pm_matches.updated_at RETURNING match_id, status, (xmax = 0) AS created`, [a, z, intent]);
    const row = m.rows[0];
    if (row.status !== 'matched') return R.ok(res, { matched: false });
    if (row.created) {
      await query(`INSERT INTO pm_messages (match_id, sender_id, body, kind) VALUES ($1,$2,$3,'system')`, [row.match_id, me.owner_id, `${me.name} and ${t.name} matched for a ${INTENT_LABEL[intent].toLowerCase()}! Say hello and plan a date.`]);
      await notify(t.owner_id, `It's a match! ${t.name} 💞 ${me.name}`, `${me.name} liked ${t.name} back for a ${INTENT_LABEL[intent].toLowerCase()}. Say hello and plan a date.`, '35_pawmatch.html?match=' + row.match_id);
    }
    const O = await ownerJoin();
    const other = (await query(`SELECT ${PCOLS}, ${O.sel} FROM pm_profiles p ${O.join} WHERE p.profile_id = $1`, [t.profile_id])).rows[0];
    return R.ok(res, { matched: true, match_id: row.match_id, pet: pub(other), mine: mine(me), intent });
  } catch (e) { return fail(res, 'swipe', e); }
};

exports.likedYou = async (req, res) => {
  try {
    const me = await myProfile(req, req.query.profile); if (!me) return notFound(res, 'Choose one of your pets first');
    const O = await ownerJoin();
    const { rows } = await query(`
      SELECT ${PCOLS}, ${O.sel}, s.intent AS l_intent, s.created_at AS l_at
      FROM pm_swipes s JOIN pm_profiles p ON p.profile_id = s.from_profile ${O.join}
      WHERE s.to_profile = $1 AND s.action = 'like' AND ${HIDE} AND s.intent = ANY($3)
        AND NOT EXISTS (SELECT 1 FROM pm_swipes y WHERE y.from_profile = $1 AND y.to_profile = p.profile_id AND y.intent = s.intent)
      ORDER BY s.created_at DESC LIMIT 60`, [me.profile_id, me.owner_id, me.intents || []]);
    return R.ok(res, { pets: rows.map(p => { const c = compat(me, p, p.l_intent); return pub(p, { intent: p.l_intent, liked_at: iso(p.l_at), score: c.score, why: c.why, km: c.km }); }) });
  } catch (e) { return fail(res, 'likedYou', e); }
};

// ═════════════ matches, chat, dates ═════════════
async function loadMatch(req, id) {
  if (!UUID_RX.test(String(id || ''))) return null;
  const { rows } = await query(`
    SELECT m.*, pa.owner_id AS a_owner, pb.owner_id AS b_owner FROM pm_matches m
    JOIN pm_profiles pa ON pa.profile_id = m.profile_a JOIN pm_profiles pb ON pb.profile_id = m.profile_b
    WHERE m.match_id = $1`, [id]);
  const m = rows[0]; if (!m) return null;
  const me = uid(req);
  if (String(m.a_owner) === me) { m.my_profile = m.profile_a; m.other_profile = m.profile_b; m.other_owner = m.b_owner; }
  else if (String(m.b_owner) === me) { m.my_profile = m.profile_b; m.other_profile = m.profile_a; m.other_owner = m.a_owner; }
  else return null;
  return m;
}
const dateOut = (d, me) => d && ({ id: d.date_id, status: d.status, slots: (d.slots || []).map(iso), place: d.place, note: d.note || '', starts_at: iso(d.starts_at),
  mine: String(d.proposed_by) === me, reason: d.reason || null, created_at: iso(d.created_at), responded_at: iso(d.responded_at), past: d.starts_at ? new Date(d.starts_at) < new Date() : false });

exports.matches = async (req, res) => {
  try {
    const me = uid(req), O = await ownerJoin();
    const { rows } = await query(`
      WITH my AS (SELECT profile_id FROM pm_profiles WHERE owner_id::text = $1)
      SELECT m.match_id, m.intent, m.created_at AS m_created, m.status AS m_status,
        CASE WHEN m.profile_a IN (SELECT profile_id FROM my) THEN m.profile_a ELSE m.profile_b END AS my_id,
        ${PCOLS}, ${O.sel},
        (SELECT row_to_json(x) FROM (SELECT body, kind, sender_id::text AS sender, created_at FROM pm_messages WHERE match_id = m.match_id ORDER BY message_id DESC LIMIT 1) x) AS last_msg,
        (SELECT COUNT(*)::int FROM pm_messages x LEFT JOIN pm_reads r ON r.match_id = x.match_id AND r.user_id::text = $1
           WHERE x.match_id = m.match_id AND x.sender_id::text <> $1 AND x.message_id > COALESCE(r.last_read_id, 0)) AS unread,
        (SELECT row_to_json(d) FROM (SELECT * FROM pm_dates WHERE match_id = m.match_id AND status IN ('pending','confirmed') LIMIT 1) d) AS active_date,
        (SELECT row_to_json(d) FROM (SELECT * FROM pm_dates WHERE match_id = m.match_id ORDER BY created_at DESC LIMIT 1) d) AS last_date
      FROM pm_matches m
      JOIN pm_profiles p ON p.profile_id = CASE WHEN m.profile_a IN (SELECT profile_id FROM my) THEN m.profile_b ELSE m.profile_a END
      ${O.join}
      WHERE m.status = 'matched' AND (m.profile_a IN (SELECT profile_id FROM my) OR m.profile_b IN (SELECT profile_id FROM my))
      ORDER BY GREATEST(m.created_at, COALESCE((SELECT MAX(created_at) FROM pm_messages WHERE match_id = m.match_id), m.created_at)) DESC
      LIMIT 200`, [me]);
    const mineNames = {}; (await query(`SELECT profile_id, name, photos FROM pm_profiles WHERE owner_id::text = $1`, [me])).rows.forEach(r => { mineNames[r.profile_id] = r; });
    return R.ok(res, { matches: rows.map(r => {
      const d = r.active_date || r.last_date;
      return { id: r.match_id, intent: r.intent, created_at: iso(r.m_created), unread: r.unread,
        my_pet: { id: r.my_id, name: (mineNames[r.my_id] || {}).name, photo: ((mineNames[r.my_id] || {}).photos || []).filter(httpsUrl)[0] || null },
        pet: pub(r), last: r.last_msg ? { text: r.last_msg.body, system: r.last_msg.kind === 'system', mine: r.last_msg.sender === me, at: iso(r.last_msg.created_at) } : null,
        date: d ? dateOut({ ...d, slots: d.slots, starts_at: d.starts_at }, me) : null };
    }) });
  } catch (e) { return fail(res, 'matches', e); }
};

exports.match = async (req, res) => {
  try {
    const m = await loadMatch(req, req.params.id); if (!m) return notFound(res, 'Match not found');
    const me = uid(req), O = await ownerJoin();
    const ps = (await query(`SELECT ${PCOLS}, ${O.sel} FROM pm_profiles p ${O.join} WHERE p.profile_id = ANY($1)`, [[m.my_profile, m.other_profile]])).rows;
    const mineP = ps.find(p => String(p.profile_id) === String(m.my_profile)), other = ps.find(p => String(p.profile_id) === String(m.other_profile));
    const msgs = (await query(`SELECT message_id, sender_id::text AS sender, body, kind, created_at FROM pm_messages WHERE match_id = $1 ORDER BY message_id DESC LIMIT 150`, [m.match_id])).rows.reverse();
    const dates = (await query(`SELECT * FROM pm_dates WHERE match_id = $1 ORDER BY created_at DESC LIMIT 20`, [m.match_id])).rows;
    if (msgs.length) await query(`INSERT INTO pm_reads (match_id, user_id, last_read_id) VALUES ($1,$2,$3)
      ON CONFLICT (match_id, user_id) DO UPDATE SET last_read_id = GREATEST(pm_reads.last_read_id, EXCLUDED.last_read_id)`, [m.match_id, me, msgs[msgs.length - 1].message_id]);
    const c = compat(mineP, other, m.intent);
    return R.ok(res, { match: { id: m.match_id, intent: m.intent, status: m.status, created_at: iso(m.created_at),
      my_pet: mine(mineP), pet: pub(other, { score: c.score, why: c.why, km: c.km }),
      messages: msgs.map(x => ({ id: Number(x.message_id), text: x.body, system: x.kind === 'system', mine: x.sender === me, at: iso(x.created_at) })),
      dates: dates.map(d => dateOut(d, me)), active_date: dateOut(dates.find(d => ['pending', 'confirmed'].includes(d.status)), me) || null } });
  } catch (e) { return fail(res, 'match', e); }
};

async function sysMsg(m, by, text) { await query(`INSERT INTO pm_messages (match_id, sender_id, body, kind) VALUES ($1,$2,$3,'system')`, [m.match_id, by, text.slice(0, 1000)]); }
const fmtSlot = t => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

exports.send = async (req, res) => {
  try {
    const m = await loadMatch(req, req.params.id); if (!m) return notFound(res, 'Match not found');
    if (m.status !== 'matched') return conflict(res, 'This match has ended.');
    const text = str(req.body && req.body.text, 1000); if (!text) return bad(res, ['text'], 'Type a message');
    const me = uid(req);
    const prev = (await query(`SELECT sender_id::text AS s, created_at FROM pm_messages WHERE match_id = $1 AND kind = 'text' ORDER BY message_id DESC LIMIT 1`, [m.match_id])).rows[0];
    const r = await query(`INSERT INTO pm_messages (match_id, sender_id, body) VALUES ($1,$2,$3) RETURNING message_id, created_at`, [m.match_id, me, text]);
    await query(`INSERT INTO pm_reads (match_id, user_id, last_read_id) VALUES ($1,$2,$3) ON CONFLICT (match_id, user_id) DO UPDATE SET last_read_id = EXCLUDED.last_read_id`, [m.match_id, me, r.rows[0].message_id]);
    if (!prev || prev.s !== me || Date.now() - new Date(prev.created_at).getTime() > 15 * 60000) {
      const pet = (await query(`SELECT name FROM pm_profiles WHERE profile_id = $1`, [m.my_profile])).rows[0] || {};
      await notify(m.other_owner, `New PawMatch message from ${pet.name || 'a match'}'s parent`, text.slice(0, 140), '35_pawmatch.html?match=' + m.match_id);
    }
    return R.ok(res, { message: { id: Number(r.rows[0].message_id), text, mine: true, system: false, at: iso(r.rows[0].created_at) } });
  } catch (e) { return fail(res, 'send', e); }
};

exports.propose = async (req, res) => {
  try {
    const m = await loadMatch(req, req.params.id); if (!m) return notFound(res, 'Match not found');
    if (m.status !== 'matched') return conflict(res, 'This match has ended.');
    const b = req.body || {}, now = Date.now();
    const slots = [...new Set((Array.isArray(b.slots) ? b.slots : []).map(s => new Date(s)).filter(d => !isNaN(d)).map(d => d.toISOString()))].sort();
    if (slots.length < 1 || slots.length > 3) return bad(res, ['slots'], 'Offer 1 to 3 date and time options.');
    if (slots.some(s => new Date(s).getTime() < now + 60 * 60000)) return bad(res, ['slots'], 'Each option must be at least an hour from now.');
    if (slots.some(s => new Date(s).getTime() > now + 60 * 86400000)) return bad(res, ['slots'], 'Pick options within the next 60 days.');
    const place = str(b.place, 160); if (place.length < 3) return bad(res, ['place'], 'Say where you’d like to meet.');
    const note = str(b.note, 300) || null, me = uid(req);
    let d;
    try {
      d = (await query(`INSERT INTO pm_dates (match_id, proposed_by, slots, place, note) VALUES ($1,$2,$3::timestamptz[],$4,$5) RETURNING *`, [m.match_id, me, slots, place, note])).rows[0];
    } catch (e) { if (e.code === '23505') return conflict(res, 'There’s already a date planned or waiting for an answer. Cancel it first to suggest a new one.'); throw e; }
    const pet = (await query(`SELECT name FROM pm_profiles WHERE profile_id = $1`, [m.my_profile])).rows[0] || {};
    await sysMsg(m, me, `📅 ${pet.name || 'Your match'}'s parent suggested a date at ${place}: ${slots.map(fmtSlot).join(' · ')}`);
    await notify(m.other_owner, `${pet.name || 'Your match'} wants to meet! 📅`, `Pick one of ${slots.length} time${slots.length > 1 ? 's' : ''} at ${place}.`, '35_pawmatch.html?match=' + m.match_id);
    return R.ok(res, { date: dateOut(d, me) });
  } catch (e) { return fail(res, 'propose', e); }
};

exports.respond = async (req, res) => {
  try {
    const m = await loadMatch(req, req.params.id); if (!m) return notFound(res, 'Match not found');
    const me = uid(req), b = req.body || {}, action = String(b.action || '');
    if (!UUID_RX.test(String(b.date || ''))) return bad(res, ['date']);
    const d = (await query(`SELECT * FROM pm_dates WHERE date_id = $1 AND match_id = $2`, [b.date, m.match_id])).rows[0];
    if (!d) return notFound(res, 'Date not found');
    const mineD = String(d.proposed_by) === me, reason = str(b.reason, 300) || null;
    const pet = (await query(`SELECT name FROM pm_profiles WHERE profile_id = $1`, [m.my_profile])).rows[0] || {};
    const who = pet.name ? pet.name + "'s parent" : 'Your match';
    let upd, msg, note;
    if (action === 'accept' || action === 'decline') {
      if (mineD) return forbid(res, 'Your match needs to answer this one.');
      if (d.status !== 'pending') return conflict(res, 'This suggestion has already been answered.');
      if (m.status !== 'matched') return conflict(res, 'This match has ended.');
      if (action === 'accept') {
        const want = new Date(b.slot);
        const slot = isNaN(want) ? null : (d.slots || []).map(iso).find(s => s === want.toISOString());
        if (!slot) return bad(res, ['slot'], 'Pick one of the suggested times.');
        if (new Date(slot) < new Date()) return conflict(res, 'That time has already passed — ask for a new date.');
        upd = await query(`UPDATE pm_dates SET status='confirmed', starts_at=$1, responded_by=$2, responded_at=NOW(), updated_at=NOW() WHERE date_id=$3 AND status='pending' RETURNING *`, [slot, me, d.date_id]);
        msg = `✅ Date confirmed: ${fmtSlot(slot)} at ${d.place}`; note = [`Date confirmed! 🐾`, `${fmtSlot(slot)} at ${d.place}`];
      } else {
        upd = await query(`UPDATE pm_dates SET status='declined', reason=$1, responded_by=$2, responded_at=NOW(), updated_at=NOW() WHERE date_id=$3 AND status='pending' RETURNING *`, [reason, me, d.date_id]);
        msg = `${who} couldn't make those times${reason ? ': ' + reason : ''}. Suggest new ones?`; note = [`${who} can't make those times`, reason || 'Suggest a few new options.'];
      }
    } else if (action === 'withdraw') {
      if (!mineD || d.status !== 'pending') return conflict(res, 'Only a waiting suggestion you made can be withdrawn.');
      upd = await query(`UPDATE pm_dates SET status='withdrawn', updated_at=NOW() WHERE date_id=$1 AND status='pending' RETURNING *`, [d.date_id]);
      msg = `${who} withdrew the date suggestion.`;
    } else if (action === 'cancel') {
      if (d.status !== 'confirmed') return conflict(res, 'Only a confirmed date can be cancelled.');
      upd = await query(`UPDATE pm_dates SET status='cancelled', reason=$1, responded_by=$2, responded_at=NOW(), updated_at=NOW() WHERE date_id=$3 AND status='confirmed' RETURNING *`, [reason, me, d.date_id]);
      msg = `❌ ${who} cancelled the date on ${fmtSlot(d.starts_at)}${reason ? ': ' + reason : ''}.`; note = ['Date cancelled', `${fmtSlot(d.starts_at)} at ${d.place}${reason ? ' — ' + reason : ''}`];
    } else if (action === 'done') {
      if (d.status !== 'confirmed') return conflict(res, 'Only a confirmed date can be marked as done.');
      if (new Date(d.starts_at) > new Date()) return conflict(res, 'You can mark it done once the date has happened.');
      upd = await query(`UPDATE pm_dates SET status='done', updated_at=NOW() WHERE date_id=$1 AND status='confirmed' RETURNING *`, [d.date_id]);
      msg = `🎉 ${who} marked the date as done.`;
    } else return bad(res, ['action']);
    if (!upd.rows.length) return conflict(res, 'This date was just changed — refresh and try again.');
    await sysMsg(m, me, msg);
    if (note) await notify(m.other_owner, note[0], note[1], '35_pawmatch.html?match=' + m.match_id);
    return R.ok(res, { date: dateOut(upd.rows[0], me) });
  } catch (e) { return fail(res, 'respond', e); }
};

exports.unmatch = async (req, res) => {
  try {
    const m = await loadMatch(req, req.params.id); if (!m) return notFound(res, 'Match not found');
    await query(`UPDATE pm_matches SET status='unmatched', ended_by=$1, updated_at=NOW() WHERE match_id=$2`, [uid(req), m.match_id]);
    await query(`UPDATE pm_dates SET status = CASE WHEN status='pending' THEN 'withdrawn' ELSE 'cancelled' END, reason = COALESCE(reason,'Match ended'), updated_at=NOW()
      WHERE match_id=$1 AND status IN ('pending','confirmed')`, [m.match_id]);
    return R.ok(res, { unmatched: true });
  } catch (e) { return fail(res, 'unmatch', e); }
};

exports.report = async (req, res) => {
  try {
    const b = req.body || {}, reason = String(b.reason || '');
    if (!REASONS.includes(reason)) return bad(res, ['reason']);
    if (!UUID_RX.test(String(b.profile || ''))) return bad(res, ['profile']);
    const p = (await query(`SELECT profile_id, owner_id FROM pm_profiles WHERE profile_id = $1`, [b.profile])).rows[0];
    if (!p || String(p.owner_id) === uid(req)) return notFound(res, 'Profile not found');
    const matchId = UUID_RX.test(String(b.match || '')) ? b.match : null;
    await query(`INSERT INTO pm_reports (reporter_id, profile_id, match_id, reason, details) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (reporter_id, profile_id) DO UPDATE SET reason = EXCLUDED.reason, details = EXCLUDED.details, created_at = NOW()`, [uid(req), p.profile_id, matchId, reason, str(b.details, 1000) || null]);
    // reporting also ends any match between the two owners' pets
    await query(`UPDATE pm_matches m SET status='unmatched', ended_by=$1::uuid, updated_at=NOW()
      WHERE m.status='matched' AND ((m.profile_a = $2 AND m.profile_b IN (SELECT profile_id FROM pm_profiles WHERE owner_id = $1::uuid))
        OR (m.profile_b = $2 AND m.profile_a IN (SELECT profile_id FROM pm_profiles WHERE owner_id = $1::uuid)))`, [uid(req), p.profile_id]);
    await query(`UPDATE pm_dates d SET status = CASE WHEN d.status='pending' THEN 'withdrawn' ELSE 'cancelled' END, reason='Match ended', updated_at=NOW()
      FROM pm_matches m WHERE d.match_id = m.match_id AND m.status='unmatched' AND d.status IN ('pending','confirmed') AND (m.profile_a = $1 OR m.profile_b = $1)`, [p.profile_id]);
    return R.ok(res, { reported: true });
  } catch (e) { return fail(res, 'report', e); }
};

// upcoming + waiting dates across all my matches (Dates tab)
exports.dates = async (req, res) => {
  try {
    const me = uid(req), O = await ownerJoin();
    const { rows } = await query(`
      WITH my AS (SELECT profile_id FROM pm_profiles WHERE owner_id::text = $1)
      SELECT d.*, m.intent, ${PCOLS}, ${O.sel},
        (SELECT name FROM pm_profiles WHERE profile_id = CASE WHEN m.profile_a IN (SELECT profile_id FROM my) THEN m.profile_a ELSE m.profile_b END) AS my_name
      FROM pm_dates d JOIN pm_matches m ON m.match_id = d.match_id
      JOIN pm_profiles p ON p.profile_id = CASE WHEN m.profile_a IN (SELECT profile_id FROM my) THEN m.profile_b ELSE m.profile_a END
      ${O.join}
      WHERE (m.profile_a IN (SELECT profile_id FROM my) OR m.profile_b IN (SELECT profile_id FROM my))
        AND (d.status = 'pending' OR (d.status IN ('confirmed','done') AND COALESCE(d.starts_at, d.created_at) > NOW() - INTERVAL '30 days'))
      ORDER BY CASE WHEN d.status='pending' THEN 0 WHEN d.status='confirmed' AND d.starts_at > NOW() THEN 1 ELSE 2 END, COALESCE(d.starts_at, d.created_at)
      LIMIT 100`, [me]);
    return R.ok(res, { dates: rows.map(r => Object.assign(dateOut(r, me), { match_id: r.match_id, intent: r.intent, my_pet: r.my_name, pet: pub(r) })) });
  } catch (e) { return fail(res, 'dates', e); }
};
