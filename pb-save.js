/* PawBook "Save to My PawBook" buttons for vets, training, travel guides and health tips.
   Adds a bookmark button to items on pages 11, 16, 22, 24 and 37; saved items appear in My PawBook → My Collection.
   Uses /api/v1/mypawbook (login required). Loaded with <script src="pb-save.js"></script>. */
(function () {
  'use strict';
  var API = 'https://pawbook.deemona.com/api/v1', TOKEN = '';
  try { TOKEN = localStorage.getItem('pb_token') || localStorage.getItem('pawbook_token') || localStorage.getItem('token') || ''; } catch (e) {}
  if (!TOKEN || window.__pbSave) return;
  window.__pbSave = true;
  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  var SAVED = {}, ready = false, busy = {};

  var css = document.createElement('style');
  css.textContent = '.pbs-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;min-width:32px;padding:0 9px;border-radius:10px;border:1.5px solid #f0d9c4;background:#fff;color:#8a6a52;font:700 12px Poppins,system-ui,sans-serif;cursor:pointer;flex-shrink:0;transition:background .15s,color .15s}' +
    '.pbs-btn i{font-size:16px}.pbs-btn:hover{border-color:#F47A38;color:#d65f20}.pbs-btn.on{background:#FFEBDD;border-color:#F47A38;color:#d65f20}.pbs-btn[disabled]{opacity:.6}' +
    '.pbs-abs{position:absolute;right:8px;top:8px;z-index:3;box-shadow:0 3px 10px rgba(0,0,0,.08)}' +
    '#pbs-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#3a2a1f;color:#fff;padding:10px 16px;border-radius:14px;font:600 13px Poppins,system-ui,sans-serif;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.2);max-width:90vw;text-align:center;display:none}' +
    '#pbs-toast a{color:#ffcfa8;margin-left:8px;font-weight:800}';
  document.head.appendChild(css);

  function toast(msg, link) {
    var t = document.getElementById('pbs-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pbs-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    if (link) { var a = document.createElement('a'); a.href = '31_saved.html?tab=collection'; a.textContent = 'View'; t.appendChild(a); }
    t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 3000);
  }
  function call(path, method, body) {
    return fetch(API + path, { method: method || 'GET', headers: Object.assign({ Authorization: 'Bearer ' + TOKEN }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) { var e = new Error(j.message || 'Could not save'); e.status = r.status; throw e; } return j.data !== undefined ? j.data : j; }); });
  }
  var https = function (u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ''; };
  var clean = function (s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); };

  function paint(b) { var on = !!SAVED[b._k]; if (b._painted && b._on === on) return; b._painted = 1; b._on = on; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.title = on ? 'Saved to My PawBook — tap to remove' : 'Save to My PawBook';
    b.innerHTML = '<i class="ti ti-bookmark' + (on ? '-filled' : '') + '"></i>' + (b._label ? (on ? 'Saved' : b._label) : ''); }
  // get() returns {title, image, url, note} at click time
  function button(kind, ref, get, opts) {
    opts = opts || {};
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pbs-btn' + (opts.abs ? ' pbs-abs' : ''); b._k = kind + ':' + ref; b._label = opts.label || '';
    b.setAttribute('aria-label', 'Save to My PawBook'); paint(b);
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (busy[b._k]) return; busy[b._k] = 1; b.disabled = true;
      var on = !!SAVED[b._k], p;
      if (on) p = call('/mypawbook/collection/items/' + kind + '/' + encodeURIComponent(ref), 'DELETE');
      else { var d = get() || {}; p = call('/mypawbook/collection/items', 'POST', { kind: kind, ref: ref, title: clean(d.title, 160) || 'Saved item', image: https(d.image) || undefined, url: d.url || undefined, note: d.note ? clean(d.note, 300) : undefined }); }
      p.then(function () { if (on) delete SAVED[b._k]; else SAVED[b._k] = 1; toast(on ? 'Removed from My PawBook' : 'Saved to My PawBook 🐾', !on); refreshAll(); })
        .catch(function (e) { toast(e.status === 401 ? 'Please log in again to save' : (e.message || 'Could not save')); })
        .then(function () { delete busy[b._k]; b.disabled = false; });
    });
    return b;
  }
  function refreshAll() { document.querySelectorAll('.pbs-btn').forEach(paint); }

  /* ── page adapters ── */
  var A = {};
  // 11 · vet cards in the vet booking list
  A['11_vet_booking.html'] = function () {
    document.querySelectorAll('.vet-card:not([data-pbs])').forEach(function (card) {
      card.setAttribute('data-pbs', '1');
      var m = /_openBookingById\('([^']+)'/.exec(card.getAttribute('onclick') || ''); if (!m) return;
      var vid = m[1]; if (/^demo-/.test(vid)) return;   // sample vets shown before real ones load
      var get = function () {
        var v = (window._vetMap && window._vetMap[vid]) || {};
        var name = v.clinic_name && v._is_clinic ? v.clinic_name : v.first_name ? 'Dr. ' + [v.first_name, v.last_name].filter(Boolean).join(' ') : (card.querySelector('.vet-name') || {}).textContent;
        return { title: name, image: v.avatar_url, note: [v.primary_specialty, [v.area, v.city].filter(Boolean).join(', ')].filter(Boolean).join(' · '), url: v._source === 'google' ? '11_vet_booking.html' : '16_vet_profile.html?id=' + encodeURIComponent(vid) };
      };
      var det = [].filter.call(card.querySelectorAll('button'), function (x) { return /Details/.test(x.textContent); })[0];
      var b = button('vet', 'vet:' + vid, get);
      if (det && det.parentNode) det.parentNode.insertBefore(b, det.nextSibling); else { card.style.position = 'relative'; b.classList.add('pbs-abs'); card.appendChild(b); }
    });
  };
  // 16 · single vet profile
  A['16_vet_profile.html'] = function () {
    if (document.querySelector('[data-pbs-vet]')) return;
    var q = new URLSearchParams(location.search), vid = q.get('vet_id') || q.get('id'); if (!vid) return;
    var nameEl = document.querySelector('.vet-card [style*="font-size:24px"]'); if (!nameEl) return;
    var b = button('vet', 'vet:' + vid, function () {
      var img = document.querySelector('.vet-av-lg img');
      var sub = document.querySelector('.vet-card [style*="font-size:14px"][style*="color:var(--muted)"]');
      return { title: nameEl.textContent, image: img && img.src, note: sub ? sub.textContent.replace(/^🩺\s*/, '') : '', url: '16_vet_profile.html?id=' + encodeURIComponent(vid) };
    }, { label: 'Save vet' });
    b.setAttribute('data-pbs-vet', '1'); b.style.marginTop = '8px';
    nameEl.parentNode.insertBefore(b, nameEl.nextSibling);
  };
  // 22 · training sessions
  A['22_training.html'] = function () {
    document.querySelectorAll('.session-card:not([data-pbs])').forEach(function (card) {
      card.setAttribute('data-pbs', '1');
      var act = card.querySelector('button[onclick*="_startSession("]'); if (!act) return;
      var m = /_startSession\((\d+)\)/.exec(act.getAttribute('onclick')); var s = m && window._sessMap ? window._sessMap[m[1]] : null; if (!s || !s.title) return;
      var b = button('training', 'session:' + (s.id || slug(s.title)), function () {
        return { title: s.title, image: s.thumbnail_url, note: [s.duration_min ? s.duration_min + ' min' : '', s.trainer_name ? 'Trainer: ' + s.trainer_name : '', s.difficulty].filter(Boolean).join(' · '), url: '22_training.html' };
      });
      b.style.marginRight = '6px'; act.parentNode.insertBefore(b, act);
    });
  };
  // 24 · travel guide sections and quick tips
  A['24_pet_travel.html'] = function () {
    document.querySelectorAll('.pb-card-header:not([data-pbs])').forEach(function (h) {
      h.setAttribute('data-pbs', '1');
      var t = clean((h.querySelector('h3') || h).textContent, 120); if (!t || /emergency|^travel guide$|^quick tips$/i.test(t)) return;
      var b = button('tip', 'travel:' + slug(t), function () { return { title: 'Pet travel: ' + t, url: '24_pet_travel.html', note: 'Pet travel guide' }; });
      h.appendChild(b);
    });
    document.querySelectorAll('.tip-card:not([data-pbs])').forEach(function (c) {
      c.setAttribute('data-pbs', '1');
      var t = clean((c.querySelector('.tip-title') || {}).textContent, 120); if (!t) return;
      var items = [].map.call(c.querySelectorAll('.tip-item span'), function (x) { return x.textContent.trim(); }).join(' · ');
      c.style.position = 'relative';
      c.appendChild(button('tip', 'travel-tip:' + slug(t), function () { return { title: 'Travel tip: ' + t, url: '24_pet_travel.html', note: items }; }, { abs: true }));
    });
  };
  // 37 · first-aid quick reference cards
  A['37_pet_ai_health_agent.html'] = function () {
    document.querySelectorAll('.first-aid-card:not([data-pbs])').forEach(function (c) {
      c.setAttribute('data-pbs', '1');
      var m = /setFirstAid\('([^']+)'\)/.exec(c.getAttribute('onclick') || ''); if (!m) return;
      var t = clean((c.querySelector('.first-aid-title') || c).textContent, 120);
      c.style.position = 'relative';
      c.appendChild(button('tip', 'firstaid:' + m[1], function () { return { title: 'First aid: ' + t, url: '37_pet_ai_health_agent.html', note: 'First aid quick reference' }; }, { abs: true }));
    });
  };

  var run = A[page]; if (!run) return;
  var t0 = null; function scan() { clearTimeout(t0); t0 = setTimeout(function () { try { run(); } catch (e) { console.warn('[PawBook save]', e.message); } }, 120); }
  call('/mypawbook/collection').then(function (d) { (d.items || []).forEach(function (i) { SAVED[i.kind + ':' + i.ref] = 1; }); }).catch(function () {}).then(function () { ready = true; refreshAll(); });
  function start() { scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
