'use strict';
/* ============================================================================
   PawBook VetCare — the veterinary workspace behind the Vet Portal (page 41).
   Uses the existing tables (vets, vet_appointments, vet_availability, prescriptions,
   pets, users, pet_vaccinations) and adds clinic-side tables (migration 013):
     vet_clinic_staff (team + roles), vet_queue (waiting room), vet_clinical_notes,
     vet_activity (audit trail), vet_notifications (delivery tracking).
   Who can do what:
     vet (vets.user_id, status 'active') and clinic admin: everything
     receptionist: schedule, waiting room, owner contact, vaccination due dates —
                   no clinical notes, prescriptions or full medical history, no revenue
   A clinic only sees pets that have (or had) an appointment with that vet.
   Mounted under /api/v1/vetcare (see add_shop_routes.js).
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = u => String(u.user_id);
const fail = (res, where, e) => { console.error('[VetCare] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const conflict = (res, msg) => res.status(409).json({ success: false, message: msg || 'Someone else just changed this. The page has been refreshed.' });
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/, TIME_RX = /^([01]\d|2[0-3]):[0-5]\d$/;
const todayISO = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);   // India date
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const d10 = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmt = d => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); return isNaN(x) ? String(d) : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const num = v => (v == null || v === '' ? null : Number(v));
const CLINICAL = ['vet', 'admin'];
const CT = { video: 'Video', chat: 'Chat', in_clinic: 'In clinic', Video: 'Video', Chat: 'Chat', 'In-Clinic': 'In clinic' };

// ── who is calling? ──────────────────────────────────────────────────────────
// Returns { vet_id, role, vet } for the practice the user works in (?practice=<vet_id> picks one if several).
async function practices(user) {
  const me = uid(user);
  const { rows } = await query(
    `SELECT v.vet_id::text AS vet_id, 'vet' AS role, v.status FROM vets v WHERE v.user_id::text = $1
     UNION ALL
     SELECT s.vet_id::text, s.role, v.status FROM vet_clinic_staff s JOIN vets v ON v.vet_id = s.vet_id WHERE s.user_id::text = $1 AND s.removed_at IS NULL`, [me]);
  return rows;
}
async function ctx(req, res, roles) {
  const list = await practices(req.user);
  if (!list.length) { res.status(403).json({ success: false, code: 'not_vet', message: 'This workspace is for registered PawBook vets and their clinic team.' }); return null; }
  const want = str(req.query.practice || (req.body && req.body.practice), 40);
  const p = (want && list.find(x => x.vet_id === want)) || list.find(x => x.status === 'active') || list[0];
  if (p.status !== 'active') { res.status(403).json({ success: false, code: p.status === 'pending' ? 'pending' : 'suspended', message: p.status === 'pending' ? 'Your vet registration is being verified. The workspace opens once it is approved.' : 'This clinic account is suspended. Please contact support@deemona.com.' }); return null; }
  if (roles && !roles.includes(p.role)) { res.status(403).json({ success: false, code: 'role', message: 'Your role in this clinic cannot do this.' }); return null; }
  return { vet_id: p.vet_id, role: p.role, me: uid(req.user), all: list };
}
async function log(c, action, pet, ref, detail) {
  try { await query(`INSERT INTO vet_activity (vet_id, user_id, pet_id, action, ref, detail) VALUES ($1,$2,$3,$4,$5,$6)`, [c.vet_id, c.me, pet == null ? null : Number(pet), action, ref == null ? null : String(ref).slice(0, 80), JSON.stringify(detail || {})]); }
  catch (e) { console.error('[VetCare] audit:', e.message); }
}
// is this pet a patient of the clinic?
async function patientOf(c, petId) {
  if (!/^\d{1,10}$/.test(String(petId))) return false;
  const { rows } = await query(`SELECT 1 FROM vet_appointments WHERE vet_id::text = $1 AND pet_id = $2 LIMIT 1`, [c.vet_id, Number(petId)]);
  return rows.length > 0;
}

// ── pet + owner shapes ───────────────────────────────────────────────────────
function ageLabel(a) {
  if (a == null || a === '') return null; const s = String(a).toLowerCase(), n = parseFloat(s);
  if (!isFinite(n)) return String(a).slice(0, 20);
  if (/month|mo\b/.test(s)) return n < 12 ? Math.round(n) + ' months' : Math.round(n / 12) + ' years';
  if (/week|wk/.test(s)) return Math.round(n) + ' weeks';
  return n < 1 ? Math.round(n * 12) + ' months' : (n === 1 ? '1 year' : (Math.round(n * 10) / 10) + ' years');
}
const PET_SEL = `p.id AS pet_id, p.name AS pet_name, p.species, p.breed, p.age AS pet_age, p.gender, p.weight AS pet_weight, p.avatar AS pet_photo`;
const OWNER_JOIN = `LEFT JOIN users ou ON p.user_id::text IN (ou.user_id::text, ou.user_no::text)`;
function petOut(r) {
  if (r.pet_id == null) return null;
  const w = parseFloat(String(r.pet_weight == null ? '' : r.pet_weight).replace(',', '.'));
  return { id: String(r.pet_id), name: r.pet_name, species: r.species || null, breed: r.breed || null, age: ageLabel(r.pet_age), gender: r.gender || null,
    weight_kg: isFinite(w) && w > 0 && !/lb/i.test(String(r.pet_weight)) ? w : null, photo: r.pet_photo && /^https:\/\//.test(r.pet_photo) ? r.pet_photo : null };
}
function apptOut(r, c, q) {
  const st = String(r.status || '').toLowerCase();
  return { id: r.appointment_id, date: d10(r.appt_date), time: r.appt_time ? String(r.appt_time).slice(0, 5) : null, type: CT[r.consult_type] || r.consult_type, reason: r.reason || null,
    status: st, notes: CLINICAL.includes(c.role) ? (r.notes || null) : null, fee: CLINICAL.includes(c.role) && r.fee_paid != null ? Number(r.fee_paid) : null, payment: CLINICAL.includes(c.role) ? r.payment_status : null,
    pet: petOut(r), owner: { name: r.owner_name || null, phone: r.owner_phone || null }, token: r.updated_at ? new Date(r.updated_at).toISOString() : null, queue: q || null };
}
const APPT_SQL = `SELECT a.appointment_id::text, a.appt_date, a.appt_time, a.consult_type, a.reason, a.status, a.notes, a.fee_paid, a.payment_status, a.updated_at, a.user_id::text AS owner_id,
    ${PET_SEL}, bu.full_name AS owner_name, bu.phone AS owner_phone
  FROM vet_appointments a LEFT JOIN pets p ON p.id = a.pet_id LEFT JOIN users bu ON bu.user_id = a.user_id`;
function queueOut(r) {
  const wait = r.status === 'waiting' ? Math.max(0, Math.round((Date.now() - new Date(r.checked_in_at).getTime()) / 60000)) : r.called_at ? Math.max(0, Math.round((new Date(r.called_at) - new Date(r.checked_in_at)) / 60000)) : null;
  return { id: String(r.queue_id), appointment_id: r.appointment_id || null, status: r.status, priority: r.priority, reason: r.reason || null, checked_in_at: r.checked_in_at, called_at: r.called_at, wait_min: wait,
    token: new Date(r.updated_at).toISOString(), pet: r.pet_id != null ? petOut(r) : { id: null, name: r.walkin_name, species: r.walkin_species || null, breed: null, photo: null, walkin: true },
    owner: { name: r.owner_name || r.walkin_owner || null } };
}
const QUEUE_SQL = `SELECT q.*, ${PET_SEL}, ou.full_name AS owner_name FROM vet_queue q LEFT JOIN pets p ON p.id = q.pet_id ${OWNER_JOIN}`;
const PRI = { urgent: 0, priority: 1, routine: 2 };
const sortQueue = l => l.sort((a, b) => (a.status === 'in_consult' ? -1 : 0) - (b.status === 'in_consult' ? -1 : 0) || PRI[a.priority] - PRI[b.priority] || new Date(a.checked_in_at) - new Date(b.checked_in_at));

// latest record per vaccine per pet, for the clinic's patients
async function vaxDue(c, from, to) {
  const { rows } = await query(
    `WITH pts AS (SELECT DISTINCT pet_id FROM vet_appointments WHERE vet_id::text = $1 AND pet_id IS NOT NULL),
     latest AS (SELECT DISTINCT ON (v.pet_id, lower(v.vaccine_name)) v.pet_id, v.vaccine_name, v.given_date, v.next_due_date FROM pet_vaccinations v JOIN pts ON pts.pet_id = v.pet_id
       ORDER BY v.pet_id, lower(v.vaccine_name), v.given_date DESC NULLS LAST, v.id DESC)
     SELECT l.*, ${PET_SEL}, ou.full_name AS owner_name, ou.phone AS owner_phone FROM latest l JOIN pets p ON p.id = l.pet_id ${OWNER_JOIN}
     WHERE l.next_due_date IS NOT NULL AND l.next_due_date <= $2 ${from ? 'AND l.next_due_date >= $3' : ''} ORDER BY l.next_due_date`, from ? [c.vet_id, to, from] : [c.vet_id, to]);
  return rows.map(r => ({ pet: petOut(r), owner: { name: r.owner_name || null, phone: r.owner_phone || null }, vaccine: r.vaccine_name, given: d10(r.given_date), next_due: d10(r.next_due_date) }));
}

// ── GET /vetcare/me ──────────────────────────────────────────────────────────
exports.me = async (req, res) => {
  try {
    const list = await practices(req.user);
    if (!list.length) return R.ok(res, { practices: [] });
    const { rows } = await query(`SELECT vet_id::text, first_name, last_name, clinic_name, city, avatar_url, status FROM vets WHERE vet_id::text = ANY($1)`, [list.map(x => x.vet_id)]);
    return R.ok(res, { practices: list.map(p => { const v = rows.find(x => x.vet_id === p.vet_id) || {}; return { vet_id: p.vet_id, role: p.role, status: p.status, vet_name: [v.first_name, v.last_name].filter(Boolean).join(' '), clinic: v.clinic_name || null, city: v.city || null }; }) });
  } catch (e) { return fail(res, 'me', e); }
};

// ── GET /vetcare/dashboard?date=YYYY-MM-DD ────────────────────────────────────
exports.dashboard = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const t = todayISO(), day = DATE_RX.test(str(req.query.date, 10)) ? str(req.query.date, 10) : t, w0 = addDays(t, -6);
    const [vetR, meR, apR, qR, ptR, wkR, rxR, waitR, vaxR, pastR, unpaidR, staleR] = await Promise.all([
      query(`SELECT first_name, last_name, clinic_name, city, avatar_url, clinic_address FROM vets WHERE vet_id::text = $1`, [c.vet_id]),
      query(`SELECT full_name FROM users WHERE user_id::text = $1`, [c.me]),
      query(`${APPT_SQL} WHERE a.vet_id::text = $1 AND a.appt_date = $2 ORDER BY a.appt_time`, [c.vet_id, day]),
      query(`${QUEUE_SQL} WHERE q.vet_id::text = $1 AND (q.status IN ('waiting','in_consult') OR (q.checked_in_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date)`, [c.vet_id, t]),
      query(`SELECT COUNT(DISTINCT pet_id)::int AS n, COUNT(DISTINCT pet_id) FILTER (WHERE first_at >= $2::date - 29)::int AS new30 FROM (SELECT pet_id, MIN(appt_date) AS first_at FROM vet_appointments WHERE vet_id::text = $1 AND pet_id IS NOT NULL GROUP BY pet_id) x`, [c.vet_id, t]),
      query(`SELECT appt_date, status, fee_paid, payment_status, pet_id FROM vet_appointments WHERE vet_id::text = $1 AND appt_date BETWEEN $2 AND $3`, [c.vet_id, w0, t]),
      query(`SELECT COUNT(*)::int AS n FROM prescriptions WHERE vet_id::text = $1 AND created_at >= $2::date`, [c.vet_id, w0]),
      query(`SELECT AVG(EXTRACT(EPOCH FROM (called_at - checked_in_at)) / 60)::float AS avg FROM vet_queue WHERE vet_id::text = $1 AND called_at IS NOT NULL AND checked_in_at >= $2::date`, [c.vet_id, w0]),
      query(`SELECT COUNT(*)::int AS n FROM vet_activity WHERE vet_id::text = $1 AND action = 'vaccination' AND at >= $2::date`, [c.vet_id, w0]),
      query(`SELECT COUNT(*)::int AS n FROM vet_appointments WHERE vet_id::text = $1 AND status = 'upcoming' AND appt_date < $2`, [c.vet_id, t]),
      CLINICAL.includes(c.role) ? query(`SELECT COUNT(*)::int AS n FROM vet_appointments WHERE vet_id::text = $1 AND status = 'completed' AND COALESCE(payment_status,'pending') = 'pending' AND appt_date >= $2::date - 30`, [c.vet_id, t]) : Promise.resolve({ rows: [{ n: 0 }] }),
      query(`WITH last AS (SELECT pet_id, MAX(appt_date) AS d FROM vet_appointments WHERE vet_id::text = $1 AND status = 'completed' AND pet_id IS NOT NULL GROUP BY pet_id)
        SELECT l.d, ${PET_SEL}, ou.full_name AS owner_name FROM last l JOIN pets p ON p.id = l.pet_id ${OWNER_JOIN}
        WHERE l.d < $2::date - 365 AND NOT EXISTS (SELECT 1 FROM vet_appointments a2 WHERE a2.vet_id::text = $1 AND a2.pet_id = l.pet_id AND a2.status = 'upcoming' AND a2.appt_date >= $2::date) ORDER BY l.d LIMIT 20`, [c.vet_id, t])
    ]);
    const queue = sortQueue(qR.rows.map(queueOut));
    const qByAppt = {}; queue.forEach(x => { if (x.appointment_id) qByAppt[x.appointment_id] = x; });
    // a finished queue entry today still tells the card it was seen
    const appts = apR.rows.map(r => apptOut(r, c, qByAppt[r.appointment_id] || null));
    const v = vetR.rows[0] || {};
    const open = queue.filter(x => x.status === 'waiting' || x.status === 'in_consult');
    const due7 = await vaxDue(c, t, addDays(t, 7)), overdue = await vaxDue(c, null, addDays(t, -1));
    // week
    const wk = wkR.rows.map(r => Object.assign(r, { day: d10(r.appt_date) }));
    const days = []; for (let i = 6; i >= 0; i--) { const d = addDays(t, -i); const l = wk.filter(r => r.day === d); days.push({ day: d, total: l.length, completed: l.filter(r => r.status === 'completed').length }); }
    const closed = wk.filter(r => r.status !== 'upcoming');
    const firstR = await query(`SELECT COUNT(*)::int AS n FROM (SELECT pet_id, MIN(appt_date) f FROM vet_appointments WHERE vet_id::text = $1 AND pet_id IS NOT NULL GROUP BY pet_id) x WHERE f BETWEEN $2 AND $3`, [c.vet_id, w0, t]);
    const week = { from: w0, to: t, total: wk.length, completed: wk.filter(r => r.status === 'completed').length, cancelled: wk.filter(r => r.status === 'cancelled').length, no_show: wk.filter(r => r.status === 'no-show').length,
      new_patients: firstR.rows[0].n, vaccinations: vaxR.rows[0].n, prescriptions: rxR.rows[0].n, avg_wait_min: waitR.rows[0].avg == null ? null : Math.round(waitR.rows[0].avg),
      completion_rate: closed.length ? Math.round(wk.filter(r => r.status === 'completed').length / closed.length * 100) : null, days,
      revenue: CLINICAL.includes(c.role) ? wk.filter(r => r.payment_status === 'paid').reduce((s, r) => s + Number(r.fee_paid || 0), 0) : null };
    // patient care attention — kept in separate, clearly different groups
    const attention = {
      urgent: open.filter(x => x.priority === 'urgent').map(x => ({ title: (x.pet.name || 'Walk-in') + (x.reason ? ' · ' + x.reason : ''), detail: 'Marked urgent in the waiting room · waiting ' + x.wait_min + ' min', queue_id: x.id, pet_id: x.pet.id })),
      follow_up: staleR.rows.map(r => ({ title: r.pet_name + ' · wellness check', detail: 'Last visit ' + fmt(d10(r.d)) + ' (over a year ago) · no visit booked', pet_id: String(r.pet_id), owner: r.owner_name || null })),
      preventive: { due_7: due7.length, overdue: overdue.length, items: overdue.slice(0, 6).map(x => ({ title: x.pet.name + ' · ' + x.vaccine, detail: 'Was due ' + fmt(x.next_due), pet_id: x.pet.id })) },
      admin: [pastR.rows[0].n ? { key: 'close_out', title: pastR.rows[0].n + ' past appointment' + (pastR.rows[0].n > 1 ? 's' : '') + ' not closed', detail: 'Mark them completed, no-show or cancelled' } : null,
        unpaidR.rows[0].n ? { key: 'unpaid', title: unpaidR.rows[0].n + ' completed visit' + (unpaidR.rows[0].n > 1 ? 's' : '') + ' without payment recorded', detail: 'Last 30 days' } : null].filter(Boolean)
    };
    return R.ok(res, {
      role: c.role, practices: c.all.length, today: t, date: day,
      clinic: { vet_name: [v.first_name, v.last_name].filter(Boolean).join(' '), clinic: v.clinic_name || null, city: v.city || null, avatar: v.avatar_url && /^https:\/\//.test(v.avatar_url) ? v.avatar_url : null },
      viewer: { name: meR.rows[0] ? meR.rows[0].full_name : null },
      kpi: { today: appts.length, completed: appts.filter(a => a.status === 'completed').length, remaining: appts.filter(a => a.status === 'upcoming').length, patients: ptR.rows[0].n, new_patients_30: ptR.rows[0].new30,
        waiting: open.filter(x => x.status === 'waiting').length, in_consult: open.filter(x => x.status === 'in_consult').length, vaccines_due_7: due7.length, vaccines_overdue: overdue.length },
      appointments: appts, queue: open, attention, week
    });
  } catch (e) { return fail(res, 'dashboard', e); }
};

// ── schedule ─────────────────────────────────────────────────────────────────
// GET /vetcare/schedule?from=YYYY-MM-DD&days=7
exports.schedule = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const from = DATE_RX.test(str(req.query.from, 10)) ? str(req.query.from, 10) : todayISO(), n = Math.min(31, Math.max(1, parseInt(req.query.days, 10) || 7)), to = addDays(from, n - 1);
    const { rows } = await query(`${APPT_SQL} WHERE a.vet_id::text = $1 AND a.appt_date BETWEEN $2 AND $3 ORDER BY a.appt_date, a.appt_time`, [c.vet_id, from, to]);
    return R.ok(res, { from, to, appointments: rows.map(r => apptOut(r, c)) });
  } catch (e) { return fail(res, 'schedule', e); }
};

// PATCH /vetcare/appointments/:id {action: complete|cancel|no_show|reschedule, token, date, time, reason}
exports.updateAppointment = async (req, res) => {
  const client = await db.getClient();
  try {
    const c = await ctx(req, res); if (!c) return;
    const id = str(req.params.id, 40), b = req.body || {}, act = str(b.action, 20), token = str(b.token, 40);
    if (!['complete', 'cancel', 'no_show', 'reschedule'].includes(act)) return bad(res, ['action'], 'Unknown action');
    if (act === 'complete' && !CLINICAL.includes(c.role)) return res.status(403).json({ success: false, message: 'Only the vet or a clinic admin can complete a consultation.' });
    const { rows: cur } = await client.query(`SELECT appointment_id::text, status, appt_date, appt_time, slot_id, pet_id, updated_at, COALESCE(updated_at::text, '') AS ut FROM vet_appointments WHERE appointment_id::text = $1 AND vet_id::text = $2`, [id, c.vet_id]);
    if (!cur.length) return R.notFound(res, 'Appointment not found');
    const a = cur[0];
    if (token && a.updated_at && new Date(a.updated_at).toISOString() !== token) return conflict(res);
    if (a.status !== 'upcoming') return conflict(res, 'This appointment is already ' + a.status.replace('-', ' ') + '.');
    await client.query('BEGIN');
    let set, vals;
    if (act === 'reschedule') {
      const d = str(b.date, 10), tm = str(b.time, 5), e = [];
      if (!DATE_RX.test(d) || isNaN(Date.parse(d)) || d < todayISO()) e.push('date'); if (!TIME_RX.test(tm)) e.push('time');
      if (e.length) { await client.query('ROLLBACK'); return bad(res, e); }
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [c.vet_id + '|' + d + '|' + tm]);
      const { rows: clash } = await client.query(`SELECT 1 FROM vet_appointments WHERE vet_id::text = $1 AND appt_date = $2 AND appt_time = $3::time AND status = 'upcoming' AND appointment_id::text <> $4`, [c.vet_id, d, tm, id]);
      if (clash.length) { await client.query('ROLLBACK'); return conflict(res, 'Another appointment is already booked at that time.'); }
      set = `appt_date = $3, appt_time = $4::time, slot_id = NULL`; vals = [d, tm];
    } else { set = `status = $3`; vals = [act === 'complete' ? 'completed' : act === 'cancel' ? 'cancelled' : 'no-show']; }
    const { rows: up } = await client.query(`UPDATE vet_appointments SET ${set}, updated_at = NOW() WHERE appointment_id::text = $1 AND vet_id::text = $2 AND status = 'upcoming' AND COALESCE(updated_at::text, '') = $${vals.length + 3} RETURNING updated_at`, [id, c.vet_id].concat(vals, [a.ut]));
    if (!up.length) { await client.query('ROLLBACK'); return conflict(res); }
    if (a.slot_id && (act === 'cancel' || act === 'reschedule')) await client.query(`UPDATE vet_availability SET is_booked = FALSE WHERE slot_id = $1`, [a.slot_id]);
    if (act !== 'reschedule') await client.query(`UPDATE vet_queue SET status = CASE WHEN $2 = 'complete' THEN 'done' ELSE 'left' END, finished_at = NOW(), updated_at = NOW() WHERE appointment_id::text = $1 AND status IN ('waiting','in_consult')`, [id, act]);
    await client.query('COMMIT');
    await log(c, 'appointment_' + act, a.pet_id, id, act === 'reschedule' ? { from: d10(a.appt_date) + ' ' + String(a.appt_time).slice(0, 5), to: vals[0] + ' ' + vals[1] } : (b.reason ? { reason: str(b.reason, 200) } : {}));
    if (act === 'cancel') notify(c, id, 'cancelled', { cancellationReason: str(b.reason, 200) || undefined, cancelledBy: 'vet' });
    return R.ok(res, { saved: true });
  } catch (e) { try { await client.query('ROLLBACK'); } catch (x) {} return fail(res, 'updateAppointment', e); }
  finally { client.release(); }
};
// owner notification through the existing WhatsApp integration (if it is installed); every attempt is recorded
function notify(c, apptId, event, opts) {
  let fn = null; try { fn = require('../routes/whatsapp.routes').notifyIfStatusChanged; } catch (e) {}
  const rec = (result, err) => query(`INSERT INTO vet_notifications (vet_id, appointment_id, channel, event, result, error) VALUES ($1,$2,'whatsapp',$3,$4,$5)`, [c.vet_id, apptId, event, result, err ? String(err).slice(0, 200) : null]).catch(() => {});
  if (typeof fn !== 'function') return rec('unavailable');
  Promise.resolve().then(() => fn(apptId, event, opts || {})).then(() => rec('sent'), e => rec('failed', e && e.message));
}

// POST /vetcare/appointments {pet_id, date, time, consult_type, reason}  — follow-up for an existing patient
exports.createAppointment = async (req, res) => {
  const client = await db.getClient();
  try {
    const c = await ctx(req, res); if (!c) return;
    const b = req.body || {}, e = [], d = str(b.date, 10), tm = str(b.time, 5), ct = str(b.consult_type, 12) || 'in_clinic';
    if (!(await patientOf(c, b.pet_id))) return R.notFound(res, 'Patient not found');
    if (!DATE_RX.test(d) || isNaN(Date.parse(d)) || d < todayISO()) e.push('date'); if (!TIME_RX.test(tm)) e.push('time'); if (!['in_clinic', 'video', 'chat'].includes(ct)) e.push('consult_type');
    if (e.length) return bad(res, e);
    const { rows: ow } = await client.query(`SELECT ou.user_id FROM pets p JOIN users ou ON p.user_id::text IN (ou.user_id::text, ou.user_no::text) WHERE p.id = $1 LIMIT 1`, [Number(b.pet_id)]);
    if (!ow.length) return R.notFound(res, 'Pet owner not found');
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [c.vet_id + '|' + d + '|' + tm]);
    const { rows: clash } = await client.query(`SELECT 1 FROM vet_appointments WHERE vet_id::text = $1 AND appt_date = $2 AND appt_time = $3::time AND status = 'upcoming'`, [c.vet_id, d, tm]);
    if (clash.length) { await client.query('ROLLBACK'); return conflict(res, 'Another appointment is already booked at that time.'); }
    const { rows } = await client.query(`INSERT INTO vet_appointments (user_id, vet_id, pet_id, appt_date, appt_time, consult_type, reason, status) VALUES ($1,$2::uuid,$3,$4,$5::time,$6,$7,'upcoming') RETURNING appointment_id::text`,
      [ow[0].user_id, c.vet_id, Number(b.pet_id), d, tm, ct, str(b.reason, 300) || 'Follow-up']);
    await client.query('COMMIT');
    await log(c, 'appointment_created', b.pet_id, rows[0].appointment_id, { date: d, time: tm });
    return R.created(res, { id: rows[0].appointment_id });
  } catch (e) { try { await client.query('ROLLBACK'); } catch (x) {} return fail(res, 'createAppointment', e); }
  finally { client.release(); }
};

// ── waiting room ─────────────────────────────────────────────────────────────
// POST /vetcare/queue {appointment_id} or {walkin_name, walkin_species, walkin_owner, reason, priority}
exports.checkIn = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const b = req.body || {}, pri = ['routine', 'priority', 'urgent'].includes(b.priority) ? b.priority : 'routine';
    if (b.appointment_id) {
      const { rows: a } = await query(`SELECT appointment_id::text, pet_id, reason, status, appt_date FROM vet_appointments WHERE appointment_id::text = $1 AND vet_id::text = $2`, [str(b.appointment_id, 40), c.vet_id]);
      if (!a.length) return R.notFound(res, 'Appointment not found');
      if (a[0].status !== 'upcoming') return conflict(res, 'This appointment is already ' + a[0].status.replace('-', ' ') + '.');
      if (d10(a[0].appt_date) !== todayISO()) return bad(res, ['appointment_id'], 'Only today\'s appointments can be checked in.');
      try {
        const { rows } = await query(`INSERT INTO vet_queue (vet_id, appointment_id, pet_id, reason, priority, checked_in_by) VALUES ($1,$2::uuid,$3,$4,$5,$6) RETURNING queue_id::text`, [c.vet_id, a[0].appointment_id, a[0].pet_id, str(b.reason, 200) || (a[0].reason ? String(a[0].reason).slice(0, 200) : null), pri, c.me]);
        await log(c, 'checked_in', a[0].pet_id, rows[0].queue_id, { priority: pri });
        return R.created(res, { id: rows[0].queue_id });
      } catch (x) { if (x.code === '23505') return conflict(res, 'Already checked in.'); throw x; }
    }
    const name = str(b.walkin_name, 80); if (!name) return bad(res, ['walkin_name'], 'Please enter the pet\'s name');
    const { rows } = await query(`INSERT INTO vet_queue (vet_id, walkin_name, walkin_species, walkin_owner, reason, priority, checked_in_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING queue_id::text`,
      [c.vet_id, name, str(b.walkin_species, 40) || null, str(b.walkin_owner, 120) || null, str(b.reason, 200) || null, pri, c.me]);
    await log(c, 'walk_in', null, rows[0].queue_id, { priority: pri });
    return R.created(res, { id: rows[0].queue_id });
  } catch (e) { return fail(res, 'checkIn', e); }
};
// PATCH /vetcare/queue/:id {action: call|finish|leave|priority, priority, token}
exports.updateQueue = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const id = str(req.params.id, 20), b = req.body || {}, act = str(b.action, 12);
    const { rows: cur } = await query(`SELECT *, updated_at::text AS ut FROM vet_queue WHERE queue_id::text = $1 AND vet_id::text = $2`, [id, c.vet_id]);
    if (!cur.length) return R.notFound(res, 'Not in the waiting room');
    const q = cur[0];
    if (b.token && new Date(q.updated_at).toISOString() !== str(b.token, 40)) return conflict(res);
    const from = { call: ['waiting'], finish: ['in_consult', 'waiting'], leave: ['waiting', 'in_consult'], priority: ['waiting', 'in_consult'] }[act];
    if (!from) return bad(res, ['action'], 'Unknown action');
    if (act === 'finish' && !CLINICAL.includes(c.role)) return res.status(403).json({ success: false, message: 'Only the vet or a clinic admin can finish a consultation.' });
    if (!from.includes(q.status)) return conflict(res, 'This patient is already ' + q.status.replace('_', ' ') + '.');
    let set = '', vals = [];
    if (act === 'call') set = `status = 'in_consult', called_at = NOW()`;
    if (act === 'finish') set = `status = 'done', finished_at = NOW(), called_at = COALESCE(called_at, NOW())`;
    if (act === 'leave') set = `status = 'left', finished_at = NOW()`;
    if (act === 'priority') { if (!['routine', 'priority', 'urgent'].includes(b.priority)) return bad(res, ['priority']); set = `priority = $4`; vals = [b.priority]; }
    const { rows: up } = await query(`UPDATE vet_queue SET ${set}, updated_at = NOW() WHERE queue_id::text = $1 AND vet_id::text = $2 AND updated_at::text = $3 RETURNING queue_id`, [id, c.vet_id, q.ut].concat(vals));
    if (!up.length) return conflict(res);
    if (act === 'finish' && q.appointment_id) await query(`UPDATE vet_appointments SET status = 'completed', updated_at = NOW() WHERE appointment_id = $1 AND status = 'upcoming'`, [q.appointment_id]);
    await log(c, 'queue_' + act, q.pet_id, id, act === 'priority' ? { priority: b.priority } : {});
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'updateQueue', e); }
};

// ── patients ─────────────────────────────────────────────────────────────────
// GET /vetcare/patients?q=
exports.patients = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const q = str(req.query.q, 60).toLowerCase(), t = todayISO();
    const { rows } = await query(
      `WITH pts AS (SELECT pet_id, MAX(appt_date) FILTER (WHERE status = 'completed') AS last_visit, MIN(appt_date) FILTER (WHERE status = 'upcoming' AND appt_date >= $2::date) AS next_visit, COUNT(*)::int AS visits
         FROM vet_appointments WHERE vet_id::text = $1 AND pet_id IS NOT NULL GROUP BY pet_id)
       SELECT pts.last_visit, pts.next_visit, pts.visits, ${PET_SEL}, ou.full_name AS owner_name, ou.phone AS owner_phone,
         (SELECT COUNT(*)::int FROM (SELECT DISTINCT ON (lower(v.vaccine_name)) v.next_due_date FROM pet_vaccinations v WHERE v.pet_id = p.id ORDER BY lower(v.vaccine_name), v.given_date DESC NULLS LAST, v.id DESC) z WHERE z.next_due_date < $2::date) AS vax_overdue
       FROM pts JOIN pets p ON p.id = pts.pet_id ${OWNER_JOIN}
       WHERE ($3 = '' OR lower(p.name) LIKE '%' || $3 || '%' OR lower(COALESCE(p.breed,'')) LIKE '%' || $3 || '%' OR lower(COALESCE(ou.full_name,'')) LIKE '%' || $3 || '%')
       ORDER BY COALESCE(pts.last_visit, pts.next_visit) DESC NULLS LAST, p.name LIMIT 300`, [c.vet_id, t, q]);
    return R.ok(res, { patients: rows.map(r => ({ pet: petOut(r), owner: { name: r.owner_name || null, phone: r.owner_phone || null }, last_visit: d10(r.last_visit), next_visit: d10(r.next_visit), visits: r.visits, vax_overdue: r.vax_overdue })) });
  } catch (e) { return fail(res, 'patients', e); }
};
// GET /vetcare/patients/:pet_id — the patient's journey with this clinic
exports.patient = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const pid = str(req.params.pet_id, 12);
    if (!(await patientOf(c, pid))) return R.notFound(res, 'Patient not found');
    const clinical = CLINICAL.includes(c.role), t = todayISO();
    const [petR, apR, vxR, rxR, ntR, auR] = await Promise.all([
      query(`SELECT ${PET_SEL}, ou.full_name AS owner_name, ou.phone AS owner_phone, ou.email AS owner_email FROM pets p ${OWNER_JOIN} WHERE p.id = $1 LIMIT 1`, [Number(pid)]),
      query(`${APPT_SQL} WHERE a.vet_id::text = $1 AND a.pet_id = $2 ORDER BY a.appt_date DESC, a.appt_time DESC LIMIT 100`, [c.vet_id, Number(pid)]),
      query(`SELECT v.id::text, v.vaccine_name, v.given_date, v.next_due_date, v.vet_name, v.batch_number FROM pet_vaccinations v WHERE v.pet_id = $1 ORDER BY v.given_date DESC NULLS LAST, v.id DESC LIMIT 200`, [Number(pid)]),
      clinical ? query(`SELECT prescription_id::text, appointment_id::text, title, medicines, instructions, valid_until, created_at FROM prescriptions WHERE vet_id::text = $1 AND pet_id = $2 ORDER BY created_at DESC LIMIT 100`, [c.vet_id, Number(pid)]) : Promise.resolve({ rows: [] }),
      clinical ? query(`SELECT n.*, u.full_name AS author FROM vet_clinical_notes n LEFT JOIN users u ON u.user_id = n.author_id WHERE n.vet_id::text = $1 AND n.pet_id = $2 ORDER BY n.created_at DESC LIMIT 200`, [c.vet_id, Number(pid)]) : Promise.resolve({ rows: [] }),
      clinical ? query(`SELECT a.action, a.ref, a.detail, a.at, u.full_name AS who FROM vet_activity a LEFT JOIN users u ON u.user_id = a.user_id WHERE a.vet_id::text = $1 AND a.pet_id = $2 ORDER BY a.at DESC LIMIT 100`, [c.vet_id, Number(pid)]) : Promise.resolve({ rows: [] })
    ]);
    if (!petR.rows.length) return R.notFound(res, 'Patient not found');
    await log(c, 'viewed_record', pid, null, {});
    const r0 = petR.rows[0];
    // latest vaccination per vaccine name → status
    const seen = {}, vstat = [];
    vxR.rows.forEach(v => { const k = String(v.vaccine_name).toLowerCase(); if (seen[k]) return; seen[k] = 1; const nd = d10(v.next_due_date);
      vstat.push({ name: v.vaccine_name, given: d10(v.given_date), next_due: nd, status: !nd ? 'recorded' : nd < t ? 'overdue' : nd <= addDays(t, 30) ? 'due_soon' : 'up_to_date' }); });
    const notes = ntR.rows.map(n => ({ id: String(n.note_id), appointment_id: n.appointment_id || null, author: n.author || null, at: n.created_at, current: !n.superseded_at, supersedes: n.supersedes ? String(n.supersedes) : null,
      weight_kg: num(n.weight_kg), temperature_c: num(n.temperature_c), heart_rate: n.heart_rate, resp_rate: n.resp_rate, diagnosis: n.diagnosis, notes: n.notes, allergies: n.allergies, follow_up_date: d10(n.follow_up_date) }));
    const cur = notes.filter(n => n.current);
    const allergies = (cur.find(n => n.allergies) || {}).allergies || null;
    return R.ok(res, {
      role: c.role, pet: petOut(r0), owner: { name: r0.owner_name || null, phone: r0.owner_phone || null, email: r0.owner_email || null },
      appointments: apR.rows.map(r => apptOut(r, c)),
      vaccinations: clinical ? vxR.rows.map(v => ({ id: v.id, name: v.vaccine_name, given: d10(v.given_date), next_due: d10(v.next_due_date), vet: v.vet_name || null, batch: v.batch_number || null })) : [],
      vaccine_status: vstat,
      prescriptions: rxR.rows.map(p => { let m = p.medicines; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { m = []; } } return { id: p.prescription_id, appointment_id: p.appointment_id, title: p.title, medicines: Array.isArray(m) ? m : [], instructions: p.instructions, valid_until: d10(p.valid_until), at: p.created_at }; }),
      notes, allergies,
      vitals: cur.filter(n => n.weight_kg != null || n.temperature_c != null).map(n => ({ at: n.at, weight_kg: n.weight_kg, temperature_c: n.temperature_c, heart_rate: n.heart_rate })).reverse(),
      audit: auR.rows.map(a => ({ action: a.action, ref: a.ref, detail: a.detail, at: a.at, who: a.who || null })),
      limited: !clinical
    });
  } catch (e) { return fail(res, 'patient', e); }
};

// POST /vetcare/patients/:pet_id/notes {appointment_id?, weight_kg, temperature_c, heart_rate, resp_rate, diagnosis, notes, allergies, follow_up_date, supersedes?}
exports.addNote = async (req, res) => {
  try {
    const c = await ctx(req, res, CLINICAL); if (!c) return;
    const pid = str(req.params.pet_id, 12); if (!(await patientOf(c, pid))) return R.notFound(res, 'Patient not found');
    const b = req.body || {}, e = [], v = {
      weight_kg: num(b.weight_kg), temperature_c: num(b.temperature_c), heart_rate: num(b.heart_rate), resp_rate: num(b.resp_rate),
      diagnosis: str(b.diagnosis, 200) || null, notes: str(b.notes, 5000) || null, allergies: str(b.allergies, 300) || null, follow_up_date: str(b.follow_up_date, 10) || null };
    if (v.weight_kg != null && !(v.weight_kg > 0 && v.weight_kg <= 200)) e.push('weight_kg');
    if (v.temperature_c != null && !(v.temperature_c >= 30 && v.temperature_c <= 45)) e.push('temperature_c');
    if (v.heart_rate != null && !(Number.isInteger(v.heart_rate) && v.heart_rate >= 10 && v.heart_rate <= 400)) e.push('heart_rate');
    if (v.resp_rate != null && !(Number.isInteger(v.resp_rate) && v.resp_rate >= 2 && v.resp_rate <= 200)) e.push('resp_rate');
    if (v.follow_up_date && (!DATE_RX.test(v.follow_up_date) || v.follow_up_date < todayISO())) e.push('follow_up_date');
    if (!v.notes && !v.diagnosis && v.weight_kg == null && v.temperature_c == null) e.push('notes');
    if (e.length) return bad(res, e);
    let appt = null;
    if (b.appointment_id) { const { rows } = await query(`SELECT appointment_id::text FROM vet_appointments WHERE appointment_id::text = $1 AND vet_id::text = $2 AND pet_id = $3`, [str(b.appointment_id, 40), c.vet_id, Number(pid)]); if (!rows.length) return bad(res, ['appointment_id']); appt = rows[0].appointment_id; }
    let sup = null;
    if (b.supersedes) {
      const { rows } = await query(`UPDATE vet_clinical_notes SET superseded_at = NOW() WHERE note_id::text = $1 AND vet_id::text = $2 AND pet_id = $3 AND superseded_at IS NULL RETURNING note_id, appointment_id::text`, [str(b.supersedes, 20), c.vet_id, Number(pid)]);
      if (!rows.length) return conflict(res, 'This note was already changed by someone else.');
      sup = rows[0].note_id; if (!appt) appt = rows[0].appointment_id;
    }
    const { rows } = await query(`INSERT INTO vet_clinical_notes (vet_id, pet_id, appointment_id, author_id, weight_kg, temperature_c, heart_rate, resp_rate, diagnosis, notes, allergies, follow_up_date, supersedes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING note_id::text`, [c.vet_id, Number(pid), appt, c.me, v.weight_kg, v.temperature_c, v.heart_rate, v.resp_rate, v.diagnosis, v.notes, v.allergies, v.follow_up_date, sup]);
    await log(c, sup ? 'note_edited' : 'note_added', pid, rows[0].note_id, sup ? { replaces: String(sup) } : {});
    return R.created(res, { id: rows[0].note_id });
  } catch (e) { return fail(res, 'addNote', e); }
};

// POST /vetcare/patients/:pet_id/prescriptions {appointment_id?, title, medicines:[{name,dose,frequency,duration}], instructions, valid_until}
exports.addPrescription = async (req, res) => {
  try {
    const c = await ctx(req, res, CLINICAL); if (!c) return;
    const pid = str(req.params.pet_id, 12); if (!(await patientOf(c, pid))) return R.notFound(res, 'Patient not found');
    const b = req.body || {}, e = [], title = str(b.title, 200), vu = str(b.valid_until, 10) || null;
    const meds = (Array.isArray(b.medicines) ? b.medicines : []).slice(0, 20).map(m => ({ name: str(m && m.name, 100), dose: str(m && m.dose, 80) || null, frequency: str(m && m.frequency, 80) || null, duration: str(m && m.duration, 80) || null })).filter(m => m.name);
    if (!title) e.push('title'); if (!meds.length) e.push('medicines'); if (vu && (!DATE_RX.test(vu) || vu < todayISO())) e.push('valid_until');
    if (e.length) return bad(res, e);
    const { rows: ow } = await query(`SELECT ou.user_id FROM pets p JOIN users ou ON p.user_id::text IN (ou.user_id::text, ou.user_no::text) WHERE p.id = $1 LIMIT 1`, [Number(pid)]);
    if (!ow.length) return R.notFound(res, 'Pet owner not found');
    let appt = null;
    if (b.appointment_id) { const { rows } = await query(`SELECT appointment_id FROM vet_appointments WHERE appointment_id::text = $1 AND vet_id::text = $2 AND pet_id = $3`, [str(b.appointment_id, 40), c.vet_id, Number(pid)]); if (!rows.length) return bad(res, ['appointment_id']); appt = rows[0].appointment_id; }
    const { rows } = await query(`INSERT INTO prescriptions (appointment_id, user_id, vet_id, pet_id, title, medicines, instructions, valid_until) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8) RETURNING prescription_id::text`,
      [appt, ow[0].user_id, c.vet_id, Number(pid), title, JSON.stringify(meds), str(b.instructions, 2000) || null, vu]);
    await log(c, 'prescription', pid, rows[0].prescription_id, { title });
    return R.created(res, { id: rows[0].prescription_id });
  } catch (e) { return fail(res, 'addPrescription', e); }
};

// POST /vetcare/patients/:pet_id/vaccinations {name, given_date, next_due_date, batch_number, notes}
exports.addVaccination = async (req, res) => {
  try {
    const c = await ctx(req, res, CLINICAL); if (!c) return;
    const pid = str(req.params.pet_id, 12); if (!(await patientOf(c, pid))) return R.notFound(res, 'Patient not found');
    const b = req.body || {}, e = [], name = str(b.name, 100), given = str(b.given_date, 10), next = str(b.next_due_date, 10) || null;
    if (!name) e.push('name'); if (!DATE_RX.test(given) || given > todayISO()) e.push('given_date'); if (next && (!DATE_RX.test(next) || next <= given)) e.push('next_due_date');
    if (e.length) return bad(res, e);
    const { rows: v } = await query(`SELECT first_name, last_name, clinic_name FROM vets WHERE vet_id::text = $1`, [c.vet_id]);
    const { rows: ow } = await query(`SELECT ou.user_no FROM pets p JOIN users ou ON p.user_id::text IN (ou.user_id::text, ou.user_no::text) WHERE p.id = $1 LIMIT 1`, [Number(pid)]);
    const vetName = ('Dr. ' + [v[0].first_name, v[0].last_name].filter(Boolean).join(' ')).slice(0, 120);
    const { rows } = await query(`INSERT INTO pet_vaccinations (pet_id, user_id, vaccine_name, given_date, next_due_date, vet_name, batch_number, notes, reminder_set) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`,
      [Number(pid), ow.length ? ow[0].user_no : null, name, given, next, vetName, str(b.batch_number, 60) || null, str(b.notes, 300) || null, !!next]);
    const vid = rows[0].id;
    // same extras the owner's Vaccination Diary uses (best effort; never blocks saving)
    await query(`INSERT INTO pet_vaccine_details (vaccination_id, pet_id, clinic) VALUES ($1,$2,$3) ON CONFLICT (vaccination_id) DO NOTHING`, [vid, String(pid), v[0].clinic_name || null]).catch(() => {});
    await query(`INSERT INTO pet_vaccine_audit (pet_id, vaccination_id, owner_id, action, changes) VALUES ($1,$2,$3,'created',$4)`, [String(pid), vid, c.me, JSON.stringify({ name, given_date: given, next_due_date: next, by: 'clinic' })]).catch(() => {});
    if (next) await query(`INSERT INTO vaccination_reminders (vaccination_id, pet_id, user_id, vaccine_name, reminder_date) VALUES ($1,$2,$3,$4,$5)`, [Number(vid), Number(pid), ow.length ? ow[0].user_no : null, name, next]).catch(() => {});
    await log(c, 'vaccination', pid, vid, { name });
    return R.created(res, { id: vid });
  } catch (e) { return fail(res, 'addVaccination', e); }
};

// ── lists for the other sections ─────────────────────────────────────────────
// GET /vetcare/vaccinations  — due in the next 30 days and overdue, across the clinic's patients
exports.vaccinations = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const t = todayISO(), l = await vaxDue(c, null, addDays(t, 30));
    return R.ok(res, { overdue: l.filter(x => x.next_due < t), upcoming: l.filter(x => x.next_due >= t) });
  } catch (e) { return fail(res, 'vaccinations', e); }
};
// GET /vetcare/owners
exports.owners = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const { rows } = await query(
      `SELECT ou.user_id::text AS owner_id, ou.full_name, ou.phone, ou.email, json_agg(json_build_object('id', p.id::text, 'name', p.name, 'species', p.species) ORDER BY p.name) AS pets, MAX(a.appt_date) AS last_visit
       FROM vet_appointments a JOIN pets p ON p.id = a.pet_id JOIN users ou ON p.user_id::text IN (ou.user_id::text, ou.user_no::text)
       WHERE a.vet_id::text = $1 GROUP BY ou.user_id, ou.full_name, ou.phone, ou.email ORDER BY MAX(a.appt_date) DESC LIMIT 300`, [c.vet_id]);
    // a pet can appear once per appointment in json_agg — keep unique pets
    return R.ok(res, { owners: rows.map(r => { const s = {}; return { id: r.owner_id, name: r.full_name, phone: r.phone, email: r.email, last_visit: d10(r.last_visit), pets: (r.pets || []).filter(p => !s[p.id] && (s[p.id] = 1)) }; }) });
  } catch (e) { return fail(res, 'owners', e); }
};
// GET /vetcare/consultations — recent consultation notes (clinical staff)
exports.consultations = async (req, res) => {
  try {
    const c = await ctx(req, res, CLINICAL); if (!c) return;
    const { rows } = await query(`SELECT n.note_id::text, n.created_at, n.diagnosis, n.notes, n.follow_up_date, ${PET_SEL}, u.full_name AS author FROM vet_clinical_notes n JOIN pets p ON p.id = n.pet_id LEFT JOIN users u ON u.user_id = n.author_id
      WHERE n.vet_id::text = $1 AND n.superseded_at IS NULL ORDER BY n.created_at DESC LIMIT 100`, [c.vet_id]);
    return R.ok(res, { notes: rows.map(r => ({ id: r.note_id, at: r.created_at, diagnosis: r.diagnosis, notes: r.notes ? String(r.notes).slice(0, 300) : null, follow_up_date: d10(r.follow_up_date), author: r.author, pet: petOut(r) })) });
  } catch (e) { return fail(res, 'consultations', e); }
};
// GET /vetcare/analytics?days=30
exports.analytics = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const n = [7, 30, 90].includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 30, t = todayISO(), from = addDays(t, -(n - 1));
    const [aR, qR, nR] = await Promise.all([
      query(`SELECT appt_date, status, consult_type, fee_paid, payment_status FROM vet_appointments WHERE vet_id::text = $1 AND appt_date BETWEEN $2 AND $3`, [c.vet_id, from, t]),
      query(`SELECT AVG(EXTRACT(EPOCH FROM (called_at - checked_in_at)) / 60)::float AS avg, COUNT(*)::int AS n FROM vet_queue WHERE vet_id::text = $1 AND called_at IS NOT NULL AND checked_in_at >= $2::date`, [c.vet_id, from]),
      query(`SELECT action, COUNT(*)::int AS n FROM vet_activity WHERE vet_id::text = $1 AND at >= $2::date AND action IN ('vaccination','prescription','note_added') GROUP BY action`, [c.vet_id, from])
    ]);
    const l = aR.rows.map(r => Object.assign(r, { day: d10(r.appt_date) })), closed = l.filter(r => r.status !== 'upcoming');
    const byDay = []; for (let i = n - 1; i >= 0; i--) { const d = addDays(t, -i), x = l.filter(r => r.day === d); byDay.push({ day: d, total: x.length, completed: x.filter(r => r.status === 'completed').length }); }
    const types = {}; l.forEach(r => { const k = CT[r.consult_type] || r.consult_type; types[k] = (types[k] || 0) + 1; });
    const act = {}; nR.rows.forEach(r => { act[r.action] = r.n; });
    return R.ok(res, { days: n, from, to: t, total: l.length, completed: l.filter(r => r.status === 'completed').length, cancelled: l.filter(r => r.status === 'cancelled').length, no_show: l.filter(r => r.status === 'no-show').length,
      completion_rate: closed.length ? Math.round(l.filter(r => r.status === 'completed').length / closed.length * 100) : null, avg_wait_min: qR.rows[0].avg == null ? null : Math.round(qR.rows[0].avg),
      vaccinations: act.vaccination || 0, prescriptions: act.prescription || 0, consultations: act.note_added || 0, by_day: byDay, by_type: types,
      revenue: CLINICAL.includes(c.role) ? l.filter(r => r.payment_status === 'paid').reduce((s, r) => s + Number(r.fee_paid || 0), 0) : null });
  } catch (e) { return fail(res, 'analytics', e); }
};

// ── clinic team ──────────────────────────────────────────────────────────────
// GET /vetcare/staff
exports.staff = async (req, res) => {
  try {
    const c = await ctx(req, res); if (!c) return;
    const [vR, sR, nR] = await Promise.all([
      query(`SELECT v.first_name, v.last_name, v.clinic_name, v.city, v.clinic_address, v.vci_number, v.consultation_fee, v.available_from, v.available_until, v.available_days, u.full_name, u.email FROM vets v LEFT JOIN users u ON u.user_id = v.user_id WHERE v.vet_id::text = $1`, [c.vet_id]),
      query(`SELECT s.staff_id::text, s.role, s.created_at, u.full_name, u.email FROM vet_clinic_staff s JOIN users u ON u.user_id = s.user_id WHERE s.vet_id::text = $1 AND s.removed_at IS NULL ORDER BY s.created_at`, [c.vet_id]),
      CLINICAL.includes(c.role) ? query(`SELECT channel, event, result, at FROM vet_notifications WHERE vet_id::text = $1 ORDER BY at DESC LIMIT 20`, [c.vet_id]) : Promise.resolve({ rows: [] })
    ]);
    const v = vR.rows[0] || {};
    return R.ok(res, { role: c.role, clinic: { vet_name: [v.first_name, v.last_name].filter(Boolean).join(' '), clinic: v.clinic_name, city: v.city, address: v.clinic_address, vci: v.vci_number, fee: v.consultation_fee != null ? Number(v.consultation_fee) : null,
      hours: v.available_from ? String(v.available_from).slice(0, 5) + '–' + String(v.available_until || '').slice(0, 5) : null, days: v.available_days || [] },
      team: [{ id: null, role: 'vet', name: v.full_name || [v.first_name, v.last_name].join(' '), email: v.email || null }].concat(sR.rows.map(s => ({ id: s.staff_id, role: s.role, name: s.full_name, email: s.email, since: s.created_at }))),
      notifications: nR.rows });
  } catch (e) { return fail(res, 'staff', e); }
};
// POST /vetcare/staff {email, role}
exports.addStaff = async (req, res) => {
  try {
    const c = await ctx(req, res, CLINICAL); if (!c) return;
    const b = req.body || {}, email = str(b.email, 200).toLowerCase(), role = str(b.role, 15);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, ['email']);
    if (!['receptionist', 'admin'].includes(role)) return bad(res, ['role']);
    if (role === 'admin' && c.role !== 'vet') return res.status(403).json({ success: false, message: 'Only the vet can add another clinic admin.' });
    const { rows: u } = await query(`SELECT user_id::text FROM users WHERE lower(email) = $1 LIMIT 1`, [email]);
    if (!u.length) return R.notFound(res, 'No PawBook account uses this email. Ask them to sign up first.');
    const { rows: vv } = await query(`SELECT 1 FROM vets WHERE vet_id::text = $1 AND user_id::text = $2`, [c.vet_id, u[0].user_id]);
    if (vv.length) return conflict(res, 'That is the vet\'s own account.');
    try { const { rows } = await query(`INSERT INTO vet_clinic_staff (vet_id, user_id, role, added_by) VALUES ($1,$2,$3,$4) RETURNING staff_id::text`, [c.vet_id, u[0].user_id, role, c.me]);
      await log(c, 'staff_added', null, rows[0].staff_id, { role }); return R.created(res, { id: rows[0].staff_id }); }
    catch (x) { if (x.code === '23505') return conflict(res, 'This person is already in your clinic team.'); throw x; }
  } catch (e) { return fail(res, 'addStaff', e); }
};
// DELETE /vetcare/staff/:id
exports.removeStaff = async (req, res) => {
  try {
    const c = await ctx(req, res, CLINICAL); if (!c) return;
    const { rows: s } = await query(`SELECT staff_id, role, user_id::text FROM vet_clinic_staff WHERE staff_id::text = $1 AND vet_id::text = $2 AND removed_at IS NULL`, [str(req.params.id, 20), c.vet_id]);
    if (!s.length) return R.notFound(res, 'Team member not found');
    if (s[0].role === 'admin' && c.role !== 'vet') return res.status(403).json({ success: false, message: 'Only the vet can remove a clinic admin.' });
    await query(`UPDATE vet_clinic_staff SET removed_at = NOW() WHERE staff_id = $1`, [s[0].staff_id]);
    await log(c, 'staff_removed', null, String(s[0].staff_id), { role: s[0].role });
    return R.ok(res, { removed: true });
  } catch (e) { return fail(res, 'removeStaff', e); }
};
