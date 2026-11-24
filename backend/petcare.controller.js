'use strict';
/* ============================================================================
   PawBook Pet Health (page 36) — real data for each owner's pets.
   Reads the existing tables (pets, pet_vaccinations, vet_appointments, prescriptions)
   and adds owner-kept records in new tables (migration 011):
     pet_health_logs (weight, walk, meal, water, sleep, mood, event, memory, med_dose)
     pet_medicines, pet_care_docs (private files), pet_care_settings (exercise goal)
   Column names of the existing tables are looked up once from information_schema, so the
   code works with either naming (id/pet_id, avatar/avatar_url, given_date/administered_at…).
   Mounted under /api/v1/petcare (see add_shop_routes.js).
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = u => String(u.user_id);
const money2 = n => Math.round(Number(n) * 100) / 100;
const fail = (res, where, e) => { console.error('[PetCare] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const todayISO = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);   // India date

// ── schema lookup (cached) ───────────────────────────────────────────────────
const SCHEMA = {};
async function cols(table) {
  if (SCHEMA[table]) return SCHEMA[table];
  const { rows } = await query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [table]);
  const m = {}; rows.forEach(r => { m[r.column_name] = r.data_type; });
  SCHEMA[table] = m; return m;
}
const pick = (c, names) => names.find(n => c[n] !== undefined) || null;
const q = n => '"' + String(n).replace(/"/g, '') + '"';
async function petCols() {
  const c = await cols('pets');
  if (!Object.keys(c).length) throw new Error('pets table not found');
  const u = await cols('users');
  return {
    c, id: pick(c, ['id', 'pet_id']), owner: pick(c, ['user_id', 'owner_id']), name: pick(c, ['name']), species: pick(c, ['species', 'type', 'pet_type']),
    breed: pick(c, ['breed']), gender: pick(c, ['gender', 'sex']), age: pick(c, ['age', 'age_years']), weight: pick(c, ['weight', 'weight_kg']),
    photo: pick(c, ['avatar', 'avatar_url', 'photo_url', 'image_url', 'profile_photo', 'photo']), dob: pick(c, ['date_of_birth', 'dob', 'birthday', 'birth_date']),
    created: pick(c, ['created_at']), updated: pick(c, ['updated_at']),
    userNo: u.user_no !== undefined, ownerIsInt: ['integer', 'bigint', 'smallint'].includes(c[pick(c, ['user_id', 'owner_id'])])
  };
}
// SQL condition: pet row "p" belongs to the user whose UUID is $n
function ownCond(P, n) {
  return `EXISTS (SELECT 1 FROM users ou WHERE ou.user_id::text = $${n} AND p.${q(P.owner)}::text IN (ou.user_id::text${P.userNo ? ', COALESCE(ou.user_no::text, \'\')' : ''}))`;
}
function ageLabel(dob, age) {
  if (dob) {
    const d = new Date(dob); if (!isNaN(d)) {
      const now = new Date(); let m = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth(); if (now.getDate() < d.getDate()) m--;
      if (m < 0) return null; if (m < 12) return m <= 1 ? (m === 1 ? '1 month' : 'Under a month') : m + ' months';
      const y = Math.floor(m / 12); return y === 1 ? '1 year' : y + ' years';
    }
  }
  const n = parseAge(age);
  if (n != null) return n < 1 ? (Math.round(n * 12) <= 1 ? '1 month' : Math.round(n * 12) + ' months') : (n === 1 ? '1 year' : (Math.round(n * 10) / 10) + ' years');
  if (age) return String(age).slice(0, 20);
  return null;
}
// "3", "3.5", "3 years", "6 months", "8 weeks" → years
function parseAge(a) {
  if (a == null || a === '') return null;
  const s = String(a).toLowerCase(), n = parseFloat(s.replace(',', '.'));
  if (!isFinite(n) || n < 0) return null;
  if (/month|mo\b|mnth/.test(s)) return Math.round(n / 12 * 100) / 100;
  if (/week|wk/.test(s)) return Math.round(n / 52 * 100) / 100;
  return n;
}
function normPet(P, r) {
  const dob = P.dob ? r[P.dob] : null, age = P.age ? r[P.age] : null;
  let years = null;
  if (dob && !isNaN(new Date(dob))) years = Math.round((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000) * 10) / 10;
  else years = parseAge(age);
  const wkg = P.weight ? parseFloat(String(r[P.weight] == null ? '' : r[P.weight]).replace(',', '.')) : NaN;
  return {
    id: String(r[P.id]), name: r[P.name] || 'My pet', species: P.species ? (r[P.species] || '') : '', breed: P.breed ? r[P.breed] || null : null,
    gender: P.gender ? String(r[P.gender] || '').toLowerCase() || null : null, weight_kg: isFinite(wkg) && wkg > 0 && !/\b(lb|lbs|pound)/i.test(String(r[P.weight])) ? wkg : null,
    photo: P.photo ? r[P.photo] || null : null, birthday: dob ? new Date(dob).toISOString().slice(0, 10) : null, age_years: years, age_label: ageLabel(dob, age)
  };
}
async function myPet(petId, userId) {
  const P = await petCols();
  const { rows } = await query(`SELECT p.* FROM pets p WHERE p.${q(P.id)}::text = $1 AND ${ownCond(P, 2)}`, [String(petId).slice(0, 64), userId]);
  return rows.length ? { P, row: rows[0], pet: normPet(P, rows[0]) } : null;
}
async function guard(req, res) {
  const m = await myPet(req.params.id, uid(req.user));
  if (!m) { R.notFound(res, 'Pet not found'); return null; }
  return m;
}

// ── pets ─────────────────────────────────────────────────────────────────────
// GET /petcare/pets
exports.listPets = async (req, res) => {
  try {
    const P = await petCols();
    const { rows } = await query(`SELECT p.* FROM pets p WHERE ${ownCond(P, 1)} ORDER BY ${P.created ? 'p.' + q(P.created) + ' ASC, ' : ''}p.${q(P.id)} ASC LIMIT 50`, [uid(req.user)]);
    return R.ok(res, { pets: rows.map(r => normPet(P, r)) });
  } catch (e) { return fail(res, 'listPets', e); }
};

const SPECIES = ['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'];
const GENDERS = ['male', 'female', 'unknown'];
function petInput(b, partial) {
  const o = {}, e = [];
  if (!partial || b.name !== undefined) { o.name = str(b.name, 60); if (!o.name) e.push('name'); }
  if (b.species !== undefined) { o.species = SPECIES.includes(String(b.species).toLowerCase()) ? String(b.species).toLowerCase() : 'other'; } else if (!partial) o.species = 'dog';
  if (b.breed !== undefined) o.breed = str(b.breed, 80) || null;
  if (b.gender !== undefined) { o.gender = GENDERS.includes(String(b.gender).toLowerCase()) ? String(b.gender).toLowerCase() : 'unknown'; }
  if (b.birthday !== undefined && b.birthday !== null && b.birthday !== '') { if (!DATE_RX.test(b.birthday) || b.birthday > todayISO() || isNaN(Date.parse(b.birthday))) e.push('birthday'); else o.birthday = b.birthday; }
  else if (b.birthday === null) o.birthday = null;
  if (b.age_years !== undefined && b.age_years !== null && b.age_years !== '') { const n = Number(b.age_years); if (!(n >= 0 && n <= 40)) e.push('age'); else o.age_years = n; }
  if (b.weight_kg !== undefined && b.weight_kg !== null && b.weight_kg !== '') { const n = Number(b.weight_kg); if (!(n > 0 && n <= 200)) e.push('weight'); else o.weight_kg = money2(n); }
  if (b.photo_url !== undefined) { const u = str(b.photo_url, 500); if (u && !/^https:\/\/[^\s"'<>]+$/.test(u)) e.push('photo'); else o.photo_url = u || null; }
  return { o, e };
}
function ageValue(P, o) {
  if (!P.age) return undefined;
  let n = o.age_years;
  if (o.birthday) n = (Date.now() - new Date(o.birthday).getTime()) / (365.25 * 86400000);
  if (n == null) return undefined;
  const t = P.c[P.age];
  return ['integer', 'bigint', 'smallint'].includes(t) ? Math.max(0, Math.round(n)) : (t === 'numeric' || t === 'real' || t === 'double precision') ? Math.round(n * 10) / 10 : String(Math.round(n * 10) / 10);
}
// POST /petcare/pets
exports.createPet = async (req, res) => {
  try {
    const { o, e } = petInput(req.body || {}, false);
    if (e.length) return bad(res, e);
    const P = await petCols(), me = uid(req.user);
    const { rows: u } = await query(`SELECT user_id::text AS id${P.userNo ? ', user_no' : ''} FROM users WHERE user_id::text = $1`, [me]);
    if (!u.length) return R.notFound(res, 'User not found');
    const set = {}; set[P.owner] = P.ownerIsInt && P.userNo ? u[0].user_no : me; set[P.name] = o.name;
    if (P.species) set[P.species] = o.species; if (P.breed && o.breed !== undefined) set[P.breed] = o.breed; if (P.gender && o.gender) set[P.gender] = o.gender;
    if (P.dob && o.birthday) set[P.dob] = o.birthday; const av = ageValue(P, o); if (av !== undefined) set[P.age] = av;
    if (P.weight && o.weight_kg != null) set[P.weight] = o.weight_kg; if (P.photo && o.photo_url) set[P.photo] = o.photo_url;
    const k = Object.keys(set);
    const { rows } = await query(`INSERT INTO pets (${k.map(q).join(', ')}) VALUES (${k.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`, k.map(x => set[x]));
    const pet = normPet(P, rows[0]);
    if (o.weight_kg != null) await addLog(pet.id, me, { kind: 'weight', value: o.weight_kg, logged_at: new Date().toISOString(), details: 'Added with profile' });
    return R.created(res, { pet });
  } catch (e) { return fail(res, 'createPet', e); }
};
// PATCH /petcare/pets/:id
exports.updatePet = async (req, res) => {
  try {
    const m = await guard(req, res); if (!m) return;
    const { o, e } = petInput(req.body || {}, true);
    if (e.length) return bad(res, e);
    const P = m.P, set = {};
    if (o.name !== undefined) set[P.name] = o.name; if (P.species && o.species) set[P.species] = o.species; if (P.breed && o.breed !== undefined) set[P.breed] = o.breed;
    if (P.gender && o.gender) set[P.gender] = o.gender; if (P.dob && o.birthday !== undefined) set[P.dob] = o.birthday;
    const av = ageValue(P, o); if (av !== undefined) set[P.age] = av;
    if (P.weight && o.weight_kg != null) set[P.weight] = o.weight_kg; if (P.photo && o.photo_url !== undefined) set[P.photo] = o.photo_url;
    const k = Object.keys(set);
    if (!k.length) return R.ok(res, { pet: m.pet });
    const { rows } = await query(`UPDATE pets SET ${k.map((x, i) => q(x) + ' = $' + (i + 1)).join(', ')}${P.updated ? ', ' + q(P.updated) + ' = NOW()' : ''} WHERE ${q(P.id)}::text = $${k.length + 1} RETURNING *`, k.map(x => set[x]).concat([m.pet.id]));
    if (o.weight_kg != null && o.weight_kg !== m.pet.weight_kg) await addLog(m.pet.id, uid(req.user), { kind: 'weight', value: o.weight_kg, logged_at: new Date().toISOString(), details: 'Updated profile' });
    return R.ok(res, { pet: normPet(P, rows[0]) });
  } catch (e) { return fail(res, 'updatePet', e); }
};

// ── existing health tables (read) ───────────────────────────────────────────
async function vaccinations(petId) {
  const c = await cols('pet_vaccinations'); if (!Object.keys(c).length) return [];
  const idc = pick(c, ['id', 'vaccination_id', 'record_id']), name = pick(c, ['vaccine_name', 'name', 'vaccine']), given = pick(c, ['given_date', 'administered_at', 'date_given', 'vaccinated_on', 'date']);
  const next = pick(c, ['next_due_date', 'next_due', 'due_date']), clinic = pick(c, ['vet_name', 'clinic_name', 'clinic', 'administered_by']), notes = pick(c, ['notes', 'note']);
  if (!name) return [];
  const { rows } = await query(`SELECT ${[idc && q(idc) + '::text AS id', q(name) + ' AS name', given ? q(given) + ' AS given' : 'NULL AS given', next ? q(next) + ' AS next_due' : 'NULL AS next_due', clinic ? q(clinic) + ' AS clinic' : 'NULL AS clinic', notes ? q(notes) + ' AS notes' : 'NULL AS notes'].filter(Boolean).join(', ')}
    FROM pet_vaccinations WHERE pet_id::text = $1 ORDER BY ${given ? q(given) + ' DESC NULLS LAST' : '1'} LIMIT 200`, [petId]);
  return rows.map(r => ({ id: r.id || null, name: r.name, given: d10(r.given), next_due: d10(r.next_due), clinic: r.clinic || null, notes: r.notes || null }));
}
function d10(v) { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
async function appointments(petId) {
  const c = await cols('vet_appointments'); if (!Object.keys(c).length || c.pet_id === undefined) return [];
  const date = pick(c, ['appt_date', 'appointment_date', 'date', 'scheduled_at', 'slot_date']), time = pick(c, ['appt_time', 'slot_time', 'time', 'start_time']);
  const ctype = pick(c, ['consult_type', 'type', 'service']), reason = pick(c, ['reason']), status = pick(c, ['status']), notes = pick(c, ['notes', 'vet_notes']), vetName = pick(c, ['vet_name', 'clinic_name']);
  if (!date) return [];
  // vet's name: from the vets table if the appointment links to it
  let vetSel = vetName ? 'a.' + q(vetName) : 'NULL', vetJoin = '';
  if (!vetName && c.vet_id !== undefined) {
    const v = await cols('vets');
    if (Object.keys(v).length && v.vet_id !== undefined) {
      const vn = pick(v, ['full_name', 'name', 'display_name', 'doctor_name']), cl = pick(v, ['clinic_name', 'clinic']);
      if (vn || cl || v.user_id !== undefined) {
        vetJoin = ' LEFT JOIN vets v ON v.vet_id = a.vet_id' + (!vn && v.user_id !== undefined ? ' LEFT JOIN users vu ON vu.user_id = v.user_id' : '');
        const nm = vn ? 'v.' + q(vn) : (v.user_id !== undefined ? 'vu.full_name' : 'NULL');
        vetSel = cl ? `CONCAT_WS(', ', ${nm}, v.${q(cl)})` : nm;
      }
    }
  }
  const { rows } = await query(`SELECT a.${q(date)} AS date${time ? ', a.' + q(time) + '::text AS time' : ''}${ctype ? ', a.' + q(ctype) + ' AS ctype' : ''}${reason ? ', a.' + q(reason) + ' AS reason' : ''}${status ? ', a.' + q(status) + ' AS status' : ''}${notes ? ', a.' + q(notes) + ' AS notes' : ''}, ${vetSel} AS vet
    FROM vet_appointments a${vetJoin} WHERE a.pet_id::text = $1 ORDER BY a.${q(date)} DESC LIMIT 100`, [petId]);
  const t = todayISO(), CT = { video: 'Video consultation', chat: 'Chat consultation', in_clinic: 'Clinic visit', 'in-clinic': 'Clinic visit' };
  return rows.map(r => { const d = d10(r.date), st = String(r.status || '').toLowerCase().replace('-', '_'), ct = String(r.ctype || '').toLowerCase();
    return { date: d, time: r.time ? String(r.time).slice(0, 5) : null, title: CT[ct] || (r.ctype ? cap(String(r.ctype).replace(/_/g, ' ')) : 'Vet appointment'), status: st || null,
      notes: [r.reason, r.notes].filter(Boolean).join(' · ') || null, vet: r.vet || null,
      upcoming: !!d && d >= t && !['cancelled', 'canceled', 'completed', 'done', 'no_show', 'rejected'].includes(st) }; });
}
async function prescriptions(petId) {
  const c = await cols('prescriptions'); if (!Object.keys(c).length) return [];
  const date = pick(c, ['created_at', 'issued_at', 'date']), title = pick(c, ['diagnosis', 'title', 'medicine_name', 'medication']), detail = pick(c, ['instructions', 'notes', 'details']), medsC = pick(c, ['medicines', 'medications']);
  let where = null;
  if (c.pet_id !== undefined) where = 'pr.pet_id::text = $1';
  else if (c.appointment_id !== undefined) { const a = await cols('vet_appointments'); if (a.pet_id !== undefined) { const aid = pick(a, ['id', 'appointment_id']); if (aid) where = `pr.appointment_id::text IN (SELECT ${q(aid)}::text FROM vet_appointments WHERE pet_id::text = $1)`; } }
  if (!where) return [];
  const { rows } = await query(`SELECT ${date ? 'pr.' + q(date) : 'NULL'} AS date, ${title ? 'pr.' + q(title) : 'NULL'} AS title, ${detail ? 'pr.' + q(detail) : 'NULL'} AS detail, ${medsC ? 'pr.' + q(medsC) : 'NULL'} AS meds FROM prescriptions pr WHERE ${where} ORDER BY 1 DESC NULLS LAST LIMIT 50`, [petId]);
  return rows.map(r => {
    let meds = r.meds; if (typeof meds === 'string') { try { meds = JSON.parse(meds); } catch (e) { meds = null; } }
    const names = Array.isArray(meds) ? meds.map(m => typeof m === 'string' ? m : (m && (m.name || m.medicine || m.drug) ? [m.name || m.medicine || m.drug, m.dose || m.dosage, m.frequency].filter(Boolean).join(' ') : null)).filter(Boolean) : [];
    const det = [names.length ? names.join(', ') : '', r.detail == null ? '' : String(r.detail)].filter(Boolean).join(' — ');
    return { date: d10(r.date), title: r.title ? String(r.title).slice(0, 160) : (names[0] || 'Prescription'), detail: det ? det.slice(0, 400) : null };
  });
}
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
async function safe(fn, d) { try { return await fn(); } catch (e) { console.error('[PetCare] read:', e.message); return d; } }

// ── owner logs ──────────────────────────────────────────────────────────────
const KINDS = ['weight', 'walk', 'meal', 'water', 'sleep', 'mood', 'event', 'memory', 'med_dose'];
const EVENT_TYPES = ['vet_visit', 'lab_test', 'grooming', 'milestone', 'emergency', 'surgery', 'other'];
const ACT_TYPES = ['walk', 'run', 'play', 'swim', 'training', 'other'];
const MOODS = ['happy', 'playful', 'calm', 'tired', 'anxious', 'unwell'];
async function addLog(petId, owner, b) {
  const { rows } = await query(`INSERT INTO pet_health_logs (pet_id, owner_id, kind, logged_at, value, title, details, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING log_id`,
    [petId, owner, b.kind, b.logged_at, b.value == null ? null : b.value, b.title || null, b.details || null, JSON.stringify(b.data || {})]);
  return rows[0].log_id;
}
// POST /petcare/pets/:id/logs
exports.createLog = async (req, res) => {
  try {
    const m = await guard(req, res); if (!m) return;
    const b = req.body || {}, kind = str(b.kind, 20), e = [];
    if (!KINDS.includes(kind) || kind === 'med_dose') return R.badRequest(res, 'Unknown record type');
    let at = b.logged_at ? new Date(b.logged_at) : new Date();
    if (isNaN(at) || at.getTime() > Date.now() + 36 * 3600000 || at.getFullYear() < 1990) e.push('logged_at');
    const v = b.value === '' || b.value == null ? null : Number(b.value);
    const lim = { weight: [0.05, 200], walk: [1, 600], meal: [1, 5000], water: [10, 10000], sleep: [0.5, 24] }[kind];
    if (lim && kind !== 'meal' && !(v >= lim[0] && v <= lim[1])) e.push('value');
    if (kind === 'meal' && v != null && !(v >= lim[0] && v <= lim[1])) e.push('value');
    const title = str(b.title, 120), details = str(b.details, 2000), data = {}, inData = (b.data && typeof b.data === 'object') ? b.data : {};
    if (['meal', 'event', 'memory'].includes(kind) && !title) e.push('title');
    if (kind === 'mood' && !MOODS.includes(title)) e.push('title');
    if (kind === 'event') { data.event_type = EVENT_TYPES.includes(inData.event_type) ? inData.event_type : 'other'; data.clinic = str(inData.clinic, 120) || null; }
    if (kind === 'walk') { data.type = ACT_TYPES.includes(inData.type) ? inData.type : 'walk'; const dk = Number(inData.distance_km); if (inData.distance_km != null && inData.distance_km !== '' && !(dk >= 0 && dk <= 100)) e.push('distance_km'); else if (dk > 0) data.distance_km = Math.round(dk * 10) / 10; }
    if (['event', 'memory'].includes(kind) && inData.photo_url) { const u = str(inData.photo_url, 500); if (!/^https:\/\/[^\s"'<>]+$/.test(u)) e.push('photo'); else data.photo_url = u; }
    if (e.length) return bad(res, e);
    let when = at.toISOString();
    if (kind === 'mood') {   // one mood per day: replace today's
      await query(`DELETE FROM pet_health_logs WHERE pet_id = $1 AND kind = 'mood' AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date`, [m.pet.id]);
    }
    const id = await addLog(m.pet.id, uid(req.user), { kind, logged_at: when, value: kind === 'weight' ? money2(v) : v, title: title || null, details: details || null, data });
    // newest weight becomes the profile weight
    if (kind === 'weight' && m.P.weight) {
      const { rows } = await query(`SELECT log_id FROM pet_health_logs WHERE pet_id = $1 AND kind = 'weight' ORDER BY logged_at DESC, log_id DESC LIMIT 1`, [m.pet.id]);
      if (rows.length && String(rows[0].log_id) === String(id)) await query(`UPDATE pets SET ${q(m.P.weight)} = $1 WHERE ${q(m.P.id)}::text = $2`, [String(money2(v)), m.pet.id]).catch(x => console.error('[PetCare] weight sync:', x.message));
    }
    return R.created(res, { log_id: id });
  } catch (e) { return fail(res, 'createLog', e); }
};
// DELETE /petcare/logs/:id
exports.deleteLog = async (req, res) => {
  try {
    const { rows } = await query(`DELETE FROM pet_health_logs WHERE log_id::text = $1 AND owner_id = $2 RETURNING pet_id, kind`, [str(req.params.id, 30), uid(req.user)]);
    if (!rows.length) return R.notFound(res, 'Record not found');
    if (rows[0].kind === 'weight') {   // keep the profile weight in step with the newest remaining weigh-in
      const P = await petCols();
      const { rows: w } = await query(`SELECT value FROM pet_health_logs WHERE pet_id = $1 AND kind = 'weight' ORDER BY logged_at DESC, log_id DESC LIMIT 1`, [rows[0].pet_id]);
      if (w.length && P.weight) await query(`UPDATE pets SET ${q(P.weight)} = $1 WHERE ${q(P.id)}::text = $2`, [Number(w[0].value), rows[0].pet_id]).catch(() => {});
    }
    return R.ok(res, { deleted: true });
  } catch (e) { return fail(res, 'deleteLog', e); }
};
// PUT /petcare/pets/:id/goal {goal_min|null}
exports.setGoal = async (req, res) => {
  try {
    const m = await guard(req, res); if (!m) return;
    const g = (req.body || {}).goal_min; const n = g === null || g === '' || g === undefined ? null : Number(g);
    if (n !== null && !(Number.isInteger(n) && n >= 5 && n <= 600)) return bad(res, ['goal_min']);
    await query(`INSERT INTO pet_care_settings (pet_id, goal_min, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (pet_id) DO UPDATE SET goal_min = EXCLUDED.goal_min, updated_at = NOW()`, [m.pet.id, n]);
    return R.ok(res, { goal_min: n });
  } catch (e) { return fail(res, 'setGoal', e); }
};

// ── vaccinations (write into the existing table) ─────────────────────────────
// POST /petcare/pets/:id/vaccinations {name, given_date, next_due_date, clinic, notes}
exports.addVaccination = async (req, res) => {
  try {
    const m = await guard(req, res); if (!m) return;
    const b = req.body || {}, e = [], name = str(b.name, 100), given = str(b.given_date, 10), next = str(b.next_due_date, 10) || null;
    if (!name) e.push('name');
    if (!DATE_RX.test(given) || given > todayISO() || isNaN(Date.parse(given))) e.push('given_date');
    if (next && (!DATE_RX.test(next) || isNaN(Date.parse(next)) || next <= given)) e.push('next_due_date');
    if (e.length) return bad(res, e);
    const c = await cols('pet_vaccinations'); if (!Object.keys(c).length) return R.serverError(res, 'Vaccination records are not available');
    const set = { pet_id: m.pet.id };
    const nameC = pick(c, ['vaccine_name', 'name', 'vaccine']); set[nameC] = name;
    // fill every "given" column the table has (older code used different names) so other pages see it too
    ['given_date', 'administered_at', 'date_given', 'vaccinated_on'].forEach(k => { if (c[k] !== undefined) set[k] = given; });
    const nextC = pick(c, ['next_due_date', 'next_due', 'due_date']); if (nextC && next) set[nextC] = next;
    const clinicC = pick(c, ['vet_name', 'clinic_name', 'clinic']); if (clinicC && b.clinic) set[clinicC] = str(b.clinic, 120);
    if (c.notes !== undefined && b.notes) set.notes = str(b.notes, 300);
    if (c.user_id !== undefined) { const { rows: u } = await query(`SELECT user_id::text AS id${(await cols('users')).user_no !== undefined ? ', user_no' : ''} FROM users WHERE user_id::text = $1`, [uid(req.user)]); set.user_id = ['integer', 'bigint'].includes(c.user_id) ? u[0].user_no : u[0].id; }
    if (c.reminder_set !== undefined && next) set.reminder_set = true;
    const k = Object.keys(set), vid = pick(c, ['id', 'vaccination_id']);
    const { rows: ins } = await query(`INSERT INTO pet_vaccinations (${k.map(q).join(', ')}) VALUES (${k.map((_, i) => '$' + (i + 1)).join(', ')})${vid ? ' RETURNING ' + q(vid) + ' AS id' : ''}`, k.map(x => set[x]));
    if (next && ins && ins[0]) {   // same reminder row the older vaccination endpoint created; never blocks saving
      try {
        const r = await cols('vaccination_reminders');
        if (r.vaccination_id !== undefined && r.reminder_date !== undefined) {
          const rs = { vaccination_id: ins[0].id, reminder_date: next };
          if (r.pet_id !== undefined) rs.pet_id = m.pet.id; if (r.vaccine_name !== undefined) rs.vaccine_name = name;
          if (r.user_id !== undefined) { const { rows: u } = await query(`SELECT user_id::text AS id, user_no FROM users WHERE user_id::text = $1`, [uid(req.user)]); rs.user_id = ['integer', 'bigint'].includes(r.user_id) ? u[0].user_no : u[0].id; }
          const rk = Object.keys(rs);
          await query(`INSERT INTO vaccination_reminders (${rk.map(q).join(', ')}) VALUES (${rk.map((_, i) => '$' + (i + 1)).join(', ')})`, rk.map(x => rs[x]));
        }
      } catch (x) { console.error('[PetCare] reminder row:', x.message); }
    }
    return R.created(res, { saved: true });
  } catch (e) { return fail(res, 'addVaccination', e); }
};

// ── medicines ───────────────────────────────────────────────────────────────
const FREQ = { daily: 1, twice_daily: 0.5, weekly: 7, monthly: 30, once: null, as_needed: null };
function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function addMonth(d) { const x = new Date(d + 'T00:00:00Z'); const day = x.getUTCDate(); x.setUTCMonth(x.getUTCMonth() + 1); if (x.getUTCDate() < day) x.setUTCDate(0); return x.toISOString().slice(0, 10); }
// POST /petcare/pets/:id/medicines
exports.addMedicine = async (req, res) => {
  try {
    const m = await guard(req, res); if (!m) return;
    const b = req.body || {}, e = [], name = str(b.name, 100), freq = Object.keys(FREQ).includes(b.frequency) ? b.frequency : null;
    const start = str(b.start_date, 10) || todayISO(), end = str(b.end_date, 10) || null;
    if (!name) e.push('name'); if (!freq) e.push('frequency');
    if (!DATE_RX.test(start) || isNaN(Date.parse(start))) e.push('start_date');
    if (end && (!DATE_RX.test(end) || isNaN(Date.parse(end)) || end < start)) e.push('end_date');
    if (e.length) return bad(res, e);
    const next = freq === 'as_needed' ? null : start;
    const { rows } = await query(`INSERT INTO pet_medicines (pet_id, owner_id, name, dose, frequency, start_date, end_date, next_due, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING med_id`,
      [m.pet.id, uid(req.user), name, str(b.dose, 80) || null, freq, start, end, next, str(b.notes, 300) || null]);
    return R.created(res, { med_id: rows[0].med_id });
  } catch (e) { return fail(res, 'addMedicine', e); }
};
async function myMed(id, owner) { const { rows } = await query(`SELECT * FROM pet_medicines WHERE med_id::text = $1 AND owner_id = $2`, [str(id, 30), owner]); return rows[0] || null; }
// POST /petcare/medicines/:id/given
exports.medGiven = async (req, res) => {
  try {
    const md = await myMed(req.params.id, uid(req.user)); if (!md) return R.notFound(res, 'Medicine not found');
    if (!md.active) return res.status(409).json({ success: false, message: 'This medicine is marked as finished' });
    const t = todayISO(), f = md.frequency;
    let next = null, active = true;
    if (f === 'daily') next = addDays(t, 1);
    else if (f === 'twice_daily') { const { rows } = await query(`SELECT COUNT(*)::int AS n FROM pet_health_logs WHERE kind = 'med_dose' AND data->>'med_id' = $1 AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`, [String(md.med_id), t]); next = rows[0].n >= 1 ? addDays(t, 1) : t; }
    else if (f === 'weekly') next = addDays(t, 7);
    else if (f === 'monthly') next = addMonth(t);
    else if (f === 'once') active = false;
    const endD = md.end_date ? d10(md.end_date) : null;
    if (next && endD && next > endD) { next = null; active = false; }
    await addLog(md.pet_id, md.owner_id, { kind: 'med_dose', logged_at: new Date().toISOString(), title: md.name, details: md.dose || null, data: { med_id: String(md.med_id) } });
    await query(`UPDATE pet_medicines SET last_given = NOW(), next_due = $2, active = $3, updated_at = NOW() WHERE med_id = $1`, [md.med_id, next, active]);
    return R.ok(res, { next_due: next, active });
  } catch (e) { return fail(res, 'medGiven', e); }
};
// PATCH /petcare/medicines/:id {active:false}
exports.updateMedicine = async (req, res) => {
  try {
    const md = await myMed(req.params.id, uid(req.user)); if (!md) return R.notFound(res, 'Medicine not found');
    const b = req.body || {};
    if (b.active === false) await query(`UPDATE pet_medicines SET active = FALSE, next_due = NULL, end_date = COALESCE(end_date, $2::date), updated_at = NOW() WHERE med_id = $1`, [md.med_id, todayISO()]);
    return R.ok(res, { updated: true });
  } catch (e) { return fail(res, 'updateMedicine', e); }
};

// ── private documents ───────────────────────────────────────────────────────
const DOC_DIR = process.env.PB_PETDOC_DIR || path.join(os.homedir(), 'pawbook_private', 'petdocs');
const DOC_KINDS = ['prescription', 'lab_report', 'certificate', 'insurance', 'other'];
const MAX_DOC = 5 * 1024 * 1024;
let multerMw = null;
exports.uploadMiddleware = (req, res, next) => {
  try {
    if (!multerMw) { const multer = require('multer'); multerMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOC, files: 1 } }).single('file'); }
    multerMw(req, res, err => { if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB' : 'Upload failed', fields: ['file'] }); next(); });
  } catch (e) { return fail(res, 'upload', e); }
};
function sniff(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return ['image/jpeg', '.jpg'];
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return ['image/png', '.png'];
  if (buf.slice(0, 5).toString() === '%PDF-') return ['application/pdf', '.pdf'];
  return null;
}
// POST /petcare/pets/:id/documents (multipart: file, doc_kind, title)
exports.uploadDoc = async (req, res) => {
  try {
    const m = await guard(req, res); if (!m) return;
    const f = req.file; const t = f && sniff(f.buffer);
    if (!f || !t) return bad(res, ['file'], 'Please upload a JPG, PNG or PDF');
    const { rows: cnt } = await query(`SELECT COUNT(*)::int AS n FROM pet_care_docs WHERE owner_id = $1`, [uid(req.user)]);
    if (cnt[0].n >= 200) return res.status(409).json({ success: false, message: 'You have reached the limit of 200 documents. Please delete some first.' });
    fs.mkdirSync(DOC_DIR, { recursive: true, mode: 0o700 });
    const stored = crypto.randomBytes(18).toString('hex') + t[1];
    fs.writeFileSync(path.join(DOC_DIR, stored), f.buffer, { mode: 0o600 });
    const kind = DOC_KINDS.includes(req.body.doc_kind) ? req.body.doc_kind : 'other';
    const orig = str(f.originalname, 160).replace(/[^\w .()-]/g, '_');
    try {
      const { rows } = await query(`INSERT INTO pet_care_docs (pet_id, owner_id, doc_kind, title, stored_name, original_name, mime, size_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING doc_id`,
        [m.pet.id, uid(req.user), kind, str(req.body.title, 120) || null, stored, orig, t[0], f.size]);
      return R.created(res, { doc_id: rows[0].doc_id });
    } catch (x) { try { fs.unlinkSync(path.join(DOC_DIR, stored)); } catch (y) {} throw x; }
  } catch (e) { return fail(res, 'uploadDoc', e); }
};
// GET /petcare/documents/:id  (owner only)
exports.getDoc = async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM pet_care_docs WHERE doc_id::text = $1 AND owner_id = $2`, [str(req.params.id, 30), uid(req.user)]);
    if (!rows.length) return R.notFound(res, 'Document not found');
    const fp = path.join(DOC_DIR, path.basename(rows[0].stored_name));
    if (!fs.existsSync(fp)) return R.notFound(res, 'File missing');
    res.setHeader('Content-Type', rows[0].mime); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; plugin-types application/pdf"); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Disposition', 'inline; filename="' + (rows[0].original_name || 'document').replace(/"/g, '') + '"');
    return fs.createReadStream(fp).pipe(res);
  } catch (e) { return fail(res, 'getDoc', e); }
};
// DELETE /petcare/documents/:id
exports.deleteDoc = async (req, res) => {
  try {
    const { rows } = await query(`DELETE FROM pet_care_docs WHERE doc_id::text = $1 AND owner_id = $2 RETURNING stored_name`, [str(req.params.id, 30), uid(req.user)]);
    if (!rows.length) return R.notFound(res, 'Document not found');
    try { fs.unlinkSync(path.join(DOC_DIR, path.basename(rows[0].stored_name))); } catch (e) {}
    return R.ok(res, { deleted: true });
  } catch (e) { return fail(res, 'deleteDoc', e); }
};

// ── overview (everything the page needs, one call) ───────────────────────────
// GET /petcare/pets/:id/overview
exports.overview = async (req, res) => {
  try {
    const m = await guard(req, res); if (!m) return;
    const pet = m.pet, id = pet.id, me = uid(req.user), t = todayISO();
    const [vax, appts, rx, logsR, medsR, docsR, setR, ownerR] = await Promise.all([
      safe(() => vaccinations(id), []), safe(() => appointments(id), []), safe(() => prescriptions(id), []),
      query(`SELECT log_id::text AS log_id, kind, logged_at, value::float AS value, title, details, data FROM pet_health_logs WHERE pet_id = $1 AND logged_at > NOW() - INTERVAL '3 years' ORDER BY logged_at DESC, log_id DESC LIMIT 1500`, [id]),
      query(`SELECT med_id::text AS med_id, name, dose, frequency, start_date, end_date, next_due, last_given, active, notes, created_at FROM pet_medicines WHERE pet_id = $1 ORDER BY active DESC, created_at DESC LIMIT 100`, [id]),
      query(`SELECT doc_id::text AS doc_id, doc_kind, title, original_name, mime, size_bytes, uploaded_at FROM pet_care_docs WHERE pet_id = $1 AND owner_id = $2 ORDER BY uploaded_at DESC LIMIT 200`, [id, me]),
      query(`SELECT goal_min FROM pet_care_settings WHERE pet_id = $1`, [id]).catch(() => ({ rows: [] })),
      query(`SELECT full_name FROM users WHERE user_id::text = $1`, [me]).catch(() => ({ rows: [] }))
    ]);
    const logs = logsR.rows.map(l => { l.data = typeof l.data === 'string' ? (() => { try { return JSON.parse(l.data); } catch (e) { return {}; } })() : (l.data || {}); return l; });
    const meds = medsR.rows.map(x => Object.assign(x, { start_date: d10(x.start_date), end_date: d10(x.end_date), next_due: d10(x.next_due) }));
    const goal = setR.rows.length ? setR.rows[0].goal_min : null;
    const istDay = v => new Date(new Date(v).getTime() + 330 * 60000).toISOString().slice(0, 10);

    // weights (logs; fall back to the profile weight)
    const weights = logs.filter(l => l.kind === 'weight').map(l => ({ log_id: l.log_id, date: istDay(l.logged_at), kg: l.value, notes: l.details || null }));

    // daily wellness
    const DAILY = ['walk', 'meal', 'water', 'sleep', 'mood'];
    const byDay = {}; logs.forEach(l => { if (!DAILY.includes(l.kind)) return; const d = istDay(l.logged_at); (byDay[d] = byDay[d] || []).push(l); });
    const sum = (d, k) => (byDay[d] || []).filter(l => l.kind === k).reduce((s, l) => s + (l.value || 0), 0);
    const todayLogs = byDay[t] || [];
    const moodL = todayLogs.find(l => l.kind === 'mood');
    const week = []; for (let i = 6; i >= 0; i--) { const d = addDays(t, -i); week.push({ day: d, walk_min: Math.round(sum(d, 'walk')) }); }
    let streak = 0; { let d = byDay[t] ? t : addDays(t, -1); while (byDay[d]) { streak++; d = addDays(d, -1); } }
    const daily = { today: { walk_min: Math.round(sum(t, 'walk')), meals: todayLogs.filter(l => l.kind === 'meal').length, water_ml: Math.round(sum(t, 'water')), sleep_h: sum(t, 'sleep') || null, mood: moodL ? moodL.title : null }, week, streak, goal_min: goal };

    // timeline (scrapbook)
    const tl = [];
    vax.forEach(v => tl.push({ kind: 'vaccination', date: v.given, title: v.name, who: v.clinic, detail: [v.next_due ? 'Next due ' + fmt(v.next_due, true) : '', v.notes].filter(Boolean).join(' · ') || null }));
    appts.filter(a => !a.upcoming && !['cancelled', 'canceled', 'rejected', 'no_show'].includes(a.status || '')).forEach(a => tl.push({ kind: 'appointment', date: a.date, title: a.title, who: a.vet, detail: a.notes }));
    rx.forEach(r => tl.push({ kind: 'prescription', date: r.date, title: r.title, detail: r.detail }));
    meds.forEach(x => tl.push({ kind: 'medicine', date: x.start_date, title: 'Started ' + x.name, detail: [x.dose, x.notes].filter(Boolean).join(' · ') || null }));
    logs.forEach(l => {
      if (l.kind === 'weight') tl.push({ kind: 'weight', log_id: l.log_id, date: istDay(l.logged_at), title: Number(l.value) + ' kg', detail: l.details });
      if (l.kind === 'event') tl.push({ kind: (l.data && l.data.event_type) || 'other', log_id: l.log_id, date: istDay(l.logged_at), title: l.title, who: l.data && l.data.clinic, detail: l.details, photo: l.data && l.data.photo_url });
      if (l.kind === 'memory') tl.push({ kind: 'memory', log_id: l.log_id, date: istDay(l.logged_at), title: l.title, detail: l.details, photo: l.data && l.data.photo_url });
    });
    tl.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    // reminders
    const rem = [];
    vax.forEach(v => { if (!v.next_due) return; const n = Math.round((Date.parse(v.next_due) - Date.parse(t)) / 86400000);
      // an older record is superseded when the same vaccine was given again later
      if (vax.some(o => o !== v && o.name && v.name && o.name.toLowerCase() === v.name.toLowerCase() && (o.given || '') > (v.given || ''))) return;
      if (n <= 30) rem.push({ kind: 'vaccine', title: v.name + (/booster|vaccin/i.test(v.name) ? '' : ' vaccine'), detail: n < 0 ? 'Was due ' + fmt(v.next_due) + ' · please book it' : 'Due ' + fmt(v.next_due) + ' · ' + (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n + ' days left'), status: n < 0 ? 'overdue' : 'soon', sort: n }); });
    meds.filter(x => x.active && x.next_due && x.frequency !== 'as_needed').forEach(x => { const n = Math.round((Date.parse(x.next_due) - Date.parse(t)) / 86400000);
      rem.push({ kind: 'medicine', ref: x.med_id, title: x.name + (x.dose ? ' · ' + x.dose : ''), detail: n < 0 ? 'Dose was due ' + fmt(x.next_due) : n === 0 ? 'Next dose · today' : 'Next dose · ' + fmt(x.next_due), status: n < 0 ? 'overdue' : n === 0 ? 'soon' : 'ok', sort: n + (n > 0 ? 100 : 0) }); });
    appts.filter(a => a.upcoming).forEach(a => { const n = Math.round((Date.parse(a.date) - Date.parse(t)) / 86400000); rem.push({ kind: 'appointment', title: a.title || 'Vet appointment', detail: fmt(a.date) + (a.time ? ' · ' + a.time : '') + (a.vet ? ' · ' + a.vet : ''), status: 'info', sort: n + 50 }); });
    const lastW = weights[0];
    if (lastW || pet.weight_kg != null) { const age = lastW ? Math.round((Date.parse(t) - Date.parse(lastW.date)) / 86400000) : 999; if (age > 45) rem.push({ kind: 'weight', title: 'Weight check', detail: lastW ? 'Last weighed ' + fmt(lastW.date) : 'No weigh-ins recorded yet', status: 'soon', sort: 200 }); }
    const lastVet = tl.find(e => e.kind === 'vet_visit' || e.kind === 'appointment');
    if (lastVet && Math.round((Date.parse(t) - Date.parse(lastVet.date)) / 86400000) > 365 && !appts.some(a => a.upcoming)) rem.push({ kind: 'vet', title: 'Yearly check-up', detail: 'Last vet visit ' + fmt(lastVet.date) + ' · consider a wellness check', status: 'soon', sort: 150 });
    rem.sort((a, b) => a.sort - b.sort); rem.forEach(r => delete r.sort);

    // wellness indicator (documented inputs only)
    const ind = [];
    const latestVax = vax.filter(v => !vax.some(o => o !== v && o.name && v.name && o.name.toLowerCase() === v.name.toLowerCase() && (o.given || '') > (v.given || '')));
    const overdue = latestVax.filter(v => v.next_due && v.next_due < t).length;
    ind.push(vax.length ? { key: 'vaccines', label: 'Vaccinations', max: 30, applies: true, points: Math.max(0, 30 - overdue * 15), detail: overdue ? overdue + ' overdue' : 'Up to date · ' + latestVax.length + ' on record' }
      : { key: 'vaccines', label: 'Vaccinations', max: 30, applies: true, points: 0, detail: 'None recorded yet' });
    const wAge = lastW ? Math.round((Date.parse(t) - Date.parse(lastW.date)) / 86400000) : null;
    ind.push({ key: 'weight', label: 'Weight tracking', max: 20, applies: true, points: wAge == null ? 0 : wAge <= 30 ? 20 : wAge <= 90 ? 10 : 0, detail: wAge == null ? 'No weigh-ins yet' : 'Last weighed ' + (wAge === 0 ? 'today' : wAge + ' days ago') });
    const vAge = lastVet ? Math.round((Date.parse(t) - Date.parse(lastVet.date)) / 86400000) : null;
    ind.push({ key: 'vet', label: 'Vet visits', max: 20, applies: true, points: vAge == null ? 0 : vAge <= 365 ? 20 : vAge <= 540 ? 10 : 0, detail: vAge == null ? 'No visits recorded' : 'Last visit ' + fmt(lastVet.date) });
    const actMeds = meds.filter(x => x.active && x.frequency !== 'as_needed' && x.next_due);
    const late = actMeds.filter(x => x.next_due < t).length;
    ind.push(actMeds.length ? { key: 'medicines', label: 'Medicine routine', max: 15, applies: true, points: late ? Math.max(0, 15 - late * 8) : 15, detail: late ? late + ' dose' + (late > 1 ? 's' : '') + ' overdue' : 'On track' }
      : { key: 'medicines', label: 'Medicine routine', max: 15, applies: false, points: 0, detail: 'No regular medicines' });
    const days7 = week.map(w => w.day).filter(d => byDay[d]).length;
    ind.push({ key: 'daily', label: 'Daily care', max: 15, applies: true, points: Math.round(days7 / 7 * 15), detail: days7 + ' of the last 7 days logged' });
    // a score only makes sense once core health records exist (vaccines or a vet visit)
    const any = vax.length || lastVet;
    const app = ind.filter(i => i.applies), tot = app.reduce((s, i) => s + i.max, 0), got = app.reduce((s, i) => s + i.points, 0);
    const wellness = { score: any ? Math.round(got / tot * 100) : null, indicators: ind };

    const memories = logs.filter(l => l.kind === 'memory').map(l => ({ log_id: l.log_id, date: istDay(l.logged_at), title: l.title, detail: l.details, photo: l.data && l.data.photo_url }));
    if (pet.birthday) memories.push({ date: pet.birthday, title: pet.name + ' was born', icon: '🎂', detail: null });
    memories.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const counts = { vaccines: latestVax.length, vet_visits: tl.filter(e => e.kind === 'vet_visit' || e.kind === 'appointment').length };
    return R.ok(res, {
      pet, owner_name: ownerR.rows[0] ? ownerR.rows[0].full_name : null, wellness, reminders: rem, timeline: tl.slice(0, 300), vaccinations: vax,
      vet: { appointments: appts, prescriptions: rx }, medicines: meds.map(x => ({ med_id: x.med_id, name: x.name, dose: x.dose, frequency: x.frequency, start_date: x.start_date, end_date: x.end_date, next_due: x.next_due, last_given: x.last_given, active: x.active, notes: x.notes })),
      weights, daily, logs: logs.filter(l => ['walk', 'meal', 'water'].includes(l.kind)).slice(0, 200).map(l => ({ log_id: l.log_id, kind: l.kind, logged_at: l.logged_at, value: l.value, title: l.title, details: l.details, data: l.data })),
      memories, documents: docsR.rows, counts
    });
  } catch (e) { return fail(res, 'overview', e); }
};
function fmt(d, y) { const x = new Date(d + 'T00:00:00Z'); return isNaN(x) ? d : x.toLocaleDateString('en-IN', Object.assign({ day: 'numeric', month: 'short', timeZone: 'UTC' }, y ? { year: 'numeric' } : {})); }
