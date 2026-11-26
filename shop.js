/* ============================================================================
   PawBook Marketplace 2.0 — shared storefront engine (shop.js)
   Used by 42_shop.html, 43_shop_list.html, 44_shop_product.html.
   Requires pawbook-i18n.js loaded first.
   - Cart: server cart (/marketplace/cart) when logged in, device cart for guests
   - Wishlist: server (/shop/wishlist) when logged in, device list for guests
   - Never shows invented ratings: stars render only when review_count > 0
   ========================================================================== */
(function () {
  'use strict';
  var API = 'https://pawbook.deemona.com/api/v1';
  var T = function (k, v) { return PBi18n.t(k, v); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function px(id, w) { return 'https://images.pexels.com/photos/' + id + '/pexels-photo-' + id + '.jpeg?auto=compress&cs=tinysrgb&w=' + (w || 600); }

  // ── Taxonomy (images: free Pexels photos) ───────────────────────────────────
  var PETS = [
    { id: 'dog', img: 29932030 }, { id: 'cat', img: 35912498 }, { id: 'bird', img: 34951082 },
    { id: 'fish', img: 33867664 }, { id: 'small_pet', img: 8434767 }
  ];
  var CATS = [
    { id: 'food', icon: 'ti-bowl', img: 8473516 }, { id: 'treats', icon: 'ti-bone', img: 8434633 },
    { id: 'toys', icon: 'ti-ball-tennis', img: 28802853 }, { id: 'grooming', icon: 'ti-sparkles', img: 19145894 },
    { id: 'walk', icon: 'ti-route', img: 8499440 }, { id: 'beds', icon: 'ti-bed', img: 35237328 },
    { id: 'clothing', icon: 'ti-shirt', img: 9428235 }, { id: 'bowls', icon: 'ti-tools-kitchen-2', img: 6568942 },
    { id: 'health', icon: 'ti-heartbeat', img: 7469217 }, { id: 'litter', icon: 'ti-box', img: 6853522 },
    { id: 'aquarium', icon: 'ti-fish', img: 29848116 }, { id: 'cages', icon: 'ti-building-cottage', img: 36842655 },
    { id: 'travel', icon: 'ti-car', img: 30617496 }, { id: 'training', icon: 'ti-target', img: 36951300 },
    { id: 'accessories', icon: 'ti-tag', img: 1750543 }, { id: 'other', icon: 'ti-dots', img: 16395147 }
  ];
  function catInfo(id) { for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i]; return CATS[CATS.length - 1]; }
  // Categories are managed by admins in the database; the list above is the offline fallback.
  var dynCats = {}, activeCats = null, catsReady = null;
  function loadCats() {
    if (catsReady) return catsReady;
    catsReady = api('/shop/categories').then(function (d) {
      var list = d.categories || [];
      list.forEach(function (c) {
        dynCats[c.slug] = c;
        var ex = CATS.filter(function (x) { return x.id === c.slug; })[0];
        if (ex) { if (c.icon) ex.icon = c.icon; if (c.image_url) ex.image_url = c.image_url; }
        else CATS.splice(CATS.length - 1, 0, { id: c.slug, icon: c.icon || 'ti-tag', img: null, image_url: c.image_url });
      });
      activeCats = list.map(function (c) { return c.slug; });
      return list;
    }).catch(function () { return null; });
    return catsReady;
  }
  function catImg(id, w) { var c = catInfo(id); return c.image_url || px(c.img || 16395147, w || 500); }
  function activeCatIds() { return activeCats || CATS.map(function (c) { return c.id; }); }
  function homeCats() {
    if (!activeCats) return ['food', 'treats', 'toys', 'grooming', 'walk', 'beds', 'clothing', 'health'];
    var h = activeCats.filter(function (s) { return dynCats[s] && dynCats[s].show_on_home; });
    return (h.length ? h : activeCats).slice(0, 8);
  }

  // ── API ─────────────────────────────────────────────────────────────────────
  function token() { try { return localStorage.getItem('pb_token') || ''; } catch (e) { return ''; } }
  function loggedIn() { return !!token(); }
  function api(path, opts) {
    opts = opts || {};
    var h = { 'Accept': 'application/json' };
    if (opts.body) h['Content-Type'] = 'application/json';
    if (token()) h['Authorization'] = 'Bearer ' + token();
    return fetch(API + path, { method: opts.method || 'GET', headers: h, credentials: 'include', body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.success === false) { var e = new Error(j.message || ('HTTP ' + r.status)); e.status = r.status; e.code = j.code; e.data = j.data; throw e; } return j.data !== undefined ? j.data : j; }); });
  }

  // ── Formatting ──────────────────────────────────────────────────────────────
  function money(n) {
    try { return new Intl.NumberFormat(PBi18n.locale, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0); }
    catch (e) { return '₹' + Math.round(Number(n) || 0); }
  }
  function starsHTML(r) {
    var full = Math.round(Number(r) || 0), s = '';
    for (var i = 1; i <= 5; i++) s += i <= full ? '★' : '☆';
    return '<span class="stars" aria-label="' + r + '/5">' + s + '</span>';
  }
  function deliveryBy(days) {
    var d = new Date(Date.now() + (Number(days) || 4) * 86400000);
    return PBi18n.fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function firstImg(p, w) {
    var im = (p.images && p.images[0]) || p.image || p.image_url;
    if (typeof im === 'string' && im) return im;
    return catImg(p.category, w || 500);
  }
  function catLabel(id) {
    var d = dynCats[id];
    if (d && d.name_i18n && d.name_i18n[PBi18n.lang]) return d.name_i18n[PBi18n.lang];
    if (PBi18n.has('cat.' + id)) return T('cat.' + id);
    return d ? d.name : id;
  }

  // ── Recently viewed (device only) ───────────────────────────────────────────
  var recent = {
    add: function (p) {
      var list = (ls('pb_shop_recent') || []).filter(function (x) { return String(x.product_id) !== String(p.product_id); });
      list.unshift({ product_id: p.product_id, name: p.name, price: p.price, compare_price: p.compare_price, images: [firstImg(p, 400)],
        category: p.category, brand: p.brand, rating: p.rating, review_count: p.review_count, stock: p.stock, delivery_days: p.delivery_days });
      ls('pb_shop_recent', list.slice(0, 12));
    },
    list: function () { return ls('pb_shop_recent') || []; }
  };

  // ── Wishlist ────────────────────────────────────────────────────────────────
  var wishIds = new Set((ls('pb_shop_wish') || []).map(String));
  var wish = {
    load: function () {
      if (!loggedIn()) { paintWish(); return Promise.resolve(); }
      return api('/shop/wishlist').then(function (d) {
        var guest = Array.from(wishIds); wishIds = new Set((d.ids || []).map(String));
        // merge device wishlist into account once
        guest.forEach(function (id) { if (!wishIds.has(id)) { wishIds.add(id); api('/shop/wishlist/' + encodeURIComponent(id), { method: 'POST' }).catch(function () {}); } });
        ls('pb_shop_wish', []); paintWish();
      }).catch(function () { paintWish(); });
    },
    has: function (id) { return wishIds.has(String(id)); },
    toggle: function (id) {
      id = String(id); var on = !wishIds.has(id);
      if (on) wishIds.add(id); else wishIds.delete(id);
      if (loggedIn()) api('/shop/wishlist/' + encodeURIComponent(id), { method: on ? 'POST' : 'DELETE' }).catch(function () {});
      else ls('pb_shop_wish', Array.from(wishIds));
      paintWish(); toast(T(on ? 'w.added' : 'w.removed'), on ? 'ti-heart-filled' : 'ti-heart');
      return on;
    },
    ids: function () { return Array.from(wishIds); }
  };
  function paintWish() {
    document.querySelectorAll('[data-wish]').forEach(function (b) {
      var on = wishIds.has(String(b.getAttribute('data-wish')));
      b.classList.toggle('on', on);
      var i = b.querySelector('i'); if (i) i.className = 'ti ' + (on ? 'ti-heart-filled' : 'ti-heart');
    });
    setBadge('wish', wishIds.size);
  }

  // ── Compare (device, up to 4) ───────────────────────────────────────────────
  var CMP_KEY = 'pb_shop_compare', CMP_MAX = 4;
  var compare = {
    list: function () { return ls(CMP_KEY) || []; },
    has: function (id) { return compare.list().some(function (x) { return String(x.product_id) === String(id); }); },
    toggle: function (p) {
      var l = compare.list(), id = String(p.product_id);
      if (compare.has(id)) l = l.filter(function (x) { return String(x.product_id) !== id; });
      else { if (l.length >= CMP_MAX) { toast(T('cmp.max', { n: CMP_MAX }), 'ti-alert-circle'); return; } l.push({ product_id: p.product_id, name: p.name || '', image: p.name ? firstImg(p, 120) : '', category: p.category }); toast(T('cmp.added'), 'ti-arrows-left-right'); }
      ls(CMP_KEY, l); paintCompare();
    },
    clear: function () { ls(CMP_KEY, []); paintCompare(); },
    url: function () { return '47_shop_compare.html?ids=' + compare.list().map(function (x) { return encodeURIComponent(x.product_id); }).join(','); }
  };
  function paintCompare() {
    var l = compare.list();
    document.querySelectorAll('[data-cmp]').forEach(function (b) { b.classList.toggle('on', compare.has(b.getAttribute('data-cmp'))); });
    var t = document.getElementById('cmp-tray');
    if (!t) { t = document.createElement('div'); t.id = 'cmp-tray'; t.className = 'cmp-tray'; document.body.appendChild(t); }
    if (!l.length || /47_shop_compare/.test(location.pathname)) { t.classList.remove('show'); return; }
    var slots = ''; for (var i = 0; i < CMP_MAX; i++) { var x = l[i]; slots += x ? '<span class="cmp-slot" title="' + esc(x.name) + '">' + (x.image ? '<img src="' + esc(x.image) + '" alt="">' : '<i class="ti ti-package"></i>') + '<button onclick="Shop.compare.toggle({product_id:\'' + esc(x.product_id) + '\'})" aria-label="remove">×</button></span>' : '<span class="cmp-slot empty"><i class="ti ti-plus"></i></span>'; }
    t.innerHTML = '<div class="cmp-slots">' + slots + '</div><div class="cmp-txt"><b>' + esc(T('cmp.n', { n: l.length, max: CMP_MAX })) + '</b><button class="cmp-clear" onclick="Shop.compare.clear()">' + esc(T('f.clear')) + '</button></div>'
      + '<a class="btn btn-o btn-sm" href="' + compare.url() + '"' + (l.length < 2 ? ' aria-disabled="true" onclick="event.preventDefault();Shop.toast(Shop.T(\'cmp.need2\'),\'ti-info-circle\')"' : '') + '><i class="ti ti-arrows-left-right"></i>' + esc(T('cmp.go')) + '</a>';
    t.classList.add('show');
  }

  // ── Cart ────────────────────────────────────────────────────────────────────
  // One line per product + size. Signed-in carts live on the server (/shop/cart), which
  // always returns the real price, stock and totals; guests keep theirs on this device.
  var cartItems = [], cartSummary = null;
  var FREE_DELIVERY = 499;   // same rule as the server (free from ₹499, else ₹49)
  function lineKey(id, v) { return String(id) + '|' + (v || ''); }
  function findLine(id, v) { return cartItems.filter(function (x) { return lineKey(x.product_id, x.variant) === lineKey(id, v); })[0]; }
  function fromServer(d) {
    cartItems = (d.items || []).map(function (it) {
      return { product_id: it.product_id, variant: it.variant || '', name: it.name + (it.variant ? ' — ' + it.variant : ''), price: Number(it.price), mrp: it.mrp,
        quantity: Number(it.quantity), image: it.image || '', stock: it.stock, issue: it.issue };
    });
    cartSummary = d.summary || null;
    paintCart();
    return d;
  }
  var cart = {
    load: function () {
      if (!loggedIn()) { cartItems = ls('pb_shop_cart') || []; cartSummary = null; paintCart(); return Promise.resolve(); }
      var guest = ls('pb_shop_cart') || [];
      var merge = guest.length ? api('/shop/cart/merge', { method: 'POST', body: { items: guest.map(function (g) { return { product_id: g.product_id, variant: g.variant || '', quantity: g.quantity }; }) } })
        .then(function () { ls('pb_shop_cart', []); }).catch(function () {}) : Promise.resolve();
      return merge.then(function () { return api('/shop/cart'); }).then(fromServer).catch(function () { cartItems = ls('pb_shop_cart') || []; paintCart(); });
    },
    refresh: function () { return loggedIn() ? api('/shop/cart').then(fromServer) : Promise.resolve({ items: cartItems }); },
    // p: {product_id, name, price, images|image, stock, variant?, size_count?}
    add: function (p, qty) {
      qty = qty || 1;
      var v = p.variant || '';
      if (!v && Number(p.size_count) > 0) { toast(T('c.pick'), 'ti-ruler'); setTimeout(function () { location.href = '44_shop_product.html?id=' + encodeURIComponent(p.product_id); }, 700); return Promise.resolve(); }
      var ex = findLine(p.product_id, v);
      if (ex) ex.quantity = Math.min(ex.quantity + qty, 20);
      else cartItems.push({ product_id: p.product_id, variant: v, name: p.name, price: Number(p.price), quantity: qty, image: firstImg(p, 200), stock: p.stock });
      paintCart(); toast(T('c.added'), 'ti-shopping-bag-check');
      if (!loggedIn()) { save(); return Promise.resolve(); }
      return api('/shop/cart', { method: 'POST', body: { product_id: p.product_id, variant: v, quantity: qty } })
        .then(function (r) { if (r.limited) toast(T('c.limited'), 'ti-info-circle'); return cart.refresh(); })
        .catch(function (e) { if (e.status === 401) { save(); return; } toast(e.message || T('l.err'), 'ti-alert-circle'); cart.refresh(); });
    },
    setQty: function (id, q, v) {
      var it = findLine(id, v); if (!it) return;
      if (q < 1) return cart.remove(id, v);
      it.quantity = Math.min(q, 20); paintCart();
      if (!loggedIn()) { save(); return; }
      api('/shop/cart', { method: 'PUT', body: { product_id: id, variant: v || '', quantity: it.quantity } })
        .then(function (r) { if (r.limited) toast(T('c.limited'), 'ti-info-circle'); return cart.refresh(); }).catch(function () { cart.refresh(); });
    },
    remove: function (id, v) {
      cartItems = cartItems.filter(function (x) { return lineKey(x.product_id, x.variant) !== lineKey(id, v); });
      paintCart();
      if (!loggedIn()) { save(); return; }
      api('/shop/cart?product_id=' + encodeURIComponent(id) + '&variant=' + encodeURIComponent(v || ''), { method: 'DELETE' }).then(cart.refresh).catch(function () { cart.refresh(); });
    },
    items: function () { return cartItems.slice(); },
    summary: function () { return cartSummary; },
    count: function () { return cartItems.reduce(function (a, x) { return a + (x.issue ? 0 : x.quantity); }, 0); },
    subtotal: function () { return cartItems.reduce(function (a, x) { return a + (x.issue ? 0 : x.price * x.quantity); }, 0); }
  };
  function save() { ls('pb_shop_cart', cartItems.map(function (x) { return { product_id: x.product_id, variant: x.variant || '', name: x.name, price: x.price, quantity: x.quantity, image: x.image, stock: x.stock }; })); }
  function paintCart() { setBadge('cart', cart.count()); if (document.getElementById('cart-drawer') && document.getElementById('cart-drawer').classList.contains('show')) renderCart(); }

  function setBadge(name, n) {
    document.querySelectorAll('[data-badge="' + name + '"]').forEach(function (b) { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('show', n > 0); });
  }

  // ── Toast ───────────────────────────────────────────────────────────────────
  var tt = null;
  function toast(msg, icon) {
    var t = document.getElementById('shop-toast');
    if (!t) { t = document.createElement('div'); t.id = 'shop-toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = '<i class="ti ' + (icon || 'ti-check') + '"></i><span>' + esc(msg) + '</span>';
    t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // ── Delivery PIN ────────────────────────────────────────────────────────────
  var PIN_KEY = 'pb_shop_pin';
  var pinIdx = null;
  function loadPins() {
    if (pinIdx) return Promise.resolve(pinIdx);
    return fetch('pawbook-in-locations.json').then(function (r) { return r.json(); }).then(function (d) {
      pinIdx = {}; Object.keys(d.states).forEach(function (s) { Object.keys(d.states[s]).forEach(function (dt) { d.states[s][dt].forEach(function (p) { pinIdx[p[0]] = dt + ', ' + s; }); }); });
      return pinIdx;
    }).catch(function () { pinIdx = {}; return pinIdx; });
  }
  var pin = {
    get: function () { return ls(PIN_KEY); },          // {pin:'110075', place:'South West, Delhi'}
    set: function (p, place) { ls(PIN_KEY, { pin: p, place: place }); paintPin(); window.dispatchEvent(new CustomEvent('shop:pin', { detail: { pin: p, place: place } })); },
    check: function (p) { return loadPins().then(function (idx) { return idx[p] || null; }); },
    open: function () {
      var m = document.getElementById('pin-modal'); if (!m) return;
      var cur = pin.get(); document.getElementById('pin-inp').value = cur ? cur.pin : '';
      document.getElementById('pin-msg').textContent = '';
      m.classList.add('show'); setTimeout(function () { document.getElementById('pin-inp').focus(); }, 50);
    }
  };
  function paintPin() {
    var c = pin.get();
    document.querySelectorAll('[data-pin-label]').forEach(function (el) { el.textContent = c ? (c.pin + (c.place ? ' · ' + c.place.split(',')[0] : '')) : T('h.setpin'); });
  }

  // ── Product card ────────────────────────────────────────────────────────────
  function productCard(p, opts) {
    opts = opts || {};
    var off = p.discount_pct || (p.compare_price > p.price ? Math.round((1 - p.price / p.compare_price) * 100) : 0);
    var url = '44_shop_product.html?id=' + encodeURIComponent(p.product_id);
    var oos = Number(p.stock) <= 0;
    var rate = Number(p.review_count) > 0
      ? '<div class="pc-rate">' + starsHTML(p.rating) + '<span>' + Number(p.rating).toFixed(1) + ' (' + p.review_count + ')</span></div>'
      : '<div class="pc-rate"><span class="pc-new">' + esc(T('p.newin')) + '</span></div>';
    return '<article class="pc">'
      + '<a class="pc-img" href="' + url + '"><img loading="lazy" src="' + esc(firstImg(p, 500)) + '" alt="' + esc(p.name) + '" onerror="this.onerror=null;this.src=\'' + catImg(p.category, 500) + '\'">'
      + (off >= 5 ? '<span class="pc-off">' + esc(T('p.off', { n: off })) + '</span>' : '')
      + (opts.tag ? '<span class="pc-tag">' + esc(opts.tag) + '</span>' : '')
      + (oos ? '<span class="pc-oos"><span>' + esc(T('p.oos')) + '</span></span>' : '') + '</a>'
      + '<button class="pc-wish' + (wish.has(p.product_id) ? ' on' : '') + '" data-wish="' + esc(p.product_id) + '" aria-label="' + esc(T('w.save')) + '"><i class="ti ' + (wish.has(p.product_id) ? 'ti-heart-filled' : 'ti-heart') + '"></i></button>'
      + '<button class="pc-cmp' + (compare.has(p.product_id) ? ' on' : '') + '" data-cmp="' + esc(p.product_id) + '" title="' + esc(T('cmp.add')) + '" aria-label="' + esc(T('cmp.add')) + '"><i class="ti ti-arrows-left-right"></i></button>'
      + '<div class="pc-b">'
      + (p.brand ? '<div class="pc-brand">' + esc(p.brand) + '</div>' : '<div class="pc-brand">' + esc(catLabel(p.category)) + '</div>')
      + '<a class="pc-name" href="' + url + '">' + esc(p.name) + '</a>' + rate
      + '<div class="pc-price"><b>' + money(p.price) + '</b>' + (off >= 1 ? '<s>' + money(p.compare_price) + '</s>' : '') + '</div>'
      + (oos ? '' : '<div class="pc-del"><i class="ti ti-truck-delivery"></i>' + esc(T('p.getby', { d: deliveryBy(p.delivery_days) })) + '</div>')
      + '<div class="pc-add">' + (Number(p.size_count) > 0 && !oos ? '<a class="btn btn-o" href="' + url + '"><i class="ti ti-ruler"></i>' + esc(T('p.choose')) + '</a>'
        : '<button class="btn btn-o" data-add="' + esc(p.product_id) + '"' + (oos ? ' disabled' : '') + '><i class="ti ti-shopping-bag-plus"></i>' + esc(T(oos ? 'p.oos' : 'p.add')) + '</button>') + '</div>'
      + '</div></article>';
  }
  var cardData = {};
  function renderCards(el, list, opts) {
    list.forEach(function (p) { cardData[String(p.product_id)] = p; });
    el.innerHTML = list.map(function (p) { return productCard(p, opts); }).join('');
  }
  document.addEventListener('click', function (e) {
    var w = e.target.closest('[data-wish]'); if (w) { e.preventDefault(); wish.toggle(w.getAttribute('data-wish')); return; }
    var cm = e.target.closest('[data-cmp]'); if (cm) { e.preventDefault(); var cid = cm.getAttribute('data-cmp'); compare.toggle(cardData[cid] || { product_id: cid }); return; }
    var a = e.target.closest('[data-add]'); if (a) { e.preventDefault(); var p = cardData[a.getAttribute('data-add')]; if (p) cart.add(p, 1); return; }
  });
  function skeletons(el, n) { var s = ''; for (var i = 0; i < (n || 4); i++) s += '<div class="pc-skel"></div>'; el.innerHTML = s; }

  // ── Header / footer / drawers ───────────────────────────────────────────────
  function header(active) {
    var nav = [['dog', 'ti-dog'], ['cat', 'ti-cat'], ['bird', 'ti-feather'], ['fish', 'ti-fish'], ['small_pet', 'ti-paw']];
    var h = '<div class="promo"><i class="ti ti-truck-delivery"></i> <span data-i18n="h.promo">' + esc(T('h.promo')) + '</span></div>'
      + '<header class="hdr"><div class="wrap hdr-row">'
      + '<a class="logo" href="07_home.html" title="PawBook home"><div class="logo-ic">🐾</div><div><div class="logo-t">PawBook</div><div class="logo-s" data-i18n="h.shop">' + esc(T('h.shop')) + '</div></div></a>'
      + '<button class="deliver" onclick="Shop.pin.open()"><i class="ti ti-map-pin"></i><span><small data-i18n="h.deliver">' + esc(T('h.deliver')) + '</small><b data-pin-label></b></span></button>'
      + '<form class="search" role="search" onsubmit="Shop.search(event)"><i class="ti ti-search"></i>'
      + '<input id="shop-q" autocomplete="off" data-i18n-ph="h.search" placeholder="' + esc(T('h.search')) + '" aria-label="' + esc(T('h.search')) + '">'
      + '<button class="search-go" aria-label="Search"><i class="ti ti-arrow-right"></i></button><div class="sugg" id="shop-sugg"></div></form>'
      + '<div class="hdr-acts"><div data-pb-lang-btn class="hdr-lang"></div>'
      + '<a class="hdr-btn" href="43_shop_list.html?wishlist=1"><i class="ti ti-heart"></i><span data-i18n="h.wish">' + esc(T('h.wish')) + '</span><em class="badge" data-badge="wish"></em></a>'
      + '<button class="hdr-btn" onclick="Shop.openCart()"><i class="ti ti-shopping-bag"></i><span data-i18n="h.cart">' + esc(T('h.cart')) + '</span><em class="badge" data-badge="cart"></em></button>'
      + '<a class="hdr-btn hide-m" href="' + (loggedIn() ? '53_shop_orders.html' : '01_login.html') + '"><i class="ti ti-user-circle"></i><span>' + esc(T(loggedIn() ? 'h.account' : 'h.login')) + '</span></a>'
      + '</div></div>'
      + '<nav class="nav"><div class="wrap">'
      + '<a href="42_shop.html"' + (active === 'home' ? ' class="on"' : '') + '><i class="ti ti-building-store"></i><span data-i18n="h.shop">' + esc(T('h.shop')) + '</span></a>'
      + nav.map(function (n) { return '<a href="43_shop_list.html?pet=' + n[0] + '"' + (active === n[0] ? ' class="on"' : '') + '><i class="ti ' + n[1] + '"></i><span data-i18n="pet.' + n[0] + '">' + esc(T('pet.' + n[0])) + '</span></a>'; }).join('')
      + '<a href="43_shop_list.html?sort=discount&on_sale=1" class="hot' + (active === 'offers' ? ' on' : '') + '"><i class="ti ti-discount-2"></i><span data-i18n="h.offers">' + esc(T('h.offers')) + '</span></a>'
      + '<a href="45_shop_brands.html"' + (active === 'brands' ? ' class="on"' : '') + '><i class="ti ti-building-store"></i><span data-i18n="h.brands">' + esc(T('h.brands')) + '</span></a>'
      + '<a href="42_shop.html#services"><i class="ti ti-scissors"></i><span data-i18n="h.services">' + esc(T('h.services')) + '</span></a>'
      + '<a href="39_adoption_matching.html"><i class="ti ti-heart-handshake"></i><span data-i18n="h.adopt">' + esc(T('h.adopt')) + '</span></a>'
      + '<span class="sp"></span><a class="back" href="07_home.html"><i class="ti ti-arrow-back-up"></i><span data-i18n="h.back">' + esc(T('h.back')) + '</span></a>'
      + '</div></nav></header>';
    var host = document.getElementById('shop-header'); host.innerHTML = h;
    // drawers + modals
    var extra = document.createElement('div');
    extra.innerHTML = '<div class="ov" id="shop-ov" onclick="Shop.closeCart()"></div>'
      + '<aside class="drawer" id="cart-drawer" aria-label="Cart"><div class="dr-h"><i class="ti ti-shopping-bag" style="font-size:22px;color:var(--o)"></i><b data-i18n="c.title">' + esc(T('c.title')) + '</b><button class="dr-x" onclick="Shop.closeCart()" aria-label="Close"><i class="ti ti-x"></i></button></div><div class="dr-b" id="cart-body"></div><div class="dr-f" id="cart-foot"></div></aside>'
      + '<div class="modal" id="pin-modal" onclick="if(event.target===this)this.classList.remove(\'show\')"><div class="modal-box">'
      + '<div class="modal-t" data-i18n="pin.t">' + esc(T('pin.t')) + '</div><div class="modal-s" data-i18n="pin.s">' + esc(T('pin.s')) + '</div>'
      + '<form onsubmit="Shop.savePin(event)" style="display:flex;gap:10px"><input id="pin-inp" class="inp" inputmode="numeric" maxlength="6" placeholder="110075" style="letter-spacing:2px;font-weight:700"><button class="btn btn-o" data-i18n="pin.apply">' + esc(T('pin.apply')) + '</button></form>'
      + '<div id="pin-msg" style="font-size:12.5px;margin-top:10px;font-weight:600"></div></div></div>'
      + '<nav class="bnav">'
      + '<a href="42_shop.html"' + (active === 'home' ? ' class="on"' : '') + '><i class="ti ti-building-store"></i><span data-i18n="b.home">' + esc(T('b.home')) + '</span></a>'
      + '<a href="43_shop_list.html"' + (active === 'all' ? ' class="on"' : '') + '><i class="ti ti-layout-grid"></i><span data-i18n="b.cats">' + esc(T('b.cats')) + '</span></a>'
      + '<a href="43_shop_list.html?wishlist=1"' + (active === 'wish' ? ' class="on"' : '') + '><i class="ti ti-heart"></i><span data-i18n="h.wish">' + esc(T('h.wish')) + '</span><em class="badge" data-badge="wish"></em></a>'
      + '<a href="#" onclick="event.preventDefault();Shop.openCart()"><i class="ti ti-shopping-bag"></i><span data-i18n="h.cart">' + esc(T('h.cart')) + '</span><em class="badge" data-badge="cart"></em></a>'
      + '<a href="' + (loggedIn() ? '53_shop_orders.html' : '01_login.html') + '"' + (active === 'account' ? ' class="on"' : '') + '><i class="ti ti-user-circle"></i><span data-i18n="h.account">' + esc(T('h.account')) + '</span></a>'
      + '</nav>';
    while (extra.firstChild) document.body.appendChild(extra.firstChild);
    PBi18n.apply();
    paintPin(); bindSuggest();
  }
  function footer() {
    var f = document.getElementById('shop-footer'); if (!f) return;
    f.innerHTML = '<footer class="foot"><div class="wrap"><div class="foot-g">'
      + '<div><a class="logo" href="07_home.html" style="margin-bottom:12px"><div class="logo-ic">🐾</div><div><div class="logo-t" style="color:#fff">PawBook</div><div class="logo-s" data-i18n="h.shop">' + esc(T('h.shop')) + '</div></div></a>'
      + '<p data-i18n="f.about">' + esc(T('f.about')) + '</p></div>'
      + '<div><h4 data-i18n="f.shop">' + esc(T('f.shop')) + '</h4>' + ['dog', 'cat', 'bird', 'fish', 'small_pet'].map(function (p) { return '<a href="43_shop_list.html?pet=' + p + '" data-i18n="pet.' + p + '">' + esc(T('pet.' + p)) + '</a>'; }).join('') + '<a href="45_shop_brands.html" data-i18n="h.brands">' + esc(T('h.brands')) + '</a></div>'
      + '<div><h4 data-i18n="f.help">' + esc(T('f.help')) + '</h4><a href="legal.html#terms" data-i18n="f.terms">' + esc(T('f.terms')) + '</a><a href="legal.html#privacy" data-i18n="f.privacy">' + esc(T('f.privacy')) + '</a><a href="legal.html#grievance" data-i18n="f.grievance">' + esc(T('f.grievance')) + '</a><a href="36_abuse_reporting.html" data-i18n="f.abuse">' + esc(T('f.abuse')) + '</a></div>'
      + '<div><h4 data-i18n="f.pawbook">' + esc(T('f.pawbook')) + '</h4><a href="07_home.html" data-i18n="f.social">' + esc(T('f.social')) + '</a><a href="11_vet_booking.html" data-i18n="f.vet">' + esc(T('f.vet')) + '</a><a href="39_adoption_matching.html" data-i18n="h.adopt">' + esc(T('h.adopt')) + '</a><a href="49_seller_join.html" data-i18n="f.sell">' + esc(T('f.sell')) + '</a></div>'
      + '</div><div class="foot-b"><span>© ' + new Date().getFullYear() + ' Deemona Global Solutions · PawBook</span><span data-i18n="f.note">' + esc(T('f.note')) + '</span></div></div></footer>';
  }

  // ── Cart drawer ─────────────────────────────────────────────────────────────
  function openCart() { renderCart(); document.getElementById('shop-ov').classList.add('show'); document.getElementById('cart-drawer').classList.add('show'); document.body.style.overflow = 'hidden'; }
  function closeCart() { document.getElementById('shop-ov').classList.remove('show'); document.getElementById('cart-drawer').classList.remove('show'); document.body.style.overflow = ''; }
  function renderCart() {
    var b = document.getElementById('cart-body'), f = document.getElementById('cart-foot');
    if (!cartItems.length) {
      b.innerHTML = '<div class="empty"><div class="empty-ic"><i class="ti ti-shopping-bag"></i></div><div class="empty-t">' + esc(T('c.empty')) + '</div><div class="empty-s">' + esc(T('c.emptys')) + '</div><a class="btn btn-o" href="43_shop_list.html">' + esc(T('c.browse')) + '</a></div>';
      f.innerHTML = ''; return;
    }
    var key = function (it) { return "'" + esc(it.product_id) + "'," + "'" + esc(String(it.variant || '').replace(/'/g, "\\'")) + "'"; };
    b.innerHTML = cartItems.map(function (it) {
      return '<div class="ci' + (it.issue ? ' ci-bad' : '') + '"><a href="44_shop_product.html?id=' + encodeURIComponent(it.product_id) + '"><img src="' + esc(it.image || px(8473516, 200)) + '" alt="" onerror="this.onerror=null;this.src=\'' + px(8473516, 200) + '\'"></a>'
        + '<div style="flex:1;min-width:0"><div class="ci-n">' + esc(it.name) + '</div>'
        + (it.issue ? '<div class="ci-issue">' + esc(T('ci.' + it.issue)) + '</div>' : '<div class="ci-p">' + money(it.price * it.quantity) + '</div>'
        + '<div class="qty"><button onclick="Shop.cart.setQty(' + key(it) .replace(/,'/, ',' + (it.quantity - 1) + ",'") + ')" aria-label="-">−</button><span>' + it.quantity + '</span><button onclick="Shop.cart.setQty(' + key(it).replace(/,'/, ',' + (it.quantity + 1) + ",'") + ')" aria-label="+"' + (it.stock != null && it.quantity >= Math.min(Number(it.stock), 20) ? ' disabled' : '') + '>+</button></div>') + '</div>'
        + '<button class="ci-rm" onclick="Shop.cart.remove(' + key(it) + ')" aria-label="remove"><i class="ti ti-trash"></i></button></div>';
    }).join('');
    var sm = cartSummary, sub = sm ? sm.subtotal : cart.subtotal(), fee = sm ? sm.delivery_fee : (sub >= FREE_DELIVERY || !sub ? 0 : 49), left = Math.max(FREE_DELIVERY - sub, 0);
    f.innerHTML = '<div style="font-size:12.5px;font-weight:700;color:' + (left ? 'var(--o-d)' : 'var(--green)') + '">' + esc(left ? T('c.freeleft', { amt: money(left) }) : T('c.free')) + '</div>'
      + '<div class="free-bar"><i style="width:' + Math.min(100, sub / FREE_DELIVERY * 100) + '%"></i></div>'
      + '<div class="dr-row"><span>' + esc(T('c.sub')) + '</span><b>' + money(sub) + '</b></div>'
      + (sm && sm.savings > 0 ? '<div class="dr-row" style="color:var(--green)"><span>' + esc(T('co.save')) + '</span><b>−' + money(sm.savings) + '</b></div>' : '')
      + '<div class="dr-row"><span>' + esc(T('c.del')) + '</span><b>' + (fee ? money(fee) : esc(T('c.freeword'))) + '</b></div>'
      + '<div class="dr-row tot"><span>' + esc(T('c.total')) + '</span><span>' + money(sm ? sm.total : sub + fee) + '</span></div>'
      + (cartItems.some(function (x) { return x.issue; }) ? '<div class="dr-note" style="color:var(--red)">' + esc(T('c.fixissues')) + '</div>' : '')
      + '<button class="btn btn-o" style="margin-top:10px" onclick="Shop.checkout()"' + (sub > 0 ? '' : ' disabled') + '><i class="ti ti-lock"></i>' + esc(T('c.checkout')) + '</button>'
      + '<div class="dr-note">' + esc(T('c.note')) + '</div>';
  }
  function checkout() {
    if (!loggedIn()) { toast(T('c.login'), 'ti-login'); setTimeout(function () { location.href = '01_login.html'; }, 1200); return; }
    location.href = '52_shop_checkout.html';
  }

  // ── Search with suggestions ─────────────────────────────────────────────────
  var RS_KEY = 'pb_shop_searches';
  function saveSearch(q) { q = String(q || '').trim().slice(0, 60); if (q.length < 2) return; var l = (ls(RS_KEY) || []).filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); l.unshift(q); ls(RS_KEY, l.slice(0, 6)); }
  function search(e) { e.preventDefault(); var q = document.getElementById('shop-q').value.trim(); saveSearch(q); location.href = '43_shop_list.html' + (q ? '?q=' + encodeURIComponent(q) : ''); }
  var popular = null;
  function showStarters(box) {
    var rec = ls(RS_KEY) || [];
    var draw = function () {
      var h = '';
      if (rec.length) h += '<div class="sugg-h">' + esc(T('s.recent')) + ' <button type="button" class="sugg-clr" onclick="event.stopPropagation();try{localStorage.removeItem(\'' + RS_KEY + '\')}catch(e){};document.getElementById(\'shop-sugg\').classList.remove(\'show\')">' + esc(T('f.clear')) + '</button></div>' + rec.map(function (q) { return '<a href="43_shop_list.html?q=' + encodeURIComponent(q) + '"><i class="ti ti-history" style="font-size:18px;color:var(--muted);width:38px;text-align:center"></i>' + esc(q) + '</a>'; }).join('');
      if (popular && popular.length) h += '<div class="sugg-h">' + esc(T('s.popular')) + '</div><div class="sugg-pop">' + popular.map(function (q) { return '<a href="43_shop_list.html?q=' + encodeURIComponent(q) + '"><i class="ti ti-trending-up"></i>' + esc(q) + '</a>'; }).join('') + '</div>';
      box.innerHTML = h; box.classList.toggle('show', !!h);
    };
    draw();
    if (popular === null) api('/shop/suggest?q=').then(function (d) { popular = d.popular || []; if (!document.getElementById('shop-q').value.trim() && document.activeElement === document.getElementById('shop-q')) draw(); }).catch(function () { popular = []; });
  }
  var sTimer = null;
  function bindSuggest() {
    var inp = document.getElementById('shop-q'), box = document.getElementById('shop-sugg');
    var qs = new URLSearchParams(location.search).get('q'); if (qs) { inp.value = qs; saveSearch(qs); }
    inp.addEventListener('focus', function () { if (!inp.value.trim()) showStarters(box); });
    box.addEventListener('click', function (e) { var a = e.target.closest('a[href*="q="]'); if (a) saveSearch(decodeURIComponent((a.getAttribute('href').split('q=')[1] || '').split('&')[0])); });
    inp.addEventListener('input', function () {
      clearTimeout(sTimer); var q = inp.value.trim();
      if (!q) { showStarters(box); return; }
      if (q.length < 2) { box.classList.remove('show'); return; }
      sTimer = setTimeout(function () {
        var cats = CATS.filter(function (c) { return catLabel(c.id).toLowerCase().indexOf(q.toLowerCase()) >= 0; }).slice(0, 3);
        api('/shop/suggest?q=' + encodeURIComponent(q)).catch(function () { return { products: [], brands: [] }; }).then(function (d) {
          var h = '';
          if (cats.length) h += '<div class="sugg-h">' + esc(T('s.cats')) + '</div>' + cats.map(function (c) { return '<a href="43_shop_list.html?category=' + c.id + '"><i class="ti ' + c.icon + '" style="font-size:20px;color:var(--o);width:38px;text-align:center"></i>' + esc(catLabel(c.id)) + '</a>'; }).join('');
          if (d.brands && d.brands.length) h += '<div class="sugg-h">' + esc(T('s.brands')) + '</div>' + d.brands.map(function (b) { return '<a href="43_shop_list.html?brand=' + encodeURIComponent(b) + '"><i class="ti ti-building-store" style="font-size:20px;color:var(--o);width:38px;text-align:center"></i>' + esc(b) + '</a>'; }).join('');
          if (d.products && d.products.length) h += '<div class="sugg-h">' + esc(T('s.products')) + '</div>' + d.products.map(function (p) { return '<a href="44_shop_product.html?id=' + encodeURIComponent(p.product_id) + '"><img src="' + esc(firstImg(p, 100)) + '" alt="">' + esc(p.name) + '<span class="pr">' + money(p.price) + '</span></a>'; }).join('');
          h += '<a href="43_shop_list.html?q=' + encodeURIComponent(q) + '" style="border-top:1px solid var(--line2);font-weight:700;color:var(--o-d)"><i class="ti ti-search" style="width:38px;text-align:center"></i>' + esc(T('s.all', { q: q })) + '</a>';
          box.innerHTML = h; box.classList.add('show');
        });
      }, 250);
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) box.classList.remove('show'); });
  }
  function savePin(e) {
    e.preventDefault();
    var v = document.getElementById('pin-inp').value.replace(/\D/g, ''), msg = document.getElementById('pin-msg');
    if (v.length !== 6) { msg.style.color = 'var(--red)'; msg.textContent = T('pin.bad'); return; }
    pin.check(v).then(function (place) {
      if (!place) { msg.style.color = 'var(--red)'; msg.textContent = T('pin.bad'); return; }
      pin.set(v, place); msg.style.color = 'var(--green)'; msg.textContent = T('pin.ok', { place: place });
      setTimeout(function () { document.getElementById('pin-modal').classList.remove('show'); }, 700);
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  function init(active) {
    header(active); footer(); PBi18n.apply();
    wish.load(); cart.load(); loadCats(); paintCompare();
    window.addEventListener('pb:langchange', function () { paintPin(); paintWish(); paintCompare(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeCart(); var m = document.getElementById('pin-modal'); if (m) m.classList.remove('show'); } });
  }

  // ── Review dialog (verified buyers) ─────────────────────────────────────────
  // p: {product_id, name, image}; mine: existing review or null; done: called after saving
  function openReview(p, mine, done) {
    var old = document.getElementById('rv-modal'); if (old) old.remove();
    var m = document.createElement('div'); m.id = 'rv-modal'; m.className = 'rv-modal';
    var stars = mine ? Number(mine.rating) : 0;
    m.innerHTML = '<div class="rv-box" role="dialog" aria-modal="true" aria-labelledby="rv-t"><button class="rv-x" aria-label="close"><i class="ti ti-x"></i></button>'
      + '<div class="rv-p">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '') + '<div><div class="rv-k" id="rv-t">' + esc(T(mine ? 'rv.edit' : 'rv.write')) + '</div><b>' + esc(p.name || '') + '</b></div></div>'
      + '<div class="rv-stars" role="radiogroup" aria-label="' + esc(T('rv.rate')) + '">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-s="' + n + '" aria-label="' + n + '">★</button>'; }).join('') + '<span class="rv-sl"></span></div>'
      + '<label class="rv-l">' + esc(T('rv.title')) + '<input id="rv-title" maxlength="120" placeholder="' + esc(T('rv.titleph')) + '" value="' + esc(mine && mine.title || '') + '"></label>'
      + '<label class="rv-l">' + esc(T('rv.text')) + '<textarea id="rv-text" maxlength="2000" placeholder="' + esc(T('rv.textph')) + '">' + esc(mine && mine.comment || '') + '</textarea></label>'
      + '<div class="rv-err" id="rv-err"></div><div class="rv-note"><i class="ti ti-circle-check"></i>' + esc(T('rv.note')) + '</div>'
      + '<button class="btn btn-o" id="rv-save" style="width:100%"><i class="ti ti-send"></i>' + esc(T('rv.submit')) + '</button></div>';
    document.body.appendChild(m);
    var paint = function () { m.querySelectorAll('.rv-stars button').forEach(function (b) { b.classList.toggle('on', Number(b.getAttribute('data-s')) <= stars); }); m.querySelector('.rv-sl').textContent = stars ? T('rv.s' + stars) : ''; };
    paint();
    var close = function () { m.remove(); document.removeEventListener('keydown', esck); };
    var esck = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esck);
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('.rv-x')) close(); var b = e.target.closest('.rv-stars button'); if (b) { stars = Number(b.getAttribute('data-s')); paint(); m.querySelector('#rv-err').textContent = ''; } });
    m.addEventListener('input', function () { m.querySelector('#rv-err').textContent = ''; });
    setTimeout(function () { m.classList.add('show'); }, 10);
    m.querySelector('#rv-save').onclick = function () {
      var t = m.querySelector('#rv-text').value.trim(), er = m.querySelector('#rv-err');
      if (!stars) { er.textContent = T('rv.e_stars'); return; }
      if (t.length < 10) { er.textContent = T('rv.e_text'); return; }
      this.disabled = true;
      var btn = this;
      api('/shop/products/' + encodeURIComponent(p.product_id) + '/reviews', { method: 'POST', body: { rating: stars, title: m.querySelector('#rv-title').value.trim(), comment: t } })
        .then(function () { close(); toast(T('rv.thanks'), 'ti-heart'); if (done) done(); })
        .catch(function (e) { btn.disabled = false; er.textContent = e.message || T('l.err'); });
    };
  }

  window.Shop = {
    API: API, api: api, px: px, esc: esc, money: money, starsHTML: starsHTML, deliveryBy: deliveryBy, firstImg: firstImg,
    PETS: PETS, CATS: CATS, catInfo: catInfo, catLabel: catLabel, catImg: catImg, loadCats: loadCats, activeCatIds: activeCatIds, homeCats: homeCats,
    loggedIn: loggedIn, compare: compare, saveSearch: saveSearch, T: T,
    productCard: productCard, renderCards: renderCards, skeletons: skeletons, cardData: cardData,
    cart: cart, wish: wish, recent: recent, pin: pin, toast: toast,
    openReview: openReview, init: init, openCart: openCart, closeCart: closeCart, checkout: checkout, search: search, savePin: savePin
  };
})();
