'use strict';
/* ============================================================================
   PawBook Marketplace — seller trust: KYC documents + listing approval (Phase 4)
   Mounted under /api/v1/shop (see add_shop_routes.js). Requires migrations 003–008.
   KYC files are stored privately on the server (outside public_html) and are only
   streamed to the seller who uploaded them or to an admin. They never get a public URL.
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../config/db');
const R = require('../utils/response');

const PRIVATE_DIR = process.env.PB_PRIVATE_DIR || path.join(os.homedir(), 'pawbook_private', 'kyc');
const MAX_DOC = 5 * 1024 * 1024;
const DOC_KINDS = ['pan', 'gst', 'business', 'brand_auth'];
const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MODES = ['off', 'new_sellers', 'all'];

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = u => String(u.user_id);
const fail = (res, where, e) => { console.error('[Trust] ' + where + ':', e.message); return R.serverError(res); };
const exp = () => require('./experience.controller');
const maskPan = p => (p && p.length === 10 ? p.slice(0, 2) + '•••••' + p.slice(7) : p || null);

// ── settings ────────────────────────────────────────────────────────────────
async function approvalMode() {
  try { const { rows } = await query(`SELECT value FROM marketplace_settings WHERE key = 'listing_approval'`); return MODES.includes(rows[0] && rows[0].value) ? rows[0].value : 'new_sellers'; }
  catch (e) { return 'off'; }   // table missing → behave like before
}
async function kycStatus(userId) {
  try { const { rows } = await query(`SELECT status FROM marketplace_seller_kyc WHERE user_id = $1`, [userId]); return rows[0] ? rows[0].status : 'none'; }
  catch (e) { return 'none'; }
}
// Does a new or resubmitted listing from this seller need an admin's approval?
async function needsApproval(userId) {
  const mode = await approvalMode();
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return (await kycStatus(userId)) !== 'approved';
}
exports.needsApproval = needsApproval;
exports.approvalMode = approvalMode;

// Product visibility from the seller's wish, the store status and moderation.
function visibility(wantLive, storeStatus, moderation) {
  const ok = moderation === 'approved' && wantLive;
  return { is_active: ok && storeStatus === 'active', store_paused: ok && storeStatus === 'paused', seller_live: !!wantLive };
}
exports.visibility = visibility;

exports.adminGetSettings = async (req, res) => { try { return R.ok(res, { listing_approval: await approvalMode() }); } catch (e) { return fail(res, 'adminGetSettings', e); } };
exports.adminSaveSettings = async (req, res) => {
  try {
    const m = (req.body || {}).listing_approval;
    if (!MODES.includes(m)) return R.badRequest(res, 'listing_approval must be off, new_sellers or all');
    await query(`INSERT INTO marketplace_settings (key, value, updated_at) VALUES ('listing_approval', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [m]);
    return R.ok(res, { listing_approval: m });
  } catch (e) { return fail(res, 'adminSaveSettings', e); }
};

// ── KYC: seller side ────────────────────────────────────────────────────────
async function sellerRow(userId) { const { rows } = await query(`SELECT user_id, business_type, gstin, status, store_name FROM marketplace_sellers WHERE user_id::text = $1`, [userId]); return rows[0] || null; }
function requirements(seller) {
  const req = [{ kind: 'pan', required: true }];
  req.push({ kind: 'gst', required: !!(seller && seller.gstin) });
  req.push({ kind: 'business', required: false });
  req.push({ kind: 'brand_auth', required: false, recommended: !!(seller && seller.business_type === 'brand') });
  return req;
}
async function kycView(userId, full) {
  const s = await sellerRow(userId);
  const { rows: k } = await query(`SELECT legal_name, pan, status, reject_reason, submitted_at, reviewed_at FROM marketplace_seller_kyc WHERE user_id = $1`, [userId]);
  const { rows: docs } = await query(`SELECT doc_id, kind, original_name, mime, size_bytes, uploaded_at FROM marketplace_kyc_docs WHERE user_id = $1 ORDER BY uploaded_at DESC`, [userId]);
  const kyc = k[0] || { status: 'none' };
  if (!full) kyc.pan_masked = maskPan(kyc.pan);
  return { kyc, docs, requirements: requirements(s), approval_mode: await approvalMode() };
}

// GET /shop/seller/kyc
exports.getKyc = async (req, res) => {
  try {
    const me = uid(req.user);
    if (!(await sellerRow(me))) return R.badRequest(res, 'Please set up your store first');
    return R.ok(res, await kycView(me, true));
  } catch (e) { return fail(res, 'getKyc', e); }
};
async function editable(userId) {
  const st = await kycStatus(userId);
  return st === 'none' || st === 'draft' || st === 'rejected';
}
// PUT /shop/seller/kyc  {legal_name, pan}
exports.saveKyc = async (req, res) => {
  try {
    const me = uid(req.user), b = req.body || {};
    if (!(await sellerRow(me))) return R.badRequest(res, 'Please set up your store first');
    if (!(await editable(me))) return res.status(409).json({ success: false, message: 'Your verification is already submitted. Please contact PawBook support to change it.' });
    const name = str(b.legal_name, 120), pan = str(b.pan, 10).toUpperCase().replace(/\s/g, '');
    const e = [];
    if (name && name.length < 3) e.push('legal_name');
    if (pan && !PAN_RX.test(pan)) e.push('pan');
    if (e.length) return res.status(422).json({ success: false, message: 'Please check: ' + e.join(', '), fields: e });
    await query(`INSERT INTO marketplace_seller_kyc (user_id, legal_name, pan, status, updated_at) VALUES ($1, $2, $3, 'draft', NOW())
      ON CONFLICT (user_id) DO UPDATE SET legal_name = EXCLUDED.legal_name, pan = EXCLUDED.pan,
        status = CASE WHEN marketplace_seller_kyc.status = 'rejected' THEN 'rejected' ELSE 'draft' END, updated_at = NOW()`, [me, name || null, pan || null]);
    return R.ok(res, await kycView(me, true));
  } catch (e) { return fail(res, 'saveKyc', e); }
};

// file type from the first bytes, not from what the browser claims
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}
// multer is optional at load time so the rest of the shop keeps working if it is missing
let uploadMw = null;
exports.uploadMiddleware = (req, res, next) => {
  try {
    if (!uploadMw) { const multer = require('multer'); uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOC, files: 1 } }).single('file'); }
    uploadMw(req, res, err => {
      if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB' : 'Upload failed' });
      next();
    });
  } catch (e) { return fail(res, 'uploadMiddleware', e); }
};
// POST /shop/seller/kyc/docs  (multipart: kind, file)
exports.uploadDoc = async (req, res) => {
  try {
    const me = uid(req.user), kind = str((req.body || {}).kind, 20);
    if (!(await sellerRow(me))) return R.badRequest(res, 'Please set up your store first');
    if (!DOC_KINDS.includes(kind)) return R.badRequest(res, 'Unknown document type');
    if (!(await editable(me))) return res.status(409).json({ success: false, message: 'Your verification is already submitted. Please contact PawBook support to change it.' });
    const f = req.file;
    if (!f || !f.buffer || !f.buffer.length) return R.badRequest(res, 'Please choose a file');
    const t = sniff(f.buffer);
    if (!t) return R.badRequest(res, 'Please upload a JPG, PNG or PDF file');
    const dir = path.join(PRIVATE_DIR, me.replace(/[^a-zA-Z0-9-]/g, ''));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stored = kind + '-' + crypto.randomBytes(12).toString('hex') + '.' + t.ext;
    fs.writeFileSync(path.join(dir, stored), f.buffer, { mode: 0o600 });
    // one current file per kind: remove the previous one
    const { rows: old } = await query(`DELETE FROM marketplace_kyc_docs WHERE user_id = $1 AND kind = $2 RETURNING stored_name`, [me, kind]);
    old.forEach(o => { try { fs.unlinkSync(path.join(dir, o.stored_name)); } catch (x) {} });
    const { rows } = await query(`INSERT INTO marketplace_kyc_docs (user_id, kind, stored_name, original_name, mime, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING doc_id, kind, original_name, mime, size_bytes, uploaded_at`, [me, kind, stored, str(f.originalname, 160), t.mime, f.buffer.length]);
    await query(`INSERT INTO marketplace_seller_kyc (user_id, status) VALUES ($1, 'draft') ON CONFLICT (user_id) DO NOTHING`, [me]);
    return R.created(res, { doc: rows[0] });
  } catch (e) { return fail(res, 'uploadDoc', e); }
};
// GET /shop/kyc/docs/:id  → the file, only for its owner or an admin
exports.getDoc = async (req, res) => {
  try {
    const { rows } = await query(`SELECT user_id, stored_name, mime, original_name FROM marketplace_kyc_docs WHERE doc_id = $1`, [parseInt(req.params.id, 10) || 0]);
    const d = rows[0];
    if (!d || (d.user_id !== uid(req.user) && req.user.role !== 'admin')) return R.notFound(res, 'Document not found');
    const file = path.join(PRIVATE_DIR, d.user_id.replace(/[^a-zA-Z0-9-]/g, ''), path.basename(d.stored_name));
    if (!fs.existsSync(file)) return R.notFound(res, 'Document file is missing');
    res.set({ 'Content-Type': d.mime, 'Content-Disposition': 'inline; filename="' + (d.original_name || 'document').replace(/[^\w.\- ]/g, '') + '"',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'", 'X-Frame-Options': 'DENY' });
    return fs.createReadStream(file).pipe(res);
  } catch (e) { return fail(res, 'getDoc', e); }
};
// POST /shop/seller/kyc/submit
exports.submitKyc = async (req, res) => {
  try {
    const me = uid(req.user), s = await sellerRow(me);
    if (!s) return R.badRequest(res, 'Please set up your store first');
    if (!(await editable(me))) return res.status(409).json({ success: false, message: 'Already submitted' });
    const v = await kycView(me, true), missing = [];
    if (!v.kyc.legal_name || v.kyc.legal_name.length < 3) missing.push('legal_name');
    if (!v.kyc.pan || !PAN_RX.test(v.kyc.pan)) missing.push('pan');
    v.requirements.filter(r => r.required).forEach(r => { if (!v.docs.some(d => d.kind === r.kind)) missing.push('doc_' + r.kind); });
    if (missing.length) return res.status(422).json({ success: false, message: 'Please complete: ' + missing.join(', '), fields: missing });
    await query(`UPDATE marketplace_seller_kyc SET status = 'submitted', submitted_at = NOW(), reject_reason = NULL, updated_at = NOW() WHERE user_id = $1`, [me]);
    const { rows: admins } = await query(`SELECT user_id FROM users WHERE role = 'admin' LIMIT 20`).catch(() => ({ rows: [] }));
    admins.forEach(a => exp().notify(a.user_id, { type: 'shop_order', icon: '🪪', title: 'Seller verification to review: ' + s.store_name, link: '48_shop_admin.html' }));
    return R.ok(res, await kycView(me, true));
  } catch (e) { return fail(res, 'submitKyc', e); }
};

// ── KYC: admin ──────────────────────────────────────────────────────────────
exports.adminKycList = async (req, res) => {
  try {
    const st = ['submitted','approved','rejected','draft'].includes(req.query.status) ? req.query.status : null;
    const { rows } = await query(`SELECT k.user_id, k.legal_name, k.pan, k.status, k.submitted_at, k.reviewed_at, k.reject_reason, s.store_name, s.business_type, s.gstin, s.city,
        (SELECT COUNT(*)::int FROM marketplace_kyc_docs d WHERE d.user_id = k.user_id) AS docs
      FROM marketplace_seller_kyc k LEFT JOIN marketplace_sellers s ON s.user_id::text = k.user_id
      ${st ? 'WHERE k.status = $1' : ''} ORDER BY (k.status = 'submitted') DESC, k.submitted_at DESC NULLS LAST LIMIT 300`, st ? [st] : []);
    rows.forEach(r => { r.pan = maskPan(r.pan); });
    return R.ok(res, { kyc: rows });
  } catch (e) { return fail(res, 'adminKycList', e); }
};
exports.adminKycGet = async (req, res) => {
  try {
    const id = str(req.params.user_id, 64), s = await sellerRow(id);
    if (!s) return R.notFound(res, 'Seller not found');
    const v = await kycView(id, true);
    return R.ok(res, Object.assign(v, { seller: s }));
  } catch (e) { return fail(res, 'adminKycGet', e); }
};
// PATCH /shop/admin/kyc/:user_id  {decision: approve|reject, reason}
exports.adminKycDecide = async (req, res) => {
  try {
    const id = str(req.params.user_id, 64), b = req.body || {}, reason = str(b.reason, 500);
    if (!['approve','reject'].includes(b.decision)) return R.badRequest(res, 'decision must be approve or reject');
    if (b.decision === 'reject' && reason.length < 5) return res.status(422).json({ success: false, message: 'Please give the seller a reason', fields: ['reason'] });
    const st = await kycStatus(id);
    if (st === 'none') return R.notFound(res, 'No verification for this seller');
    const approve = b.decision === 'approve';
    await query(`UPDATE marketplace_seller_kyc SET status = $2, reject_reason = $3, reviewed_at = NOW(), reviewed_by = $4, updated_at = NOW() WHERE user_id = $1`,
      [id, approve ? 'approved' : 'rejected', approve ? null : reason, uid(req.user)]);
    await query(`UPDATE marketplace_sellers SET is_verified = $2, updated_at = NOW() WHERE user_id::text = $1`, [id, approve]);
    exp().notify(id, approve
      ? { type: 'shop_order', icon: '✅', title: 'Your store is verified', body: 'Your store now shows a Verified seller badge.', link: '50_seller_hub.html' }
      : { type: 'shop_order', icon: '⚠️', title: 'Verification needs changes', body: reason, link: '50_seller_hub.html?tab=kyc' });
    return R.ok(res, { status: approve ? 'approved' : 'rejected' });
  } catch (e) { return fail(res, 'adminKycDecide', e); }
};

// ── listing approval: admin ─────────────────────────────────────────────────
exports.adminListings = async (req, res) => {
  try {
    const st = ['pending','rejected','approved'].includes(req.query.status) ? req.query.status : 'pending';
    const { rows } = await query(`SELECT p.product_id, p.name, p.description, p.brand, p.category, p.pet_types, p.life_stages, p.images, p.price, p.compare_price, p.stock, p.variants, p.specs,
        p.ingredients, p.moderation, p.moderation_note, p.submitted_at, p.updated_at, p.seller_id::text AS seller_id, s.store_name, s.is_verified,
        COALESCE(k.status, 'none') AS kyc_status
      FROM marketplace_products p LEFT JOIN marketplace_sellers s ON s.user_id::text = p.seller_id::text LEFT JOIN marketplace_seller_kyc k ON k.user_id = p.seller_id::text
      WHERE p.moderation = $1 AND NOT COALESCE(p.archived, FALSE) ORDER BY p.submitted_at ASC NULLS LAST, p.updated_at DESC LIMIT 200`, [st]);
    const { rows: c } = await query(`SELECT moderation, COUNT(*)::int AS n FROM marketplace_products WHERE NOT COALESCE(archived, FALSE) GROUP BY moderation`);
    const counts = {}; c.forEach(r => { counts[r.moderation] = r.n; });
    return R.ok(res, { products: rows, counts, mode: await approvalMode() });
  } catch (e) { return fail(res, 'adminListings', e); }
};
// PATCH /shop/admin/listings/:id  {decision: approve|reject, note}
exports.adminDecideListing = async (req, res) => {
  try {
    const id = str(req.params.id, 64), b = req.body || {}, note = str(b.note, 500);
    if (!['approve','reject'].includes(b.decision)) return R.badRequest(res, 'decision must be approve or reject');
    if (b.decision === 'reject' && note.length < 5) return res.status(422).json({ success: false, message: 'Please tell the seller what to fix', fields: ['note'] });
    const { rows } = await query(`SELECT p.product_id, p.name, p.seller_id::text AS seller_id, COALESCE(p.seller_live, TRUE) AS seller_live, COALESCE(s.status, 'active') AS store_status
      FROM marketplace_products p LEFT JOIN marketplace_sellers s ON s.user_id::text = p.seller_id::text WHERE p.product_id::text = $1 AND NOT COALESCE(p.archived, FALSE)`, [id]);
    if (!rows.length) return R.notFound(res, 'Product not found');
    const p = rows[0], mod = b.decision === 'approve' ? 'approved' : 'rejected';
    const v = visibility(p.seller_live, p.store_status, mod);
    await query(`UPDATE marketplace_products SET moderation = $2, moderation_note = $3, is_active = $4, store_paused = $5, updated_at = NOW() WHERE product_id::text = $1`,
      [id, mod, mod === 'rejected' ? note : null, v.is_active, v.store_paused]);
    exp().notify(p.seller_id, mod === 'approved'
      ? { type: 'shop_order', icon: '✅', title: 'Listing approved: ' + p.name, body: v.is_active ? 'It is now live in the shop.' : null, link: '50_seller_hub.html?tab=products' }
      : { type: 'shop_order', icon: '✏️', title: 'Listing needs changes: ' + p.name, body: note, link: '51_seller_product.html?id=' + encodeURIComponent(id) });
    return R.ok(res, { moderation: mod, is_active: v.is_active });
  } catch (e) { return fail(res, 'adminDecideListing', e); }
};
