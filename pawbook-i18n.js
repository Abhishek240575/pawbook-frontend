/* ============================================================================
   PawBook i18n engine — "Every Language, Every Pet"
   ----------------------------------------------------------------------------
   System A (static UI localisation). Drop into any page:

     <script src="pawbook-i18n.js"></script>
     <script>PBi18n.register({ en:{...}, hi:{...}, ... });</script>

   Markup:
     data-i18n="key"          -> element.textContent
     data-i18n-ph="key"       -> placeholder
     data-i18n-title="key"    -> title + aria-label
     <div data-pb-lang-btn></div>  -> language switch button is rendered here
     <body data-i18n-prompt>  -> ask for language on first visit

   JS:
     PBi18n.t('key', {name:'x'})   PBi18n.lang   PBi18n.setLang('hi')
     PBi18n.fmtDate(date)          PBi18n.openPicker()
     window.addEventListener('pb:langchange', e => e.detail.lang)

   Preference is stored in localStorage 'pb_lang'.
   Never translate: pet names, phone numbers, microchip / reference IDs.
   ========================================================================== */
(function () {
  'use strict';

  var STORE_KEY = 'pb_lang';

  // Phase 1 = ready:true. Phase 2 languages are listed as "coming soon".
  var LANGS = [
    { code: 'en', native: 'English',  name: 'English',   locale: 'en-IN', ready: true },
    { code: 'hi', native: 'हिन्दी',    name: 'Hindi',     locale: 'hi-IN', ready: true, font: 'Noto Sans Devanagari' },
    { code: 'bn', native: 'বাংলা',     name: 'Bengali',   locale: 'bn-IN', ready: true, font: 'Noto Sans Bengali' },
    { code: 'ta', native: 'தமிழ்',     name: 'Tamil',     locale: 'ta-IN', ready: true, font: 'Noto Sans Tamil' },
    { code: 'mr', native: 'मराठी',     name: 'Marathi',   locale: 'mr-IN', ready: true, font: 'Noto Sans Devanagari' },
    { code: 'te', native: 'తెలుగు',    name: 'Telugu',    locale: 'te-IN', ready: false },
    { code: 'kn', native: 'ಕನ್ನಡ',     name: 'Kannada',   locale: 'kn-IN', ready: false },
    { code: 'gu', native: 'ગુજરાતી',   name: 'Gujarati',  locale: 'gu-IN', ready: false },
    { code: 'pa', native: 'ਪੰਜਾਬੀ',    name: 'Punjabi',   locale: 'pa-IN', ready: false },
    { code: 'ml', native: 'മലയാളം',    name: 'Malayalam', locale: 'ml-IN', ready: false }
  ];

  // Strings the engine itself needs (picker UI)
  var dicts = {
    en: { 'i18n.choose': 'Choose your language', 'i18n.sub': 'Your pet’s world, in your language. You can change this anytime.', 'i18n.soon': 'Coming soon', 'i18n.continue': 'Continue', 'i18n.btn': 'Language' },
    hi: { 'i18n.choose': 'अपनी भाषा चुनें', 'i18n.sub': 'आपके पालतू की दुनिया, आपकी भाषा में। आप इसे कभी भी बदल सकते हैं।', 'i18n.soon': 'जल्द आ रहा है', 'i18n.continue': 'आगे बढ़ें', 'i18n.btn': 'भाषा' },
    bn: { 'i18n.choose': 'আপনার ভাষা বেছে নিন', 'i18n.sub': 'আপনার পোষ্যের জগৎ, আপনার ভাষায়। যেকোনো সময় এটি বদলাতে পারেন।', 'i18n.soon': 'শীঘ্রই আসছে', 'i18n.continue': 'এগিয়ে যান', 'i18n.btn': 'ভাষা' },
    ta: { 'i18n.choose': 'உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்', 'i18n.sub': 'உங்கள் செல்லப்பிராணியின் உலகம், உங்கள் மொழியில். எப்போது வேண்டுமானாலும் மாற்றலாம்.', 'i18n.soon': 'விரைவில்', 'i18n.continue': 'தொடரவும்', 'i18n.btn': 'மொழி' },
    mr: { 'i18n.choose': 'तुमची भाषा निवडा', 'i18n.sub': 'तुमच्या पाळीव प्राण्याचे जग, तुमच्या भाषेत. तुम्ही हे कधीही बदलू शकता.', 'i18n.soon': 'लवकरच येत आहे', 'i18n.continue': 'पुढे जा', 'i18n.btn': 'भाषा' }
  };

  function langInfo(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return LANGS[0];
  }
  function readStored() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  function writeStored(v) {
    try { localStorage.setItem(STORE_KEY, v); } catch (e) {}
  }

  var stored = readStored();
  var current = (stored && langInfo(stored).ready) ? stored : 'en';

  // ── fonts: Poppins covers Latin + Devanagari; Bengali/Tamil need Noto ─────
  var loadedFonts = {};
  function loadFont(info) {
    var root = document.documentElement;
    var stack = "'Poppins'" + (info.font ? ", '" + info.font + "'" : '') + ', system-ui, sans-serif';
    root.style.setProperty('--pb-font', stack);
    if (!info.font || loadedFonts[info.font]) return;
    loadedFonts[info.font] = true;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + info.font.replace(/ /g, '+') + ':wght@400;500;600;700;800&display=swap';
    document.head.appendChild(l);
  }

  // ── core API ──────────────────────────────────────────────────────────────
  function t(key, vars) {
    var s = (dicts[current] && dicts[current][key] != null) ? dicts[current][key]
          : (dicts.en && dicts.en[key] != null) ? dicts.en[key] : key;
    if (vars) for (var k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  function has(key) { return !!((dicts[current] && dicts[current][key] != null) || (dicts.en && dicts.en[key] != null)); }

  function register(obj) {
    for (var lang in obj) {
      dicts[lang] = dicts[lang] || {};
      for (var k in obj[lang]) dicts[lang][k] = obj[lang][k];
    }
    if (document.readyState !== 'loading') apply();
  }

  function apply(root) {
    root = root || document;
    var i, el, nodes;
    nodes = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) { el = nodes[i]; el.textContent = t(el.getAttribute('data-i18n')); }
    nodes = root.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < nodes.length; i++) { el = nodes[i]; el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); }
    nodes = root.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i]; var v = t(el.getAttribute('data-i18n-title'));
      el.setAttribute('title', v); el.setAttribute('aria-label', v);
    }
    renderButtons();
  }

  function setLang(code) {
    var info = langInfo(code);
    if (!info.ready) return;
    current = info.code;
    writeStored(current);
    document.documentElement.lang = current;
    loadFont(info);
    apply();
    try { window.dispatchEvent(new CustomEvent('pb:langchange', { detail: { lang: current } })); } catch (e) {}
  }

  function fmtDate(d, opts) {
    try {
      return new Date(d).toLocaleDateString(langInfo(current).locale, opts || { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return new Date(d).toDateString(); }
  }

  // ── picker UI ─────────────────────────────────────────────────────────────
  var CSS = ''
    + '.pbl-btn{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:999px;border:1.5px solid #dbe4f3;background:#fff;color:#1a3a6b;font:600 13px var(--pb-font,Poppins),sans-serif;cursor:pointer;white-space:nowrap}'
    + '.pbl-btn:hover{border-color:#1877F2;color:#1877F2}'
    + '.pbl-btn .ti{font-size:17px}'
    + '.pbl-ov{position:fixed;inset:0;background:rgba(15,32,87,.55);backdrop-filter:blur(3px);z-index:10050;display:none;align-items:center;justify-content:center;padding:16px}'
    + '.pbl-ov.show{display:flex}'
    + '.pbl-box{background:#fff;border-radius:22px;max-width:520px;width:100%;max-height:92vh;overflow:auto;padding:26px 22px 20px;box-shadow:0 24px 60px rgba(0,0,0,.25);font-family:var(--pb-font,Poppins),sans-serif}'
    + '.pbl-head{text-align:center;margin-bottom:18px}'
    + '.pbl-logo{width:54px;height:54px;border-radius:16px;margin:0 auto 10px;background:linear-gradient(135deg,#1877F2,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:26px}'
    + '.pbl-title{font-size:20px;font-weight:800;color:#0f2057}'
    + '.pbl-sub{font-size:13px;color:#65676b;margin-top:4px;line-height:1.5}'
    + '.pbl-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}'
    + '.pbl-opt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:12px 14px;border-radius:14px;border:2px solid #e4e9f2;background:#f8fafd;cursor:pointer;text-align:left;font-family:inherit;position:relative}'
    + '.pbl-opt:hover{border-color:#93b8f5}'
    + '.pbl-opt.on{border-color:#1877F2;background:#eef5ff}'
    + '.pbl-opt.on::after{content:"\\2713";position:absolute;top:10px;right:12px;width:20px;height:20px;border-radius:50%;background:#1877F2;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}'
    + '.pbl-opt[disabled]{opacity:.5;cursor:not-allowed}'
    + '.pbl-native{font-size:17px;font-weight:700;color:#0f2057}'
    + '.pbl-en{font-size:11.5px;color:#65676b}'
    + '.pbl-soon{font-size:10px;font-weight:700;color:#8b5cf6;margin-top:2px}'
    + '.pbl-go{width:100%;margin-top:16px;height:48px;border:none;border-radius:14px;background:linear-gradient(135deg,#1877F2,#1a56db);color:#fff;font:700 15px var(--pb-font,Poppins),sans-serif;cursor:pointer}';

  var overlay = null, pending = current;

  function ensureCss() {
    if (document.getElementById('pbl-css')) return;
    var s = document.createElement('style'); s.id = 'pbl-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function buildPicker() {
    ensureCss();
    overlay = document.createElement('div');
    overlay.className = 'pbl-ov';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePicker(); });
    document.body.appendChild(overlay);
  }

  function renderPicker() {
    var html = '<div class="pbl-box"><div class="pbl-head"><div class="pbl-logo">🐾</div>'
      + '<div class="pbl-title">' + t('i18n.choose') + '</div><div class="pbl-sub">' + t('i18n.sub') + '</div></div><div class="pbl-grid">';
    LANGS.forEach(function (L) {
      html += '<button type="button" class="pbl-opt' + (L.code === pending ? ' on' : '') + '" data-code="' + L.code + '"' + (L.ready ? '' : ' disabled') + ' lang="' + L.code + '">'
        + '<span class="pbl-native">' + L.native + '</span><span class="pbl-en">' + L.name + '</span>'
        + (L.ready ? '' : '<span class="pbl-soon">' + t('i18n.soon') + '</span>') + '</button>';
    });
    html += '</div><button type="button" class="pbl-go">' + t('i18n.continue') + '</button></div>';
    overlay.innerHTML = html;
    var opts = overlay.querySelectorAll('.pbl-opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].addEventListener('click', function () {
        if (this.disabled) return;
        pending = this.getAttribute('data-code');
        setLang(pending);            // live preview in chosen language
        renderPicker();
      });
    }
    overlay.querySelector('.pbl-go').addEventListener('click', function () { writeStored(current); closePicker(); });
  }

  function openPicker() {
    if (!overlay) buildPicker();
    pending = current;
    renderPicker();
    overlay.classList.add('show');
  }
  function closePicker() {
    if (overlay) overlay.classList.remove('show');
    if (!readStored()) writeStored(current);
  }

  function renderButtons() {
    var slots = document.querySelectorAll('[data-pb-lang-btn]');
    if (!slots.length) return;
    ensureCss();
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      s.innerHTML = '<button type="button" class="pbl-btn" aria-label="' + t('i18n.btn') + '"><i class="ti ti-language"></i><span>' + langInfo(current).native + '</span><i class="ti ti-chevron-down" style="font-size:14px"></i></button>';
      s.firstChild.addEventListener('click', openPicker);
    }
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  function boot() {
    var info = langInfo(current);
    document.documentElement.lang = current;
    loadFont(info);
    apply();
    if (!readStored() && document.body && document.body.hasAttribute('data-i18n-prompt')) openPicker();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PBi18n = {
    t: t, has: has, register: register, apply: apply, setLang: setLang, fmtDate: fmtDate,
    openPicker: openPicker, languages: LANGS,
    get lang() { return current; },
    get locale() { return langInfo(current).locale; }
  };
})();
