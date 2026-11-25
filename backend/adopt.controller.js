'use strict';
/* ============================================================================
   PawBook Adoption 2.0 (page 39) — mounted under /api/v1/adopt (see add_shop_routes.js).
   Builds on the existing tables (adoptable_pets, adoption_inquiries, shelters) extended by migration 016.
   The old /adoptions routes are untouched.
   Rules: never invent pet facts (unknown stays "unknown"); applying starts screening, it never completes
   an adoption; applicant details are visible only to that shelter's partner team and PawBook admins;
   registration references and private documents are visible to admins only.
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const fail = (res, where, e) => { console.error('[Adopt] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const conflict = (res, msg) => res.status(409).json({ success: false, message: msg });
const forbid = (res, msg) => res.status(403).json({ success: false, message: msg || 'Not allowed' });
const httpsUrl = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 600;
const iso = t => (t ? new Date(t).toISOString() : null);
const YNU = ['yes', 'no', 'unknown'];
const yn = (v, list) => ((list || YNU).includes(v) ? v : 'unknown');
async function tx(fn) {
  const c = await db.getClient();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { try { await c.query('ROLLBACK'); } catch (x) {} throw e; } finally { c.release(); }
}

// ── who am I ──
let HAS_NO = null;
async function hasUserNo() { if (HAS_NO === null) HAS_NO = (await query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'user_no'`)).rows.length > 0; return HAS_NO; }
async function me(req) {
  const id = String(req.user.user_id), hn = await hasUserNo();
  const { rows } = await query(`SELECT user_id::text AS id, ${hn ? 'user_no::text' : 'NULL'} AS no, role, full_name FROM users WHERE user_id::text = $1`, [id]);
  const u = rows[0] || { id };
  const sh = (await query(`SELECT shelter_id::text AS id, role FROM adoption_partner_users WHERE user_id::text = $1`, [id])).rows;
  return { id, no: u.no || null, name: u.full_name || null, admin: u.role === 'admin', role: u.role || null, shelters: sh.map(r => r.id), shelterRole: Object.fromEntries(sh.map(r => [r.id, r.role])) };
}
const canManage = (M, shelterId) => M.admin || (shelterId && M.shelters.includes(String(shelterId)));
async function notify(userId, title, body, link, emoji) {
  if (!userId) return;
  try { await query(`INSERT INTO notifications (user_id, type, title, body, link_url, icon_emoji) VALUES ($1,'system',$2,$3,$4,$5)`, [userId, title.slice(0, 200), body ? String(body).slice(0, 500) : null, link || null, emoji || '🐾']); }
  catch (e) { console.error('[Adopt] notify:', e.message); }
}
async function notifyPartners(shelterId, title, body, link) {
  if (!shelterId) return;
  const { rows } = await query(`SELECT user_id::text AS id FROM adoption_partner_users WHERE shelter_id = $1`, [shelterId]);
  for (const r of rows) await notify(r.id, title, body, link, '🏡');
}

// ── pets ──
const PET_SQL = `SELECT ap.*, s.name AS s_name, s.city AS s_city, s.state AS s_state, s.is_verified AS s_verified, s.verified_at AS s_verified_at, s.org_type AS s_type,
  s.phone AS s_phone, s.contact_phone AS s_cphone, s.contact_email AS s_email, s.website AS s_web, s.address AS s_address, s.adoption_policy AS s_policy
  FROM adoptable_pets ap LEFT JOIN shelters s ON s.shelter_id = ap.shelter_id`;
function ageLabel(r) {
  if (r.age_months != null) { const m = +r.age_months, y = Math.floor(m / 12), mm = m % 12;
    const t = y ? y + ' yr' + (y > 1 ? 's' : '') + (mm ? ' ' + mm + ' mo' : '') : mm + ' month' + (mm === 1 ? '' : 's');
    return (r.age_estimated ? 'About ' : '') + t; }
  return r.age ? String(r.age) : 'Age unknown';
}
function ageGroup(r) { if (r.age_months == null) return null; return r.age_months < 12 ? 'young' : r.age_months >= 96 ? 'senior' : 'adult'; }
function normPet(r, full) {
  const photos = [r.photo_url].concat(r.photos || []).filter(httpsUrl);
  const o = {
    id: r.id, name: r.name, species: r.species || 'Other', breed: r.breed || null, gender: r.gender || 'Unknown', age: ageLabel(r), age_months: r.age_months, age_estimated: r.age_estimated !== false, age_group: ageGroup(r),
    photos: [...new Set(photos)].slice(0, 12), status: r.status, urgency: r.urgency || 'normal', size: r.size || null, energy: r.energy || null,
    good_with_kids: yn(r.good_with_kids), good_with_dogs: yn(r.good_with_dogs), good_with_cats: yn(r.good_with_cats), apartment_ok: yn(r.apartment_ok), house_trained: yn(r.house_trained),
    vaccinated: yn(r.vaccinated, ['yes', 'partial', 'no', 'unknown']), sterilized: yn(r.sterilized), microchipped: yn(r.microchipped), care_level: r.care_level || null,
    city: r.location_city || r.s_city || null, state: r.location_state || r.s_state || null, country: r.location_country || null,
    shelter: r.shelter_id ? { id: r.shelter_id, name: r.s_name, verified: !!r.s_verified, type: r.s_type || 'shelter', city: r.s_city } : null,
    fee: r.adoption_fee != null ? Number(r.adoption_fee) : null, listed_at: iso(r.created_at), moderation: r.moderation
  };
  if (full) Object.assign(o, {
    description: r.description || null, temperament: r.temperament || null, rescue_story: r.rescue_story || null, health_notes: r.health_notes || null, special_needs: r.special_needs || null,
    requirements: r.requirements || null, fee_note: r.fee_note || null, video_url: httpsUrl(r.video_url) ? r.video_url : null, moderation_note: r.moderation_note || null,
    adopted_at: iso(r.adopted_at)
  });
  if (full && r.shelter_id) Object.assign(o.shelter, { phone: r.s_cphone || r.s_phone || null, email: r.s_email || null, website: r.s_web || null, address: r.s_address || null, policy: r.s_policy || null, verified_at: iso(r.s_verified_at) });
  return o;
}
// compatibility = a recommendation from what the rescuer recorded; unknown facts are listed, never assumed
const SP = s => { s = String(s || '').toLowerCase(); return /dog|puppy/.test(s) ? 'dog' : /cat|kitten/.test(s) ? 'cat' : /bird|parrot/.test(s) ? 'bird' : /rabbit|bunny/.test(s) ? 'rabbit' : 'other'; };
function match(p, a) {
  if (!a || !Object.keys(a).length) return null;
  let s = 55; const reasons = [], cautions = [], unknown = [];
  const sp = Array.isArray(a.species) ? a.species : [];
  if (sp.length && !sp.includes('any') && !sp.includes(SP(p.species))) return { score: 0, reasons: [], cautions: ['Not the kind of pet you are looking for'], unknown: [], other_species: true };
  const hh = Array.isArray(a.household) ? a.household : [];
  if (a.home === 'apartment' || a.home === 'small_flat') {
    if (p.apartment_ok === 'yes') { s += 12; reasons.push('Suitable for apartment living'); } else if (p.apartment_ok === 'no') { s -= 25; cautions.push('Needs more space than an apartment'); } else unknown.push('apartment living');
    if (a.home === 'small_flat' && p.size === 'large') { s -= 8; cautions.push('A large pet for a small flat'); }
  } else if (a.home === 'house') { s += 4; if (p.energy === 'high') reasons.push('Room to run in a house'); }
  if (hh.includes('children')) { if (p.good_with_kids === 'yes') { s += 12; reasons.push('Comfortable around children'); } else if (p.good_with_kids === 'no') { s -= 30; cautions.push('Not recommended with young children'); } else unknown.push('children'); }
  if (hh.includes('dogs')) { if (p.good_with_dogs === 'yes') { s += 8; reasons.push('Gets along with other dogs'); } else if (p.good_with_dogs === 'no') { s -= 20; cautions.push('Prefers to be the only dog'); } else unknown.push('other dogs'); }
  if (hh.includes('cats')) { if (p.good_with_cats === 'yes') { s += 8; reasons.push('Gets along with cats'); } else if (p.good_with_cats === 'no') { s -= 20; cautions.push('Not suited to a home with cats'); } else unknown.push('cats'); }
  if (hh.includes('elderly') && p.energy === 'high') { s -= 5; cautions.push('Very energetic — may be a lot for elderly family members'); }
  if (p.energy) {
    const want = { relaxed: 'low', moderate: 'medium', active: 'high' }[a.activity];
    if (want && want === p.energy) { s += 10; reasons.push('Activity needs match your lifestyle'); }
    else if (a.activity === 'relaxed' && p.energy === 'high') { s -= 15; cautions.push('Needs more exercise than your routine allows'); }
    else if (a.activity === 'active' && p.energy === 'low') { s += 2; reasons.push('Calm companion for your downtime'); }
  } else unknown.push('energy level');
  if (a.time === '1_2' && p.energy === 'high') { s -= 8; cautions.push('Needs more daily time than 1–2 hours'); }
  if (a.time === 'most') { s += 5; reasons.push('You can spend most of the day together'); }
  if (a.experience === 'first') {
    if (p.care_level === 'easy') { s += 6; reasons.push('Easy to care for — good for first-time parents'); }
    if (p.care_level === 'demanding' || p.special_needs) { s -= 12; cautions.push('Best with an experienced pet parent'); }
  }
  if (a.budget === 'low' && (p.care_level === 'demanding' || p.special_needs)) { s -= 6; cautions.push('Ongoing care costs may be higher'); }
  return { score: Math.max(5, Math.min(97, Math.round(s))), reasons: reasons.slice(0, 4), cautions: cautions.slice(0, 3), unknown };
}
async function prefsOf(uid) { const { rows } = await query(`SELECT answers FROM adoption_preferences WHERE user_id::text = $1`, [uid]); return rows[0] ? rows[0].answers : null; }

// GET /adopt/config
exports.config = async (req, res) => {
  try {
    const M = await me(req), [st, pr] = await Promise.all([
      query(`SELECT (SELECT COUNT(*)::int FROM adoptable_pets WHERE status IN ('available','reserved') AND moderation = 'approved') AS available,
                    (SELECT COUNT(*)::int FROM adoptable_pets WHERE status = 'adopted') AS adopted,
                    (SELECT COUNT(*)::int FROM shelters WHERE is_verified) AS verified_partners,
                    (SELECT COUNT(DISTINCT lower(COALESCE(location_city, ''))) ::int FROM adoptable_pets WHERE status IN ('available','reserved') AND moderation = 'approved' AND location_city IS NOT NULL) AS cities`),
      prefsOf(M.id)]);
    const req2 = (await query(`SELECT status, org_name, decision_note, created_at FROM adoption_partner_requests WHERE user_id::text = $1 ORDER BY created_at DESC LIMIT 1`, [M.id])).rows[0] || null;
    return R.ok(res, { stats: st.rows[0], preferences: pr, partner: { shelters: M.shelters, request: req2 }, admin: M.admin });
  } catch (e) { return fail(res, 'config', e); }
};
// GET /adopt/pets?species&city&state&country&gender&age&size&kids&q&sort&limit&offset
exports.list = async (req, res) => {
  try {
    const M = await me(req), q = req.query, w = [`ap.status IN ('available','reserved')`, `ap.moderation = 'approved'`], a = [];
    const add = (sql, v) => { a.push(v); w.push(sql.replace('?', '$' + a.length)); };
    if (q.species) add(`lower(ap.species) = lower(?)`, str(q.species, 40));
    if (q.country) add(`lower(COALESCE(ap.location_country, 'India')) = lower(?)`, str(q.country, 60));
    if (q.state) add(`lower(COALESCE(ap.location_state, s.state, '')) = lower(?)`, str(q.state, 80));
    if (q.city) add(`lower(COALESCE(ap.location_city, s.city, '')) = lower(?)`, str(q.city, 80));
    if (q.gender) add(`lower(ap.gender) = lower(?)`, str(q.gender, 20));
    if (q.size) add(`ap.size = ?`, str(q.size, 10));
    if (q.kids === 'yes') w.push(`ap.good_with_kids = 'yes'`);
    if (q.age === 'young') w.push(`ap.age_months < 12`); else if (q.age === 'adult') w.push(`ap.age_months BETWEEN 12 AND 95`); else if (q.age === 'senior') w.push(`ap.age_months >= 96`);
    if (q.urgent === '1') w.push(`ap.urgency IN ('urgent','high')`);
    if (q.q) add(`(ap.name ILIKE ? OR ap.breed ILIKE $${a.length} OR s.name ILIKE $${a.length})`, '%' + str(q.q, 60).replace(/[%_]/g, '') + '%');
    const lim = Math.min(Math.max(parseInt(q.limit, 10) || 60, 1), 120), off = Math.max(parseInt(q.offset, 10) || 0, 0);
    const [{ rows }, wl, prefs] = await Promise.all([
      query(`${PET_SQL} WHERE ${w.join(' AND ')} ORDER BY (ap.urgency IN ('urgent','high')) DESC, ap.created_at DESC LIMIT ${lim + 1} OFFSET ${off}`, a),
      query(`SELECT pet_id FROM adoption_wishlist WHERE user_id::text = $1`, [M.id]), prefsOf(M.id)]);
    const W = new Set(wl.rows.map(r => r.pet_id));
    let pets = rows.slice(0, lim).map(r => { const p = normPet(r); p.saved = W.has(p.id); p.match = match(p, prefs); return p; });
    if (q.sort === 'match' && prefs) pets.sort((x, y) => (y.match ? y.match.score : 0) - (x.match ? x.match.score : 0));
    return R.ok(res, { pets, more: rows.length > lim, has_preferences: !!prefs });
  } catch (e) { return fail(res, 'list', e); }
};
// GET /adopt/pets/:id
exports.detail = async (req, res) => {
  try {
    const M = await me(req), id = parseInt(req.params.id, 10); if (!id) return R.notFound(res, 'Pet not found');
    const { rows } = await query(`${PET_SQL} WHERE ap.id = $1`, [id]); const r = rows[0]; if (!r) return R.notFound(res, 'Pet not found');
    const manage = canManage(M, r.shelter_id) || (r.listed_by && String(r.listed_by) === M.id);
    if (r.moderation !== 'approved' && !manage) return R.notFound(res, 'Pet not found');
    const p = normPet(r, true), prefs = await prefsOf(M.id);
    p.match = match(p, prefs); p.can_manage = !!manage;
    p.saved = (await query(`SELECT 1 FROM adoption_wishlist WHERE user_id::text = $1 AND pet_id = $2`, [M.id, id])).rows.length > 0;
    const app = (await query(`SELECT inquiry_id::text AS id, stage, created_at FROM adoption_inquiries WHERE user_id::text = $1 AND pet_id = $2 ORDER BY created_at DESC LIMIT 1`, [M.id, id])).rows[0];
    p.my_application = app ? { id: app.id, stage: app.stage, at: iso(app.created_at) } : null;
    const sim = (await query(`${PET_SQL} WHERE ap.id <> $1 AND ap.status = 'available' AND ap.moderation = 'approved' AND lower(ap.species) = lower($2) ORDER BY (lower(COALESCE(ap.location_city,'')) = lower($3)) DESC, ap.created_at DESC LIMIT 4`, [id, r.species || '', r.location_city || ''])).rows;
    return R.ok(res, { pet: p, similar: sim.map(x => normPet(x)), disclaimer: 'Compatibility is a recommendation based on what the rescuer has recorded. It is not a guarantee of behaviour — meet the pet and talk to the rescuer before deciding.' });
  } catch (e) { return fail(res, 'detail', e); }
};

// ── preferences + wishlist ──
const Q = { home: ['house', 'apartment', 'small_flat'], activity: ['relaxed', 'moderate', 'active'], time: ['1_2', '3_5', 'most'], experience: ['first', 'experienced'], budget: ['low', 'medium', 'high'] };
exports.savePrefs = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, a = {};
    Object.keys(Q).forEach(k => { if (Q[k].includes(b[k])) a[k] = b[k]; });
    a.household = (Array.isArray(b.household) ? b.household : []).filter(x => ['adults', 'children', 'elderly', 'dogs', 'cats', 'other_pets'].includes(x));
    a.species = (Array.isArray(b.species) ? b.species : []).filter(x => ['dog', 'cat', 'bird', 'rabbit', 'other', 'any'].includes(x));
    if (!a.home || !a.activity) return bad(res, ['home', 'activity'], 'Please answer the questions');
    a.ownership_confirmed = b.ownership_confirmed === true;
    await query(`INSERT INTO adoption_preferences (user_id, answers) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET answers = $2, updated_at = NOW()`, [M.id, JSON.stringify(a)]);
    return R.ok(res, { saved: true, preferences: a });
  } catch (e) { return fail(res, 'savePrefs', e); }
};
exports.clearPrefs = async (req, res) => { try { const M = await me(req); await query(`DELETE FROM adoption_preferences WHERE user_id::text = $1`, [M.id]); return R.ok(res, { cleared: true }); } catch (e) { return fail(res, 'clearPrefs', e); } };
exports.wishlist = async (req, res) => {
  try { const M = await me(req), prefs = await prefsOf(M.id);
    const { rows } = await query(`${PET_SQL} JOIN adoption_wishlist w ON w.pet_id = ap.id WHERE w.user_id::text = $1 ORDER BY w.created_at DESC LIMIT 200`, [M.id]);
    return R.ok(res, { pets: rows.filter(r => r.moderation === 'approved').map(r => { const p = normPet(r); p.saved = true; p.match = match(p, prefs); return p; }) }); }
  catch (e) { return fail(res, 'wishlist', e); }
};
exports.toggleWish = async (req, res) => {
  try { const M = await me(req), id = parseInt(req.params.id, 10), on = req.method !== 'DELETE';
    if (on) { const { rows } = await query(`SELECT 1 FROM adoptable_pets WHERE id = $1 AND moderation = 'approved'`, [id]); if (!rows.length) return R.notFound(res, 'Pet not found');
      await query(`INSERT INTO adoption_wishlist (user_id, pet_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [M.id, id]); }
    else await query(`DELETE FROM adoption_wishlist WHERE user_id::text = $1 AND pet_id = $2`, [M.id, id]);
    return R.ok(res, { saved: on }); }
  catch (e) { return fail(res, 'toggleWish', e); }
};

// ── applications ──
const STAGES = ['submitted', 'initial_review', 'rescuer_contact', 'meet_greet', 'home_check', 'more_info', 'approved', 'agreement', 'handed_over', 'followup', 'completed', 'rejected', 'withdrawn'];
const ACTIVE = ['submitted', 'initial_review', 'rescuer_contact', 'meet_greet', 'home_check', 'more_info', 'approved', 'agreement'];
const legacyStatus = s => (['rejected', 'withdrawn'].includes(s) ? s : ['handed_over', 'followup', 'completed'].includes(s) ? 'completed' : ['approved', 'agreement'].includes(s) ? 'approved' : 'pending');
// POST /adopt/pets/:id/apply
exports.apply = async (req, res) => {
  try {
    const M = await me(req), id = parseInt(req.params.id, 10), b = req.body || {}, e = [];
    const name = str(b.name, 200) || M.name || '', phone = str(b.phone, 30), email = str(b.email, 200);
    if (!phone || !/^[+\d][\d\s-]{6,20}$/.test(phone)) e.push('phone');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.push('email');
    const reason = str(b.reason, 1500); if (reason.length < 20) e.push('reason');
    const living = str(b.living_situation, 1000); if (living.length < 10) e.push('living_situation');
    const exp = str(b.prior_pet_experience, 1000);
    if (b.ownership_confirmed !== true) e.push('ownership_confirmed');
    if (b.declaration_accepted !== true) e.push('declaration_accepted');
    if (e.length) return bad(res, e);
    const answers = { household: Array.isArray(b.household) ? b.household.filter(x => typeof x === 'string').slice(0, 8) : [], home: str(b.home, 20), hours_alone: str(b.hours_alone, 20), landlord_ok: str(b.landlord_ok, 10), visit_ok: b.visit_ok === true };
    const out = await tx(async c => {
      const { rows } = await c.query(`SELECT id, shelter_id, name, status, moderation, listed_by FROM adoptable_pets WHERE id = $1 FOR UPDATE`, [id]);
      const p = rows[0]; if (!p || p.moderation !== 'approved') return { nf: 1 };
      if (p.status !== 'available') return { busy: p.status };
      if (p.listed_by && String(p.listed_by) === M.id) return { own: 1 };
      const dup = await c.query(`SELECT 1 FROM adoption_inquiries WHERE user_id::text = $1 AND pet_id = $2 AND stage = ANY($3)`, [M.id, id, ACTIVE]); if (dup.rows.length) return { dup: 1 };
      const n = await c.query(`SELECT COUNT(*)::int AS n FROM adoption_inquiries WHERE user_id::text = $1 AND created_at > NOW() - INTERVAL '1 day'`, [M.id]); if (n.rows[0].n >= 5) return { many: 1 };
      const ins = await c.query(`INSERT INTO adoption_inquiries (user_id, pet_id, shelter_id, message, applicant_name, applicant_email, applicant_phone, status, purpose, reason, living_situation, prior_pet_experience, declaration_accepted, stage, answers, ownership_confirmed)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','adoption',$8,$9,$10,TRUE,'submitted',$11,TRUE) RETURNING inquiry_id::text AS id`,
        [M.id, id, p.shelter_id, str(b.message, 1000) || null, name || null, email || null, phone, reason, living, exp || null, JSON.stringify(answers)]);
      await c.query(`INSERT INTO adoption_stage_history (inquiry_id, from_stage, to_stage, by_user, note) VALUES ($1,NULL,'submitted',$2,'Application submitted')`, [ins.rows[0].id, M.id]);
      return { id: ins.rows[0].id, pet: p };
    });
    if (out.nf) return R.notFound(res, 'Pet not found');
    if (out.busy) return conflict(res, out.busy === 'reserved' ? 'Someone is already in the final steps of adopting this pet. Save it to your wishlist — we will show it again if it becomes available.' : 'This pet is no longer available.');
    if (out.own) return conflict(res, 'You listed this pet.');
    if (out.dup) return conflict(res, 'You already have an application for this pet.');
    if (out.many) return res.status(429).json({ success: false, message: 'You have sent several applications today. Please wait for the rescuers to reply.' });
    await notifyPartners(out.pet.shelter_id, 'New adoption application for ' + out.pet.name, 'Review it in Adoption → Partner dashboard.', '39_adoption_matching.html?partner=1');
    if (out.pet.listed_by && !out.pet.shelter_id) await notify(String(out.pet.listed_by), 'New adoption application for ' + out.pet.name, null, '39_adoption_matching.html?partner=1', '🏡');
    return R.created(res, { id: out.id, stage: 'submitted' });
  } catch (e) { return fail(res, 'apply', e); }
};
async function history(ids, applicantView) {
  if (!ids.length) return {};
  const { rows } = await query(`SELECT inquiry_id::text AS id, from_stage, to_stage, note, at FROM adoption_stage_history WHERE inquiry_id::text = ANY($1) ${applicantView ? 'AND visible_to_applicant' : ''} ORDER BY at`, [ids]);
  const h = {}; rows.forEach(r => { (h[r.id] = h[r.id] || []).push({ stage: r.to_stage, note: r.note, at: iso(r.at) }); }); return h;
}
// GET /adopt/applications  (mine)
exports.myApplications = async (req, res) => {
  try {
    const M = await me(req);
    const { rows } = await query(`SELECT ai.inquiry_id::text AS id, ai.stage, ai.created_at, ai.visit_date, ai.decision_note, ap.id AS pet_id, ap.name, ap.photo_url, ap.photos, ap.species, s.name AS shelter, s.contact_phone, s.phone, s.contact_email,
        (SELECT story_id FROM adoption_stories st WHERE st.inquiry_id = ai.inquiry_id LIMIT 1) AS story_id
      FROM adoption_inquiries ai JOIN adoptable_pets ap ON ap.id = ai.pet_id LEFT JOIN shelters s ON s.shelter_id = ai.shelter_id WHERE ai.user_id::text = $1 ORDER BY ai.created_at DESC LIMIT 100`, [M.id]);
    const h = await history(rows.map(r => r.id), true);
    return R.ok(res, { applications: rows.map(r => ({ id: r.id, stage: r.stage, at: iso(r.created_at), visit_date: iso(r.visit_date), note: r.decision_note || null,
      pet: { id: r.pet_id, name: r.name, species: r.species, photo: [r.photo_url].concat(r.photos || []).find(httpsUrl) || null }, shelter: r.shelter || null,
      contact: ACTIVE.concat(['handed_over', 'followup', 'completed']).includes(r.stage) && r.stage !== 'submitted' ? { phone: r.contact_phone || r.phone || null, email: r.contact_email || null } : null,
      story_shared: !!r.story_id, history: h[r.id] || [] })) });
  } catch (e) { return fail(res, 'myApplications', e); }
};
// POST /adopt/applications/:id/withdraw
exports.withdraw = async (req, res) => {
  try {
    const M = await me(req), id = str(req.params.id, 40);
    const out = await tx(async c => {
      const { rows } = await c.query(`SELECT ai.inquiry_id, ai.stage, ai.pet_id, ai.shelter_id FROM adoption_inquiries ai WHERE ai.inquiry_id::text = $1 AND ai.user_id::text = $2 FOR UPDATE`, [id, M.id]);
      const a = rows[0]; if (!a) return { nf: 1 }; if (!ACTIVE.includes(a.stage)) return { done: 1 };
      await c.query(`UPDATE adoption_inquiries SET stage = 'withdrawn', status = 'withdrawn', stage_updated_at = NOW(), updated_at = NOW() WHERE inquiry_id = $1`, [a.inquiry_id]);
      await c.query(`INSERT INTO adoption_stage_history (inquiry_id, from_stage, to_stage, by_user, note) VALUES ($1,$2,'withdrawn',$3,'Withdrawn by applicant')`, [a.inquiry_id, a.stage, M.id]);
      await releaseIfReserved(c, a.pet_id); return a;
    });
    if (out.nf) return R.notFound(res, 'Application not found'); if (out.done) return conflict(res, 'This application can no longer be withdrawn.');
    await notifyPartners(out.shelter_id, 'An adoption application was withdrawn', null, '39_adoption_matching.html?partner=1');
    return R.ok(res, { withdrawn: true });
  } catch (e) { return fail(res, 'withdraw', e); }
};
async function releaseIfReserved(c, petId) {
  const { rows } = await c.query(`SELECT 1 FROM adoption_inquiries WHERE pet_id = $1 AND stage IN ('approved','agreement')`, [petId]);
  if (!rows.length) await c.query(`UPDATE adoptable_pets SET status = 'available', updated_at = NOW() WHERE id = $1 AND status = 'reserved'`, [petId]);
}

// ── partner (shelter / rescuer) ──
async function partnerScope(M) { return M.admin ? null : M.shelters; }
// GET /adopt/partner
exports.partner = async (req, res) => {
  try {
    const M = await me(req), sc = await partnerScope(M);
    if (sc && !sc.length) return R.ok(res, { shelters: [], pets: [], applications: [], fosters: [] });
    const where = sc ? `WHERE ap.shelter_id::text = ANY($1) OR ap.listed_by::text = $2` : '';
    const args = sc ? [sc, M.id] : [];
    const [sh, pets, apps] = await Promise.all([
      query(`SELECT shelter_id::text AS id, name, city, state, is_verified, verified_at, org_type FROM shelters WHERE ${sc ? 'shelter_id::text = ANY($1)' : 'shelter_id IN (SELECT shelter_id FROM adoption_partner_users)'} ORDER BY name LIMIT 100`, sc ? [sc] : []),
      query(`${PET_SQL} ${where} ORDER BY ap.created_at DESC LIMIT 300`, args),
      query(`SELECT ai.inquiry_id::text AS id, ai.stage, ai.created_at, ai.visit_date, ai.applicant_name, ai.applicant_phone, ai.applicant_email, ai.reason, ai.living_situation, ai.prior_pet_experience, ai.message, ai.answers, ai.decision_note, ai.shelter_notes,
          ap.id AS pet_id, ap.name AS pet_name, ap.status AS pet_status, (SELECT COUNT(*)::int FROM adoption_followups f WHERE f.inquiry_id = ai.inquiry_id) AS followups
        FROM adoption_inquiries ai JOIN adoptable_pets ap ON ap.id = ai.pet_id ${sc ? 'WHERE ai.shelter_id::text = ANY($1) OR ap.listed_by::text = $2' : ''} ORDER BY (ai.stage = ANY($${sc ? 3 : 1})) DESC, ai.created_at DESC LIMIT 300`, sc ? [sc, M.id, ACTIVE] : [ACTIVE])
    ]);
    const h = await history(apps.rows.map(r => r.id), false);
    const cities = [...new Set(sh.rows.map(r => String(r.city || '').toLowerCase()).filter(Boolean))];
    const verifiedPartner = M.admin || sh.rows.some(r => r.is_verified);
    const fosters = verifiedPartner && (cities.length || M.admin) ? (await query(`SELECT f.city, f.state, f.species, f.capacity, f.home_type, f.experience, f.notes, f.phone, f.updated_at, u.full_name FROM adoption_fosters f LEFT JOIN users u ON u.user_id = f.user_id WHERE f.active ${M.admin ? '' : 'AND lower(f.city) = ANY($1)'} ORDER BY f.updated_at DESC LIMIT 200`, M.admin ? [] : [cities])).rows
      .map(r => ({ name: r.full_name || 'PawBook member', city: r.city, state: r.state, species: r.species, capacity: r.capacity, home_type: r.home_type, experience: r.experience, notes: r.notes, phone: r.phone, at: iso(r.updated_at) })) : [];
    return R.ok(res, { shelters: sh.rows.map(r => ({ id: r.id, name: r.name, city: r.city, state: r.state, verified: !!r.is_verified, type: r.org_type })),
      pets: pets.rows.map(r => normPet(r, true)), applications: apps.rows.map(r => ({ id: r.id, stage: r.stage, at: iso(r.created_at), visit_date: iso(r.visit_date), name: r.applicant_name, phone: r.applicant_phone, email: r.applicant_email,
        reason: r.reason, living: r.living_situation, experience: r.prior_pet_experience, message: r.message, answers: r.answers, note: r.decision_note, private_note: r.shelter_notes, pet: { id: r.pet_id, name: r.pet_name, status: r.pet_status }, followups: r.followups, history: h[r.id] || [] })),
      fosters, foster_note: verifiedPartner ? null : 'Foster volunteers are shown to verified partners only.' });
  } catch (e) { return fail(res, 'partner', e); }
};
function readPet(b, partial) {
  const e = [], v = {}, has = k => !partial || b[k] !== undefined;
  if (has('name')) { v.name = str(b.name, 100); if (v.name.length < 2) e.push('name'); }
  if (has('species')) { v.species = str(b.species, 50); if (!v.species) e.push('species'); }
  if (has('breed')) v.breed = str(b.breed, 100) || null;
  if (has('gender')) { v.gender = ['Male', 'Female', 'Unknown'].includes(b.gender) ? b.gender : 'Unknown'; }
  if (has('age_months')) { v.age_months = b.age_months === '' || b.age_months == null ? null : parseInt(b.age_months, 10); if (v.age_months != null && !(v.age_months >= 0 && v.age_months <= 360)) e.push('age_months'); }
  if (has('age_estimated')) v.age_estimated = b.age_estimated !== false;
  if (has('photos')) { const a = Array.isArray(b.photos) ? b.photos : []; if (a.some(u => !httpsUrl(u))) e.push('photos'); v.photos = a.filter(httpsUrl).slice(0, 12); if (!partial && !v.photos.length) e.push('photos'); }
  if (has('video_url')) { v.video_url = str(b.video_url, 600) || null; if (v.video_url && !httpsUrl(v.video_url)) e.push('video_url'); }
  ['size', 'energy', 'care_level'].forEach(k => { if (has(k)) { const L = { size: ['small', 'medium', 'large'], energy: ['low', 'medium', 'high'], care_level: ['easy', 'moderate', 'demanding'] }[k]; v[k] = L.includes(b[k]) ? b[k] : null; } });
  ['good_with_kids', 'good_with_dogs', 'good_with_cats', 'apartment_ok', 'house_trained', 'sterilized', 'microchipped'].forEach(k => { if (has(k)) v[k] = yn(b[k]); });
  if (has('vaccinated')) v.vaccinated = yn(b.vaccinated, ['yes', 'partial', 'no', 'unknown']);
  [['description', 3000], ['temperament', 1500], ['rescue_story', 3000], ['health_notes', 2000], ['special_needs', 1500], ['requirements', 1500], ['fee_note', 200]].forEach(([k, n]) => { if (has(k)) v[k] = str(b[k], n) || null; });
  if (!partial && (!v.description || v.description.length < 30)) e.push('description');
  if (has('adoption_fee')) { v.adoption_fee = b.adoption_fee === '' || b.adoption_fee == null ? null : Number(b.adoption_fee); if (v.adoption_fee != null && !(v.adoption_fee >= 0 && v.adoption_fee <= 100000)) e.push('adoption_fee'); }
  if (has('urgency')) v.urgency = ['normal', 'urgent'].includes(b.urgency) ? b.urgency : 'normal';
  if (has('city')) { v.location_city = str(b.city, 100); if (!v.location_city) e.push('city'); }
  if (has('state')) v.location_state = str(b.state, 100) || null;
  if (has('country')) v.location_country = str(b.country, 100) || 'India';
  return { v, e };
}
// POST /adopt/partner/pets {shelter_id, ...}
exports.createPet = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, sid = str(b.shelter_id, 40);
    if (!canManage(M, sid)) return forbid(res, 'Only a rescue partner of this shelter can list pets. Apply to become a rescue partner first.');
    const { v, e } = readPet(b, false); if (e.length) return bad(res, e);
    const { rows: s } = await query(`SELECT is_verified FROM shelters WHERE shelter_id::text = $1`, [sid]); if (!s.length) return bad(res, ['shelter_id']);
    const moderation = s[0].is_verified || M.admin ? 'approved' : 'pending';
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM adoptable_pets WHERE listed_by::text = $1 AND created_at > NOW() - INTERVAL '1 day'`, [M.id]); if (n[0].n >= 30) return res.status(429).json({ success: false, message: 'Too many listings today' });
    const cols = Object.keys(v), vals = cols.map(k => (k === 'photos' ? v[k] : v[k]));
    const { rows } = await query(`INSERT INTO adoptable_pets (shelter_id, listed_by, status, moderation, photo_url, ${cols.join(', ')}) VALUES ($1,$2,'available',$3,$4, ${cols.map((_, i) => '$' + (i + 5)).join(', ')}) RETURNING id`,
      [sid, M.id, moderation, v.photos[0], ...vals]);
    return R.created(res, { id: rows[0].id, moderation });
  } catch (e) { return fail(res, 'createPet', e); }
};
// PATCH /adopt/partner/pets/:id
exports.updatePet = async (req, res) => {
  try {
    const M = await me(req), id = parseInt(req.params.id, 10), b = req.body || {};
    const { rows } = await query(`SELECT shelter_id, listed_by, status, moderation FROM adoptable_pets WHERE id = $1`, [id]); const p = rows[0];
    if (!p || !(canManage(M, p.shelter_id) || (p.listed_by && String(p.listed_by) === M.id))) return R.notFound(res, 'Pet not found');
    const { v, e } = readPet(b, true); if (e.length) return bad(res, e);
    if (b.status !== undefined) { if (!['available', 'on_hold', 'withdrawn'].includes(b.status)) return bad(res, ['status'], 'Status changes to reserved / adopted happen through applications');
      if (['reserved', 'adopted'].includes(p.status)) return conflict(res, 'This pet is in an adoption process — update it through the application.'); v.status = b.status; }
    if (v.photos && !v.photos.length) return bad(res, ['photos'], 'Please keep at least one real photo');
    if (v.photos) v.photo_url = v.photos[0];
    if (p.moderation === 'rejected') v.moderation = 'pending';
    const cols = Object.keys(v); if (!cols.length) return R.ok(res, { saved: true });
    await query(`UPDATE adoptable_pets SET ${cols.map((k, i) => k + ' = $' + (i + 2)).join(', ')}, updated_at = NOW() WHERE id = $1`, [id, ...cols.map(k => v[k])]);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'updatePet', e); }
};
// PATCH /adopt/partner/applications/:id {stage, note, private_note, visit_date}
exports.updateApplication = async (req, res) => {
  try {
    const M = await me(req), id = str(req.params.id, 40), b = req.body || {}, to = str(b.stage, 20);
    if (to && !STAGES.includes(to)) return bad(res, ['stage']);
    if (['withdrawn'].includes(to)) return bad(res, ['stage'], 'Only the applicant can withdraw');
    const note = str(b.note, 500) || null;
    if (['rejected', 'more_info'].includes(to) && !note) return bad(res, ['note'], 'Please tell the applicant why');
    let visit = null; if (b.visit_date) { visit = new Date(b.visit_date); if (isNaN(visit)) return bad(res, ['visit_date']); }
    const out = await tx(async c => {
      const { rows } = await c.query(`SELECT ai.*, ap.name AS pet_name, ap.status AS pet_status, ap.listed_by FROM adoption_inquiries ai JOIN adoptable_pets ap ON ap.id = ai.pet_id WHERE ai.inquiry_id::text = $1 FOR UPDATE OF ai`, [id]);
      const a = rows[0]; if (!a || !(canManage(M, a.shelter_id) || (a.listed_by && String(a.listed_by) === M.id))) return { nf: 1 };
      await c.query(`SELECT 1 FROM adoptable_pets WHERE id = $1 FOR UPDATE`, [a.pet_id]);
      const from = a.stage;
      if (to && to !== from) {
        if (['completed', 'rejected', 'withdrawn'].includes(from)) return { closed: 1 };
        if (to === 'handed_over' && !['approved', 'agreement'].includes(from)) return { order: 'Approve the application and complete the adoption agreement first' };
        if (['followup', 'completed'].includes(to) && !['handed_over', 'followup'].includes(from)) return { order: 'The pet must be handed over first' };
        if (['approved', 'agreement'].includes(to)) {
          const other = await c.query(`SELECT 1 FROM adoption_inquiries WHERE pet_id = $1 AND inquiry_id <> $2 AND stage IN ('approved','agreement','handed_over','followup','completed')`, [a.pet_id, a.inquiry_id]);
          if (other.rows.length) return { order: 'Another application for this pet is already approved' };
          if (a.pet_status === 'adopted') return { order: 'This pet is already adopted' };
          await c.query(`UPDATE adoptable_pets SET status = 'reserved', updated_at = NOW() WHERE id = $1 AND status IN ('available','on_hold')`, [a.pet_id]);
        }
        if (to === 'handed_over') {
          if (await hasUserNo()) await c.query(`UPDATE adoptable_pets SET status = 'adopted', adopted_at = NOW(), adopted_by_user_id = (SELECT user_no FROM users WHERE user_id = $2), updated_at = NOW() WHERE id = $1`, [a.pet_id, a.user_id]);
          else await c.query(`UPDATE adoptable_pets SET status = 'adopted', adopted_at = NOW(), updated_at = NOW() WHERE id = $1`, [a.pet_id]);
          const others = await c.query(`UPDATE adoption_inquiries SET stage = 'rejected', status = 'rejected', decision_note = 'This pet has found a home with another family.', stage_updated_at = NOW(), updated_at = NOW()
            WHERE pet_id = $1 AND inquiry_id <> $2 AND stage = ANY($3) RETURNING inquiry_id, user_id`, [a.pet_id, a.inquiry_id, ACTIVE]);
          for (const o of others.rows) await c.query(`INSERT INTO adoption_stage_history (inquiry_id, from_stage, to_stage, by_user, note) VALUES ($1,NULL,'rejected',$2,'This pet has found a home with another family.')`, [o.inquiry_id, M.id]);
          a._others = others.rows;
        }
        await c.query(`UPDATE adoption_inquiries SET stage = $2, status = $3, decision_note = COALESCE($4, decision_note), stage_updated_at = NOW(), updated_at = NOW() WHERE inquiry_id = $1`, [a.inquiry_id, to, legacyStatus(to), note]);
        await c.query(`INSERT INTO adoption_stage_history (inquiry_id, from_stage, to_stage, by_user, note) VALUES ($1,$2,$3,$4,$5)`, [a.inquiry_id, from, to, M.id, note]);
        if (to === 'rejected' && ['approved', 'agreement'].includes(from)) await releaseIfReserved(c, a.pet_id);
      } else if (note) await c.query(`INSERT INTO adoption_stage_history (inquiry_id, from_stage, to_stage, by_user, note) VALUES ($1,$2,$2,$3,$4)`, [a.inquiry_id, from, M.id, note]);
      if (b.private_note !== undefined) await c.query(`UPDATE adoption_inquiries SET shelter_notes = $2 WHERE inquiry_id = $1`, [a.inquiry_id, str(b.private_note, 2000) || null]);
      if (visit) { await c.query(`UPDATE adoption_inquiries SET visit_date = $2 WHERE inquiry_id = $1`, [a.inquiry_id, visit]);
        await c.query(`INSERT INTO adoption_stage_history (inquiry_id, from_stage, to_stage, by_user, note) VALUES ($1,$2,$2,$3,$4)`, [a.inquiry_id, to || from, M.id, 'Meeting scheduled']); }
      return { a, from, to: to || from };
    });
    if (out.nf) return R.notFound(res, 'Application not found');
    if (out.closed) return conflict(res, 'This application is closed.');
    if (out.order) return conflict(res, out.order);
    const L = { initial_review: 'is being reviewed', rescuer_contact: '— the rescuer will contact you', meet_greet: '— time to meet!', home_check: '— home suitability check next', more_info: '— the rescuer needs more information', approved: 'was approved! 🎉', agreement: '— adoption agreement stage', handed_over: '— welcome home! 🏡', followup: '— follow-up', completed: 'is complete ❤️', rejected: 'was not approved' };
    if (out.to !== out.from) await notify(String(out.a.user_id), 'Your application for ' + out.a.pet_name + ' ' + (L[out.to] || 'was updated'), note, '39_adoption_matching.html?tab=applications', '🐾');
    else if (b.visit_date) await notify(String(out.a.user_id), 'Meeting scheduled for ' + out.a.pet_name, new Date(b.visit_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), '39_adoption_matching.html?tab=applications', '📅');
    for (const o of out.a._others || []) await notify(String(o.user_id), out.a.pet_name + ' has found a home', 'Thank you for applying. There are many more pets waiting for a family like yours.', '39_adoption_matching.html', '🏡');
    return R.ok(res, { stage: out.to });
  } catch (e) { return fail(res, 'updateApplication', e); }
};
// POST /adopt/partner/applications/:id/followups {note, wellbeing}
exports.addFollowup = async (req, res) => {
  try {
    const M = await me(req), id = str(req.params.id, 40), b = req.body || {}, note = str(b.note, 1000);
    if (note.length < 5) return bad(res, ['note']);
    const { rows } = await query(`SELECT ai.inquiry_id, ai.shelter_id, ai.stage, ap.listed_by FROM adoption_inquiries ai JOIN adoptable_pets ap ON ap.id = ai.pet_id WHERE ai.inquiry_id::text = $1`, [id]); const a = rows[0];
    if (!a || !(canManage(M, a.shelter_id) || (a.listed_by && String(a.listed_by) === M.id))) return R.notFound(res, 'Application not found');
    if (!['handed_over', 'followup', 'completed'].includes(a.stage)) return conflict(res, 'Follow-ups start after the pet is handed over.');
    await query(`INSERT INTO adoption_followups (inquiry_id, note, wellbeing, by_user) VALUES ($1,$2,$3,$4)`, [a.inquiry_id, note, b.wellbeing === 'concern' ? 'concern' : 'good', M.id]);
    return R.created(res, { saved: true });
  } catch (e) { return fail(res, 'addFollowup', e); }
};

// ── shelters / partners ──
exports.shelters = async (req, res) => {
  try {
    const q = req.query, w = ['TRUE'], a = []; const add = (s, v) => { a.push(v); w.push(s.replace('?', '$' + a.length)); };
    if (q.city) add(`lower(s.city) = lower(?)`, str(q.city, 80)); if (q.state) add(`lower(s.state) = lower(?)`, str(q.state, 80)); if (q.country) add(`lower(COALESCE(s.country,'India')) = lower(?)`, str(q.country, 60));
    if (q.verified === '1') w.push('s.is_verified'); if (q.q) add(`s.name ILIKE ?`, '%' + str(q.q, 60).replace(/[%_]/g, '') + '%');
    const { rows } = await query(`SELECT s.shelter_id::text AS id, s.name, s.city, s.state, s.country, s.address, s.animals_accepted, s.is_verified, s.verified_at, s.verification_note, s.org_type, s.about, s.website, COALESCE(s.contact_phone, s.phone) AS phone, s.contact_email AS email, s.photo_url,
        (SELECT COUNT(*)::int FROM adoptable_pets p WHERE p.shelter_id = s.shelter_id AND p.status IN ('available','reserved') AND p.moderation = 'approved') AS pets,
        (SELECT COUNT(*)::int FROM adoptable_pets p WHERE p.shelter_id = s.shelter_id AND p.status = 'adopted') AS adopted
      FROM shelters s WHERE ${w.join(' AND ')} ORDER BY s.is_verified DESC, pets DESC, s.name LIMIT 200`, a);
    return R.ok(res, { shelters: rows.map(r => Object.assign(r, { verified: !!r.is_verified, verified_at: iso(r.verified_at), photo_url: httpsUrl(r.photo_url) ? r.photo_url : null, website: httpsUrl(r.website) || /^http:\/\//.test(r.website || '') ? r.website : null })) });
  } catch (e) { return fail(res, 'shelters', e); }
};
// POST /adopt/partners/apply
exports.applyPartner = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, e = [];
    const org = str(b.org_name, 200); if (org.length < 3) e.push('org_name');
    const type = ['shelter', 'rescue', 'ngo', 'individual'].includes(b.org_type) ? b.org_type : null; if (!type) e.push('org_type');
    const city = str(b.city, 100); if (!city) e.push('city');
    const phone = str(b.phone, 30); if (!/^[+\d][\d\s-]{6,20}$/.test(phone)) e.push('phone');
    const email = str(b.email, 200); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.push('email');
    const about = str(b.about, 2000); if (about.length < 30) e.push('about');
    let sid = str(b.shelter_id, 40) || null;
    if (sid) { const { rows } = await query(`SELECT 1 FROM shelters WHERE shelter_id::text = $1`, [sid]); if (!rows.length) e.push('shelter_id'); }
    if (e.length) return bad(res, e);
    try { await query(`INSERT INTO adoption_partner_requests (user_id, shelter_id, org_name, org_type, city, state, phone, email, registration_ref, about) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [M.id, sid, org, type, city, str(b.state, 100) || null, phone, email || null, str(b.registration_ref, 120) || null, about]); }
    catch (x) { if (x.code === '23505') return conflict(res, 'Your earlier request is still being reviewed.'); throw x; }
    return R.created(res, { status: 'pending' });
  } catch (e) { return fail(res, 'applyPartner', e); }
};

// ── reports, fosters, stories ──
const REASONS = ['suspicious_listing', 'fraud_fee', 'misleading_health', 'mistreatment', 'other'];
exports.report = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, reason = REASONS.includes(b.reason) ? b.reason : null;
    const pet = b.pet_id ? parseInt(b.pet_id, 10) : null, sid = str(b.shelter_id, 40) || null;
    if (!reason) return bad(res, ['reason']); if (!pet && !sid) return bad(res, ['pet_id']);
    try { await query(`INSERT INTO adoption_reports (user_id, pet_id, shelter_id, reason, details) VALUES ($1,$2,$3,$4,$5)`, [M.id, pet, sid, reason, str(b.details, 1000) || null]); }
    catch (x) { if (x.code === '23505') return conflict(res, 'You have already reported this. Our team is reviewing it.'); if (x.code === '23503') return R.notFound(res, 'Not found'); throw x; }
    return R.created(res, { reported: true });
  } catch (e) { return fail(res, 'report', e); }
};
exports.myFoster = async (req, res) => { try { const M = await me(req); const { rows } = await query(`SELECT city, state, species, capacity, home_type, experience, notes, phone, active FROM adoption_fosters WHERE user_id::text = $1`, [M.id]); return R.ok(res, { foster: rows[0] || null }); } catch (e) { return fail(res, 'myFoster', e); } };
exports.saveFoster = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, city = str(b.city, 100); if (!city) return bad(res, ['city']);
    const phone = str(b.phone, 30); if (phone && !/^[+\d][\d\s-]{6,20}$/.test(phone)) return bad(res, ['phone']);
    const sp = (Array.isArray(b.species) ? b.species : []).filter(x => ['dog', 'cat', 'bird', 'rabbit', 'other'].includes(x));
    const cap = Math.min(Math.max(parseInt(b.capacity, 10) || 1, 1), 20);
    await query(`INSERT INTO adoption_fosters (user_id, city, state, species, capacity, home_type, experience, notes, phone, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (user_id) DO UPDATE SET city = $2, state = $3, species = $4, capacity = $5, home_type = $6, experience = $7, notes = $8, phone = $9, active = $10, updated_at = NOW()`,
      [M.id, city, str(b.state, 100) || null, sp, cap, str(b.home_type, 20) || null, str(b.experience, 20) || null, str(b.notes, 500) || null, phone || null, b.active !== false]);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'saveFoster', e); }
};
exports.stories = async (req, res) => {
  try { const { rows } = await query(`SELECT st.story_id::text AS id, st.title, st.story, st.photo_url, st.created_at, ap.name AS pet_name, ap.species, u.full_name FROM adoption_stories st LEFT JOIN adoptable_pets ap ON ap.id = st.pet_id LEFT JOIN users u ON u.user_id = st.user_id WHERE st.status = 'approved' ORDER BY st.created_at DESC LIMIT 12`);
    return R.ok(res, { stories: rows.map(r => ({ id: r.id, title: r.title, story: r.story, photo: httpsUrl(r.photo_url) ? r.photo_url : null, at: iso(r.created_at), pet: r.pet_name, species: r.species, by: r.full_name ? r.full_name.split(' ')[0] : 'An adopter' })) }); }
  catch (e) { return fail(res, 'stories', e); }
};
exports.shareStory = async (req, res) => {
  try {
    const M = await me(req), id = str(req.params.id, 40), b = req.body || {};
    const title = str(b.title, 120), story = str(b.story, 2000); if (title.length < 3 || story.length < 30) return bad(res, ['story'], 'Please add a title and a few lines');
    if (b.photo_url && !httpsUrl(b.photo_url)) return bad(res, ['photo_url']);
    const { rows } = await query(`SELECT inquiry_id, pet_id, stage FROM adoption_inquiries WHERE inquiry_id::text = $1 AND user_id::text = $2`, [id, M.id]); const a = rows[0];
    if (!a) return R.notFound(res, 'Application not found'); if (!['handed_over', 'followup', 'completed'].includes(a.stage)) return conflict(res, 'Stories can be shared after your pet comes home.');
    try { await query(`INSERT INTO adoption_stories (inquiry_id, pet_id, user_id, title, story, photo_url) VALUES ($1,$2,$3,$4,$5,$6)`, [a.inquiry_id, a.pet_id, M.id, title, story, b.photo_url || null]); }
    catch (x) { if (x.code === '23505') return conflict(res, 'You already shared this story.'); throw x; }
    return R.created(res, { status: 'pending' });
  } catch (e) { return fail(res, 'shareStory', e); }
};

// ── admin ──
exports.adminQueue = async (req, res) => {
  try {
    const M = await me(req); if (!M.admin) return forbid(res);
    const [pets, reqs, reps, sts] = await Promise.all([
      query(`${PET_SQL} WHERE ap.moderation = 'pending' ORDER BY ap.created_at LIMIT 100`),
      query(`SELECT r.req_id::text AS id, r.org_name, r.org_type, r.city, r.state, r.phone, r.email, r.registration_ref, r.about, r.shelter_id::text AS shelter_id, r.created_at, u.full_name FROM adoption_partner_requests r LEFT JOIN users u ON u.user_id = r.user_id WHERE r.status = 'pending' ORDER BY r.created_at LIMIT 100`),
      query(`SELECT r.report_id::text AS id, r.reason, r.details, r.created_at, r.pet_id, ap.name AS pet_name, s.name AS shelter_name, r.shelter_id::text AS shelter_id FROM adoption_reports r LEFT JOIN adoptable_pets ap ON ap.id = r.pet_id LEFT JOIN shelters s ON s.shelter_id = COALESCE(r.shelter_id, ap.shelter_id) WHERE r.status = 'open' ORDER BY r.created_at LIMIT 100`),
      query(`SELECT story_id::text AS id, title, story, photo_url, created_at FROM adoption_stories WHERE status = 'pending' ORDER BY created_at LIMIT 50`)]);
    return R.ok(res, { pets: pets.rows.map(r => normPet(r, true)), partner_requests: reqs.rows.map(r => Object.assign(r, { at: iso(r.created_at) })), reports: reps.rows, stories: sts.rows });
  } catch (e) { return fail(res, 'adminQueue', e); }
};
exports.adminAction = async (req, res) => {
  try {
    const M = await me(req); if (!M.admin) return forbid(res);
    const kind = req.params.kind, id = str(req.params.id, 40), b = req.body || {}, act = str(b.action, 20), note = str(b.note, 300) || null;
    if (kind === 'pet') {
      if (!['approve', 'reject', 'hide'].includes(act)) return bad(res, ['action']); if (act === 'reject' && !note) return bad(res, ['note'], 'Please give a reason');
      const { rowCount } = await query(`UPDATE adoptable_pets SET moderation = $2, moderation_note = $3, updated_at = NOW() WHERE id = $1`, [parseInt(id, 10), { approve: 'approved', reject: 'rejected', hide: 'hidden' }[act], note]);
      if (!rowCount) return R.notFound(res, 'Not found');
    } else if (kind === 'partner') {
      if (!['approve', 'reject'].includes(act)) return bad(res, ['action']);
      const out = await tx(async c => {
        const { rows } = await c.query(`SELECT * FROM adoption_partner_requests WHERE req_id::text = $1 AND status = 'pending' FOR UPDATE`, [id]); const r = rows[0]; if (!r) return null;
        let sid = r.shelter_id;
        if (act === 'approve') {
          if (!sid) sid = (await c.query(`INSERT INTO shelters (name, city, state, country, phone, contact_phone, contact_email, about, org_type, is_verified, verified_at, verified_by, verification_note) VALUES ($1,$2,$3,'India',$4,$4,$5,$6,$7,$8,NOW(),$9,$10) RETURNING shelter_id`,
            [r.org_name, r.city, r.state, r.phone, r.email, r.about, r.org_type, b.verify !== false, M.id, b.verify !== false ? (note || 'Identity and organisation details reviewed by PawBook') : null])).rows[0].shelter_id;
          else if (b.verify !== false) await c.query(`UPDATE shelters SET is_verified = TRUE, verified_at = NOW(), verified_by = $2, verification_note = $3, org_type = COALESCE(org_type, $4) WHERE shelter_id = $1`, [sid, M.id, note || 'Identity and organisation details reviewed by PawBook', r.org_type]);
          await c.query(`INSERT INTO adoption_partner_users (shelter_id, user_id, role) VALUES ($1,$2,'admin') ON CONFLICT DO NOTHING`, [sid, r.user_id]);
        }
        await c.query(`UPDATE adoption_partner_requests SET status = $2, decision_note = $3, decided_by = $4, decided_at = NOW(), shelter_id = COALESCE(shelter_id, $5) WHERE req_id = $1`, [r.req_id, act === 'approve' ? 'approved' : 'rejected', note, M.id, sid]);
        return r;
      });
      if (!out) return R.notFound(res, 'Not found');
      await notify(String(out.user_id), act === 'approve' ? 'You are now a PawBook rescue partner 🏡' : 'Your rescue partner request was not approved', act === 'approve' ? 'You can now list pets and manage adoption applications.' : note, '39_adoption_matching.html?partner=1', '🏡');
    } else if (kind === 'shelter') {
      if (!['verify', 'unverify'].includes(act)) return bad(res, ['action']);
      const { rowCount } = await query(`UPDATE shelters SET is_verified = $2, verified_at = CASE WHEN $2 THEN NOW() ELSE NULL END, verified_by = $3, verification_note = $4 WHERE shelter_id::text = $1`, [id, act === 'verify', M.id, act === 'verify' ? (note || 'Identity and organisation details reviewed by PawBook') : note]);
      if (!rowCount) return R.notFound(res, 'Not found');
    } else if (kind === 'report') {
      if (!['resolve', 'dismiss'].includes(act)) return bad(res, ['action']);
      const { rowCount } = await query(`UPDATE adoption_reports SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = NOW() WHERE report_id::text = $1 AND status = 'open'`, [id, act === 'resolve' ? 'resolved' : 'dismissed', note, M.id]);
      if (!rowCount) return R.notFound(res, 'Not found');
    } else if (kind === 'story') {
      if (!['approve', 'hide'].includes(act)) return bad(res, ['action']);
      const { rowCount } = await query(`UPDATE adoption_stories SET status = $2 WHERE story_id::text = $1`, [id, act === 'approve' ? 'approved' : 'hidden']);
      if (!rowCount) return R.notFound(res, 'Not found');
    } else return R.notFound(res, 'Not found');
    return R.ok(res, { done: true });
  } catch (e) { return fail(res, 'adminAction', e); }
};
