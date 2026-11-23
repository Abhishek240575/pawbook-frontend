/**
 * PawBook AI Widget — Floating chatbot for all pages
 * Include once at bottom of <body>: <script src="pawbook-ai-widget.js"></script>
 * No dependencies. Self-contained. Works on all 35 PawBook pages.
 */
(function(){
'use strict';

// ── Prevent double-init ──────────────────────────────────────────
if(window.__PAWBOOK_AI_WIDGET__) return;
window.__PAWBOOK_AI_WIDGET__ = true;
window.__PAWBOOK_AI_VERSION__ = 'v4-20261121-features';

var API_BASE = 'https://pawbook.deemona.com/api/v1';
var _chatHistory = []; // conversation memory for Claude

// ═══════════════════════════════════════════════════════════════
//  INJECT STYLES
// ═══════════════════════════════════════════════════════════════
var CSS = `
#pb-ai-fab{
  position:fixed;bottom:76px;left:20px;z-index:9000;
  width:56px;height:56px;border-radius:50%;
  background:linear-gradient(135deg,#1877F2,#8b5cf6);
  border:none;cursor:pointer;box-shadow:0 4px 20px rgba(24,119,242,.45);
  display:flex;align-items:center;justify-content:center;
  transition:transform .2s,box-shadow .2s;
  animation:pb-pulse-ring 2.5s ease-out infinite;
}
#pb-ai-fab:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(24,119,242,.6)}
#pb-ai-fab .pb-fab-icon{font-size:26px;line-height:1;user-select:none;transition:transform .25s}
#pb-ai-fab.open .pb-fab-icon{transform:rotate(90deg)}
#pb-ai-fab .pb-fab-badge{
  position:absolute;top:-2px;right:-2px;
  width:18px;height:18px;border-radius:50%;
  background:#dc2626;border:2px solid #fff;
  font-size:9px;font-weight:800;color:#fff;
  display:flex;align-items:center;justify-content:center;
  opacity:0;transform:scale(0);transition:all .2s;
}
#pb-ai-fab .pb-fab-badge.show{opacity:1;transform:scale(1)}

@keyframes pb-pulse-ring{
  0%{box-shadow:0 0 0 0 rgba(24,119,242,.5),0 4px 20px rgba(24,119,242,.45)}
  70%{box-shadow:0 0 0 10px rgba(24,119,242,0),0 4px 20px rgba(24,119,242,.45)}
  100%{box-shadow:0 0 0 0 rgba(24,119,242,0),0 4px 20px rgba(24,119,242,.45)}
}

#pb-ai-panel{
  position:fixed;bottom:144px;left:20px;z-index:8999;
  width:360px;max-width:calc(100vw - 40px);
  height:520px;max-height:calc(100dvh - 180px);
  right:auto;
  background:#fff;border-radius:16px;
  box-shadow:0 8px 40px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);
  display:flex;flex-direction:column;overflow:hidden;
  transform:scale(.88) translateY(16px);opacity:0;
  pointer-events:none;
  transition:transform .25s cubic-bezier(.34,1.4,.64,1),opacity .2s;
  transform-origin:bottom left;
}
#pb-ai-panel.open{transform:scale(1) translateY(0);opacity:1;pointer-events:all}

@media(max-width:480px){
  #pb-ai-panel{left:8px;right:8px;width:auto;bottom:140px}
  #pb-ai-fab{bottom:72px;left:16px}
}

/* header */
.pb-ai-head{
  background:linear-gradient(135deg,#1877F2,#8b5cf6);
  padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;
}
.pb-ai-head-av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.pb-ai-head-info{flex:1;min-width:0}
.pb-ai-head-name{font-size:14px;font-weight:800;color:#fff}
.pb-ai-head-status{font-size:11px;color:rgba(255,255,255,.8);display:flex;align-items:center;gap:4px;margin-top:1px}
.pb-ai-head-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;animation:pb-pulse-dot 2s infinite}
@keyframes pb-pulse-dot{0%,100%{opacity:1}50%{opacity:.4}}
.pb-ai-head-actions{display:flex;gap:4px}
.pb-ai-head-btn{width:30px;height:30px;border-radius:50%;border:none;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .15s}
.pb-ai-head-btn:hover{background:rgba(255,255,255,.3)}

/* messages */
.pb-ai-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;scroll-behavior:smooth}
.pb-ai-msgs::-webkit-scrollbar{width:3px}
.pb-ai-msgs::-webkit-scrollbar-thumb{background:#e4e6eb;border-radius:3px}

.pb-msg{display:flex;align-items:flex-end;gap:6px;max-width:88%}
.pb-msg.bot{align-self:flex-start}
.pb-msg.user{align-self:flex-end;flex-direction:row-reverse}
.pb-msg-av{width:24px;height:24px;border-radius:50%;flex-shrink:0;font-size:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1877F2,#8b5cf6);color:#fff}
.pb-msg.user .pb-msg-av{background:linear-gradient(135deg,#f59e0b,#ef4444);font-size:10px;font-weight:800}
.pb-msg-bubble{padding:9px 12px;border-radius:16px;font-size:13px;line-height:1.5;word-break:break-word;font-family:'Inter',sans-serif}
.pb-msg.bot .pb-msg-bubble{background:#f0f2f5;color:#050505;border-bottom-left-radius:4px}
.pb-msg.user .pb-msg-bubble{background:#1877F2;color:#fff;border-bottom-right-radius:4px}
.pb-msg-bubble strong{font-weight:700}
.pb-msg-bubble br{display:block;margin:1px 0}
.pb-msg-time{font-size:9px;color:#8a8d91;padding:0 2px;margin-top:2px}

/* quick replies */
.pb-qr-row{display:flex;flex-wrap:wrap;gap:5px;padding:2px 0 4px}
.pb-qr-btn{padding:5px 11px;border-radius:999px;border:1.5px solid #1877F2;background:#fff;color:#1877F2;font-size:11px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:all .15s}
.pb-qr-btn:hover{background:#1877F2;color:#fff}

/* action link */
.pb-action-link{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:7px 12px;border-radius:8px;background:#1877F2;color:#fff;font-size:12px;font-weight:700;cursor:pointer;border:none;font-family:'Inter',sans-serif;text-decoration:none}
.pb-action-link:hover{background:#1565c0}

/* feature pills */
.pb-pill-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:6px}
.pb-pill{padding:7px 8px;background:#e7f0fd;border-radius:8px;font-size:11px;font-weight:700;color:#1877F2;cursor:pointer;text-align:center;border:none;font-family:'Inter',sans-serif;transition:all .15s}
.pb-pill:hover{background:#1877F2;color:#fff}

/* typing */
.pb-typing{display:flex;align-items:center;gap:3px;padding:10px 14px;background:#f0f2f5;border-radius:16px;border-bottom-left-radius:4px;width:52px}
.pb-typing span{width:6px;height:6px;border-radius:50%;background:#65676b;animation:pb-typing .9s infinite}
.pb-typing span:nth-child(2){animation-delay:.2s}
.pb-typing span:nth-child(3){animation-delay:.4s}
@keyframes pb-typing{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}

/* input */
.pb-ai-input-row{display:flex;align-items:center;gap:6px;padding:10px 12px;border-top:1px solid #e4e6eb;flex-shrink:0;background:#fff}
.pb-ai-input-wrap{flex:1;background:#f0f2f5;border-radius:20px;display:flex;align-items:center;padding:0 12px;border:1.5px solid transparent;transition:border .15s}
.pb-ai-input-wrap:focus-within{border-color:#1877F2;background:#fff}
#pb-ai-input{flex:1;border:none;outline:none;background:transparent;font-size:13px;color:#050505;font-family:'Inter',sans-serif;padding:8px 0;resize:none;min-height:34px;max-height:90px;line-height:1.4}
#pb-ai-input::placeholder{color:#8a8d91}
.pb-send-btn{width:34px;height:34px;border-radius:50%;background:#1877F2;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;flex-shrink:0;transition:all .15s}
.pb-send-btn:hover{background:#1565c0;transform:scale(1.08)}
.pb-send-btn:disabled{background:#e4e6eb;cursor:not-allowed;transform:none}
.pb-mic-btn{width:34px;height:34px;border-radius:50%;background:#f0f2f5;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;transition:all .2s;position:relative}
.pb-mic-btn:hover{background:#e4e6eb;transform:scale(1.08)}
.pb-mic-btn.listening{background:linear-gradient(135deg,#ef4444,#dc2626);animation:pb-mic-pulse 1s ease-in-out infinite}
.pb-mic-btn.speaking{background:linear-gradient(135deg,#8b5cf6,#6d28d9);animation:pb-mic-pulse 1.5s ease-in-out infinite}
@keyframes pb-mic-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.5)}50%{box-shadow:0 0 0 8px rgba(239,68,68,0)}}
.pb-voice-bar{display:none;align-items:center;justify-content:center;gap:3px;padding:6px 12px;background:#fee2e2;border-radius:20px;margin:0 12px 8px;font-size:11px;font-weight:700;color:#dc2626}
.pb-voice-bar.show{display:flex}
.pb-voice-bar.speaking-bar{background:#ede9fe;color:#7c3aed}
.pb-tts-toggle{width:28px;height:28px;border-radius:50%;border:none;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background .15s}
.pb-tts-toggle:hover{background:rgba(255,255,255,.35)}
.pb-tts-toggle.muted{opacity:.5}
.pb-lang-wrap{position:relative;display:inline-block}
.pb-lang-btn{width:34px;height:34px;border-radius:50%;background:#f0f2f5;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;transition:all .2s}
.pb-lang-btn:hover{background:#e4e6eb;transform:scale(1.08)}
.pb-lang-dropdown{display:none;position:absolute;bottom:42px;left:0;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.18);z-index:9999;min-width:200px;max-height:280px;overflow-y:auto;padding:6px 0}
.pb-lang-dropdown.open{display:block}
.pb-lang-dropdown::-webkit-scrollbar{width:3px}
.pb-lang-dropdown::-webkit-scrollbar-thumb{background:#e4e6eb;border-radius:3px}
.pb-lang-opt{display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:12px;font-weight:600;color:#050505;cursor:pointer;font-family:'Inter',sans-serif;transition:background .1s}
.pb-lang-opt:hover{background:#f0f2f5}
.pb-lang-opt.active{background:#e7f0fd;color:#1877F2}
.pb-lang-opt-flag{font-size:16px;width:20px;text-align:center}
.pb-lang-label{font-size:11px;color:#8a8d91;padding:6px 14px 2px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}

/* feature cards */
.pb-feat-card{background:#fff;border:1.5px solid #e4e6eb;border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif}
.pb-feat-card:hover{border-color:#1877F2;box-shadow:0 2px 12px rgba(24,119,242,.12);transform:translateY(-1px)}
.pb-feat-card-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.pb-feat-card-icon{font-size:20px;width:24px;text-align:center}
.pb-feat-card-title{font-size:13px;font-weight:700;color:#050505}
.pb-feat-card-desc{font-size:11px;color:#65676b;line-height:1.4;margin-bottom:6px}
.pb-feat-card-tags{display:flex;flex-wrap:wrap;gap:4px}
.pb-feat-tag{background:#f0f2f5;border-radius:10px;padding:2px 8px;font-size:10px;color:#1877F2;font-weight:600;cursor:pointer}
.pb-feat-tag:hover{background:#e7f0fd}
.pb-feat-section{font-size:10px;font-weight:800;color:#8a8d91;text-transform:uppercase;letter-spacing:.6px;padding:8px 2px 4px}

/* login prompt inside chat */
.pb-login-prompt{background:#e7f0fd;border-radius:12px;padding:12px;margin-top:6px;text-align:center;font-family:'Inter',sans-serif}
.pb-login-prompt p{font-size:12px;color:#1877F2;font-weight:600;margin-bottom:8px}
.pb-login-prompt-btns{display:flex;gap:6px;justify-content:center}
.pb-lbtn{padding:7px 14px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.pb-lbtn.primary{background:#1877F2;color:#fff}
.pb-lbtn.secondary{background:#fff;color:#1877F2;border:1.5px solid #1877F2}

/* login form inside widget */
.pb-login-form{padding:14px 16px;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.pb-login-form h3{font-size:15px;font-weight:800;color:#050505;text-align:center}
.pb-login-form p{font-size:12px;color:#65676b;text-align:center}
.pb-social-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:10px;border-radius:10px;border:1.5px solid #e4e6eb;background:#fff;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:#050505;transition:all .15s}
.pb-social-btn:hover{background:#f0f2f5}
.pb-social-btn.fb{background:#1877F2;color:#fff;border-color:#1877F2}
.pb-social-btn.fb:hover{background:#1565c0}
.pb-divider{display:flex;align-items:center;gap:8px;color:#8a8d91;font-size:11px;font-weight:600}
.pb-divider::before,.pb-divider::after{content:'';flex:1;height:1px;background:#e4e6eb}
.pb-finput{width:100%;padding:9px 12px;border-radius:9px;border:1.5px solid #e4e6eb;font-family:inherit;font-size:13px;color:#050505;outline:none;transition:border .15s;box-sizing:border-box}
.pb-finput:focus{border-color:#1877F2}
.pb-fsubmit{width:100%;padding:11px;border-radius:10px;border:none;background:#1877F2;color:#fff;font-family:inherit;font-size:14px;font-weight:800;cursor:pointer;transition:background .15s}
.pb-fsubmit:hover{background:#1565c0}
.pb-fsubmit:disabled{background:#e4e6eb;cursor:not-allowed}
.pb-ferr{background:#fee2e2;color:#dc2626;font-size:11px;font-weight:600;padding:7px 10px;border-radius:7px;display:none}
.pb-fswitch{text-align:center;font-size:12px;color:#65676b}
.pb-fswitch a{color:#1877F2;cursor:pointer;font-weight:700}
.pb-back-btn{background:none;border:none;color:#1877F2;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;padding:0;display:flex;align-items:center;gap:4px}
`;

var styleEl = document.createElement('style');
styleEl.textContent = CSS;
document.head.appendChild(styleEl);

// ═══════════════════════════════════════════════════════════════
//  INJECT HTML
// ═══════════════════════════════════════════════════════════════
var HTML = `
<!-- FAB -->
<button id="pb-ai-fab" onclick="pbAI.toggle()" aria-label="PawBook AI Assistant">
  <span class="pb-fab-icon">🤖</span>
  <span class="pb-fab-badge" id="pb-fab-badge">1</span>
</button>

<!-- PANEL -->
<div id="pb-ai-panel">
  <!-- Header -->
  <div class="pb-ai-head">
    <div class="pb-ai-head-av">🤖</div>
    <div class="pb-ai-head-info">
      <div class="pb-ai-head-name">PawBook AI</div>
      <div class="pb-ai-head-status">
        <span class="pb-ai-head-dot"></span> Online · Always here
      </div>
    </div>
    <div class="pb-ai-head-actions">
      <button class="pb-tts-toggle" id="pb-tts-toggle" onclick="pbAI.toggleTTS()" title="Toggle voice reply">🔊</button>
      <button class="pb-ai-head-btn" id="pb-feat-btn" onclick="pbAI.toggleFeatures()" title="Browse all features">📋</button>
      <button class="pb-ai-head-btn" onclick="pbAI.clearChat()" title="Clear">🗑</button>
      <button class="pb-ai-head-btn" onclick="pbAI.openFull()" title="Open full page">⤢</button>
      <button class="pb-ai-head-btn" onclick="pbAI.toggle()" title="Close">✕</button>
    </div>
  </div>

  <!-- Chat view -->
  <div id="pb-chat-view" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
    <div class="pb-ai-msgs" id="pb-ai-msgs"></div>
    <div class="pb-voice-bar" id="pb-voice-bar">🎙 Listening… <span id="pb-voice-interim" style="font-weight:400;margin-left:4px;opacity:.7"></span></div>
    <div class="pb-ai-input-row">
      <button class="pb-mic-btn" id="pb-mic-btn" onclick="pbAI.toggleVoice()" title="Voice input">🎙</button>
      <div class="pb-lang-wrap" id="pb-lang-wrap">
        <button class="pb-lang-btn" id="pb-lang-btn" onclick="pbAI.toggleLang(event)" title="Select language">🌐</button>
        <div class="pb-lang-dropdown" id="pb-lang-dropdown">
          <div class="pb-lang-label">🇮🇳 Indian Languages</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('hi-IN','हिन्दी','🇮🇳')"><span class="pb-lang-opt-flag">🇮🇳</span> हिन्दी (Hindi)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('bn-IN','বাংলা','🇧🇩')"><span class="pb-lang-opt-flag">🟡</span> বাংলা (Bengali)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('ta-IN','தமிழ்','🟠')"><span class="pb-lang-opt-flag">🟠</span> தமிழ் (Tamil)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('te-IN','తెలుగు','🟡')"><span class="pb-lang-opt-flag">🟡</span> తెలుగు (Telugu)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('kn-IN','ಕನ್ನಡ','🟣')"><span class="pb-lang-opt-flag">🟣</span> ಕನ್ನಡ (Kannada)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('ml-IN','മലയാളം','🔵')"><span class="pb-lang-opt-flag">🔵</span> മലയാളം (Malayalam)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('mr-IN','मराठी','🟤')"><span class="pb-lang-opt-flag">🟤</span> मराठी (Marathi)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('gu-IN','ગુજરાતી','🟢')"><span class="pb-lang-opt-flag">🟢</span> ગુજરાતી (Gujarati)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('pa-IN','ਪੰਜਾਬੀ','🟡')"><span class="pb-lang-opt-flag">🟡</span> ਪੰਜਾਬੀ (Punjabi)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('or-IN','ଓଡ଼ିଆ','🟠')"><span class="pb-lang-opt-flag">🟠</span> ଓଡ଼ିଆ (Odia)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('as-IN','অসমীয়া','🟢')"><span class="pb-lang-opt-flag">🟢</span> অসমীয়া (Assamese)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('ur-PK','اردو','🌙')"><span class="pb-lang-opt-flag">🌙</span> اردو (Urdu)</div>
          <div class="pb-lang-label">🌍 International</div>
          <div class="pb-lang-opt active" id="pb-lang-opt-en" onclick="pbAI.selectLang('en-IN','English','🇬🇧')"><span class="pb-lang-opt-flag">🇬🇧</span> English</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('fr-FR','Français','🇫🇷')"><span class="pb-lang-opt-flag">🇫🇷</span> Français (French)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('de-DE','Deutsch','🇩🇪')"><span class="pb-lang-opt-flag">🇩🇪</span> Deutsch (German)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('zh-CN','中文','🇨🇳')"><span class="pb-lang-opt-flag">🇨🇳</span> 中文 (Chinese)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('ja-JP','日本語','🇯🇵')"><span class="pb-lang-opt-flag">🇯🇵</span> 日本語 (Japanese)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('ko-KR','한국어','🇰🇷')"><span class="pb-lang-opt-flag">🇰🇷</span> 한국어 (Korean)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('ru-RU','Русский','🇷🇺')"><span class="pb-lang-opt-flag">🇷🇺</span> Русский (Russian)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('ar-SA','العربية','🇸🇦')"><span class="pb-lang-opt-flag">🇸🇦</span> العربية (Arabic)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('es-ES','Español','🇪🇸')"><span class="pb-lang-opt-flag">🇪🇸</span> Español (Spanish)</div>
          <div class="pb-lang-opt" onclick="pbAI.selectLang('pt-BR','Português','🇧🇷')"><span class="pb-lang-opt-flag">🇧🇷</span> Português (Portuguese)</div>
        </div>
      </div>
      <div class="pb-ai-input-wrap">
        <textarea id="pb-ai-input" placeholder="Ask anything about PawBook…" rows="1"
          onkeydown="pbAI.handleKey(event)" oninput="pbAI.autoResize(this)"></textarea>
      </div>
      <button class="pb-send-btn" id="pb-send-btn" onclick="pbAI.send()">➤</button>
    </div>
  </div>

  <!-- Features Guide panel -->
  <div id="pb-features-view" style="display:none;flex-direction:column;flex:1;overflow:hidden">
    <div style="padding:10px 12px 6px;border-bottom:1px solid #e4e6eb">
      <input id="pb-feat-search" type="text" placeholder="🔍 Search features…" oninput="pbAI.filterFeatures(this.value)"
        style="width:100%;box-sizing:border-box;padding:7px 12px;border-radius:20px;border:1.5px solid #e4e6eb;font-size:12px;font-family:'Inter',sans-serif;outline:none"/>
    </div>
    <div id="pb-feat-list" style="flex:1;overflow-y:auto;padding:8px 10px">
    </div>
    <div style="padding:8px 12px;border-top:1px solid #e4e6eb;text-align:center">
      <button onclick="pbAI.toggleFeatures()" style="background:none;border:none;color:#1877F2;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif">← Back to Chat</button>
    </div>
  </div>

  <!-- Login view -->
  <div id="pb-login-view" style="display:none;flex-direction:column;flex:1;overflow:hidden">
    <div class="pb-login-form" id="pb-login-inner">
      <button class="pb-back-btn" onclick="pbAI.showChat()">← Back to chat</button>
      <div style="text-align:center;font-size:36px;margin:4px 0">🐾</div>
      <h3>Sign in to PawBook</h3>
      <p>Access your pets, bookings & history</p>
      <div id="pb-login-err" class="pb-ferr"></div>
      <button class="pb-social-btn" onclick="pbAI.socialLogin('google')">
        <svg width="17" height="17" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        Continue with Google
      </button>
      <button class="pb-social-btn fb" onclick="pbAI.socialLogin('facebook')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
        Continue with Facebook
      </button>
      <div class="pb-divider">or email</div>
      <div id="pb-email-login">
        <input class="pb-finput" type="email" id="pb-w-email" placeholder="Email" autocomplete="email" style="margin-bottom:8px">
        <input class="pb-finput" type="password" id="pb-w-pass" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key==='Enter')pbAI.emailLogin()" style="margin-bottom:8px">
        <button class="pb-fsubmit" id="pb-w-submit" onclick="pbAI.emailLogin()">Sign In</button>
        <div class="pb-fswitch" style="margin-top:8px">New here? <a onclick="pbAI.showRegister()">Create account</a></div>
      </div>
      <div id="pb-email-register" style="display:none">
        <input class="pb-finput" type="text" id="pb-w-name" placeholder="Full name" style="margin-bottom:8px">
        <input class="pb-finput" type="email" id="pb-w-reg-email" placeholder="Email" style="margin-bottom:8px">
        <input class="pb-finput" type="password" id="pb-w-reg-pass" placeholder="Password (min 6 chars)" onkeydown="if(event.key==='Enter')pbAI.doRegister()" style="margin-bottom:8px">
        <button class="pb-fsubmit" id="pb-w-reg-submit" onclick="pbAI.doRegister()">Create Account</button>
        <div class="pb-fswitch" style="margin-top:8px">Have account? <a onclick="pbAI.showLoginForm()">Sign in</a></div>
      </div>
    </div>
  </div>
</div>
`;

var container = document.createElement('div');
container.innerHTML = HTML;
document.body.appendChild(container);

// ═══════════════════════════════════════════════════════════════
//  KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════
var KB = {
  general:    { p:['what can you','capabilities','features','what is pawbook','about pawbook','hi','hello','hey','namaste','good morning','good afternoon','good evening','help','what can you do','get started','how does','tell me','version','v4','all features','show features','browse features'], a: function(){ return { t:'Hi! 👋 I\'m PawBook AI — your complete guide to all 35 PawBook features.\n\n📋 **Tap the 📋 button** (top-right) to browse ALL features with descriptions and test guides.\n\nOr ask me about any specific feature:\n🔍 Lost & Found · 🐾 Adoption · 🏥 Vet Booking · 💉 Vaccination\n🚨 Emergency · 🛍️ Marketplace · 🗺️ Discover Map · 🛡️ Insurance\n🎓 Training · ✈️ Pet Travel · 📺 Live Stream · 📚 Breeds\n👥 Groups · ⚙️ Settings · 📊 Analytics · 💬 DM Chat', pills:['Browse all features','Book a vet','Lost pet','Emergency'] }; } },
  lost:       { p:['lost pet','lost dog','lost cat','missing pet','found a dog','found a cat','stray','report lost','lost and found','pet missing','report lost pet','found a pet','view alerts','lost and found','i found'], a: function(){ return { t:'🔍 **Lost & Found**\n\nReport a lost pet → upload photo + location → alert sent to users within 10 km instantly.\n\nFound a stray? Tap "I Found a Pet" to notify owners.\n\n💡 Also share in your local group for wider reach.', pills:['Report lost pet','Found a pet','View alerts'], page:'05_lost_pet.html', pageLabel:'Lost Pet Page' }; } },
  adoption:   { p:['adopt','adoption','rescue','rehome','foster','shelter dog','shelter cat','want a dog','want a cat','puppy','kitten','browse dog','browse cat','find shelter','find a shelter','browse pets','adopt dog','adopt cat'], a: function(opts,raw){
    var t=String(raw||'');
    if(t.indexOf('dog')!==-1||t.indexOf('puppy')!==-1) return { t:'🐕 **Adopt a Dog**\n\nOver 1,200 dogs available across India and UAE.\n\nFilter by: breed, age, size, vaccinated, house-trained.\n\nTop breeds available: Indie, Labrador, Golden Retriever, Beagle, Pomeranian.\n\n💰 Cost: Free – ₹2,000 (vaccination/microchip only)', pills:['Find shelter','Browse cats','Adoption tips'], page:'04_adoption.html', pageLabel:'Browse Dogs' };
    if(t.indexOf('cat')!==-1||t.indexOf('kitten')!==-1) return { t:'🐈 **Adopt a Cat**\n\nOver 600 cats and kittens available.\n\nFilter by: breed, age, indoor/outdoor, vaccinated.\n\nTop breeds: Indie, Persian, Siamese, British Shorthair.\n\n💰 Cost: Free – ₹1,500 (vaccination/microchip only)', pills:['Find shelter','Browse dogs','Adoption tips'], page:'04_adoption.html', pageLabel:'Browse Cats' };
    if(t.indexOf('shelter')!==-1) return { t:'🏠 **Find a Shelter**\n\nFeatured shelters near you:\n\n• Blue Cross of India — Chennai\n• Friendicoes SECA — Delhi\n• CUPA — Bangalore\n• World For All — Mumbai\n• K9 Friends — Dubai\n\nTap to chat with any shelter directly on PawBook.', pills:['Browse dogs','Browse cats','Adoption tips'], page:'04_adoption.html', pageLabel:'Find Shelters' };
    return { t:'🐾 **Adoption**\n\nBrowse pets by species, breed, age & city. Chat with shelters directly.\n\nFeatured shelters: Blue Cross (Chennai), Friendicoes (Delhi), CUPA (Bangalore), K9 Friends (Dubai).\n\n💰 Cost: Free – ₹2,000 (vaccination/microchip only)', pills:['Browse dogs','Browse cats','Find shelter'], page:'04_adoption.html', pageLabel:'Adoption Page' };
  } },
  marketplace:{ p:['marketplace','buy','sell','shop','listing','pet food','pet accessories','pet products','pet store','order','browse listing','post listing','new listing','grooming tool','what is available','available in marketplace','what can i buy','what can i find'], a: function(opts,raw){
    var t=String(raw||'');
    if(t.indexOf('browse')!==-1||t.indexOf('available')!==-1||t.indexOf('what')!==-1||t.indexOf('find')!==-1||t.indexOf('buy')!==-1){
      return { t:'🛍️ **Browse Marketplace**\n\nCategories available:\n\n🥩 **Pet Food** — dry, wet, raw, treats (brands: Pedigree, Royal Canin, Drools, Whiskas)\n✂️ **Grooming** — brushes, clippers, shampoos, nail cutters\n🛏️ **Accessories** — beds, crates, carriers, leashes, collars\n🧸 **Toys** — chew toys, fetch, puzzle, interactive\n💊 **Health** — supplements, dewormers, flea/tick products\n🐾 **Pets** — responsibly-bred kittens, puppies, birds, fish\n\nFilter by city to find sellers near you.', pills:['Pet food','Grooming tools','Post listing','Safety tips'], page:'09_marketplace.html', pageLabel:'Browse Marketplace' };
    }
    if(t.indexOf('post')!==-1||t.indexOf('sell')!==-1||t.indexOf('list')!==-1){
      return { t:'📦 **Post a Listing**\n\nSell anything pet-related in 3 steps:\n\n1️⃣ Tap **+ New Listing** on the Marketplace page\n2️⃣ Add title, photos, price, description & your city\n3️⃣ Tap **Publish** — goes live instantly\n\n💡 Tips for faster sales:\n• Add 3–5 clear photos\n• Set a fair price (check similar listings first)\n• Mention pet age, breed & vaccine status for pets\n• Respond quickly to buyers\n\n⚠️ Never share your address publicly — meet in a public place.', pills:['Browse listings','Safety tips','Pet food'], page:'09_marketplace.html', pageLabel:'Post a Listing' };
    }
    if(t.indexOf('food')!==-1){
      return { t:'🥩 **Pet Food on Marketplace**\n\nFind deals from local sellers:\n\n• **Dog food**: Pedigree, Royal Canin, Drools, Orijen\n• **Cat food**: Whiskas, Sheba, Me-O, Farmina\n• **Raw/BARF diet** packs\n• **Homemade treats** from verified pet bakers\n• **Prescription diet** food (vet-recommended brands)\n\n💰 Typically 10–30% cheaper than retail stores.\n🚚 Many sellers offer delivery within city.', pills:['Browse listings','Grooming tools','Post listing'], page:'09_marketplace.html', pageLabel:'Pet Food Listings' };
    }
    if(t.indexOf('groom')!==-1){
      return { t:'✂️ **Grooming Tools on Marketplace**\n\nPopular items:\n\n• Slicker brushes & deshedding tools (₹150–₹800)\n• Pet clippers & trimmers (₹500–₹3,000)\n• Shampoos & conditioners (₹200–₹1,200)\n• Nail clippers & grinders (₹200–₹700)\n• Grooming tables (₹2,000–₹8,000)\n• Ear cleaning kits (₹100–₹400)\n\n💡 Also find professional mobile groomers who list their services on Marketplace.', pills:['Browse listings','Pet food','Post listing'], page:'09_marketplace.html', pageLabel:'Grooming Tools' };
    }
    if(t.indexOf('safe')!==-1||t.indexOf('tip')!==-1){
      return { t:'🔒 **Marketplace Safety Tips**\n\n✅ Always meet the seller in a **public place**\n✅ Inspect the pet/product before paying\n✅ Use PawBook\'s in-app chat — never move to WhatsApp for payments\n✅ Ask for vaccination certificates for pets\n✅ Check seller reviews & rating before buying\n\n🚫 Never:\n• Pay advance without seeing the item\n• Share your home address with a new seller\n• Send money via UPI to unverified accounts\n\n🚨 Report suspicious listings using the 3-dot menu.', pills:['Browse listings','Post listing','Report a listing'] };
    }
    return { t:'🛍️ **Marketplace**\n\nBuy/sell pet food, accessories, products & responsibly-bred pets.\n\nTo list: tap + New Listing → add photos, price, location → live instantly.\n\n⚠️ Safety: Always meet in public. Never pay before seeing the pet.', pills:['Browse listings','Post listing','Pet food','Grooming tools'], page:'09_marketplace.html', pageLabel:'Marketplace' };
  } },
  vet:        { p:['vet','veterinarian','doctor','appointment','book vet','clinic','hospital','consultation','video vet','find vet','pet doctor','book now','video consult','vet near me','book a vet','consult'], a: function(opts,raw){
    var t=String(raw||'');
    if(t.indexOf('video')!==-1||t.indexOf('online')!==-1){
      return { t:'📱 **Video Consultation**\n\nTalk to a licensed vet from home — perfect for:\n• Minor symptoms & concerns\n• Post-surgery follow-ups\n• Diet & nutrition advice\n• Behaviour questions\n• Prescription refills\n\n💰 Cost: ₹200–₹500 per session\n⏱️ Available: 7am–11pm daily\n📲 Works on any device — no app download needed\n\nBook a slot in under 2 minutes.', pills:['Book video consult','In-clinic booking','Vet near me'], page:'11_vet_booking.html', pageLabel:'Book Video Consult' };
    }
    if(t.indexOf('near')!==-1||t.indexOf('find')!==-1||t.indexOf('locate')!==-1){
      return { t:'📍 **Find a Vet Near You**\n\nSearch by city or allow location access to find:\n\n• General veterinary clinics\n• Specialist vets (dermatology, ortho, cardio)\n• 24-hour emergency hospitals\n• Mobile/home-visit vets\n• Exotic pet specialists\n\n🗺️ Also available on the Discover map — tap the Vet filter.', pills:['Book now','Video consult','Emergency vet'], page:'11_vet_booking.html', pageLabel:'Find Vets' };
    }
    if(t.indexOf('emergency')!==-1){
      return { t:'🚨 **Emergency Vet Clinics**\n\n• Delhi: Cessna Lifeline +91 98102 60604\n• Mumbai: Bombay Vet College +91 22 2419 4071\n• Bangalore: CUPA +91 80 2334 1086\n• Chennai: Blue Cross +91 44 2235 1074\n• Dubai: Dubai Vet Hospital +971 4 349 4646\n\nOpen 24×7. Call ahead before rushing in.', pills:['First aid tips','Find 24hr vet','Book a vet'], page:'06_emergency.html', pageLabel:'Emergency Services' };
    }
    return { t:'🏥 **Vet Booking**\n\nBook in-clinic, video or home-visit consultations.\n\n• Video call: ₹200–₹500\n• In-clinic: ₹300–₹1,000\n• Home visit: ₹800–₹2,000\n\nSearch by city → pick slot → instant confirmation.', pills:['Book now','Video consult','Vet near me','Emergency vet'], page:'11_vet_booking.html', pageLabel:'Book a Vet' };
  } },
  vaccination:{ p:['vaccination','vaccine','vaccin','shot','booster','immunization','rabies','deworming','health record','medical record','add vaccine','upcoming vaccine','vaccine record'], a: function(opts,raw){
    var t=String(raw||'');
    if(t.indexOf('add')!==-1||t.indexOf('record')!==-1||t.indexOf('log')!==-1){
      return { t:'📋 **Add Vaccine Record**\n\nTo log a vaccination:\n1. Go to Vaccination Diary\n2. Select your pet\n3. Tap **+ Add Record**\n4. Enter vaccine name, date given & next due date\n5. Upload vet certificate (optional)\n\nAll records are stored securely and can be shared as a PDF with any vet.', pills:['Upcoming vaccines','Book vaccine appt','Dog vaccine schedule'], page:'10_vaccination.html', pageLabel:'Add Record' };
    }
    if(t.indexOf('upcoming')!==-1||t.indexOf('due')!==-1||t.indexOf('remind')!==-1){
      return { t:'🔔 **Upcoming Vaccinations**\n\nPawBook sends automatic reminders:\n• 7 days before due date — push notification\n• 3 days before — reminder SMS/email\n• Day of — final alert\n\nCheck your pet\'s upcoming schedule in the Vaccination Diary → Upcoming tab.', pills:['Add vaccine record','Book vaccine appt','Dog vaccine schedule'], page:'10_vaccination.html', pageLabel:'Upcoming Vaccines' };
    }
    if(t.indexOf('dog')!==-1||t.indexOf('dhpp')!==-1){
      return { t:'🐕 **Dog Vaccine Schedule**\n\n• **DHPP** (Distemper, Hepatitis, Parvovirus, Parainfluenza): 6, 8, 10, 12 weeks → annual booster\n• **Rabies**: 12–16 weeks → every 1–3 years\n• **Leptospirosis**: 12 weeks → annual\n• **Bordetella**: 8 weeks → annual\n• **Deworming**: every 3 months\n\nConsult your vet for exact timing based on your dog\'s breed & health.', pills:['Add vaccine record','Cat vaccine schedule','Book vaccine appt'], page:'10_vaccination.html', pageLabel:'Dog Vaccine Schedule' };
    }
    return { t:'💉 **Vaccination Diary**\n\nTrack every vaccine & booster for all your pets.\n\n• Auto-reminders 7 days before each due date\n• Shareable PDF certificate\n• Dog: DHPP, Rabies, Leptospirosis schedule\n• Cat: FVRCP, Rabies schedule', pills:['Add vaccine record','Upcoming vaccines','Book vaccine appt'], page:'10_vaccination.html', pageLabel:'Vaccination Diary' };
  } },
  emergency:  { p:['emergency','urgent','critical','sick pet','dying','accident','bleeding','poisoned','poison','not breathing','unconscious','seizure','24 hour','24hr','night vet','emergency vet','find 24hr vet','first aid tips','first aid','emergency map','emergency number','call vet'], a: function(o,raw){
    var t=String(raw||'');
    if(t.indexOf('first aid')!==-1){
      return { t:'🩺 **Pet First Aid Tips**\n\n🔥 **Heatstroke**: Move to shade, cool paws & belly with wet cloth, offer water, rush to vet\n\n☠️ **Poisoning**: Do NOT induce vomiting. Note what was eaten. Rush to vet immediately\n\n🩸 **Bleeding**: Apply firm pressure with clean cloth for 5–10 mins. Do not remove cloth\n\n💨 **Not breathing**: Check airway for blockage. Keep calm and rush to emergency vet\n\n🦴 **Fracture**: Immobilise gently, do not splint at home, carry carefully to vet', pills:['Emergency numbers','Find 24hr vet','Emergency map'], page:'06_emergency.html', pageLabel:'Emergency Services' };
    }
    return { t:'🚨 **EMERGENCY — Call Now:**\n\n• Delhi: Cessna Lifeline +91 98102 60604\n• Mumbai: Bombay Vet College +91 22 2419 4071\n• Bangalore: CUPA +91 80 2334 1086\n• Chennai: Blue Cross +91 44 2235 1074\n• Dubai: Dubai Vet Hospital +971 4 349 4646\n\n⚡ Heatstroke: cool paws with water, rush to vet\n⚡ Poison: do NOT induce vomiting, rush to vet\n⚡ Bleeding: firm pressure with cloth', pills:['Find 24hr vet','First aid tips','Emergency map'], page:'06_emergency.html', pageLabel:'Emergency Services' };
  } },
  discover:   { p:['discover','find services','boarding','nearby','near me','locate','map','pet shop','pet store near','emergency map','pet shops near me','grooming salon','grooming near','vets on map','find vet near','services near'], a: function(){ return { t:'🗺️ **Discover**\n\nFind any pet service near you — worldwide.\n\nVets · Grooming · Pet Shops · Shelters · Zoos · 24hr Emergency\n\nPowered by live Google Maps. Works in India, UAE, UK, Europe, USA & more.', pills:['Pet shops near me','Grooming salons','Vets on map'], page:'26_discover.html', pageLabel:'Open Discover' }; } },
  groups:     { p:['group','community','join group','create group','pet group','meetup','club','pet parents','breed group'], a: function(){ return { t:'👥 **Groups & Community**\n\nJoin 500+ local & breed-specific groups.\n\nTop groups: Delhi Dog Parents (12.4k), Mumbai Cat Lovers (8.9k), Stray Rescue Network (9.8k)\n\nCreate your own group in 2 taps.', pills:['Browse groups','Create group','Pet events'], page:'03_groups.html', pageLabel:'Go to Groups' }; } },
  insurance:  { p:['insurance','pet insurance','cover','coverage','claim','policy','premium','insure'], a: function(){ return { t:'🛡️ **Pet Insurance**\n\n• Basic (accidents): ₹500/month\n• Standard (accidents+illness): ₹900/month\n• Premium (comprehensive): ₹1,500/month\n\nClaims reimbursed within 7 working days. Upload bill + vet notes on the Insurance page.', pills:['View plans','Get a quote','File a claim'], page:'21_pet_insurance.html', pageLabel:'Pet Insurance' }; } },
  training:   { p:['training','train','obedience','behaviour','bark','biting','potty','leash','commands','aggressive','puppy training','trainer'], a: function(){ return { t:'🎓 **Pet Training**\n\nVideo lessons, breed guides & certified trainers near you.\n\n• Excessive barking → distraction & reward\n• Potty training → schedule + positive reinforcement\n• Leash pulling → stop-and-go technique\n• Aggression → professional trainer recommended\n\nHome sessions: ₹500–₹2,000', pills:['Find a trainer','Basic commands','Stop barking','Puppy guide'], page:'22_training.html', pageLabel:'Training Hub' }; } },
  grievance:  { p:['complaint','complain','grievance','issue','problem','not working','bug','report','scam','fraud','fake','harassment','inappropriate','abuse','unhappy','refund','dispute'], a: function(){ return { t:'📋 **Complaints & Support**\n\nResponse times:\n• Critical (abuse/fraud): within 4 hours\n• Standard queries: within 24 hours\n\n📧 support@deemona.com\n📍 Grievance Officer: Deemona Global Solutions, New Delhi 110075\n\nTo report in-app: 3-dot menu on any post/user → Report.', pills:['Report fake listing','Report a user','Technical bug','Request refund'] }; } },
  account:    { p:['account','profile','settings','password','privacy','delete account','notification','dark mode','block user','deactivate'], a: function(){ return { t:'⚙️ **Account & Settings**\n\n• Change password: Settings → Security\n• Privacy: control who sees posts & can message you\n• Notifications: set quiet hours, choose channels\n• Delete account: Settings → Account (30-day cooldown)\n• Block users from their profile → Block', pills:['Change password','Privacy settings','Notifications'], page:'14_settings.html', pageLabel:'Open Settings' }; } },
  login:      { p:['sign in','login','log in','sign up','register','create account','forgot password','reset password','sign out','logout','log out'], a: function(o){ return { t: o._user ? 'You\'re signed in as '+o._user+'! 👋\n\nTo sign out, tap your name in the top-right of any PawBook page.\n\nNeed help with your account?' : 'You can sign in with **Google**, **Facebook** or **email**.\n\nTap the Sign In button above, or I can open the sign-in form for you here! 👇', loginPrompt: !o._user, pills: o._user ? ['My profile','My pets','My bookings'] : ['Sign in now'] }; } },
  fallback:   { a: function(opts,raw){ var input=raw||''; return { t:'Let me check with PawBook AI for "'+input.substring(0,40)+'"…\n\nOr tap 📋 (top-right) to browse all 35 PawBook features with test guides!', pills:['Browse all features','Lost pet','Book a vet','Emergency','Marketplace'] }; } }
};

function detectIntent(s){
  var l=s.toLowerCase();
  var order=['emergency','lost','grievance','vet','vaccination','adoption','marketplace','insurance','training','groups','discover','account','login','general'];
  for(var i=0;i<order.length;i++){
    var e=KB[order[i]];
    if(e&&e.p) for(var j=0;j<e.p.length;j++) if(l.indexOf(e.p[j])!==-1) return order[i];
  }
  return 'fallback';
}

// ═══════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════
var _open = false;
var _msgId = 0;
var _typing = false;
var _currentUser = null;
var _greeted = false;

try{ _currentUser = JSON.parse(localStorage.getItem('pb_user')||'null'); }catch(e){}

// ═══════════════════════════════════════════════════════════════
//  RENDER HELPERS
// ═══════════════════════════════════════════════════════════════
function fmt(t){
  return t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
}
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function timeNow(){ var d=new Date(); return d.getHours()+':'+String(d.getMinutes()).padStart(2,'0'); }

function scrollBottom(){
  var el=document.getElementById('pb-ai-msgs');
  if(el) el.scrollTop=el.scrollHeight;
}

function botMsg(text, pills, extraHtml, page, pageLabel){
  var msgs=document.getElementById('pb-ai-msgs');
  if(!msgs) return;
  var d=document.createElement('div');
  d.className='pb-msg bot';
  var html='<div class="pb-msg-av">🤖</div><div>';
  html+='<div class="pb-msg-bubble">'+fmt(text)+'</div>';
  if(extraHtml) html+='<div style="margin-top:4px">'+extraHtml+'</div>';
  if(page){
    html+='<a class="pb-action-link" onclick="window.location.href=\''+page+'\'">⤢ '+pageLabel+'</a>';
  }
  if(pills&&pills.length){
    html+='<div class="pb-qr-row">';
    pills.forEach(function(p){
      html+='<button class="pb-qr-btn" onclick="pbAI.quick(\''+p.replace(/'/g,"\\'")+'\')">'+ p+'</button>';
    });
    html+='</div>';
  }
  html+='<div class="pb-msg-time">'+timeNow()+'</div></div>';
  d.innerHTML=html;
  msgs.appendChild(d);
  scrollBottom();
}

function userMsg(text){
  var msgs=document.getElementById('pb-ai-msgs');
  if(!msgs) return;
  var d=document.createElement('div');
  d.className='pb-msg user';
  var init=_currentUser?((_currentUser.full_name||_currentUser.username||'U').charAt(0).toUpperCase()):'U';
  d.innerHTML='<div class="pb-msg-av" style="font-size:10px">'+init+'</div>'+
    '<div><div class="pb-msg-bubble">'+esc(text)+'</div>'+
    '<div class="pb-msg-time" style="text-align:right">'+timeNow()+'</div></div>';
  msgs.appendChild(d);
  scrollBottom();
}

function showTyping(){
  var msgs=document.getElementById('pb-ai-msgs');
  if(!msgs||_typing) return;
  _typing=true;
  var d=document.createElement('div');
  d.className='pb-msg bot'; d.id='pb-typing';
  d.innerHTML='<div class="pb-msg-av">🤖</div><div class="pb-typing"><span></span><span></span><span></span></div>';
  msgs.appendChild(d); scrollBottom();
}

function hideTyping(){
  var el=document.getElementById('pb-typing');
  if(el){el.remove();} _typing=false;
}

function loginPromptMsg(){
  var html='<div class="pb-login-prompt">'+
    '<p>🔐 Sign in to access your pet data, bookings & history</p>'+
    '<div class="pb-login-prompt-btns">'+
    '<button class="pb-lbtn primary" onclick="pbAI.showLoginView()">Sign In</button>'+
    '<button class="pb-lbtn secondary" onclick="pbAI.showLoginView(true)">Register</button>'+
    '</div></div>';
  botMsg('You\'re not signed in yet.', null, html);
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PUBLIC API — window.pbAI
// ═══════════════════════════════════════════════════════════════
window.pbAI = {

  toggle: function(){
    _open = !_open;
    var panel=document.getElementById('pb-ai-panel');
    var fab=document.getElementById('pb-ai-fab');
    if(_open){
      panel.classList.add('open');
      fab.classList.add('open');
      // Hide the new-message badge
      var badge=document.getElementById('pb-fab-badge');
      if(badge) badge.classList.remove('show');
      // Greet once
      if(!_greeted){ _greeted=true; this._greet(); }
      setTimeout(function(){ var inp=document.getElementById('pb-ai-input'); if(inp) inp.focus(); },300);
    } else {
      panel.classList.remove('open');
      fab.classList.remove('open');
    }
  },

  _greet: function(){
    var h=new Date().getHours();
    var g=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
    var name=_currentUser?(' '+(_currentUser.full_name||_currentUser.username||'')):'';
    botMsg(g+name+'! 🐾 I\'m PawBook AI — your complete guide to all 35 PawBook features.\n\n💬 **Ask me anything** — features, how to use them, testing steps.\n📋 **Tap 📋 above** to browse all features with one tap.\n🎙 **Use voice** — tap 🎙 to speak your question.\n🌐 **Change language** — tap 🌐 for Hindi, Tamil, Telugu & more.',
      ['Browse all features','Lost pet','Book a vet','Emergency']);
    // show badge on FAB before first open
  },

  // ── VOICE ENGINE ──────────────────────────────────────────────
  _voiceRecog: null,
  _voiceActive: false,
  _ttsEnabled: true,
  _ttsLang: '',       // auto-detected from speech (fallback)
  _selectedLang: 'en-IN',  // explicitly chosen by user via lang picker

  // Language code map for SpeechSynthesis (BCP-47)
  _langMap: {
    // Indian regional
    'hi':'hi-IN','bn':'bn-IN','ta':'ta-IN','te':'te-IN','kn':'kn-IN',
    'ml':'ml-IN','mr':'mr-IN','gu':'gu-IN','pa':'pa-IN','or':'or-IN',
    'as':'as-IN','ur':'ur-PK',
    // International
    'en':'en-IN','fr':'fr-FR','de':'de-DE','zh':'zh-CN','ja':'ja-JP',
    'ko':'ko-KR','ru':'ru-RU','ar':'ar-SA','es':'es-ES','pt':'pt-BR',
    'it':'it-IT','nl':'nl-NL','tr':'tr-TR','pl':'pl-PL','vi':'vi-VN',
    'th':'th-TH','id':'id-ID'
  },

  // Detect language from speech recognition result lang tag
  _detectLang: function(langTag){
    if(!langTag) return 'en-IN';
    var base = langTag.split('-')[0].toLowerCase();
    return this._langMap[base] || langTag || 'en-IN';
  },

  toggleVoice: function(){
    if(this._voiceActive){ this._stopVoice(); return; }
    this._startVoice();
  },

  _startVoice: function(){
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){
      botMsg('Voice input is not supported in this browser. Please use Chrome or Edge. 🎙');
      return;
    }
    // Stop any ongoing TTS
    window.speechSynthesis && window.speechSynthesis.cancel();

    var self = this;
    var recog = new SR();
    recog.continuous = false;
    recog.interimResults = true;
    recog.maxAlternatives = 1;
    // Use explicitly selected language so STT transcribes correctly
    recog.lang = this._selectedLang || navigator.language || 'en-IN';

    recog.onstart = function(){
      self._voiceActive = true;
      self._voiceRecog = recog;
      var mb = document.getElementById('pb-mic-btn');
      var vb = document.getElementById('pb-voice-bar');
      if(mb) mb.classList.add('listening');
      if(vb){ vb.classList.add('show'); vb.classList.remove('speaking-bar'); }
    };

    recog.onresult = function(e){
      var interim = '';
      var final = '';
      for(var i = e.resultIndex; i < e.results.length; i++){
        if(e.results[i].isFinal){
          final += e.results[i][0].transcript;
          // Capture detected language if available
          if(e.results[i][0].lang) self._ttsLang = self._detectLang(e.results[i][0].lang);
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      var vi = document.getElementById('pb-voice-interim');
      if(vi) vi.textContent = interim || final;
      if(final){
        var inp = document.getElementById('pb-ai-input');
        if(inp) inp.value = final;
      }
    };

    recog.onerror = function(e){
      self._stopVoice();
      if(e.error === 'not-allowed'){
        botMsg('Microphone access denied. Please allow mic access in your browser settings. 🎙');
      }
    };

    recog.onend = function(){
      self._stopVoice();
      // Auto-send if we got text
      var inp = document.getElementById('pb-ai-input');
      if(inp && inp.value.trim()){
        setTimeout(function(){ pbAI.send(); }, 100);
      }
    };

    recog.start();
  },

  _stopVoice: function(){
    this._voiceActive = false;
    if(this._voiceRecog){
      try{ this._voiceRecog.stop(); }catch(e){}
      this._voiceRecog = null;
    }
    var mb = document.getElementById('pb-mic-btn');
    var vb = document.getElementById('pb-voice-bar');
    var vi = document.getElementById('pb-voice-interim');
    if(mb) mb.classList.remove('listening');
    if(vb) vb.classList.remove('show');
    if(vi) vi.textContent = '';
  },

  _speak: function(text){
    if(!this._ttsEnabled) return;
    if(!window.speechSynthesis) return;
    // Strip markdown symbols for cleaner speech
    var clean = text
      .replace(/\*\*(.*?)\*\*/g,'$1')
      .replace(/\*(.*?)\*/g,'$1')
      .replace(/#{1,6}\s/g,'')
      .replace(/`([^`]+)`/g,'$1')
      .replace(/\n/g,'. ')
      .substring(0, 500); // cap length

    window.speechSynthesis.cancel();
    var utt = new SpeechSynthesisUtterance(clean);

    // Pick voice — prefer explicit user selection, fall back to auto-detected
    var targetLang = this._selectedLang || this._ttsLang || 'en-IN';
    var voices = window.speechSynthesis.getVoices();
    var voice = null;
    // Try exact match first, then base language
    if(voices.length){
      voice = voices.find(function(v){ return v.lang === targetLang; }) ||
              voices.find(function(v){ return v.lang.startsWith(targetLang.split('-')[0]); }) ||
              voices.find(function(v){ return v.lang.startsWith('en'); });
    }
    if(voice) utt.voice = voice;
    utt.lang = targetLang;
    utt.rate = 0.95;
    utt.pitch = 1;
    utt.volume = 1;

    var mb = document.getElementById('pb-mic-btn');
    var vb = document.getElementById('pb-voice-bar');
    utt.onstart = function(){
      if(mb) mb.classList.add('speaking');
      if(vb){ vb.textContent = '🔊 Speaking…'; vb.classList.add('show','speaking-bar'); }
    };
    utt.onend = utt.onerror = function(){
      if(mb) mb.classList.remove('speaking');
      if(vb){ vb.classList.remove('show','speaking-bar'); vb.innerHTML = '🎙 Listening… <span id="pb-voice-interim" style="font-weight:400;margin-left:4px;opacity:.7"></span>'; }
    };

    // Voices may load async on first call
    if(voices.length === 0){
      window.speechSynthesis.onvoiceschanged = function(){
        var v2 = window.speechSynthesis.getVoices();
        var vx = v2.find(function(v){ return v.lang === targetLang; }) ||
                 v2.find(function(v){ return v.lang.startsWith(targetLang.split('-')[0]); }) ||
                 v2.find(function(v){ return v.lang.startsWith('en'); });
        if(vx) utt.voice = vx;
        window.speechSynthesis.speak(utt);
      };
    } else {
      window.speechSynthesis.speak(utt);
    }
  },

  toggleTTS: function(){
    this._ttsEnabled = !this._ttsEnabled;
    var btn = document.getElementById('pb-tts-toggle');
    if(btn){
      btn.textContent = this._ttsEnabled ? '🔊' : '🔇';
      btn.classList.toggle('muted', !this._ttsEnabled);
    }
    if(!this._ttsEnabled) window.speechSynthesis && window.speechSynthesis.cancel();
  },

  toggleLang: function(e){
    e.stopPropagation();
    var dd = document.getElementById('pb-lang-dropdown');
    if(!dd) return;
    var isOpen = dd.classList.contains('open');
    // Close any other open dropdown first
    this._closeLangDropdown();
    if(!isOpen){
      dd.classList.add('open');
      // Close on outside click
      var self = this;
      setTimeout(function(){
        document.addEventListener('click', function handler(){
          self._closeLangDropdown();
          document.removeEventListener('click', handler);
        });
      }, 10);
    }
  },

  _closeLangDropdown: function(){
    var dd = document.getElementById('pb-lang-dropdown');
    if(dd) dd.classList.remove('open');
  },

  selectLang: function(bcp47, label, flag){
    this._selectedLang = bcp47;
    this._ttsLang = bcp47; // keep them in sync
    // Update button to show selected language flag
    var btn = document.getElementById('pb-lang-btn');
    if(btn) btn.textContent = flag;
    // Mark active option
    var opts = document.querySelectorAll('.pb-lang-opt');
    opts.forEach(function(o){ o.classList.remove('active'); });
    // Find and mark the clicked option
    var all = document.querySelectorAll('.pb-lang-opt');
    for(var i=0; i<all.length; i++){
      if(all[i].onclick && all[i].textContent.indexOf(label) !== -1){
        all[i].classList.add('active'); break;
      }
    }
    this._closeLangDropdown();
    // Update STT placeholder to reflect language
    var inp = document.getElementById('pb-ai-input');
    if(inp){
      var hints = {
        'hi-IN':'हिन्दी में पूछें…','bn-IN':'বাংলায় জিজ্ঞেস করুন…',
        'ta-IN':'தமிழில் கேளுங்கள்…','te-IN':'తెలుగులో అడగండి…',
        'kn-IN':'ಕನ್ನಡದಲ್ಲಿ ಕೇಳಿ…','ml-IN':'മലയാളത്തിൽ ചോദിക്കൂ…',
        'mr-IN':'मराठीत विचारा…','gu-IN':'ગુજરાતીમાં પૂछो…',
        'pa-IN':'ਪੰਜਾਬੀ ਵਿੱਚ ਪੁੱਛੋ…','ur-PK':'اردو میں پوچھیں…',
        'fr-FR':'Posez une question en français…','de-DE':'Auf Deutsch fragen…',
        'zh-CN':'用中文提问…','ja-JP':'日本語で質問…','ko-KR':'한국어로 질문하세요…',
        'ru-RU':'Спросите по-русски…','ar-SA':'اسأل بالعربية…',
        'es-ES':'Pregunta en español…','pt-BR':'Pergunte em português…'
      };
      inp.placeholder = hints[bcp47] || 'Ask anything about PawBook…';
    }
  },
  // ── END VOICE ENGINE ──────────────────────────────────────────

  // ── FEATURES GUIDE ───────────────────────────────────────────
  _FEATURES: [
    { icon:'🏠', title:'Home Feed', desc:'Social feed — post photos, videos, feelings & location. Like, comment, share, save.', tags:['Post a photo','Add feeling','Like a post','Comment','Share post','Story'], page:'07_home.html', section:'Social' },
    { icon:'👤', title:'My Profile', desc:'Your pet parent profile with bio, cover photo, pets grid, posts and followers.', tags:['Edit profile','My pets','View posts','Add photo'], page:'02_profile.html', section:'Social' },
    { icon:'👥', title:'Groups & Community', desc:'500+ local & breed groups. Create groups, chat, post events.', tags:['Join a group','Create group','Find local groups','Group events'], page:'03_groups.html', section:'Social' },
    { icon:'📖', title:'Stories', desc:'24-hour disappearing photos & videos with stickers and text overlays.', tags:['Post a story','View story','Add sticker','Who viewed'], page:'07_home.html', section:'Social' },
    { icon:'💬', title:'Direct Messages', desc:'Private 1-on-1 and group chat with photos, voice notes and read receipts.', tags:['Send a message','Group chat','Voice note','Read receipts'], page:'', section:'Social' },
    { icon:'🔍', title:'Lost & Found', desc:'Report a lost pet — alerts sent to users within 10 km radius instantly.', tags:['Report lost pet','Found a pet','View alerts','Share alert'], page:'05_lost_pet.html', section:'Pet Care' },
    { icon:'🐾', title:'Adoption', desc:'Browse 1,200+ pets from verified shelters across India & UAE. Filter by breed, age, city.', tags:['Adopt a dog','Adopt a cat','Find shelter','Adoption tips'], page:'04_adoption.html', section:'Pet Care' },
    { icon:'🚨', title:'Emergency Services', desc:'24/7 emergency vet numbers, first aid guides, and live emergency map.', tags:['Emergency number','First aid','Find 24hr vet','Emergency map'], page:'06_emergency.html', section:'Pet Care' },
    { icon:'🏥', title:'Vet Booking', desc:'Book in-clinic (₹300–₹1,000), video (₹200–₹500) or home-visit (₹800–₹2,000) vet appointments.', tags:['Book a vet','Video consult','Find vet near me','My bookings'], page:'11_vet_booking.html', section:'Pet Care' },
    { icon:'💉', title:'Vaccination Diary', desc:'Track all vaccines with calendar, reminders 7 days ahead, and PDF export.', tags:['Add vaccine record','Upcoming vaccines','Dog schedule','Cat schedule','Export PDF'], page:'10_vaccination.html', section:'Pet Care' },
    { icon:'🎓', title:'Pet Training', desc:'Video lessons, certified trainers (₹500–₹2,000), breed guides and progress tracker.', tags:['Find a trainer','Stop barking','Potty training','Puppy 101'], page:'22_training.html', section:'Pet Care' },
    { icon:'✈️', title:'Pet Travel', desc:'Airline pet policies, IRCTC guide, international travel requirements, travel checklist.', tags:['Airline rules','Train travel','International travel','Travel checklist'], page:'24_pet_travel.html', section:'Pet Care' },
    { icon:'🛍️', title:'Marketplace', desc:'Buy/sell pet food, accessories, grooming tools, toys, and responsibly-bred pets.', tags:['Browse listings','Post a listing','Pet food','Grooming tools','Safety tips'], page:'09_marketplace.html', section:'Commerce' },
    { icon:'🗺️', title:'Discover Map', desc:'Find vets, groomers, pet shops, shelters, 24hr emergency clinics near you worldwide.', tags:['Vets near me','Grooming salons','Pet shops','Boarding'], page:'26_discover.html', section:'Commerce' },
    { icon:'🛡️', title:'Pet Insurance', desc:'Plans from ₹500/month. File claims, get reimbursed in 7 days.', tags:['View plans','Get a quote','File a claim','Compare plans'], page:'21_pet_insurance.html', section:'Commerce' },
    { icon:'📺', title:'Live Streaming', desc:'Watch pet live streams or go live yourself. Chat, react with emojis, gift coins.', tags:['Watch a stream','Go Live','Emoji reactions','Gift coins'], page:'34_live.html', section:'Entertainment' },
    { icon:'📚', title:'Breeds Encyclopedia', desc:'200+ dog breeds & 80+ cat breeds with photos, temperament, health info and quiz.', tags:['Search a breed','Compare breeds','Breed quiz','Breed photos'], page:'33_breeds.html', section:'Entertainment' },
    { icon:'📊', title:'Analytics', desc:'Post engagement charts, follower growth, vaccination compliance score and PDF report.', tags:['View engagement','Follower growth','Vaccination score','Export report'], page:'25_analytics.html', section:'Account' },
    { icon:'🔔', title:'Notifications', desc:'All activity in one place — social, health reminders, marketplace, emergency alerts.', tags:['View notifications','Mark all read','Notification settings','Quiet hours'], page:'12_notifications.html', section:'Account' },
    { icon:'⚙️', title:'Settings', desc:'Password, privacy, dark mode, notification preferences, security, connected apps.', tags:['Change password','Dark mode','Privacy settings','Block a user','Delete account'], page:'14_settings.html', section:'Account' },
    { icon:'📋', title:'Complaints & Support', desc:'Report abuse or fraud (4-hr response), technical issues (24-hr response).', tags:['Report a user','Report listing','Technical bug','Contact support'], page:'', section:'Account' }
  ],

  _featVisible: false,

  toggleFeatures: function(){
    this._featVisible = !this._featVisible;
    var chatView = document.getElementById('pb-chat-view');
    var featView = document.getElementById('pb-features-view');
    var btn = document.getElementById('pb-feat-btn');
    if(this._featVisible){
      if(chatView) chatView.style.display = 'none';
      if(featView){ featView.style.display = 'flex'; this._renderFeatureCards(''); }
      if(btn) btn.style.background = '#e7f0fd';
    } else {
      if(chatView) chatView.style.display = 'flex';
      if(featView) featView.style.display = 'none';
      if(btn) btn.style.background = '';
    }
  },

  filterFeatures: function(q){
    this._renderFeatureCards(q || '');
  },

  _renderFeatureCards: function(q){
    var list = document.getElementById('pb-feat-list');
    if(!list) return;
    var query = (q || '').toLowerCase().trim();
    var features = this._FEATURES;
    if(query){
      features = features.filter(function(f){
        return f.title.toLowerCase().indexOf(query) !== -1 ||
               f.desc.toLowerCase().indexOf(query) !== -1 ||
               f.tags.some(function(t){ return t.toLowerCase().indexOf(query) !== -1; });
      });
    }
    // Group by section
    var sections = {};
    features.forEach(function(f){
      if(!sections[f.section]) sections[f.section] = [];
      sections[f.section].push(f);
    });
    var html = '';
    if(!features.length){
      html = '<div style="text-align:center;padding:24px;color:#65676b;font-size:12px">No features found for "'+q+'"</div>';
    } else {
      var sectionOrder = ['Social','Pet Care','Commerce','Entertainment','Account'];
      sectionOrder.forEach(function(sec){
        if(!sections[sec]) return;
        if(!query) html += '<div class="pb-feat-section">'+sec+'</div>';
        sections[sec].forEach(function(f){
          html += '<div class="pb-feat-card" onclick="pbAI._featAsk(\''+f.title.replace(/'/g,"\\'")+'\')">';
          html += '<div class="pb-feat-card-head"><span class="pb-feat-card-icon">'+f.icon+'</span><span class="pb-feat-card-title">'+f.title+'</span></div>';
          html += '<div class="pb-feat-card-desc">'+f.desc+'</div>';
          html += '<div class="pb-feat-card-tags">';
          f.tags.forEach(function(tag){
            html += '<span class="pb-feat-tag" onclick="event.stopPropagation();pbAI._featQuick(\''+tag.replace(/'/g,"\\'")+'\')">'+ tag+'</span>';
          });
          html += '</div>';
          if(f.page){
            html += '<div style="margin-top:6px"><a onclick="event.stopPropagation();window.location.href=\''+f.page+'\'" style="font-size:11px;color:#1877F2;font-weight:600;cursor:pointer;text-decoration:none">⤢ Open '+f.title+'</a></div>';
          }
          html += '</div>';
        });
      });
    }
    list.innerHTML = html;
  },

  _featAsk: function(title){
    this.toggleFeatures();
    this._process('Tell me everything about ' + title + ' in PawBook — features, how to use it, and how to test it.');
  },

  _featQuick: function(tag){
    this.toggleFeatures();
    this._process(tag);
  },
  // ── END FEATURES GUIDE ────────────────────────────────────────

  send: function(){
    var inp=document.getElementById('pb-ai-input');
    var text=inp.value.trim();
    if(!text) return;
    inp.value=''; inp.style.height='';
    document.getElementById('pb-send-btn').disabled=true;
    this._process(text);
  },

  quick: function(text){
    if(text === 'Browse all features'){ this.toggleFeatures(); return; }
    this._process(text);
  },

  _process: function(text){
    userMsg(text);
    showTyping();
    var self=this;

    // Add to history
    _chatHistory.push({ role: 'user', content: text });
    if(_chatHistory.length > 12) _chatHistory = _chatHistory.slice(-12);

    // Try Claude AI first
    var tok = localStorage.getItem('pb_token')||localStorage.getItem('pawbook_token')||localStorage.getItem('token')||'';
    var headers = { 'Content-Type': 'application/json' };
    if(tok) headers['Authorization'] = 'Bearer ' + tok;

    fetch(API_BASE + '/ai/chat', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ message: text, history: _chatHistory.slice(0,-1) })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      hideTyping();
      if(d.success && d.data && d.data.reply){
        // Store assistant reply in history
        _chatHistory.push({ role: 'assistant', content: d.data.reply });
        if(_chatHistory.length > 12) _chatHistory = _chatHistory.slice(-12);
        // Render — detect if reply has quick action links based on keywords
        var reply = d.data.reply;
        var pills = self._suggestPills(text);
        botMsg(reply, pills.length ? pills : null, null, null, null);
        // Speak the reply in detected language
        self._speak(reply);
      } else {
        // API returned error — fall back to KB
        self._kbFallback(text);
      }
      document.getElementById('pb-send-btn').disabled=false;
    })
    .catch(function(){
      hideTyping();
      // Network error or AI down — fall back to KB
      self._kbFallback(text);
      document.getElementById('pb-send-btn').disabled=false;
    });
  },

  // Suggest quick-reply pills based on detected intent
  _suggestPills: function(text){
    var intent = detectIntent(text);
    var pillMap = {
      lost:        ['Report lost pet','Found a pet','View alerts'],
      adoption:    ['Browse dogs','Browse cats','Find shelter'],
      vet:         ['Book now','Video consult','Emergency vet'],
      vaccination: ['Add vaccine record','Upcoming vaccines','Dog vaccine schedule'],
      emergency:   ['First aid tips','Find 24hr vet','Emergency map'],
      marketplace: ['Browse listings','Post listing','Pet food'],
      insurance:   ['View plans','Get a quote','File a claim'],
      training:    ['Find a trainer','Stop barking','Puppy guide'],
      groups:      ['Browse groups','Create group'],
      grievance:   ['Report a user','Technical bug'],
      general:     ['Lost pet','Book a vet','Emergency','Adoption']
    };
    return pillMap[intent] || [];
  },

  // KB-based fallback when Claude is unavailable
  _kbFallback: function(text){
    var intent = detectIntent(text);
    var entry = KB[intent];
    var opts = { _user: _currentUser ? (_currentUser.full_name||_currentUser.username) : null };
    var r = entry.a(opts, String(text).toLowerCase());
    if(r.loginPrompt){
      loginPromptMsg();
    } else {
      botMsg('(Offline mode) ' + r.t, r.pills, null, r.page, r.pageLabel);
    }
  },

  handleKey: function(e){
    if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); this.send(); }
  },

  autoResize: function(el){
    el.style.height='auto';
    el.style.height=Math.min(el.scrollHeight,90)+'px';
  },

  clearChat: function(){
    var msgs=document.getElementById('pb-ai-msgs');
    if(msgs) msgs.innerHTML='';
    _greeted=false;
    _chatHistory=[];
    this._greet();
  },

  openFull: function(){
    window.location.href='35_ai_agent.html';
  },

  // ── LOGIN VIEW ──────────────────────────────────────────────
  showLoginView: function(reg){
    document.getElementById('pb-chat-view').style.display='none';
    document.getElementById('pb-login-view').style.display='flex';
    if(reg) this.showRegister();
    else this.showLoginForm();
  },

  showChat: function(){
    document.getElementById('pb-login-view').style.display='none';
    document.getElementById('pb-chat-view').style.display='flex';
  },

  showRegister: function(){
    document.getElementById('pb-email-login').style.display='none';
    document.getElementById('pb-email-register').style.display='block';
    document.getElementById('pb-login-err').style.display='none';
  },

  showLoginForm: function(){
    document.getElementById('pb-email-register').style.display='none';
    document.getElementById('pb-email-login').style.display='block';
    document.getElementById('pb-login-err').style.display='none';
  },

  _loginErr: function(msg){
    var el=document.getElementById('pb-login-err');
    el.textContent=msg; el.style.display='block';
  },

  _loginSuccess: function(tok, ud, provider){
    localStorage.setItem('pb_token', tok);
    localStorage.setItem('pb_user', JSON.stringify(ud));
    _currentUser=ud;
    this.showChat();
    // Notify parent page if it has renderUserChip
    if(typeof renderUserChip==='function') renderUserChip();
    if(typeof loadUser==='function') loadUser();
    var name=ud.full_name||ud.username||'friend';
    botMsg('Welcome'+(provider?' ('+provider+')':'')+', '+name+'! 🐾 You\'re signed in.\n\nHow can I help you today?',
      ['My pet profile','Track vaccinations','Book a vet','Find lost pets']);
  },

  socialLogin: function(provider){
    // Real OAuth would open a popup here
    // Demo: simulate successful login
    var self=this;
    var btn=document.querySelector('.pb-social-btn'+(provider==='facebook'?'.fb':''));
    if(btn){ btn.textContent='Connecting…'; btn.disabled=true; }
    setTimeout(function(){
      if(btn){ btn.innerHTML=provider==='google'
        ? '<svg width="17" height="17" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg> Continue with Facebook';
        btn.disabled=false; }
      var demo={full_name:'Pet Parent', username:'petparent', email:'demo@pawbook.app'};
      self._loginSuccess('demo_'+provider, demo, provider.charAt(0).toUpperCase()+provider.slice(1));
    },1400);
  },

  emailLogin: function(){
    var email=document.getElementById('pb-w-email').value.trim();
    var pass=document.getElementById('pb-w-pass').value;
    if(!email||!pass){ this._loginErr('Enter email and password.'); return; }
    var btn=document.getElementById('pb-w-submit');
    btn.disabled=true; btn.textContent='Signing in…';
    var self=this;
    fetch(API_BASE+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,password:pass})})
    .then(function(r){return r.json();})
    .then(function(d){
      btn.disabled=false; btn.textContent='Sign In';
      if(d.token||(d.data&&d.data.token)){
        var tok=d.token||d.data.token;
        var ud=d.user||d.data||{};
        self._loginSuccess(tok,ud,'');
      } else { self._loginErr(d.message||'Invalid email or password.'); }
    })
    .catch(function(){
      btn.disabled=false; btn.textContent='Sign In';
      // Demo fallback
      if(email==='abhishek@pawbook.app'){
        self._loginSuccess('demo_email',{full_name:'Abhishek',username:'abhishek',email:email},'');
      } else { self._loginErr('Could not connect. Try again.'); }
    });
  },

  doRegister: function(){
    var name=document.getElementById('pb-w-name').value.trim();
    var email=document.getElementById('pb-w-reg-email').value.trim();
    var pass=document.getElementById('pb-w-reg-pass').value;
    if(!name||!email||!pass){ this._loginErr('Fill all fields.'); return; }
    if(pass.length<6){ this._loginErr('Password min 6 characters.'); return; }
    var btn=document.getElementById('pb-w-reg-submit');
    btn.disabled=true; btn.textContent='Creating…';
    var self=this;
    fetch(API_BASE+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:name,email:email,password:pass})})
    .then(function(r){return r.json();})
    .then(function(d){
      btn.disabled=false; btn.textContent='Create Account';
      if(d.token||(d.data&&d.data.token)){
        var tok=d.token||d.data.token;
        var ud=d.user||d.data||{full_name:name,email:email};
        self._loginSuccess(tok,ud,'');
      } else { self._loginErr(d.message||'Registration failed.'); }
    })
    .catch(function(){
      btn.disabled=false; btn.textContent='Create Account';
      self._loginErr('Could not connect. Try again.');
    });
  }
};

// Show the badge dot after 2 seconds (tease first-time users)
setTimeout(function(){
  if(!_open){
    var badge=document.getElementById('pb-fab-badge');
    if(badge) badge.classList.add('show');
  }
}, 2000);

})(); // end IIFE
