/* PawBook seller pages — shared helpers. Needs pawbook-i18n.js, shop-i18n.js, seller-i18n.js, shop.js. */
(function () {
  var S = window.Shop, T = PBi18n.t;
  function token() { try { return localStorage.getItem('pb_token') || ''; } catch (e) { return ''; } }

  // Upload one image to PawBook media storage (Cloudinary). Resolves to the https URL.
  function upload(file) {
    if (!file || !/^image\//.test(file.type)) return Promise.reject(new Error(T('sl.imgtype')));
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error(T('sl.imgsize')));
    var fd = new FormData(); fd.append('file', file);
    return fetch(S.API + '/media/upload?type=product', { method: 'POST', headers: token() ? { Authorization: 'Bearer ' + token() } : {}, credentials: 'include', body: fd })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.success === false) throw new Error(j.message || ('HTTP ' + r.status));
        var url = (j.data && (j.data.url || j.data.secure_url)) || j.url;
        if (!url || !/^https:\/\//.test(url)) throw new Error(T('sl.upfail'));
        return url;
      }); });
  }

  // Load the signed-in seller; send guests to login and non-sellers to onboarding.
  function requireSeller() {
    if (!S.loggedIn()) { location.href = '01_login.html'; return new Promise(function () {}); }
    return S.api('/shop/seller/me').then(function (d) {
      if (!d.seller) { location.href = '49_seller_join.html'; return new Promise(function () {}); }
      return d;
    });
  }

  var FLOW = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
  var NEXT = { pending: 'confirmed', confirmed: 'packed', packed: 'shipped', shipped: 'delivered' };
  function statusLabel(s) { return T('os.' + s); }
  function statusPill(s) { return '<span class="spill s-' + s + '">' + S.esc(statusLabel(s)) + '</span>'; }

  // Field error helper for 422 responses: marks inputs [data-f="name"] invalid
  function markErrors(root, fields) {
    if (!root._pbClear) {
      root._pbClear = true;
      var clear = function (e) {
        var t = e.target, box = t.closest('.invalid');
        if (t.classList.contains('invalid')) t.classList.remove('invalid');
        if (box && box !== root) box.classList.remove('invalid');
        var row = t.closest('tr.invalid'); if (row) row.classList.remove('invalid');
      };
      root.addEventListener('input', clear); root.addEventListener('change', clear);
    }
    root.querySelectorAll('.invalid').forEach(function (el) { el.classList.remove('invalid'); });
    (fields || []).forEach(function (f) {
      var el = root.querySelector('[data-f="' + f.split('.')[0] + '"]');
      if (el) el.classList.add('invalid');
    });
    var first = root.querySelector('.invalid');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // PIN code → {state, district} from the India Post directory shipped with PawBook
  var locP = null;
  function lookupPin(pin) {
    if (!/^[1-9]\d{5}$/.test(pin)) return Promise.resolve(null);
    if (!locP) locP = fetch('pawbook-in-locations.json').then(function (r) { return r.json(); }).catch(function () { locP = null; return { states: {} }; });
    return locP.then(function (d) {
      var n = Number(pin), st = d.states || {};
      for (var s in st) { if (!s) continue; for (var dist in st[s]) { var l = st[s][dist]; for (var i = 0; i < l.length; i++) if (l[i][0] === n) return { state: s, district: dist }; } }
      return null;
    });
  }

  window.Seller = { lookupPin: lookupPin, upload: upload, requireSeller: requireSeller, FLOW: FLOW, NEXT: NEXT, statusLabel: statusLabel, statusPill: statusPill, markErrors: markErrors };
})();
