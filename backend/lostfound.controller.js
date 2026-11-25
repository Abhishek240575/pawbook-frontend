'use strict';
/* ============================================================================
   PawBook Lost & Found 2.0 (page 38) — multilingual rescue & reunification network.
   Mounted under /api/v1/lostfound (see add_shop_routes.js). Migration 017.
   Privacy: phone numbers, exact coordinates and full microchip numbers are never public;
   people reach each other through the in-app message relay. Public maps use ≈500 m locations.
   Translation: originals are stored unchanged; machine translations (Anthropic, same key the AI
   assistant uses) are cached per language, labelled, and never delay alerts.
   ========================================================================== */
const crypto = require('crypto');
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const fail = (res, where, e) => { console.error('[LostFound] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const conflict = (res, msg) => res.status(409).json({ success: false, message: msg });
const forbid = (res, msg) => res.status(403).json({ success: false, message: msg || 'Not allowed' });
const httpsUrl = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 600;
const iso = t => (t ? new Date(t).toISOString() : null);
const num = v => (v === null || v === undefined || v === '' || isNaN(+v) ? null : +v);
const LANGS = { en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', mr: 'Marathi', te: 'Telugu', kn: 'Kannada', gu: 'Gujarati', pa: 'Punjabi', ml: 'Malayalam', ur: 'Urdu', or: 'Odia' };
const READY = ['en', 'hi', 'bn', 'ta', 'mr'];
const lang = v => (LANGS[v] ? v : 'en');
const SPECIES = ['dog', 'cat', 'bird', 'rabbit', 'other'];
const spk = s => { s = String(s || '').toLowerCase(); return /dog|puppy/.test(s) ? 'dog' : /cat|kitten/.test(s) ? 'cat' : /bird|parrot/.test(s) ? 'bird' : /rabbit|bunny/.test(s) ? 'rabbit' : 'other'; };
const approx = v => (v == null ? null : Math.round(v / 0.005) * 0.005);
const chipLast4 = c => { c = String(c || '').replace(/\s/g, ''); return c.length >= 4 ? c.slice(-4) : null; };
const validLat = v => v === null || (v >= -90 && v <= 90), validLng = v => v === null || (v >= -180 && v <= 180);
const hav = (a, b, c, d) => { if ([a, b, c, d].some(x => x == null)) return null; const r = x => x * Math.PI / 180, R2 = 6371, dl = r(c - a), dn = r(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2; return Math.round(2 * R2 * Math.asin(Math.sqrt(h)) * 10) / 10; };
async function tx(fn) { const c = await db.getClient(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { try { await c.query('ROLLBACK'); } catch (x) {} throw e; } finally { c.release(); } }

let HAS_NO = null;
async function hasUserNo() { if (HAS_NO === null) HAS_NO = (await query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'user_no'`)).rows.length > 0; return HAS_NO; }
async function me(req) {
  const id = String(req.user.user_id), hn = await hasUserNo();
  const { rows } = await query(`SELECT ${hn ? 'user_no::text' : 'NULL'} AS no, role, full_name, phone FROM users WHERE user_id::text = $1`, [id]);
  const u = rows[0] || {};
  const p = (await query(`SELECT * FROM pb_user_prefs WHERE user_id::text = $1`, [id])).rows[0] || null;
  return { id, no: u.no || null, name: u.full_name || null, phone: u.phone || null, admin: u.role === 'admin', prefs: p, lang: p ? lang(p.ui_lang) : 'en' };
}
async function notify(userId, title, body, link) {
  try { await query(`INSERT INTO notifications (user_id, type, title, body, link_url, icon_emoji) VALUES ($1,'system',$2,$3,$4,'🐾')`, [userId, String(title).slice(0, 200), body ? String(body).slice(0, 500) : null, link || null]); }
  catch (e) { console.error('[LostFound] notify:', e.message); }
}

// ── notification text in the recipient's language (fixed, reviewed wording; names and places are never translated) ──
const T = {
  en: { lost: 'Missing {sp} near {area}', found: '{sp} found near {area}', sight: 'New sighting reported for {name}', msg: 'New message about {name}', help: 'Tap to see photos and help.', reunited: '{name} is back home! 🎉',
    sp: { dog: 'dog', cat: 'cat', bird: 'bird', rabbit: 'rabbit', other: 'pet' } },
  hi: { lost: '{area} के पास {sp} लापता', found: '{area} के पास {sp} मिला', sight: '{name} को देखे जाने की नई सूचना', msg: '{name} के बारे में नया संदेश', help: 'फ़ोटो देखने और मदद करने के लिए टैप करें।', reunited: '{name} घर लौट आया! 🎉',
    sp: { dog: 'कुत्ता', cat: 'बिल्ली', bird: 'पक्षी', rabbit: 'खरगोश', other: 'पालतू जानवर' } },
  bn: { lost: '{area}-এর কাছে {sp} নিখোঁজ', found: '{area}-এর কাছে একটি {sp} পাওয়া গেছে', sight: '{name}-কে দেখা যাওয়ার নতুন খবর', msg: '{name} সম্পর্কে নতুন বার্তা', help: 'ছবি দেখতে ও সাহায্য করতে ট্যাপ করুন।', reunited: '{name} বাড়ি ফিরেছে! 🎉',
    sp: { dog: 'কুকুর', cat: 'বিড়াল', bird: 'পাখি', rabbit: 'খরগোশ', other: 'পোষা প্রাণী' } },
  ta: { lost: '{area} அருகே {sp} காணவில்லை', found: '{area} அருகே ஒரு {sp} கண்டுபிடிக்கப்பட்டது', sight: '{name} பற்றிய புதிய பார்வைத் தகவல்', msg: '{name} பற்றிய புதிய செய்தி', help: 'புகைப்படங்களைப் பார்க்கவும் உதவவும் தட்டவும்.', reunited: '{name} வீடு திரும்பியது! 🎉',
    sp: { dog: 'நாய்', cat: 'பூனை', bird: 'பறவை', rabbit: 'முயல்', other: 'செல்லப்பிராணி' } },
  mr: { lost: '{area} जवळ {sp} हरवले आहे', found: '{area} जवळ एक {sp} सापडले', sight: '{name} दिसल्याची नवी माहिती', msg: '{name} बद्दल नवीन संदेश', help: 'फोटो पाहण्यासाठी आणि मदतीसाठी टॅप करा.', reunited: '{name} घरी परतले! 🎉',
    sp: { dog: 'कुत्रा', cat: 'मांजर', bird: 'पक्षी', rabbit: 'ससा', other: 'पाळीव प्राणी' } }
};
const tt = (l, k, v) => { const d = T[l] || T.en; return (d[k] || T.en[k]).replace(/\{(\w+)\}/g, (_, x) => (x === 'sp' ? (d.sp[v.sp] || T.en.sp[v.sp] || v.sp) : v[x] != null ? v[x] : '')); };
async function prefLang(uid) { const { rows } = await query(`SELECT notify_lang FROM pb_user_prefs WHERE user_id::text = $1`, [uid]); return rows[0] ? lang(rows[0].notify_lang) : 'en'; }

// ── machine translation (cached; originals untouched) ──
const TFIELDS = { lost: ['breed', 'color', 'collar', 'marks', 'description', 'reward'], found: ['breed_guess', 'age_guess', 'color', 'collar', 'marks', 'description', 'shelter_note'], sighting: ['direction', 'description'], message: ['body'] };
const hashOf = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
async function aiTranslate(fields, target) {
  if (process.env.PB_TRANSLATE_MOCK === '1') { const o = {}; Object.keys(fields).forEach(k => { o[k] = '[' + target + '] ' + fields[k]; }); return { fields: o, model: 'mock' }; }
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const model = process.env.PB_TRANSLATE_MODEL || 'claude-haiku-4-5-20251001';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 2000, temperature: 0,
      system: 'You translate lost-and-found pet reports for an animal rescue app in India. Translate every field value into ' + LANGS[target] + '. The text may be written in any language or a mix (e.g. Hinglish). Keep pet names, people\'s names, place and landmark names, phone numbers, numbers, dates, times, microchip and reference IDs exactly as written. Do not add, remove, soften or guess information. If a value is already in ' + LANGS[target] + ', return it unchanged. Reply with only a JSON object that has exactly the same keys.',
      messages: [{ role: 'user', content: JSON.stringify(fields) }] }) });
  if (!r.ok) throw new Error('translate HTTP ' + r.status);
  const j = await r.json(); const t = ((j.content || [])[0] || {}).text || '';
  const m = t.match(/\{[\s\S]*\}/); if (!m) throw new Error('translate: no JSON');
  const out = JSON.parse(m[0]), clean = {};
  Object.keys(fields).forEach(k => { if (typeof out[k] === 'string' && out[k].length <= 6000) clean[k] = out[k]; });
  return { fields: clean, model };
}
async function sourceFields(type, id) {
  const tbl = { lost: 'lost_pet_reports', found: 'found_pet_reports', sighting: 'pet_sightings', message: 'pb_case_messages' }[type];
  const { rows } = await query(`SELECT * FROM ${tbl} WHERE id = $1`, [id]); const r = rows[0]; if (!r) return null;
  const f = {}; TFIELDS[type].forEach(k => { const col = type === 'lost' && k === 'breed' ? 'breed' : k; if (r[col] && String(r[col]).trim()) f[k] = String(r[col]); });
  return { fields: f, src: r.source_lang || 'en' };
}
async function translation(type, id, target, allowCall) {
  const s = await sourceFields(type, id); if (!s || !Object.keys(s.fields).length || s.src === target) return null;
  const h = hashOf(s.fields);
  const { rows } = await query(`SELECT fields, src_hash, model FROM pb_translations WHERE source_type = $1 AND source_id = $2 AND lang = $3`, [type, id, target]);
  if (rows[0] && rows[0].src_hash === h) return { lang: target, fields: rows[0].fields, machine: true, from: s.src };
  if (!allowCall) return null;
  const t = await aiTranslate(s.fields, target); if (!t) return null;
  await query(`INSERT INTO pb_translations (source_type, source_id, lang, src_hash, fields, model) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_type, source_id, lang) DO UPDATE SET src_hash = $4, fields = $5, model = $6, created_at = NOW()`, [type, id, target, h, JSON.stringify(t.fields), t.model]);
  return { lang: target, fields: t.fields, machine: true, from: s.src };
}
function translateLater(type, id, src) {   // never blocks the request or the alerts
  setImmediate(async () => { for (const l of READY) { if (l === src) continue; try { await translation(type, id, l, true); } catch (e) { console.error('[LostFound] translate ' + type + ' ' + id + ' ' + l + ':', e.message); return; } } });
}

// ── normalise cases ──
function photosOf(v) { let a = v; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = []; } } return (Array.isArray(a) ? a : []).map(x => (x && typeof x === 'object' ? x.url : x)).filter(httpsUrl).slice(0, 10); }
function isOwner(M, type, r) { return type === 'lost' ? (r.reporter_uuid ? String(r.reporter_uuid) === M.id : (M.no && String(r.user_id) === M.no)) : String(r.finder_id) === M.id; }
function lostWhen(r) { const d = r.date_last_seen instanceof Date ? new Date(r.date_last_seen.getTime() - r.date_last_seen.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(r.date_last_seen).slice(0, 10); return d + (r.time_last_seen ? 'T' + String(r.time_last_seen).slice(0, 5) : ''); }
function norm(type, r, M, extra) {
  const o = { type, id: Number(r.id), key: type + '-' + r.id, species: spk(r.species), species_label: r.species, photos: photosOf(r.photos), color: r.color || null, collar: r.collar || null, marks: r.marks || null, gender: r.gender || null,
    area: r.area, city: r.city || null, state: r.state || null, lat: r.public_lat != null ? Number(r.public_lat) : null, lng: r.public_lng != null ? Number(r.public_lng) : null,
    status: r.case_status, created_at: iso(r.created_at), source_lang: r.source_lang || 'en', description: r.description || null, sightings: r.sightings != null ? Number(r.sightings) : 0, alerts_sent: r.alerts_sent || 0, hidden: r.moderation === 'hidden' };
  if (type === 'lost') Object.assign(o, { name: r.pet_name, breed: r.breed || null, age: r.age || null, when: lostWhen(r), reward: r.reward || null, urgent: !!r.urgent, chip: chipLast4(r.microchip) });
  else Object.assign(o, { name: null, breed: r.breed_guess || null, age: r.age_guess || null, when: iso(r.found_at), safety: r.safety, can_hold: !!r.can_hold, shelter_note: r.shelter_note || null, chip: chipLast4(r.microchip_seen) });
  if (M) o.is_owner = isOwner(M, type, r);
  return Object.assign(o, extra || {});
}
async function archiveOld() {
  await query(`UPDATE lost_pet_reports SET case_status = 'archived' WHERE case_status IN ('active','sighted') AND last_activity_at < NOW() - INTERVAL '60 days'`);
  await query(`UPDATE found_pet_reports SET case_status = 'archived' WHERE case_status IN ('found','sheltered') AND last_activity_at < NOW() - INTERVAL '60 days'`);
}
const OPEN_LOST = ['active', 'sighted', 'identified'], OPEN_FOUND = ['found', 'sheltered', 'owner_identified'];

// GET /lostfound/config
exports.config = async (req, res) => {
  try {
    const M = await me(req); await archiveOld();
    const { rows } = await query(`SELECT
      (SELECT COUNT(*)::int FROM lost_pet_reports WHERE case_status = ANY($1) AND moderation = 'visible') AS missing,
      (SELECT COUNT(*)::int FROM found_pet_reports WHERE case_status = ANY($2) AND moderation = 'visible') AS found,
      (SELECT COUNT(*)::int FROM lost_pet_reports WHERE case_status = 'reunited') + (SELECT COUNT(*)::int FROM found_pet_reports WHERE case_status = 'reunited') AS reunited,
      (SELECT COUNT(*)::int FROM pb_rescue_volunteers WHERE active AND safety_ack) AS volunteers,
      (SELECT COUNT(*)::int FROM pet_sightings WHERE created_at > NOW() - INTERVAL '30 days') AS sightings_30d`, [OPEN_LOST, OPEN_FOUND]);
    const vol = (await query(`SELECT city, state, radius_km, can_search, can_transport, can_foster, languages, verified, active FROM pb_rescue_volunteers WHERE user_id::text = $1`, [M.id])).rows[0] || null;
    return R.ok(res, { stats: rows[0], prefs: M.prefs ? { ui_lang: M.prefs.ui_lang, notify_lang: M.prefs.notify_lang, extra_langs: M.prefs.extra_langs, auto_translate: M.prefs.auto_translate, show_original: M.prefs.show_original, alerts_on: M.prefs.alerts_on, alert_city: M.prefs.alert_city, alert_state: M.prefs.alert_state, alert_radius_km: M.prefs.alert_radius_km, has_alert_point: M.prefs.alert_lat != null } : null,
      volunteer: vol, admin: M.admin, languages: Object.keys(LANGS).map(k => ({ code: k, name: LANGS[k], translation: true })), translation_available: !!process.env.ANTHROPIC_API_KEY || process.env.PB_TRANSLATE_MOCK === '1' });
  } catch (e) { return fail(res, 'config', e); }
};
// GET /lostfound/cases?type&status&species&city&state&lat&lng&km&days&q&lang
exports.list = async (req, res) => {
  try {
    const M = await me(req), q = req.query; await archiveOld();
    const type = ['lost', 'found'].includes(q.type) ? q.type : 'all', want = l => type === 'all' || type === l;
    const st = q.status === 'reunited' ? 'reunited' : q.status === 'urgent' ? 'urgent' : 'open';
    const days = Math.min(Math.max(parseInt(q.days, 10) || 0, 0), 365), sp = SPECIES.includes(q.species) ? q.species : '';
    const lat = num(q.lat), lng = num(q.lng), km = Math.min(Math.max(num(q.km) || 0, 0), 100);
    const s = str(q.q, 60).toLowerCase(), city = str(q.city, 80).toLowerCase(), state = str(q.state, 80).toLowerCase();
    const out = [];
    if (want('lost')) {
      const { rows } = await query(`SELECT r.*, (SELECT COUNT(*) FROM pet_sightings s WHERE s.case_type = 'lost' AND s.case_id = r.id) AS sightings FROM lost_pet_reports r
        WHERE r.moderation = 'visible' AND r.case_status = ANY($1) ${days ? `AND r.created_at > NOW() - ($2 || ' days')::interval` : 'AND $2::text IS NOT NULL'} ORDER BY r.urgent DESC, r.created_at DESC LIMIT 400`, [st === 'reunited' ? ['reunited'] : OPEN_LOST, String(days || 0)]);
      rows.forEach(r => out.push(norm('lost', r, M)));
    }
    if (want('found') && st !== 'urgent') {
      const { rows } = await query(`SELECT r.*, (SELECT COUNT(*) FROM pet_sightings s WHERE s.case_type = 'found' AND s.case_id = r.id) AS sightings FROM found_pet_reports r
        WHERE r.moderation = 'visible' AND r.case_status = ANY($1) ${days ? `AND r.created_at > NOW() - ($2 || ' days')::interval` : 'AND $2::text IS NOT NULL'} ORDER BY r.created_at DESC LIMIT 400`, [st === 'reunited' ? ['reunited'] : OPEN_FOUND, String(days || 0)]);
      rows.forEach(r => out.push(norm('found', r, M)));
    }
    let list = out.filter(c => (!sp || c.species === sp) && (st !== 'urgent' || c.urgent) && (!city || String(c.city || '').toLowerCase() === city || (!c.city && String(c.area).toLowerCase().includes(city))) && (!state || String(c.state || '').toLowerCase() === state || !c.state)
      && (!s || [c.name, c.breed, c.color, c.area, c.marks, c.description].join(' ').toLowerCase().includes(s)));
    list.forEach(c => { c.distance_km = hav(lat, lng, c.lat, c.lng); });
    if (lat != null && lng != null && km) list = list.filter(c => c.distance_km != null && c.distance_km <= km);
    list.sort((a, b) => (lat != null && a.distance_km != null && b.distance_km != null ? a.distance_km - b.distance_km : 0) || ((b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)) || String(b.created_at).localeCompare(String(a.created_at)));
    list = list.slice(0, 200);
    // cached translations for the viewer's language (no API calls here)
    const L = lang(q.lang || M.lang);
    if (L !== 'en' || list.some(c => c.source_lang !== 'en')) {
      const need = list.filter(c => c.source_lang !== L);
      if (need.length) { const { rows } = await query(`SELECT source_type, source_id, fields FROM pb_translations WHERE lang = $1 AND (source_type, source_id) IN (SELECT * FROM UNNEST($2::text[], $3::bigint[]))`, [L, need.map(c => c.type), need.map(c => c.id)]);
        const map = {}; rows.forEach(r => { map[r.source_type + '-' + r.source_id] = r.fields; }); need.forEach(c => { if (map[c.key]) c.translated = { lang: L, fields: map[c.key] }; }); }
    }
    // recent public sightings for the map
    let sightings = [];
    if (q.with_sightings === '1') sightings = (await query(`SELECT s.id, s.case_type, s.case_id, s.public_lat, s.public_lng, s.seen_at, s.area FROM pet_sightings s WHERE s.public_lat IS NOT NULL AND s.created_at > NOW() - INTERVAL '30 days' ORDER BY s.created_at DESC LIMIT 300`)).rows
      .map(r => ({ id: Number(r.id), case: r.case_type + '-' + r.case_id, lat: Number(r.public_lat), lng: Number(r.public_lng), at: iso(r.seen_at), area: r.area }));
    return R.ok(res, { cases: list, sightings });
  } catch (e) { return fail(res, 'list', e); }
};
async function loadCase(type, id) {
  if (!['lost', 'found'].includes(type)) return null; const n = parseInt(id, 10); if (!n) return null;
  const { rows } = await query(`SELECT * FROM ${type === 'lost' ? 'lost_pet_reports' : 'found_pet_reports'} WHERE id = $1`, [n]); return rows[0] || null;
}
// possible matches between lost and found reports — a suggestion for people to check, never a confirmation
async function matches(type, r) {
  const other = type === 'lost' ? 'found' : 'lost', sp = spk(r.species);
  const { rows } = await query(other === 'found'
    ? `SELECT f.*, t.fields AS en FROM found_pet_reports f LEFT JOIN pb_translations t ON t.source_type = 'found' AND t.source_id = f.id AND t.lang = 'en' WHERE f.moderation = 'visible' AND f.case_status = ANY($1) AND f.found_at > NOW() - INTERVAL '90 days' LIMIT 300`
    : `SELECT l.*, t.fields AS en FROM lost_pet_reports l LEFT JOIN pb_translations t ON t.source_type = 'lost' AND t.source_id = l.id AND t.lang = 'en' WHERE l.moderation = 'visible' AND l.case_status = ANY($1) AND l.created_at > NOW() - INTERVAL '90 days' LIMIT 300`, [other === 'found' ? OPEN_FOUND : OPEN_LOST]);
  const myEn = (await query(`SELECT fields FROM pb_translations WHERE source_type = $1 AND source_id = $2 AND lang = 'en'`, [type, r.id])).rows[0];
  const words = o => new Set(String(Object.values(o || {}).join(' ')).toLowerCase().match(/[a-zऀ-෿]{3,}/g) || []);
  const COL = ['black', 'white', 'brown', 'golden', 'grey', 'gray', 'cream', 'tan', 'orange', 'ginger', 'spotted', 'brindle', 'red', 'collar', 'scar', 'tail', 'ear', 'eye', 'labrador', 'shepherd', 'indie', 'beagle', 'persian', 'pug', 'spitz', 'husky', 'retriever'];
  const mine = words(Object.assign({ c: r.color, b: r.breed || r.breed_guess, m: r.marks, d: r.description, k: r.collar }, myEn ? myEn.fields : {}));
  const myDay = type === 'lost' ? new Date(lostWhen(r).slice(0, 10)) : new Date(r.found_at);
  const out = [];
  rows.forEach(o => {
    if (spk(o.species) !== sp) return;
    const reasons = []; let score = 20;
    const d = hav(num(r.lat), num(r.lng), num(o.lat), num(o.lng));
    if (d != null) { if (d > 25) return; score += Math.max(0, 30 - d * 2); reasons.push(d < 1 ? 'Within 1 km' : 'About ' + d + ' km apart'); }
    else if (r.city && o.city && r.city.toLowerCase() === o.city.toLowerCase()) { score += 12; reasons.push('Same city'); }
    else return;
    const oDay = other === 'lost' ? new Date(lostWhen(o).slice(0, 10)) : new Date(o.found_at);
    const lostDay = type === 'lost' ? myDay : oDay, foundDay = type === 'lost' ? oDay : myDay, gap = Math.round((foundDay - lostDay) / 86400000);
    if (gap < -2) return; score += Math.max(0, 15 - Math.max(gap, 0)); reasons.push(gap <= 0 ? 'Found on the day it went missing' : 'Found ' + gap + ' day' + (gap === 1 ? '' : 's') + ' after it went missing');
    const theirs = words(Object.assign({ c: o.color, b: o.breed || o.breed_guess, m: o.marks, d: o.description, k: o.collar }, o.en || {}));
    const shared = [...mine].filter(w => theirs.has(w) && COL.includes(w)); if (shared.length) { score += shared.length * 6; reasons.push('Similar description: ' + shared.slice(0, 4).join(', ')); }
    const g1 = (r.gender || '').toLowerCase(), g2 = (o.gender || '').toLowerCase(); if (g1 && g2 && g1 !== 'unknown' && g2 !== 'unknown') { if (g1 !== g2) return; reasons.push('Same gender'); score += 4; }
    out.push(Object.assign(norm(other, o, null), { match_reasons: ['Same species'].concat(reasons), match_score: Math.min(95, Math.round(score)) }));
  });
  return out.sort((a, b) => b.match_score - a.match_score).slice(0, 5);
}
// GET /lostfound/cases/:type/:id?lang=
exports.detail = async (req, res) => {
  try {
    const M = await me(req), type = req.params.type, r = await loadCase(type, req.params.id); if (!r) return R.notFound(res, 'Case not found');
    const own = isOwner(M, type, r);
    if (r.moderation === 'hidden' && !own && !M.admin) return R.notFound(res, 'Case not found');
    const c = norm(type, r, M);
    const sg = (await query(`SELECT s.*, u.full_name FROM pet_sightings s LEFT JOIN users u ON u.user_id = s.user_id WHERE s.case_type = $1 AND s.case_id = $2 ORDER BY s.seen_at DESC LIMIT 100`, [type, r.id])).rows;
    c.sightings_list = sg.map(s => ({ id: Number(s.id), at: iso(s.seen_at), area: s.area, lat: s.public_lat != null ? Number(s.public_lat) : null, lng: s.public_lng != null ? Number(s.public_lng) : null, direction: s.direction, description: s.description, photo: httpsUrl(s.photo_url) ? s.photo_url : null,
      by: s.full_name ? s.full_name.split(' ')[0] : 'A neighbour', mine: String(s.user_id) === M.id, status: s.status, source_lang: s.source_lang }));
    c.sightings = sg.length;
    c.updates = (await query(`SELECT action, to_status, note, at FROM pb_case_updates WHERE case_type = $1 AND case_id = $2 AND (is_public OR $3) ORDER BY at`, [type, r.id, own || M.admin])).rows.map(u => ({ action: u.action, status: u.to_status, note: u.note, at: iso(u.at) }));
    const L = lang(req.query.lang || M.lang);
    c.translated = await translation(type, r.id, L, false);
    if (c.translated) c.translated = { lang: L, fields: c.translated.fields };
    if (own || M.admin) {
      c.private = type === 'lost' ? { phone: r.private_phone || null, lat: num(r.lat), lng: num(r.lng), microchip: r.microchip || null } : { lat: num(r.lat), lng: num(r.lng), microchip: r.microchip_seen || null };
      c.matches = await matches(type, r);
      c.threads = (await query(`SELECT m.thread_user::text AS uid, u.full_name, MAX(m.created_at) AS last, COUNT(*) FILTER (WHERE m.read_at IS NULL AND m.from_user <> $3) AS unread FROM pb_case_messages m LEFT JOIN users u ON u.user_id = m.thread_user WHERE m.case_type = $1 AND m.case_id = $2 GROUP BY 1, 2 ORDER BY 3 DESC`, [type, r.id, M.id])).rows
        .map(t => ({ user: t.uid, name: t.full_name ? t.full_name.split(' ')[0] : 'PawBook member', last: iso(t.last), unread: Number(t.unread) }));
      c.moderation_note = r.moderation_note || null;
    }
    return R.ok(res, { case: c, original_lang: r.source_lang || 'en', machine_note: 'Machine translated — the original is shown alongside. Names, numbers, dates and places are kept as written.' });
  } catch (e) { return fail(res, 'detail', e); }
};
// POST /lostfound/cases/:type/:id/translate {lang} — on-demand, cached
exports.translate = async (req, res) => {
  try {
    const type = req.params.type === 'sighting' ? 'sighting' : req.params.type, id = parseInt(req.params.id, 10), L = lang((req.body || {}).lang);
    if (!['lost', 'found', 'sighting'].includes(type) || !id) return R.notFound(res, 'Not found');
    if (type !== 'sighting') { const r = await loadCase(type, id); if (!r || r.moderation === 'hidden') return R.notFound(res, 'Not found'); }
    let t;
    try { t = await translation(type, id, L, true); } catch (e) { console.error('[LostFound] translate:', e.message); return res.status(503).json({ success: false, message: 'Translation is not available right now. The original report is shown.' }); }
    if (!t) return R.ok(res, { translated: null });
    return R.ok(res, { translated: { lang: L, fields: t.fields } });
  } catch (e) { return fail(res, 'translate', e); }
};

// ── reporting ──
function readCommon(b, e) {
  const v = {};
  v.species = SPECIES.includes(b.species) ? b.species : null; if (!v.species) e.push('species');
  v.area = str(b.area, 200); if (v.area.length < 3) e.push('area');
  v.city = str(b.city, 100) || null; v.state = str(b.state, 100) || null;
  v.lat = num(b.lat); v.lng = num(b.lng); if (!validLat(v.lat) || !validLng(v.lng) || (v.lat == null) !== (v.lng == null)) e.push('lat');
  const ph = Array.isArray(b.photos) ? b.photos : []; if (ph.some(u => !httpsUrl(u))) e.push('photos'); v.photos = ph.filter(httpsUrl).slice(0, 10);
  v.color = str(b.color, 100) || null; v.marks = str(b.marks, 1000) || null; v.collar = str(b.collar, 200) || null; v.description = str(b.description, 3000) || null;
  v.gender = ['male', 'female', 'unknown'].includes(b.gender) ? b.gender : null;
  v.source_lang = lang(b.source_lang);
  return v;
}
// POST /lostfound/lost
exports.reportLost = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, e = [], v = readCommon(b, e);
    v.pet_name = str(b.name, 80); if (!v.pet_name) e.push('name');
    v.breed = str(b.breed, 100) || null; v.age = str(b.age, 40) || null;
    v.date = str(b.date, 10); const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || v.date > today || v.date < '2000-01-01') e.push('date');
    v.time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : null;
    v.phone = str(b.phone, 30) || M.phone || ''; if (v.phone && !/^[+\d][\d\s-]{6,20}$/.test(v.phone)) e.push('phone');
    v.microchip = str(b.microchip, 40).replace(/[^\w-]/g, '') || null; v.reward = str(b.reward, 120) || null;
    if (e.length) return bad(res, [...new Set(e)]);
    const { rows: dup } = await query(`SELECT id FROM lost_pet_reports WHERE reporter_uuid::text = $1 AND lower(pet_name) = lower($2) AND case_status = ANY($3)`, [M.id, v.pet_name, OPEN_LOST]);
    if (dup.length) return res.status(409).json({ success: false, message: 'You already have an open alert for ' + v.pet_name + '.', existing: Number(dup[0].id) });
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM lost_pet_reports WHERE reporter_uuid::text = $1 AND created_at > NOW() - INTERVAL '1 day'`, [M.id]); if (n[0].n >= 3) return res.status(429).json({ success: false, message: 'You have reported several missing pets today. Please contact support@deemona.com if you need help.' });
    const urgent = b.urgent === true || v.date >= new Date(Date.now() + 330 * 60000 - 2 * 86400000).toISOString().slice(0, 10);
    const id = await tx(async c => {
      const { rows } = await c.query(`INSERT INTO lost_pet_reports (user_id, reporter_uuid, pet_name, species, breed, age, color, collar, description, area, date_last_seen, time_last_seen, alert_radius, lat, lng, contact_name, contact_phone, contact_email, photos, status,
          gender, marks, microchip, reward, private_phone, city, state, public_lat, public_lng, case_status, source_lang, urgent)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'5 km',$13,$14,$15,'Contact via PawBook',NULL,$16,'lost',$17,$18,$19,$20,$21,$22,$23,$24,$25,'active',$26,$27) RETURNING id`,
        [M.no ? +M.no : null, M.id, v.pet_name, v.species.charAt(0).toUpperCase() + v.species.slice(1), v.breed, v.age, v.color, v.collar, v.description, v.area, v.date, v.time, v.lat, v.lng, M.name || 'PawBook member', JSON.stringify(v.photos),
          v.gender, v.marks, v.microchip, v.reward, v.phone || null, v.city, v.state, approx(v.lat), approx(v.lng), v.source_lang, urgent]);
      await c.query(`INSERT INTO pb_case_updates (case_type, case_id, actor, action, to_status, note) VALUES ('lost',$1,$2,'reported','active','Missing pet reported')`, [rows[0].id, M.id]);
      return Number(rows[0].id);
    });
    const sent = await distribute('lost', id, v, M.id);
    translateLater('lost', id, v.source_lang);
    return R.created(res, { id, alerts_sent: sent });
  } catch (e) { return fail(res, 'reportLost', e); }
};
// POST /lostfound/found
exports.reportFound = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, e = [], v = readCommon(b, e);
    v.breed_guess = str(b.breed, 100) || null; v.age_guess = str(b.age, 40) || null;
    const at = b.found_at ? new Date(b.found_at) : null; if (!at || isNaN(at) || at > new Date(Date.now() + 10 * 60000) || at < new Date('2000-01-01')) e.push('found_at');
    v.safety = ['with_finder', 'at_shelter', 'at_vet', 'on_street'].includes(b.safety) ? b.safety : 'with_finder';
    v.can_hold = b.can_hold === true; v.shelter_note = str(b.shelter_note, 300) || null; v.microchip = str(b.microchip, 40).replace(/[^\w-]/g, '') || null;
    if (!v.photos.length && !v.description && !v.color) e.push('description');
    if (e.length) return bad(res, [...new Set(e)], e.includes('description') ? 'Please add a photo or a short description so the owner can recognise the pet' : undefined);
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM found_pet_reports WHERE finder_id::text = $1 AND created_at > NOW() - INTERVAL '1 day'`, [M.id]); if (n[0].n >= 5) return res.status(429).json({ success: false, message: 'Too many reports today' });
    const id = await tx(async c => {
      const { rows } = await c.query(`INSERT INTO found_pet_reports (finder_id, species, breed_guess, gender, age_guess, color, marks, collar, microchip_seen, description, photos, area, city, state, lat, lng, public_lat, public_lng, found_at, safety, can_hold, shelter_note, case_status, source_lang)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
        [M.id, v.species, v.breed_guess, v.gender, v.age_guess, v.color, v.marks, v.collar, v.microchip, v.description, JSON.stringify(v.photos), v.area, v.city, v.state, v.lat, v.lng, approx(v.lat), approx(v.lng), at, v.safety, v.can_hold, v.shelter_note, ['at_shelter', 'at_vet'].includes(v.safety) ? 'sheltered' : 'found', v.source_lang]);
      await c.query(`INSERT INTO pb_case_updates (case_type, case_id, actor, action, to_status, note) VALUES ('found',$1,$2,'reported','found','Found pet reported')`, [rows[0].id, M.id]);
      return Number(rows[0].id);
    });
    const sent = await distribute('found', id, v, M.id);
    translateLater('found', id, v.source_lang);
    return R.created(res, { id, alerts_sent: sent });
  } catch (e) { return fail(res, 'reportFound', e); }
};
// alert distribution: opted-in neighbours, volunteers and rescue partners nearby — in each person's language, throttled
async function distribute(type, id, v, fromUid) {
  try {
    const lat = v.lat, lng = v.lng, city = (v.city || '').toLowerCase();
    const near = (la, ln, rk, c2) => `((${la} IS NOT NULL AND $2::float8 IS NOT NULL AND 6371 * 2 * asin(sqrt(power(sin(radians((${la} - $2::float8) / 2)), 2) + cos(radians($2::float8)) * cos(radians(${la})) * power(sin(radians((${ln} - $3::float8) / 2)), 2))) <= ${rk}) OR ($4 <> '' AND lower(COALESCE(${c2}, '')) = $4))`;
    let partnerSql = '';
    const hasPartners = (await query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'adoption_partner_users'`)).rows.length > 0;
    if (hasPartners) partnerSql = ` UNION SELECT pu.user_id::text, 'partner' FROM adoption_partner_users pu JOIN shelters s ON s.shelter_id = pu.shelter_id WHERE $4 <> '' AND lower(COALESCE(s.city, '')) = $4`;
    const { rows } = await query(`SELECT DISTINCT ON (uid) uid, reason FROM (
        SELECT p.user_id::text AS uid, 'nearby' AS reason FROM pb_user_prefs p WHERE p.alerts_on AND ${near('p.alert_lat', 'p.alert_lng', 'p.alert_radius_km', 'p.alert_city')}
        UNION SELECT vo.user_id::text, 'volunteer' FROM pb_rescue_volunteers vo WHERE vo.active AND vo.safety_ack AND ${near('vo.lat', 'vo.lng', 'vo.radius_km', 'vo.city')}
        ${partnerSql}) x
      WHERE uid <> $1 AND (SELECT COUNT(*) FROM pb_alert_log a WHERE a.recipient::text = x.uid AND a.created_at > NOW() - INTERVAL '1 day') < 10
      ORDER BY uid, reason LIMIT 500`, [fromUid, lat, lng, city]);
    let sent = 0;
    for (const r of rows) {
      const L = await prefLang(r.uid);
      const ins = await query(`INSERT INTO pb_alert_log (case_type, case_id, recipient, lang, reason) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [type, id, r.uid, L, r.reason]);
      if (!ins.rows.length) continue;
      await notify(r.uid, '🐾 ' + tt(L, type, { sp: v.species, area: v.area }), (type === 'lost' && v.pet_name ? v.pet_name + ' · ' : '') + tt(L, 'help', {}), '38_lost_pet_network.html?case=' + type + '-' + id);
      sent++;
    }
    if (sent) await query(`UPDATE ${type === 'lost' ? 'lost_pet_reports' : 'found_pet_reports'} SET alerts_sent = alerts_sent + $2 WHERE id = $1`, [id, sent]);
    return sent;
  } catch (e) { console.error('[LostFound] distribute:', e.message); return 0; }
}
// PATCH /lostfound/cases/:type/:id — owner edits details
exports.update = async (req, res) => {
  try {
    const M = await me(req), type = req.params.type, r = await loadCase(type, req.params.id); if (!r || !isOwner(M, type, r)) return R.notFound(res, 'Case not found');
    const b = req.body || {}, set = [], args = [r.id];
    const put = (col, val) => { args.push(val); set.push(col + ' = $' + args.length); };
    if (b.photos !== undefined) { const ph = Array.isArray(b.photos) ? b.photos : []; if (ph.some(u => !httpsUrl(u))) return bad(res, ['photos']); put('photos', JSON.stringify(ph.slice(0, 10))); }
    [['color', 100], ['marks', 1000], ['collar', 200], ['description', 3000]].forEach(([k, n]) => { if (b[k] !== undefined) put(k, str(b[k], n) || null); });
    if (type === 'lost') { if (b.reward !== undefined) put('reward', str(b.reward, 120) || null); if (b.phone !== undefined) { const p = str(b.phone, 30); if (p && !/^[+\d][\d\s-]{6,20}$/.test(p)) return bad(res, ['phone']); put('private_phone', p || null); } if (b.urgent !== undefined) put('urgent', b.urgent === true); }
    else { if (b.shelter_note !== undefined) put('shelter_note', str(b.shelter_note, 300) || null); if (b.safety !== undefined && ['with_finder', 'at_shelter', 'at_vet', 'on_street'].includes(b.safety)) put('safety', b.safety); }
    if (b.source_lang !== undefined) put('source_lang', lang(b.source_lang));
    if (!set.length) return R.ok(res, { saved: true });
    await query(`UPDATE ${type === 'lost' ? 'lost_pet_reports' : 'found_pet_reports'} SET ${set.join(', ')}, updated_at = NOW(), last_activity_at = NOW() WHERE id = $1`, args);
    translateLater(type, r.id, b.source_lang ? lang(b.source_lang) : r.source_lang);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'update', e); }
};
// POST /lostfound/cases/:type/:id/status {to, note}
const FLOW = { lost: { active: ['identified', 'reunited', 'closed'], sighted: ['active', 'identified', 'reunited', 'closed'], identified: ['active', 'reunited', 'closed'], archived: ['active', 'reunited', 'closed'] },
  found: { found: ['sheltered', 'owner_identified', 'reunited', 'closed'], sheltered: ['owner_identified', 'reunited', 'closed'], owner_identified: ['sheltered', 'reunited', 'closed'], archived: ['found', 'reunited', 'closed'] } };
exports.setStatus = async (req, res) => {
  try {
    const M = await me(req), type = req.params.type, r = await loadCase(type, req.params.id); if (!r || !isOwner(M, type, r)) return R.notFound(res, 'Case not found');
    const to = str((req.body || {}).to, 20), note = str((req.body || {}).note, 500) || null;
    if (!((FLOW[type][r.case_status] || []).includes(to))) return conflict(res, 'This status change is not possible now.');
    const done = ['reunited', 'closed'].includes(to);
    await tx(async c => {
      await c.query(`UPDATE ${type === 'lost' ? 'lost_pet_reports' : 'found_pet_reports'} SET case_status = $2::text, ${type === 'lost' ? `status = CASE WHEN $2::text = 'reunited' THEN 'found' WHEN $2::text = 'closed' THEN 'withdrawn' ELSE 'lost' END,` : ''} resolved_at = ${done ? 'NOW()' : 'NULL'}, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`, [r.id, to]);
      await c.query(`INSERT INTO pb_case_updates (case_type, case_id, actor, action, from_status, to_status, note) VALUES ($1,$2,$3,'status',$4,$5,$6)`, [type, r.id, M.id, r.case_status, to, note]);
    });
    if (to === 'reunited') {   // tell everyone who helped
      const { rows } = await query(`SELECT DISTINCT uid FROM (SELECT user_id::text AS uid FROM pet_sightings WHERE case_type = $1 AND case_id = $2 UNION SELECT thread_user::text FROM pb_case_messages WHERE case_type = $1 AND case_id = $2) x WHERE uid <> $3`, [type, r.id, M.id]);
      for (const u of rows) { const L = await prefLang(u.uid); await notify(u.uid, tt(L, 'reunited', { name: r.pet_name || tt(L, 'found', { sp: spk(r.species), area: r.area }) }), null, '38_lost_pet_network.html?case=' + type + '-' + r.id); }
    }
    return R.ok(res, { status: to });
  } catch (e) { return fail(res, 'setStatus', e); }
};
// POST /lostfound/cases/:type/:id/sightings
exports.addSighting = async (req, res) => {
  try {
    const M = await me(req), type = req.params.type, r = await loadCase(type, req.params.id); if (!r || r.moderation === 'hidden') return R.notFound(res, 'Case not found');
    if (isOwner(M, type, r)) return conflict(res, 'This is your own report — add details by editing it.');
    if (!(type === 'lost' ? OPEN_LOST.concat(['archived']) : OPEN_FOUND).includes(r.case_status)) return conflict(res, 'This case is already closed.');
    const b = req.body || {}, e = [];
    const area = str(b.area, 200); if (area.length < 3) e.push('area');
    const at = b.seen_at ? new Date(b.seen_at) : new Date(); if (isNaN(at) || at > new Date(Date.now() + 10 * 60000)) e.push('seen_at');
    const lat = num(b.lat), lng = num(b.lng); if (!validLat(lat) || !validLng(lng) || (lat == null) !== (lng == null)) e.push('lat');
    if (b.photo_url && !httpsUrl(b.photo_url)) e.push('photo_url');
    const desc = str(b.description, 1500); if (!desc && !b.photo_url) e.push('description');
    if (e.length) return bad(res, e);
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM pet_sightings WHERE user_id::text = $1 AND created_at > NOW() - INTERVAL '1 hour'`, [M.id]); if (n[0].n >= 10) return res.status(429).json({ success: false, message: 'Please wait a little before sending more sightings.' });
    const src = lang(b.source_lang);
    const { rows } = await query(`INSERT INTO pet_sightings (case_type, case_id, user_id, seen_at, area, lat, lng, public_lat, public_lng, direction, description, photo_url, source_lang) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [type, r.id, M.id, at, area, lat, lng, approx(lat), approx(lng), str(b.direction, 30) || null, desc || null, b.photo_url || null, src]);
    await query(`UPDATE ${type === 'lost' ? 'lost_pet_reports' : 'found_pet_reports'} SET ${type === 'lost' ? `case_status = CASE WHEN case_status IN ('active','archived') THEN 'sighted' ELSE case_status END,` : ''} last_activity_at = NOW() WHERE id = $1`, [r.id]);
    await query(`INSERT INTO pb_case_updates (case_type, case_id, actor, action, note) VALUES ($1,$2,$3,'sighting',$4)`, [type, r.id, M.id, 'Sighting near ' + area]);
    const owner = type === 'lost' ? (r.reporter_uuid ? String(r.reporter_uuid) : null) : String(r.finder_id);
    if (owner) { const L = await prefLang(owner); await notify(owner, '👀 ' + tt(L, 'sight', { name: r.pet_name || tt(L, 'found', { sp: spk(r.species), area: r.area }) }), area, '38_lost_pet_network.html?case=' + type + '-' + r.id); }
    translateLater('sighting', Number(rows[0].id), src);
    return R.created(res, { id: Number(rows[0].id) });
  } catch (e) { return fail(res, 'addSighting', e); }
};
// PATCH /lostfound/sightings/:id {status}
exports.markSighting = async (req, res) => {
  try {
    const M = await me(req), st = (req.body || {}).status; if (!['useful', 'not_relevant', 'new'].includes(st)) return bad(res, ['status']);
    const { rows } = await query(`SELECT case_type, case_id FROM pet_sightings WHERE id = $1`, [parseInt(req.params.id, 10)]); if (!rows[0]) return R.notFound(res, 'Not found');
    const r = await loadCase(rows[0].case_type, rows[0].case_id); if (!r || !isOwner(M, rows[0].case_type, r)) return R.notFound(res, 'Not found');
    await query(`UPDATE pet_sightings SET status = $2 WHERE id = $1`, [parseInt(req.params.id, 10), st]); return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'markSighting', e); }
};

// ── protected messages ──
exports.messages = async (req, res) => {
  try {
    const M = await me(req), type = req.params.type, r = await loadCase(type, req.params.id); if (!r) return R.notFound(res, 'Case not found');
    const own = isOwner(M, type, r), w = own ? str(req.query.with, 40) : M.id; if (!w) return bad(res, ['with']);
    const { rows } = await query(`SELECT id, from_user::text AS from_user, body, source_lang, created_at FROM pb_case_messages WHERE case_type = $1 AND case_id = $2 AND thread_user::text = $3 ORDER BY created_at LIMIT 300`, [type, r.id, w]);
    await query(`UPDATE pb_case_messages SET read_at = NOW() WHERE case_type = $1 AND case_id = $2 AND thread_user::text = $3 AND from_user::text <> $4 AND read_at IS NULL`, [type, r.id, w, M.id]);
    const L = lang(req.query.lang || M.lang), tr = {};
    for (const m of rows) if (m.source_lang !== L) { const t = await translation('message', Number(m.id), L, false); if (t) tr[m.id] = t.fields.body; }
    return R.ok(res, { messages: rows.map(m => ({ id: Number(m.id), mine: m.from_user === M.id, body: m.body, at: iso(m.created_at), source_lang: m.source_lang, translated: tr[m.id] || null })) });
  } catch (e) { return fail(res, 'messages', e); }
};
exports.sendMessage = async (req, res) => {
  try {
    const M = await me(req), type = req.params.type, r = await loadCase(type, req.params.id); if (!r || r.moderation === 'hidden') return R.notFound(res, 'Case not found');
    const b = req.body || {}, body = str(b.body, 2000); if (body.length < 2) return bad(res, ['body']);
    const own = isOwner(M, type, r); let thread = own ? str(b.with, 40) : M.id;
    const owner = type === 'lost' ? (r.reporter_uuid ? String(r.reporter_uuid) : null) : String(r.finder_id);
    if (!owner) return conflict(res, 'This older report cannot receive messages.');
    if (own) { const { rows } = await query(`SELECT 1 FROM pb_case_messages WHERE case_type = $1 AND case_id = $2 AND thread_user::text = $3 LIMIT 1`, [type, r.id, thread]); if (!rows.length) return bad(res, ['with']); }
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM pb_case_messages WHERE from_user::text = $1 AND created_at > NOW() - INTERVAL '1 hour'`, [M.id]); if (n[0].n >= 40) return res.status(429).json({ success: false, message: 'Please slow down a little.' });
    const src = lang(b.source_lang);
    const { rows } = await query(`INSERT INTO pb_case_messages (case_type, case_id, thread_user, from_user, body, source_lang) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [type, r.id, thread, M.id, body, src]);
    const to = own ? thread : owner; const L = await prefLang(to);
    await notify(to, '💬 ' + tt(L, 'msg', { name: r.pet_name || tt(L, 'found', { sp: spk(r.species), area: r.area }) }), null, '38_lost_pet_network.html?case=' + type + '-' + r.id + (own ? '' : '&thread=' + M.id));
    await query(`UPDATE ${type === 'lost' ? 'lost_pet_reports' : 'found_pet_reports'} SET last_activity_at = NOW() WHERE id = $1`, [r.id]);
    translateLater('message', Number(rows[0].id), src);
    return R.created(res, { id: Number(rows[0].id) });
  } catch (e) { return fail(res, 'sendMessage', e); }
};

// ── flags, mine, prefs, volunteers, help ──
const FLAGS = ['fake', 'duplicate', 'wrong_info', 'scam', 'bad_translation', 'abuse', 'other'];
exports.flag = async (req, res) => {
  try {
    const M = await me(req), type = req.params.type, r = await loadCase(type, req.params.id); if (!r) return R.notFound(res, 'Case not found');
    const reason = FLAGS.includes((req.body || {}).reason) ? req.body.reason : null; if (!reason) return bad(res, ['reason']);
    try { await query(`INSERT INTO pb_case_flags (case_type, case_id, user_id, reason, details) VALUES ($1,$2,$3,$4,$5)`, [type, r.id, M.id, reason, str((req.body || {}).details, 500) || null]); }
    catch (x) { if (x.code === '23505') return conflict(res, 'You already reported this. Our team is reviewing it.'); throw x; }
    const { rows } = await query(`SELECT COUNT(DISTINCT user_id)::int AS n FROM pb_case_flags WHERE case_type = $1 AND case_id = $2 AND status = 'open' AND reason <> 'bad_translation'`, [type, r.id]);
    if (rows[0].n >= 3 && r.moderation === 'visible') {
      await query(`UPDATE ${type === 'lost' ? 'lost_pet_reports' : 'found_pet_reports'} SET moderation = 'hidden', moderation_note = 'Hidden after several community reports — under review' WHERE id = $1`, [r.id]);
      await query(`INSERT INTO pb_case_updates (case_type, case_id, action, note, is_public) VALUES ($1,$2,'auto_hidden','Hidden after community reports',FALSE)`, [type, r.id]);
    }
    return R.created(res, { flagged: true });
  } catch (e) { return fail(res, 'flag', e); }
};
exports.mine = async (req, res) => {
  try {
    const M = await me(req);
    const [l, f, s, t] = await Promise.all([
      query(`SELECT r.*, (SELECT COUNT(*) FROM pet_sightings s WHERE s.case_type = 'lost' AND s.case_id = r.id) AS sightings FROM lost_pet_reports r WHERE r.reporter_uuid::text = $1 ${M.no ? 'OR (r.reporter_uuid IS NULL AND r.user_id::text = $2)' : 'AND $2::text IS NULL'} ORDER BY r.created_at DESC LIMIT 50`, [M.id, M.no]),
      query(`SELECT r.*, (SELECT COUNT(*) FROM pet_sightings s WHERE s.case_type = 'found' AND s.case_id = r.id) AS sightings FROM found_pet_reports r WHERE r.finder_id::text = $1 ORDER BY r.created_at DESC LIMIT 50`, [M.id]),
      query(`SELECT s.case_type, s.case_id, s.area, s.seen_at, s.status FROM pet_sightings s WHERE s.user_id::text = $1 ORDER BY s.created_at DESC LIMIT 50`, [M.id]),
      query(`SELECT DISTINCT ON (m.case_type, m.case_id) m.case_type, m.case_id, m.created_at FROM pb_case_messages m WHERE m.thread_user::text = $1 ORDER BY m.case_type, m.case_id, m.created_at DESC LIMIT 50`, [M.id])]);
    return R.ok(res, { lost: l.rows.map(r => norm('lost', r, M)), found: f.rows.map(r => norm('found', r, M)), sightings: s.rows.map(x => ({ case: x.case_type + '-' + x.case_id, area: x.area, at: iso(x.seen_at), status: x.status })), conversations: t.rows.map(x => ({ case: x.case_type + '-' + x.case_id, at: iso(x.created_at) })) });
  } catch (e) { return fail(res, 'mine', e); }
};
exports.savePrefs = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, cur = M.prefs || {};
    const pick = (k, d) => (b[k] !== undefined ? b[k] : cur[k] !== undefined ? cur[k] : d);
    const v = { ui_lang: lang(pick('ui_lang', 'en')), notify_lang: lang(pick('notify_lang', pick('ui_lang', 'en'))), extra_langs: (Array.isArray(pick('extra_langs', [])) ? pick('extra_langs', []) : []).filter(x => LANGS[x]).slice(0, 6),
      auto_translate: pick('auto_translate', true) !== false, show_original: pick('show_original', true) !== false, alerts_on: pick('alerts_on', false) === true,
      alert_city: str(pick('alert_city', ''), 100) || null, alert_state: str(pick('alert_state', ''), 100) || null, alert_lat: num(b.alert_lat !== undefined ? b.alert_lat : cur.alert_lat), alert_lng: num(b.alert_lng !== undefined ? b.alert_lng : cur.alert_lng),
      alert_radius_km: [1, 3, 5, 10, 25].includes(+pick('alert_radius_km', 5)) ? +pick('alert_radius_km', 5) : 5 };
    if (!validLat(v.alert_lat) || !validLng(v.alert_lng)) return bad(res, ['alert_lat']);
    if (v.alerts_on && !v.alert_city && v.alert_lat == null) return bad(res, ['alert_city'], 'Choose your city or share your location to receive nearby alerts');
    v.alert_lat = approx(v.alert_lat); v.alert_lng = approx(v.alert_lng);
    await query(`INSERT INTO pb_user_prefs (user_id, ui_lang, notify_lang, extra_langs, auto_translate, show_original, alerts_on, alert_city, alert_state, alert_lat, alert_lng, alert_radius_km) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (user_id) DO UPDATE SET ui_lang = $2, notify_lang = $3, extra_langs = $4, auto_translate = $5, show_original = $6, alerts_on = $7, alert_city = $8, alert_state = $9, alert_lat = $10, alert_lng = $11, alert_radius_km = $12, updated_at = NOW()`,
      [M.id, v.ui_lang, v.notify_lang, v.extra_langs, v.auto_translate, v.show_original, v.alerts_on, v.alert_city, v.alert_state, v.alert_lat, v.alert_lng, v.alert_radius_km]);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'savePrefs', e); }
};
exports.saveVolunteer = async (req, res) => {
  try {
    const M = await me(req), b = req.body || {}, city = str(b.city, 100); if (!city) return bad(res, ['city']);
    if (b.active !== false && b.safety_ack !== true) return bad(res, ['safety_ack'], 'Please read and accept the safety guidance');
    const lat = num(b.lat), lng = num(b.lng); if (!validLat(lat) || !validLng(lng)) return bad(res, ['lat']);
    await query(`INSERT INTO pb_rescue_volunteers (user_id, city, state, lat, lng, radius_km, can_search, can_transport, can_foster, languages, safety_ack, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (user_id) DO UPDATE SET city = $2, state = $3, lat = $4, lng = $5, radius_km = $6, can_search = $7, can_transport = $8, can_foster = $9, languages = $10, safety_ack = pb_rescue_volunteers.safety_ack OR $11, active = $12, updated_at = NOW()`,
      [M.id, city, str(b.state, 100) || null, approx(lat), approx(lng), [1, 3, 5, 10, 25].includes(+b.radius_km) ? +b.radius_km : 5, b.can_search !== false, b.can_transport === true, b.can_foster === true, (Array.isArray(b.languages) ? b.languages : []).filter(x => LANGS[x]).slice(0, 8), b.safety_ack === true, b.active !== false]);
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'saveVolunteer', e); }
};
// GET /lostfound/help?city&state — shelters and vets on PawBook; emergency number 112 only (verified national number)
exports.help = async (req, res) => {
  try {
    const city = str(req.query.city, 80), state = str(req.query.state, 80);
    const sh = city || state ? (await query(`SELECT shelter_id::text AS id, name, city, state, COALESCE(contact_phone, phone) AS phone, is_verified FROM shelters WHERE ($1 = '' OR lower(city) = lower($1)) AND ($2 = '' OR lower(state) = lower($2)) ORDER BY is_verified DESC, name LIMIT 12`, [city, state])).rows : [];
    let vets = [];
    try { vets = city ? (await query(`SELECT vet_id::text AS id, first_name, last_name, clinic_name, city FROM vets WHERE status = 'active' AND lower(city) = lower($1) ORDER BY clinic_name LIMIT 12`, [city])).rows : []; } catch (e) { vets = []; }
    return R.ok(res, { emergency: [{ label: 'National emergency number (police, fire, ambulance)', number: '112' }], shelters: sh.map(s => ({ id: s.id, name: s.name, city: s.city, phone: s.phone || null, verified: !!s.is_verified })),
      vets: vets.map(v => ({ id: v.id, name: [v.first_name, v.last_name].filter(Boolean).length ? 'Dr. ' + [v.first_name, v.last_name].filter(Boolean).join(' ') : null, clinic: v.clinic_name, city: v.city })) });
  } catch (e) { return fail(res, 'help', e); }
};
// ── admin ──
exports.adminQueue = async (req, res) => {
  try {
    const M = await me(req); if (!M.admin) return forbid(res);
    const { rows } = await query(`SELECT f.case_type, f.case_id, COUNT(*)::int AS n, array_agg(DISTINCT f.reason) AS reasons, MAX(f.created_at) AS last, array_remove(array_agg(f.details), NULL) AS details FROM pb_case_flags f WHERE f.status = 'open' GROUP BY 1, 2 ORDER BY 3 DESC, 5 DESC LIMIT 100`);
    const out = [];
    for (const x of rows) { const r = await loadCase(x.case_type, x.case_id); if (r) out.push(Object.assign(norm(x.case_type, r, M), { flags: x.n, reasons: x.reasons, details: x.details.slice(0, 5) })); }
    return R.ok(res, { flagged: out });
  } catch (e) { return fail(res, 'adminQueue', e); }
};
exports.adminAction = async (req, res) => {
  try {
    const M = await me(req); if (!M.admin) return forbid(res);
    const type = req.params.type, r = await loadCase(type, req.params.id); if (!r) return R.notFound(res, 'Not found');
    const act = (req.body || {}).action, note = str((req.body || {}).note, 300) || null; if (!['hide', 'restore', 'dismiss'].includes(act)) return bad(res, ['action']);
    if (act !== 'dismiss') await query(`UPDATE ${type === 'lost' ? 'lost_pet_reports' : 'found_pet_reports'} SET moderation = $2, moderation_note = $3 WHERE id = $1`, [r.id, act === 'hide' ? 'hidden' : 'visible', act === 'hide' ? (note || 'Hidden by PawBook moderation') : null]);
    await query(`UPDATE pb_case_flags SET status = 'closed', resolved_by = $3, resolved_at = NOW() WHERE case_type = $1 AND case_id = $2 AND status = 'open'`, [type, r.id, M.id]);
    await query(`INSERT INTO pb_case_updates (case_type, case_id, actor, action, note, is_public) VALUES ($1,$2,$3,$4,$5,FALSE)`, [type, r.id, M.id, 'moderation_' + act, note]);
    return R.ok(res, { done: true });
  } catch (e) { return fail(res, 'adminAction', e); }
};

// ── legacy /lost-pets endpoints (older pages and api.js) — served from here so phone numbers and exact locations stay private ──
function legacyShape(c) {
  return { id: c.id, pet_name: c.name, species: c.species_label, breed: c.breed, age: c.age, color: c.color, collar: c.collar, description: c.description, area: c.area, city: c.city, state: c.state,
    lat: c.lat, lng: c.lng, date_last_seen: String(c.when || '').slice(0, 10), photos: c.photos, status: c.status === 'reunited' ? 'found' : c.status === 'closed' ? 'withdrawn' : 'lost', case_status: c.status,
    contact_name: null, contact_phone: null, contact_email: null, contact_via: 'PawBook messages', link: '38_lost_pet_network.html?case=lost-' + c.id, created_at: c.created_at };
}
exports.legacyList = async (req, res) => {
  try {
    await archiveOld();
    const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const { rows } = await query(`SELECT * FROM lost_pet_reports WHERE moderation = 'visible' AND case_status = ANY($1) ORDER BY created_at DESC LIMIT $2`, [OPEN_LOST, lim]);
    const alerts = rows.map(r => legacyShape(norm('lost', r, null)));
    return R.ok(res, { alerts, total: alerts.length });
  } catch (e) { return fail(res, 'legacyList', e); }
};
exports.legacyGet = async (req, res) => {
  try {
    const r = await loadCase('lost', req.params.alert_id); if (!r || r.moderation === 'hidden') return R.notFound(res, 'Alert not found');
    return R.ok(res, legacyShape(norm('lost', r, null)));
  } catch (e) { return fail(res, 'legacyGet', e); }
};
exports.legacyMine = async (req, res) => {
  try {
    const M = await me(req);
    const { rows } = await query(`SELECT * FROM lost_pet_reports WHERE reporter_uuid::text = $1 ${M.no ? 'OR (reporter_uuid IS NULL AND user_id::text = $2)' : 'AND $2::text IS NULL'} ORDER BY created_at DESC LIMIT 50`, [M.id, M.no]);
    return R.ok(res, { alerts: rows.map(r => Object.assign(legacyShape(norm('lost', r, M)), { contact_phone: r.private_phone || null })) });
  } catch (e) { return fail(res, 'legacyMine', e); }
};
exports.legacyCreate = (req, res) => {
  const b = req.body || {};
  req.body = { name: b.pet_name, species: spk(b.species), breed: b.breed, age: b.age, color: b.color, collar: b.collar, description: b.description, area: b.area || [b.locality, b.city].filter(Boolean).join(', '),
    city: b.city, state: b.state, lat: b.lat, lng: b.lng, date: b.date_last_seen || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), time: b.time_last_seen, phone: b.contact_phone, photos: Array.isArray(b.photos) ? b.photos : [], source_lang: 'en' };
  return exports.reportLost(req, res);
};
exports.legacyUpdate = async (req, res) => {
  const s = (req.body || {}).status;
  req.params = { type: 'lost', id: req.params.alert_id };
  if (s === 'found' || s === 'withdrawn') { req.body = { to: s === 'found' ? 'reunited' : 'closed' }; return exports.setStatus(req, res); }
  return exports.update(req, res);
};
exports.legacySighting = (req, res) => {
  const b = req.body || {};
  req.params = { type: 'lost', id: req.params.alert_id };
  req.body = { area: b.area || b.location || b.location_name, description: b.description || b.notes, lat: b.lat, lng: b.lng, seen_at: b.seen_at || b.sighted_at, photo_url: b.photo_url, source_lang: 'en' };
  return exports.addSighting(req, res);
};
