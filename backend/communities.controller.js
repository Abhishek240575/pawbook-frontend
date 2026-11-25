'use strict';
/* ============================================================================
   PawBook Communities (page 03) — real communities built on the existing "Group" tables.
   Mounted under /api/v1/communities. Migration 019.
   Public communities: anyone can read and join. Private ones: members only; joining needs an admin's approval.
   Member counts are counted from "GroupMember" (never typed in). "Verified" is set only by PawBook admins.
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = u => String(u.user_id);
const fail = (res, where, e) => { console.error('[Communities] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check: ' + fields.join(', '), fields });
const conflict = (res, msg) => res.status(409).json({ success: false, message: msg });
const forbid = (res, msg) => res.status(403).json({ success: false, message: msg || 'Not allowed' });
const iso = t => (t ? new Date(t).toISOString() : null);
const httpsUrl = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 600;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATS = ['dogs', 'cats', 'birds', 'breed', 'local', 'rescue', 'training', 'health', 'other'];
const KINDS = ['post', 'question', 'meetup', 'alert'];
const REASONS = ['spam', 'scam', 'abuse', 'cruelty', 'selling', 'fake', 'other'];
const first = n => (n ? String(n).trim().split(/\s+/)[0] : 'PawBook member');
async function tx(fn) { const c = await db.getClient(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { try { await c.query('ROLLBACK'); } catch (x) {} throw e; } finally { c.release(); } }
async function me(req) { const { rows } = await query(`SELECT role, full_name FROM users WHERE user_id::text = $1`, [uid(req.user)]); return { id: uid(req.user), admin: (rows[0] || {}).role === 'admin', name: (rows[0] || {}).full_name || null }; }
async function notify(userId, title, body, link) {
  try { await query(`INSERT INTO notifications (user_id, type, title, body, link_url, icon_emoji) VALUES ($1,'system',$2,$3,$4,'🐾')`, [userId, String(title).slice(0, 200), body ? String(body).slice(0, 500) : null, link || null]); }
  catch (e) { console.error('[Communities] notify:', e.message); }
}
const MCOUNT = `(SELECT COUNT(*)::int FROM "GroupMember" m WHERE m.group_id = g.group_id)`;
function card(r) {
  return { id: r.group_id, name: r.name, description: r.description, cover: httpsUrl(r.cover_url) ? r.cover_url : null, category: r.category || 'other', type: r.group_type,
    country: r.country, state: r.state, city: r.city, area: r.area, members: r.members || 0, posts_30d: r.posts_30d || 0, meetups: r.meetups || 0, verified: !!r.is_verified,
    my_role: r.my_role || null, requested: !!r.requested, hidden: r.moderation === 'hidden', created_at: iso(r.created_at), pet_types: r.pet_types || [] };
}
async function loadGroup(id, M) {
  if (!UUID_RX.test(String(id || ''))) return null;
  const { rows } = await query(`SELECT g.*, ${MCOUNT} AS members, (SELECT role FROM "GroupMember" WHERE group_id = g.group_id AND user_id::text = $2) AS my_role,
      EXISTS (SELECT 1 FROM "GroupJoinRequest" WHERE group_id = g.group_id AND user_id::text = $2 AND status = 'pending') AS requested
    FROM "Group" g WHERE g.group_id = $1 AND g.is_active`, [id, M.id]);
  return rows[0] || null;
}
const isMod = g => g && ['admin', 'moderator'].includes(g.my_role);
const canRead = (g, M) => g && (g.group_type === 'public' || g.my_role || M.admin) && (g.moderation !== 'hidden' || g.my_role || M.admin);

// GET /communities/config
exports.config = async (req, res) => {
  try {
    const M = await me(req);
    const { rows } = await query(`SELECT
      (SELECT COUNT(*)::int FROM "Group" WHERE is_active AND moderation = 'visible') AS communities,
      (SELECT COUNT(DISTINCT m.user_id)::int FROM "GroupMember" m JOIN "Group" g ON g.group_id = m.group_id WHERE g.is_active) AS members,
      (SELECT COUNT(*)::int FROM pb_group_posts p JOIN "Group" g ON g.group_id = p.group_id WHERE g.is_active AND NOT p.hidden AND p.created_at > NOW() - INTERVAL '7 days') AS posts_week,
      (SELECT COUNT(*)::int FROM pb_group_posts p JOIN "Group" g ON g.group_id = p.group_id WHERE g.is_active AND NOT p.hidden AND p.kind = 'meetup' AND p.meetup_at > NOW()) AS meetups,
      (SELECT COUNT(*)::int FROM "GroupMember" WHERE user_id::text = $1) AS mine,
      (SELECT COUNT(*)::int FROM "GroupJoinRequest" r JOIN "GroupMember" m ON m.group_id = r.group_id AND m.user_id::text = $1 AND m.role IN ('admin','moderator') WHERE r.status = 'pending') AS requests_waiting`, [M.id]);
    return R.ok(res, { stats: rows[0], admin: M.admin, categories: CATS });
  } catch (e) { return fail(res, 'config', e); }
};
// GET /communities?q&cat&country&state&city&area&sort&mine
exports.list = async (req, res) => {
  try {
    const M = await me(req), q = req.query, args = [M.id], w = ['g.is_active'];
    const add = v => { args.push(v); return '$' + args.length; };
    if (q.mine === '1') w.push(`EXISTS (SELECT 1 FROM "GroupMember" x WHERE x.group_id = g.group_id AND x.user_id::text = $1)`);
    else w.push(`(g.moderation = 'visible' OR EXISTS (SELECT 1 FROM "GroupMember" x WHERE x.group_id = g.group_id AND x.user_id::text = $1))`);
    if (CATS.includes(q.cat)) w.push(`g.category = ${add(q.cat)}`);
    const s = str(q.q, 60); if (s) w.push(`(g.name ILIKE ${add('%' + s + '%')} OR g.description ILIKE $${args.length} OR g.city ILIKE $${args.length} OR g.area ILIKE $${args.length})`);
    if (str(q.country, 80)) w.push(`lower(g.country) = lower(${add(str(q.country, 80))})`);
    if (str(q.state, 100)) w.push(`(lower(g.state) = lower(${add(str(q.state, 100))}) OR g.state IS NULL)`);
    if (str(q.city, 100)) { const c = str(q.city, 100).toLowerCase(), al = { 'new delhi': ['new delhi', 'delhi'], delhi: ['delhi', 'new delhi'], bangalore: ['bangalore', 'bengaluru'], bengaluru: ['bengaluru', 'bangalore'], gurgaon: ['gurgaon', 'gurugram'], mumbai: ['mumbai', 'bombay'] }[c] || [c];
      w.push(`(lower(g.city) = ANY(${add(al)}) OR g.city IS NULL)`); }
    const area = str(q.area, 120).toLowerCase(), areaRank = area ? `(lower(COALESCE(g.area, '')) LIKE ${add('%' + area + '%')})` : '';
    const sort = q.sort === 'new' ? 'g.created_at DESC' : q.sort === 'active' ? 'posts_30d DESC, members DESC' : `${area ? areaRank + ' DESC, ' : ''}(g.city IS NOT NULL) DESC, members DESC, g.created_at DESC`;
    const { rows } = await query(`SELECT g.*, ${MCOUNT} AS members,
        (SELECT COUNT(*)::int FROM pb_group_posts p WHERE p.group_id = g.group_id AND NOT p.hidden AND p.created_at > NOW() - INTERVAL '30 days') AS posts_30d,
        (SELECT COUNT(*)::int FROM pb_group_posts p WHERE p.group_id = g.group_id AND NOT p.hidden AND p.kind = 'meetup' AND p.meetup_at > NOW()) AS meetups,
        (SELECT role FROM "GroupMember" x WHERE x.group_id = g.group_id AND x.user_id::text = $1) AS my_role,
        EXISTS (SELECT 1 FROM "GroupJoinRequest" r WHERE r.group_id = g.group_id AND r.user_id::text = $1 AND r.status = 'pending') AS requested
      FROM "Group" g WHERE ${w.join(' AND ')} ORDER BY ${sort} LIMIT 120`, args);
    return R.ok(res, { communities: rows.map(card) });
  } catch (e) { return fail(res, 'list', e); }
};
// GET /communities/:id
exports.detail = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g || (g.moderation === 'hidden' && !g.my_role && !M.admin)) return R.notFound(res, 'Community not found');
    const c = card(g); c.rules = g.rules || null; c.join_question = g.join_question || null; c.languages = g.languages || []; c.moderation_note = (isMod(g) || M.admin) ? g.moderation_note : null; c.can_read = canRead(g, M);
    const { rows: ad } = await query(`SELECT m.role, u.full_name FROM "GroupMember" m JOIN users u ON u.user_id = m.user_id WHERE m.group_id = $1 AND m.role IN ('admin','moderator') ORDER BY m.role, m.joined_at LIMIT 6`, [g.group_id]);
    c.team = ad.map(a => ({ name: first(a.full_name), role: a.role }));
    const { rows: st } = await query(`SELECT (SELECT COUNT(*)::int FROM pb_group_posts WHERE group_id = $1 AND NOT hidden) AS posts, (SELECT COUNT(*)::int FROM pb_group_posts WHERE group_id = $1 AND NOT hidden AND kind = 'meetup' AND meetup_at > NOW()) AS meetups,
      (SELECT COUNT(*)::int FROM "GroupJoinRequest" WHERE group_id = $1 AND status = 'pending') AS requests`, [g.group_id]);
    c.posts = st[0].posts; c.meetups = st[0].meetups; if (isMod(g)) c.requests = st[0].requests;
    return R.ok(res, { community: c, admin: M.admin });
  } catch (e) { return fail(res, 'detail', e); }
};
function readGroupBody(b, e, partial) {
  const v = {};
  if (!partial || b.name !== undefined) { v.name = str(b.name, 100); if (v.name.length < 4) e.push('name'); }
  if (!partial || b.description !== undefined) { v.description = str(b.description, 2000); if (v.description.length < 20) e.push('description'); }
  if (!partial || b.category !== undefined) { v.category = CATS.includes(b.category) ? b.category : null; if (!v.category) e.push('category'); }
  if (!partial || b.type !== undefined) v.group_type = b.type === 'private' ? 'private' : 'public';
  if (!partial || b.country !== undefined) v.country = str(b.country, 80) || 'India';
  if (!partial || b.state !== undefined) v.state = str(b.state, 100) || null;
  if (!partial || b.city !== undefined) v.city = str(b.city, 100) || null;
  if (!partial || b.area !== undefined) v.area = str(b.area, 120) || null;
  if (!partial || b.rules !== undefined) v.rules = str(b.rules, 3000) || null;
  if (!partial || b.join_question !== undefined) v.join_question = str(b.join_question, 200) || null;
  if (!partial || b.cover !== undefined) { if (b.cover && !httpsUrl(b.cover)) e.push('cover'); v.cover_url = httpsUrl(b.cover) ? b.cover : null; }
  if (!partial || b.pet_types !== undefined) v.pet_types = (Array.isArray(b.pet_types) ? b.pet_types : []).filter(x => ['dog', 'cat', 'bird', 'rabbit', 'fish', 'other'].includes(x)).slice(0, 6);
  return v;
}
// POST /communities
exports.create = async (req, res) => {
  try {
    const M = await me(req), e = [], v = readGroupBody(req.body || {}, e, false);
    if (e.length) return bad(res, e);
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM "Group" WHERE creator_id::text = $1 AND created_at > NOW() - INTERVAL '1 day'`, [M.id]); if (n[0].n >= 3) return res.status(429).json({ success: false, message: 'You can create up to 3 communities a day.' });
    const { rows: d } = await query(`SELECT 1 FROM "Group" WHERE is_active AND lower(name) = lower($1) AND COALESCE(lower(city), '') = COALESCE(lower($2), '')`, [v.name, v.city]); if (d.length) return conflict(res, 'A community with this name already exists in this city.');
    const id = await tx(async c => {
      const { rows } = await c.query(`INSERT INTO "Group" (name, description, cover_url, group_type, category, city, creator_id, country, state, area, rules, join_question, pet_types) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING group_id`,
        [v.name, v.description, v.cover_url, v.group_type, v.category, v.city, M.id, v.country, v.state, v.area, v.rules, v.join_question, v.pet_types]);
      await c.query(`INSERT INTO "GroupMember" (group_id, user_id, role) VALUES ($1,$2,'admin') ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'admin'`, [rows[0].group_id, M.id]);
      return rows[0].group_id;
    });
    return R.created(res, { id });
  } catch (e) { return fail(res, 'create', e); }
};
// PATCH /communities/:id (admins)
exports.update = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g) return R.notFound(res, 'Community not found'); if (g.my_role !== 'admin') return forbid(res, 'Only community admins can edit');
    const e = [], v = readGroupBody(req.body || {}, e, true); if (e.length) return bad(res, e);
    const keys = Object.keys(v); if (!keys.length) return R.ok(res, { saved: true });
    await query(`UPDATE "Group" SET ${keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE group_id = $1`, [g.group_id].concat(keys.map(k => v[k])));
    return R.ok(res, { saved: true });
  } catch (e) { return fail(res, 'update', e); }
};
// POST /communities/:id/join {pet_name, pet_type, city, why, years, answer}
exports.join = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g || g.moderation === 'hidden') return R.notFound(res, 'Community not found');
    if (g.my_role) return conflict(res, 'You are already a member.');
    if (g.group_type === 'public') { await query(`INSERT INTO "GroupMember" (group_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [g.group_id, M.id]); return R.ok(res, { joined: true }); }
    if (g.requested) return conflict(res, 'Your request is waiting for an admin.');
    const b = req.body || {}, e = [], why = str(b.why, 600); if (why.length < 10) e.push('why'); if (g.join_question && str(b.answer, 600).length < 2) e.push('answer'); if (e.length) return bad(res, e);
    const yrs = parseInt(b.years, 10);
    await query(`INSERT INTO "GroupJoinRequest" (group_id, user_id, pet_name, pet_type, city, why_joining, years_as_owner, answer, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
      ON CONFLICT (group_id, user_id) DO UPDATE SET pet_name = EXCLUDED.pet_name, pet_type = EXCLUDED.pet_type, city = EXCLUDED.city, why_joining = EXCLUDED.why_joining, years_as_owner = EXCLUDED.years_as_owner, answer = EXCLUDED.answer, status = 'pending', reviewed_by = NULL, reviewed_at = NULL, decision_note = NULL, created_at = NOW()`,
      [g.group_id, M.id, str(b.pet_name, 100) || null, str(b.pet_type, 50) || null, str(b.city, 100) || null, why, yrs >= 0 && yrs <= 80 ? yrs : null, str(b.answer, 600) || null]);
    const { rows: ad } = await query(`SELECT user_id::text AS u FROM "GroupMember" WHERE group_id = $1 AND role IN ('admin','moderator') LIMIT 10`, [g.group_id]);
    for (const a of ad) await notify(a.u, 'New request to join ' + g.name, first(M.name) + ' wants to join.', '03_groups.html?c=' + g.group_id + '&tab=requests');
    return R.created(res, { requested: true });
  } catch (e) { return fail(res, 'join', e); }
};
// POST /communities/:id/leave
exports.leave = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g) return R.notFound(res, 'Community not found');
    if (g.requested && !g.my_role) { await query(`DELETE FROM "GroupJoinRequest" WHERE group_id = $1 AND user_id::text = $2 AND status = 'pending'`, [g.group_id, M.id]); return R.ok(res, { cancelled: true }); }
    if (!g.my_role) return conflict(res, 'You are not a member.');
    if (g.my_role === 'admin') { const { rows } = await query(`SELECT COUNT(*)::int AS n FROM "GroupMember" WHERE group_id = $1 AND role = 'admin'`, [g.group_id]); if (rows[0].n <= 1 && g.members > 1) return conflict(res, 'Make another member an admin before you leave.'); }
    await query(`DELETE FROM "GroupMember" WHERE group_id = $1 AND user_id::text = $2`, [g.group_id, M.id]);
    return R.ok(res, { left: true });
  } catch (e) { return fail(res, 'leave', e); }
};
// GET /communities/:id/requests (admins, moderators)
exports.requests = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g) return R.notFound(res, 'Community not found'); if (!isMod(g)) return forbid(res);
    const { rows } = await query(`SELECT r.request_id::text AS id, r.pet_name, r.pet_type, r.city, r.why_joining, r.years_as_owner, r.answer, r.created_at, u.full_name FROM "GroupJoinRequest" r JOIN users u ON u.user_id = r.user_id WHERE r.group_id = $1 AND r.status = 'pending' ORDER BY r.created_at LIMIT 100`, [g.group_id]);
    return R.ok(res, { requests: rows.map(r => ({ id: r.id, name: r.full_name || 'PawBook member', pet_name: r.pet_name, pet_type: r.pet_type, city: r.city, why: r.why_joining, years: r.years_as_owner, answer: r.answer, at: iso(r.created_at) })) });
  } catch (e) { return fail(res, 'requests', e); }
};
// POST /communities/:id/requests/:rid {action: approve|reject, note}
exports.decide = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g) return R.notFound(res, 'Community not found'); if (!isMod(g)) return forbid(res);
    const act = (req.body || {}).action; if (!['approve', 'reject'].includes(act)) return bad(res, ['action']);
    if (!UUID_RX.test(req.params.rid)) return R.notFound(res, 'Request not found');
    const { rows } = await query(`UPDATE "GroupJoinRequest" SET status = $3, reviewed_by = $4, reviewed_at = NOW(), decision_note = $5 WHERE request_id = $1 AND group_id = $2 AND status = 'pending' RETURNING user_id::text AS u`,
      [req.params.rid, g.group_id, act === 'approve' ? 'approved' : 'rejected', M.id, str((req.body || {}).note, 300) || null]);
    if (!rows[0]) return R.notFound(res, 'Request not found');
    if (act === 'approve') await query(`INSERT INTO "GroupMember" (group_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [g.group_id, rows[0].u]);
    await notify(rows[0].u, act === 'approve' ? 'Welcome to ' + g.name + '! 🎉' : 'Your request to join ' + g.name + ' was not approved', act === 'approve' ? 'You can now see posts and meetups.' : (str((req.body || {}).note, 300) || null), '03_groups.html?c=' + g.group_id);
    return R.ok(res, { done: true });
  } catch (e) { return fail(res, 'decide', e); }
};
// GET /communities/:id/members
exports.members = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g || !canRead(g, M)) return R.notFound(res, 'Community not found');
    const { rows } = await query(`SELECT m.user_id::text AS uid, m.role, m.joined_at, u.full_name FROM "GroupMember" m JOIN users u ON u.user_id = m.user_id WHERE m.group_id = $1 ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, m.joined_at LIMIT 300`, [g.group_id]);
    const mod = isMod(g);
    return R.ok(res, { members: rows.map(r => ({ id: mod ? r.uid : undefined, name: mod ? (r.full_name || 'PawBook member') : first(r.full_name), role: r.role, joined: iso(r.joined_at), me: r.uid === M.id })) });
  } catch (e) { return fail(res, 'members', e); }
};
// PATCH /communities/:id/members/:uid {role} · DELETE /communities/:id/members/:uid (admins)
exports.setRole = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g) return R.notFound(res, 'Community not found'); if (g.my_role !== 'admin') return forbid(res, 'Only admins can change roles');
    if (!UUID_RX.test(req.params.uid)) return R.notFound(res, 'Member not found');
    if (req.method === 'DELETE') {
      if (req.params.uid === M.id) return conflict(res, 'Use "Leave" to leave the community.');
      const r = await query(`DELETE FROM "GroupMember" WHERE group_id = $1 AND user_id = $2 AND role <> 'admin'`, [g.group_id, req.params.uid]); return r.rowCount ? R.ok(res, { removed: true }) : conflict(res, 'Admins cannot be removed. Change their role first.');
    }
    const role = (req.body || {}).role; if (!['admin', 'moderator', 'member'].includes(role)) return bad(res, ['role']);
    if (req.params.uid === M.id && role !== 'admin') { const { rows } = await query(`SELECT COUNT(*)::int AS n FROM "GroupMember" WHERE group_id = $1 AND role = 'admin'`, [g.group_id]); if (rows[0].n <= 1) return conflict(res, 'A community needs at least one admin.'); }
    const r = await query(`UPDATE "GroupMember" SET role = $3 WHERE group_id = $1 AND user_id = $2`, [g.group_id, req.params.uid, role]);
    return r.rowCount ? R.ok(res, { saved: true }) : R.notFound(res, 'Member not found');
  } catch (e) { return fail(res, 'setRole', e); }
};

// ── posts ──
function postOut(p, M, mod) {
  let ph = p.photos; if (typeof ph === 'string') { try { ph = JSON.parse(ph); } catch (e) { ph = []; } }
  return { id: Number(p.post_id), kind: p.kind, body: p.body, photos: (Array.isArray(ph) ? ph : []).filter(httpsUrl), meetup_at: iso(p.meetup_at), meetup_place: p.meetup_place, pinned: p.pinned, hidden: p.hidden,
    author: first(p.full_name), mine: String(p.user_id) === M.id, can_moderate: mod, likes: p.likes || 0, liked: !!p.liked, comments: p.comments || 0, going: p.going || 0, my_rsvp: p.my_rsvp || null, at: iso(p.created_at),
    group: p.gname ? { id: p.group_id, name: p.gname } : undefined };
}
const POSTSEL = (extra) => `SELECT p.*, u.full_name, ${extra || ''}
  (SELECT COUNT(*)::int FROM pb_group_post_likes l WHERE l.post_id = p.post_id) AS likes, EXISTS (SELECT 1 FROM pb_group_post_likes l WHERE l.post_id = p.post_id AND l.user_id::text = $1) AS liked,
  (SELECT COUNT(*)::int FROM pb_group_comments c WHERE c.post_id = p.post_id AND NOT c.hidden) AS comments,
  (SELECT COUNT(*)::int FROM pb_group_rsvps r WHERE r.post_id = p.post_id AND r.status = 'going') AS going, (SELECT status FROM pb_group_rsvps r WHERE r.post_id = p.post_id AND r.user_id::text = $1) AS my_rsvp
  FROM pb_group_posts p LEFT JOIN users u ON u.user_id = p.user_id`;
// GET /communities/:id/posts?kind&before
exports.posts = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g) return R.notFound(res, 'Community not found');
    if (!canRead(g, M)) return forbid(res, 'This is a private community. Join to see posts.');
    const mod = isMod(g) || M.admin, kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
    const before = req.query.before && !isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : new Date(Date.now() + 60000);
    const { rows } = await query(POSTSEL() + ` WHERE p.group_id = $2 AND ($3 OR NOT p.hidden OR p.user_id::text = $1) AND ($4::text IS NULL OR p.kind = $4) AND p.created_at < $5 ORDER BY ${req.query.before ? '' : 'p.pinned DESC, '}p.created_at DESC LIMIT 30`, [M.id, g.group_id, mod, kind, before]);
    return R.ok(res, { posts: rows.map(p => postOut(p, M, mod)), next_before: rows.length === 30 ? iso(rows[rows.length - 1].created_at) : null });
  } catch (e) { return fail(res, 'posts', e); }
};
// POST /communities/:id/posts {kind, body, photos, meetup_at, meetup_place}
exports.createPost = async (req, res) => {
  try {
    const M = await me(req), g = await loadGroup(req.params.id, M); if (!g || g.moderation === 'hidden') return R.notFound(res, 'Community not found');
    if (!g.my_role) return forbid(res, 'Join the community to post.');
    const b = req.body || {}, e = [], kind = KINDS.includes(b.kind) ? b.kind : 'post', body = str(b.body, 5000);
    if (body.length < 2) e.push('body');
    const ph = Array.isArray(b.photos) ? b.photos : []; if (ph.some(u => !httpsUrl(u))) e.push('photos');
    let at = null, place = null;
    if (kind === 'meetup') { at = b.meetup_at ? new Date(b.meetup_at) : null; if (!at || isNaN(at) || at < new Date(Date.now() - 3600000) || at > new Date(Date.now() + 365 * 86400000)) e.push('meetup_at'); place = str(b.meetup_place, 200); if (place.length < 3) e.push('meetup_place'); }
    if (e.length) return bad(res, e);
    const { rows: n } = await query(`SELECT COUNT(*)::int AS n FROM pb_group_posts WHERE user_id::text = $1 AND created_at > NOW() - INTERVAL '1 hour'`, [M.id]); if (n[0].n >= 15) return res.status(429).json({ success: false, message: 'Please slow down a little.' });
    const { rows } = await query(`INSERT INTO pb_group_posts (group_id, user_id, kind, body, photos, meetup_at, meetup_place) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING post_id`, [g.group_id, M.id, kind, body, JSON.stringify(ph.slice(0, 6)), at, place || null]);
    if (kind === 'meetup' || kind === 'alert') {   // tell members about meetups and alerts (not every post)
      const { rows: mem } = await query(`SELECT user_id::text AS u FROM "GroupMember" WHERE group_id = $1 AND user_id::text <> $2 LIMIT 500`, [g.group_id, M.id]);
      for (const m of mem) await notify(m.u, (kind === 'meetup' ? '📅 New meetup in ' : '⚠️ Alert in ') + g.name, kind === 'meetup' ? place + ' · ' + at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : body.slice(0, 120), '03_groups.html?c=' + g.group_id);
    }
    return R.created(res, { id: Number(rows[0].post_id) });
  } catch (e) { return fail(res, 'createPost', e); }
};
async function loadPost(pid, M) {
  const n = parseInt(pid, 10); if (!n) return null;
  const { rows } = await query(`SELECT p.*, g.name AS gname FROM pb_group_posts p JOIN "Group" g ON g.group_id = p.group_id WHERE p.post_id = $1 AND g.is_active`, [n]); if (!rows[0]) return null;
  const g = await loadGroup(rows[0].group_id, M); return g ? { p: rows[0], g } : null;
}
// DELETE /communities/posts/:pid (author or moderator)
exports.deletePost = async (req, res) => {
  try { const M = await me(req), x = await loadPost(req.params.pid, M); if (!x) return R.notFound(res, 'Post not found');
    if (String(x.p.user_id) !== M.id && !isMod(x.g) && !M.admin) return forbid(res);
    await query(`DELETE FROM pb_group_posts WHERE post_id = $1`, [x.p.post_id]); return R.ok(res, { deleted: true }); }
  catch (e) { return fail(res, 'deletePost', e); }
};
// POST /communities/posts/:pid/pin {pinned} · /hide {hidden} (moderators)
exports.modPost = async (req, res) => {
  try { const M = await me(req), x = await loadPost(req.params.pid, M); if (!x) return R.notFound(res, 'Post not found'); if (!isMod(x.g) && !M.admin) return forbid(res);
    const b = req.body || {};
    if (req.path.endsWith('/pin')) await query(`UPDATE pb_group_posts SET pinned = $2 WHERE post_id = $1`, [x.p.post_id, b.pinned === true]);
    else await query(`UPDATE pb_group_posts SET hidden = $2, hidden_note = $3 WHERE post_id = $1`, [x.p.post_id, b.hidden === true, b.hidden === true ? (str(b.note, 300) || 'Hidden by a moderator') : null]);
    return R.ok(res, { saved: true }); }
  catch (e) { return fail(res, 'modPost', e); }
};
// POST /communities/posts/:pid/like (toggle)
exports.like = async (req, res) => {
  try { const M = await me(req), x = await loadPost(req.params.pid, M); if (!x || !canRead(x.g, M) || x.p.hidden) return R.notFound(res, 'Post not found');
    if (!x.g.my_role) return forbid(res, 'Join the community to react.');
    const d = await query(`DELETE FROM pb_group_post_likes WHERE post_id = $1 AND user_id::text = $2`, [x.p.post_id, M.id]);
    if (!d.rowCount) await query(`INSERT INTO pb_group_post_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [x.p.post_id, M.id]);
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM pb_group_post_likes WHERE post_id = $1`, [x.p.post_id]);
    return R.ok(res, { liked: !d.rowCount, likes: rows[0].n }); }
  catch (e) { return fail(res, 'like', e); }
};
// POST /communities/posts/:pid/rsvp {status: going|maybe|none}
exports.rsvp = async (req, res) => {
  try { const M = await me(req), x = await loadPost(req.params.pid, M); if (!x || x.p.kind !== 'meetup' || x.p.hidden) return R.notFound(res, 'Meetup not found');
    if (!x.g.my_role) return forbid(res, 'Join the community to RSVP.');
    const st = (req.body || {}).status;
    if (st === 'none') await query(`DELETE FROM pb_group_rsvps WHERE post_id = $1 AND user_id::text = $2`, [x.p.post_id, M.id]);
    else if (['going', 'maybe'].includes(st)) await query(`INSERT INTO pb_group_rsvps (post_id, user_id, status) VALUES ($1,$2,$3) ON CONFLICT (post_id, user_id) DO UPDATE SET status = $3`, [x.p.post_id, M.id, st]);
    else return bad(res, ['status']);
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM pb_group_rsvps WHERE post_id = $1 AND status = 'going'`, [x.p.post_id]);
    return R.ok(res, { going: rows[0].n, my_rsvp: st === 'none' ? null : st }); }
  catch (e) { return fail(res, 'rsvp', e); }
};
// GET/POST /communities/posts/:pid/comments
exports.comments = async (req, res) => {
  try { const M = await me(req), x = await loadPost(req.params.pid, M); if (!x || !canRead(x.g, M)) return R.notFound(res, 'Post not found');
    const mod = isMod(x.g) || M.admin;
    const { rows } = await query(`SELECT c.comment_id, c.user_id, c.body, c.hidden, c.created_at, u.full_name FROM pb_group_comments c LEFT JOIN users u ON u.user_id = c.user_id WHERE c.post_id = $1 AND ($2 OR NOT c.hidden) ORDER BY c.created_at LIMIT 200`, [x.p.post_id, mod]);
    return R.ok(res, { comments: rows.map(c => ({ id: Number(c.comment_id), author: first(c.full_name), body: c.body, hidden: c.hidden, mine: String(c.user_id) === M.id, at: iso(c.created_at) })) }); }
  catch (e) { return fail(res, 'comments', e); }
};
exports.addComment = async (req, res) => {
  try { const M = await me(req), x = await loadPost(req.params.pid, M); if (!x || x.p.hidden) return R.notFound(res, 'Post not found'); if (!x.g.my_role) return forbid(res, 'Join the community to comment.');
    const body = str((req.body || {}).body, 1500); if (body.length < 1) return bad(res, ['body']);
    const { rows } = await query(`INSERT INTO pb_group_comments (post_id, user_id, body) VALUES ($1,$2,$3) RETURNING comment_id`, [x.p.post_id, M.id, body]);
    if (String(x.p.user_id) !== M.id) await notify(String(x.p.user_id), '💬 ' + first(M.name) + ' commented on your post in ' + x.g.name, body.slice(0, 120), '03_groups.html?c=' + x.g.group_id + '&post=' + x.p.post_id);
    return R.created(res, { id: Number(rows[0].comment_id) }); }
  catch (e) { return fail(res, 'addComment', e); }
};
exports.deleteComment = async (req, res) => {
  try { const M = await me(req), n = parseInt(req.params.cid, 10);
    const { rows } = await query(`SELECT c.comment_id, c.user_id, p.post_id FROM pb_group_comments c JOIN pb_group_posts p ON p.post_id = c.post_id WHERE c.comment_id = $1`, [n]); if (!rows[0]) return R.notFound(res, 'Comment not found');
    const x = await loadPost(rows[0].post_id, M); if (!x) return R.notFound(res, 'Comment not found');
    if (String(rows[0].user_id) !== M.id && !isMod(x.g) && !M.admin) return forbid(res);
    await query(`DELETE FROM pb_group_comments WHERE comment_id = $1`, [n]); return R.ok(res, { deleted: true }); }
  catch (e) { return fail(res, 'deleteComment', e); }
};
// GET /communities/meetups — upcoming meetups in my communities and public ones
exports.meetups = async (req, res) => {
  try { const M = await me(req), city = str(req.query.city, 100);
    const { rows } = await query(POSTSEL(`g.name AS gname, g.city AS gcity, (SELECT role FROM "GroupMember" x WHERE x.group_id = p.group_id AND x.user_id::text = $1) AS role,`) + `
      JOIN "Group" g ON g.group_id = p.group_id WHERE g.is_active AND g.moderation = 'visible' AND p.kind = 'meetup' AND NOT p.hidden AND p.meetup_at > NOW() - INTERVAL '2 hours'
        AND (g.group_type = 'public' OR EXISTS (SELECT 1 FROM "GroupMember" x WHERE x.group_id = p.group_id AND x.user_id::text = $1))
        AND ($2 = '' OR lower(COALESCE(g.city, '')) = lower($2) OR EXISTS (SELECT 1 FROM "GroupMember" x WHERE x.group_id = p.group_id AND x.user_id::text = $1))
      ORDER BY p.meetup_at LIMIT 60`, [M.id, city]);
    return R.ok(res, { meetups: rows.map(p => Object.assign(postOut(p, M, false), { group: { id: p.group_id, name: p.gname, city: p.gcity }, member: !!p.role })) }); }
  catch (e) { return fail(res, 'meetups', e); }
};
// POST /communities/report {group_id, post_id?, comment_id?, reason, details}
exports.report = async (req, res) => {
  try { const M = await me(req), b = req.body || {};
    const reason = REASONS.includes(b.reason) ? b.reason : null; if (!reason) return bad(res, ['reason']);
    const g = await loadGroup(b.group_id, M); if (!g) return R.notFound(res, 'Community not found');
    const pid = b.post_id ? parseInt(b.post_id, 10) : null, cid = b.comment_id ? parseInt(b.comment_id, 10) : null;
    if (pid) { const { rows } = await query(`SELECT 1 FROM pb_group_posts WHERE post_id = $1 AND group_id = $2`, [pid, g.group_id]); if (!rows.length) return R.notFound(res, 'Post not found'); }
    try { await query(`INSERT INTO pb_group_reports (group_id, post_id, comment_id, user_id, reason, details) VALUES ($1,$2,$3,$4,$5,$6)`, [g.group_id, pid, cid, M.id, reason, str(b.details, 500) || null]); }
    catch (x) { if (x.code === '23505') return conflict(res, 'You already reported this. Our team is reviewing it.'); throw x; }
    if (pid) { const { rows } = await query(`SELECT COUNT(DISTINCT user_id)::int AS n FROM pb_group_reports WHERE post_id = $1 AND status = 'open'`, [pid]); if (rows[0].n >= 3) await query(`UPDATE pb_group_posts SET hidden = TRUE, hidden_note = 'Hidden after several reports — under review' WHERE post_id = $1`, [pid]); }
    return R.created(res, { reported: true }); }
  catch (e) { return fail(res, 'report', e); }
};
// GET /communities/admin/queue · POST /communities/admin/:kind/:id {action}
exports.adminQueue = async (req, res) => {
  try { const M = await me(req); if (!M.admin) return forbid(res);
    const { rows } = await query(`SELECT r.group_id, r.post_id, g.name, g.is_verified, g.moderation, p.body, p.hidden, COUNT(*)::int AS n, array_agg(DISTINCT r.reason) AS reasons, array_remove(array_agg(r.details), NULL) AS details, MAX(r.created_at) AS last
      FROM pb_group_reports r JOIN "Group" g ON g.group_id = r.group_id LEFT JOIN pb_group_posts p ON p.post_id = r.post_id WHERE r.status = 'open' GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY 8 DESC, 11 DESC LIMIT 100`);
    const { rows: unv } = await query(`SELECT g.group_id, g.name, g.city, g.created_at, ${MCOUNT} AS members FROM "Group" g WHERE g.is_active AND NOT g.is_verified AND g.moderation = 'visible' ORDER BY members DESC, g.created_at LIMIT 30`);
    return R.ok(res, { reports: rows.map(r => ({ group: { id: r.group_id, name: r.name, verified: r.is_verified, hidden: r.moderation === 'hidden' }, post: r.post_id ? { id: Number(r.post_id), body: r.body, hidden: r.hidden } : null, count: r.n, reasons: r.reasons, details: r.details.slice(0, 5) })),
      unverified: unv.map(g => ({ id: g.group_id, name: g.name, city: g.city, members: g.members, created_at: iso(g.created_at) })) }); }
  catch (e) { return fail(res, 'adminQueue', e); }
};
exports.adminAction = async (req, res) => {
  try { const M = await me(req); if (!M.admin) return forbid(res);
    const act = (req.body || {}).action, note = str((req.body || {}).note, 300) || null;
    if (req.params.kind === 'group') {
      if (!UUID_RX.test(req.params.id)) return R.notFound(res, 'Not found');
      if (!['verify', 'unverify', 'hide', 'restore', 'dismiss'].includes(act)) return bad(res, ['action']);
      if (act === 'verify') await query(`UPDATE "Group" SET is_verified = TRUE, verified_at = NOW() WHERE group_id = $1`, [req.params.id]);
      if (act === 'unverify') await query(`UPDATE "Group" SET is_verified = FALSE, verified_at = NULL WHERE group_id = $1`, [req.params.id]);
      if (act === 'hide' || act === 'restore') await query(`UPDATE "Group" SET moderation = $2, moderation_note = $3 WHERE group_id = $1`, [req.params.id, act === 'hide' ? 'hidden' : 'visible', act === 'hide' ? (note || 'Hidden by PawBook moderation') : null]);
      if (['hide', 'restore', 'dismiss'].includes(act)) await query(`UPDATE pb_group_reports SET status = 'closed', resolved_by = $2, resolved_at = NOW() WHERE group_id = $1 AND post_id IS NULL AND status = 'open'`, [req.params.id, M.id]);
    } else if (req.params.kind === 'post') {
      const n = parseInt(req.params.id, 10); if (!['hide', 'restore', 'dismiss'].includes(act)) return bad(res, ['action']);
      if (act !== 'dismiss') await query(`UPDATE pb_group_posts SET hidden = $2, hidden_note = $3 WHERE post_id = $1`, [n, act === 'hide', act === 'hide' ? (note || 'Hidden by PawBook moderation') : null]);
      await query(`UPDATE pb_group_reports SET status = 'closed', resolved_by = $2, resolved_at = NOW() WHERE post_id = $1 AND status = 'open'`, [n, M.id]);
    } else return R.notFound(res, 'Not found');
    return R.ok(res, { done: true }); }
  catch (e) { return fail(res, 'adminAction', e); }
};
