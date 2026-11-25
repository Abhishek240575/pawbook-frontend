'use strict';
/* ============================================================================
   PawBook AI Health Agent (page 37) — symptom checks, an AI chat that knows the pet's own
   records, vitals, emergency contacts and the owner's vets. Mounted under /api/v1/healthagent.
   The pet's records are read through the Pet Health controller (same ownership rules).
   The AI never sees phone numbers or the owner's name; it gets the pet profile, vaccine status,
   medicines, weights, vitals and recent symptom checks only. Nothing typed in the chat is stored.
   Migration 018.
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');
const petcare = require('./petcare.controller');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = u => String(u.user_id);
const fail = (res, where, e) => { console.error('[HealthAgent] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const iso = t => (t ? new Date(t).toISOString() : null);
const num = v => (v === null || v === undefined || v === '' || isNaN(+v) ? null : +v);
const LANGS = { en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', mr: 'Marathi', te: 'Telugu', kn: 'Kannada', gu: 'Gujarati', pa: 'Punjabi', ml: 'Malayalam', ur: 'Urdu' };
const SYMPTOMS = ['seizure', 'breathing', 'collapse', 'bleeding', 'poison', 'bloat', 'urination', 'heatstroke', 'trauma', 'vomiting', 'diarrhea', 'lethargy', 'appetite', 'limping', 'fever', 'pain', 'eye', 'itching', 'coughing', 'discharge', 'drinking', 'odor', 'weight', 'behaviour'];
const LEVELS = ['emergency', 'urgent', 'monitor', 'mild'];

// run a Pet Health handler and capture its JSON (keeps ownership checks in one place)
function callPetcare(fn, req, petId) {
  return new Promise(resolve => {
    const res = { _s: 200, status(c) { this._s = c; return this; }, json(b) { resolve({ status: this._s, body: b }); return this; }, send(b) { resolve({ status: this._s, body: b }); return this; }, set() { return this; }, setHeader() {} };
    Promise.resolve(fn({ user: req.user, params: { id: String(petId) }, query: {}, body: {} }, res)).catch(e => resolve({ status: 500, body: { message: e.message } }));
  });
}
async function petContext(req, petId) {
  const [ov, vx] = await Promise.all([callPetcare(petcare.overview, req, petId), callPetcare(petcare.vaccineDiary, req, petId)]);
  if (ov.status === 404 || vx.status === 404) return null;
  if (ov.status >= 400) throw new Error('overview ' + ov.status);
  return { ov: ov.body.data || ov.body, vx: vx.status < 400 ? (vx.body.data || vx.body) : null };
}
async function owns(req, petId) { const r = await callPetcare(petcare.vaccineDiary, req, petId); return r.status < 400; }

// ── vitals ──
const RANGES = {   // typical resting ranges for healthy adults (general veterinary references); shown as guidance only
  dog: { hr: [60, 140], rr: [10, 30], temp_f: [101, 102.5] },
  cat: { hr: [140, 220], rr: [20, 30], temp_f: [100.5, 102.5] }
};
const sk = s => { s = String(s || '').toLowerCase(); return /dog|canine|pup/.test(s) ? 'dog' : /cat|feline|kitten/.test(s) ? 'cat' : null; };
exports.vitals = async (req, res) => {
  try {
    if (!(await owns(req, req.params.id))) return R.notFound(res, 'Pet not found');
    const { rows } = await query(`SELECT id, heart_rate, resp_rate, temp_f, gums, note, measured_at FROM pb_pet_vitals WHERE pet_id = $1 ORDER BY measured_at DESC, id DESC LIMIT 60`, [String(req.params.id)]);
    return R.ok(res, { vitals: rows.map(v => ({ id: Number(v.id), heart_rate: v.heart_rate, resp_rate: v.resp_rate, temp_f: v.temp_f == null ? null : Number(v.temp_f), gums: v.gums, note: v.note, at: iso(v.measured_at) })), ranges: RANGES });
  } catch (e) { return fail(res, 'vitals', e); }
};
exports.addVitals = async (req, res) => {
  try {
    if (!(await owns(req, req.params.id))) return R.notFound(res, 'Pet not found');
    const b = req.body || {}, e = [];
    const hr = num(b.heart_rate), rr = num(b.resp_rate), tf = num(b.temp_f);
    if (hr != null && !(hr >= 20 && hr <= 400)) e.push('heart_rate');
    if (rr != null && !(rr >= 4 && rr <= 200)) e.push('resp_rate');
    if (tf != null && !(tf >= 90 && tf <= 110)) e.push('temp_f');
    const gums = ['pink', 'pale', 'blue', 'red', 'yellow'].includes(b.gums) ? b.gums : null;
    let at = b.measured_at ? new Date(b.measured_at) : new Date(); if (isNaN(at) || at > new Date(Date.now() + 10 * 60000) || at < new Date('2000-01-01')) e.push('measured_at');
    if (hr == null && rr == null && tf == null && !gums) e.push('heart_rate');
    if (e.length) return bad(res, [...new Set(e)]);
    const { rows } = await query(`INSERT INTO pb_pet_vitals (pet_id, user_id, heart_rate, resp_rate, temp_f, gums, note, measured_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [String(req.params.id), uid(req.user), hr == null ? null : Math.round(hr), rr == null ? null : Math.round(rr), tf == null ? null : Math.round(tf * 10) / 10, gums, str(b.note, 300) || null, at]);
    return R.created(res, { id: Number(rows[0].id) });
  } catch (e) { return fail(res, 'addVitals', e); }
};
exports.deleteVitals = async (req, res) => {
  try { const r = await query(`DELETE FROM pb_pet_vitals WHERE id = $1 AND user_id::text = $2`, [parseInt(req.params.vid, 10) || 0, uid(req.user)]); return r.rowCount ? R.ok(res, { deleted: true }) : R.notFound(res, 'Not found'); }
  catch (e) { return fail(res, 'deleteVitals', e); }
};

// ── symptom checks (history the owner can show a vet) ──
exports.checks = async (req, res) => {
  try {
    if (!(await owns(req, req.params.id))) return R.notFound(res, 'Pet not found');
    const { rows } = await query(`SELECT id, symptoms, duration, level, note, created_at FROM pb_symptom_checks WHERE pet_id = $1 AND user_id::text = $2 ORDER BY created_at DESC LIMIT 50`, [String(req.params.id), uid(req.user)]);
    return R.ok(res, { checks: rows.map(c => ({ id: Number(c.id), symptoms: c.symptoms, duration: c.duration, level: c.level, note: c.note, at: iso(c.created_at) })) });
  } catch (e) { return fail(res, 'checks', e); }
};
exports.addCheck = async (req, res) => {
  try {
    if (!(await owns(req, req.params.id))) return R.notFound(res, 'Pet not found');
    const b = req.body || {}, sy = (Array.isArray(b.symptoms) ? b.symptoms : []).filter(s => SYMPTOMS.includes(s)).slice(0, 20);
    if (!sy.length) return bad(res, ['symptoms']); if (!LEVELS.includes(b.level)) return bad(res, ['level']);
    const dur = ['now', 'today', 'days', 'week'].includes(b.duration) ? b.duration : null;
    const { rows } = await query(`INSERT INTO pb_symptom_checks (pet_id, user_id, symptoms, duration, level, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [String(req.params.id), uid(req.user), sy, dur, b.level, str(b.note, 500) || null]);
    return R.created(res, { id: Number(rows[0].id) });
  } catch (e) { return fail(res, 'addCheck', e); }
};
exports.deleteCheck = async (req, res) => {
  try { const r = await query(`DELETE FROM pb_symptom_checks WHERE id = $1 AND user_id::text = $2`, [parseInt(req.params.cid, 10) || 0, uid(req.user)]); return r.rowCount ? R.ok(res, { deleted: true }) : R.notFound(res, 'Not found'); }
  catch (e) { return fail(res, 'deleteCheck', e); }
};

// ── emergency contacts (the owner's own list) + vets they have booked or saved ──
exports.contacts = async (req, res) => {
  try {
    const me = uid(req.user);
    const { rows } = await query(`SELECT id, name, role, phone, note, created_at FROM pb_emergency_contacts WHERE user_id::text = $1 ORDER BY created_at LIMIT 30`, [me]);
    const base = `SELECT v.vet_id::text AS id, v.first_name, v.last_name, v.clinic_name, v.city, v.phone FROM vets v WHERE v.vet_id IN (SELECT vet_id FROM vet_appointments WHERE user_id::text = $1)`;
    let vets = (await query(base + ` OR v.vet_id::text IN (SELECT ref FROM pb_saved_items WHERE user_id::text = $1 AND kind = 'vet') ORDER BY v.clinic_name LIMIT 20`, [me]).catch(() => null)
      || await query(base + ` ORDER BY v.clinic_name LIMIT 20`, [me]).catch(() => ({ rows: [] }))).rows;
    return R.ok(res, { contacts: rows.map(c => ({ id: Number(c.id), name: c.name, role: c.role, phone: c.phone, note: c.note })),
      vets: vets.slice(0, 20).map(v => ({ id: v.id, name: [v.first_name, v.last_name].filter(Boolean).length ? 'Dr. ' + [v.first_name, v.last_name].filter(Boolean).join(' ') : null, clinic: v.clinic_name || null, city: v.city || null, phone: v.phone || null })) });
  } catch (e) { return fail(res, 'contacts', e); }
};
exports.addContact = async (req, res) => {
  try {
    const b = req.body || {}, e = [], name = str(b.name, 100), phone = str(b.phone, 30);
    if (name.length < 2) e.push('name'); if (!/^[+\d][\d\s-]{5,20}$/.test(phone)) e.push('phone'); if (e.length) return bad(res, e);
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM pb_emergency_contacts WHERE user_id::text = $1`, [uid(req.user)]); if (n[0].n >= 30) return res.status(409).json({ success: false, message: 'You can keep up to 30 contacts' });
    const { rows } = await query(`INSERT INTO pb_emergency_contacts (user_id, name, role, phone, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [uid(req.user), name, str(b.role, 60) || null, phone, str(b.note, 200) || null]);
    return R.created(res, { id: Number(rows[0].id) });
  } catch (e) { return fail(res, 'addContact', e); }
};
exports.deleteContact = async (req, res) => {
  try { const r = await query(`DELETE FROM pb_emergency_contacts WHERE id = $1 AND user_id::text = $2`, [parseInt(req.params.cid, 10) || 0, uid(req.user)]); return r.rowCount ? R.ok(res, { deleted: true }) : R.notFound(res, 'Not found'); }
  catch (e) { return fail(res, 'deleteContact', e); }
};

// ── AI chat grounded in the pet's own records ──
const SYSTEM = `You are the PawBook AI Health Agent, a careful veterinary triage assistant for pet parents in India. You are not a veterinarian and cannot examine the pet.
Rules:
- Use the PET RECORD below. Never invent vaccinations, test results, medicines or history that are not in it; if something is not recorded, say so.
- If any sign could be an emergency (breathing trouble, collapse, seizures, heavy bleeding, suspected poisoning, swollen hard belly with retching, straining to urinate with no urine, heatstroke, major trauma, pale/blue gums), tell them clearly to contact a vet or emergency clinic now, before anything else.
- Give practical, safe home-care steps and clear "see a vet if…" signs. Say how urgent a vet visit is (now / within 24 hours / monitor).
- Never recommend human medicines (paracetamol, ibuprofen, aspirin, etc.) or give drug doses. Never suggest inducing vomiting unless a vet says so.
- Do not diagnose with certainty; describe possible causes in plain words.
- Keep answers short (under 180 words), friendly and practical. Use short bullet points. Use **bold** for the key action.
- Reply in {LANG}. Keep medicine and vaccine names as written.`;
function compact(ctx, vitals, checks) {
  const p = ctx.ov.pet || {}, vx = ctx.vx || {}, L = [];
  L.push(`Pet: ${p.name || 'pet'} · ${p.species || 'species not recorded'}${p.breed ? ' · ' + p.breed : ''}${p.age_label ? ' · ' + p.age_label : ''}${p.gender ? ' · ' + p.gender : ''}`);
  const w = (ctx.ov.weights || [])[0]; L.push('Weight: ' + (w ? w.kg + ' kg (' + w.date + ')' : p.weight_kg ? p.weight_kg + ' kg (profile)' : 'not recorded'));
  const cards = (vx.cards || []).filter(c => c.status !== 'not_recorded' || c.core);
  L.push('Vaccines: ' + (cards.length ? cards.map(c => `${c.label}: ${c.status.replace(/_/g, ' ')}${c.next_due ? ' (next due ' + c.next_due + ')' : ''}${c.latest && c.latest.given ? ' last given ' + c.latest.given : ''}`).join('; ') : 'none recorded'));
  const meds = (ctx.ov.medicines || []).filter(m => m.active); L.push('Current medicines: ' + (meds.length ? meds.map(m => m.name + (m.dose ? ' ' + m.dose : '') + (m.frequency ? ' (' + m.frequency + ')' : '')).join('; ') : 'none recorded'));
  const ap = ((ctx.ov.vet || {}).appointments || []).slice(0, 3); if (ap.length) L.push('Vet visits: ' + ap.map(a => (a.date || '') + ' ' + (a.title || 'visit') + (a.upcoming ? ' (upcoming)' : '')).join('; '));
  const rx = ((ctx.ov.vet || {}).prescriptions || []).slice(0, 3); if (rx.length) L.push('Recent prescriptions: ' + rx.map(r => (r.date || '') + ' ' + (r.title || '') + (r.detail ? ' – ' + String(r.detail).slice(0, 80) : '')).join('; '));
  if (vitals[0]) L.push('Latest vitals (' + String(vitals[0].measured_at.toISOString()).slice(0, 10) + '): ' + [vitals[0].heart_rate ? 'HR ' + vitals[0].heart_rate + '/min' : '', vitals[0].resp_rate ? 'breathing ' + vitals[0].resp_rate + '/min' : '', vitals[0].temp_f ? 'temp ' + vitals[0].temp_f + '°F' : '', vitals[0].gums ? 'gums ' + vitals[0].gums : ''].filter(Boolean).join(', '));
  if (checks.length) L.push('Recent symptom checks: ' + checks.map(c => String(c.created_at.toISOString()).slice(0, 10) + ' ' + c.symptoms.join(', ') + ' → ' + c.level).join('; '));
  return L.join('\n');
}
async function claude(system, messages) {
  if (process.env.PB_AI_MOCK === '1') { const last = messages[messages.length - 1].content; return 'MOCK REPLY · ' + (system.match(/Reply in (\w+)/) || [])[1] + ' · ' + (system.includes('Pet: ') ? system.split('Pet: ')[1].split(' ·')[0] : '') + ' · ' + last.slice(0, 60) + (process.env.PB_AI_MOCK_ECHO === '1' ? '\n' + system.split('PET RECORD (from PawBook):\n')[1] : ''); }
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw Object.assign(new Error('no key'), { code: 'NOKEY' });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(40000),
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.PB_HEALTH_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 700, system, messages }) });
  if (!r.ok) throw new Error('AI HTTP ' + r.status);
  const j = await r.json(); return ((j.content || []).find(c => c.type === 'text') || {}).text || '';
}
exports.chat = async (req, res) => {
  try {
    const b = req.body || {}, msg = str(b.message, 1500);
    if (msg.length < 2) return bad(res, ['message']);
    const ctx = await petContext(req, req.params.id); if (!ctx) return R.notFound(res, 'Pet not found');
    const [vit, chk] = await Promise.all([
      query(`SELECT heart_rate, resp_rate, temp_f, gums, measured_at FROM pb_pet_vitals WHERE pet_id = $1 ORDER BY measured_at DESC LIMIT 1`, [String(req.params.id)]),
      query(`SELECT symptoms, level, created_at FROM pb_symptom_checks WHERE pet_id = $1 AND created_at > NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 3`, [String(req.params.id)])]);
    const lang = LANGS[b.lang] ? b.lang : 'en';
    const system = SYSTEM.replace('{LANG}', LANGS[lang]) + '\n\nPET RECORD (from PawBook):\n' + compact(ctx, vit.rows, chk.rows) + '\nToday: ' + new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const hist = (Array.isArray(b.history) ? b.history : []).slice(-8).filter(h => h && ['user', 'assistant'].includes(h.role) && typeof h.content === 'string').map(h => ({ role: h.role, content: h.content.slice(0, 1500) }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const messages = []; hist.forEach(h => { if (messages.length && messages[messages.length - 1].role === h.role) messages[messages.length - 1].content += '\n' + h.content; else messages.push(h); });
    if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
    messages.push({ role: 'user', content: msg });
    let reply;
    try { reply = await claude(system, messages); }
    catch (e) { console.error('[HealthAgent] AI:', e.message); return res.status(503).json({ success: false, message: 'The AI assistant is not available right now. If your pet seems unwell, please contact your vet.' }); }
    return R.ok(res, { reply: reply || 'Sorry, I could not answer that. If you are worried, please contact your vet.' });
  } catch (e) { return fail(res, 'chat', e); }
};
