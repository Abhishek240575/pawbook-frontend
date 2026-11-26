/**
 * PawBook AI Widget — floating assistant on every PawBook page.
 * Include once at the bottom of <body>: <script src="pawbook-ai-widget.v4.js?v=8"></script>
 * v5 brain: signed-in people get the real PawBook Assistant (/api/v1/assistant — their pets, vaccines due, appointments,
 * real listings, Google Maps places near them, support requests; Claude when the server has the AI key). Guests and
 * offline moments get safe built-in answers. It knows which page it is on, and never invents listings, counts or prices.
 */
(function(){
'use strict';

if(window.__PAWBOOK_AI_WIDGET__) return;
window.__PAWBOOK_AI_WIDGET__ = true;
window.__PAWBOOK_AI_VERSION__ = 'v5-20261126-assistant';

var API_BASE = 'https://pawbook.deemona.com/api/v1';

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

/* ── v5 additions ── */
.pb-ai-locbar{display:flex;align-items:center;gap:6px;padding:6px 12px;background:#f7f8fa;border-bottom:1px solid #e4e6eb;font-family:'Inter',sans-serif;font-size:11px;color:#65676b;flex-shrink:0;overflow:hidden;white-space:nowrap}
.pb-ai-locbar button{border:none;background:#fff;border:1px solid #e4e6eb;border-radius:999px;padding:3px 9px;font:600 11px 'Inter',sans-serif;color:#1877F2;cursor:pointer;max-width:58%;overflow:hidden;text-overflow:ellipsis}
.pb-ai-locbar span{overflow:hidden;text-overflow:ellipsis;min-width:0}
.pb-ai-locbar .pb-signin{margin-left:auto;background:#1877F2;color:#fff;border-color:#1877F2;flex-shrink:0}
.pb-msg-body{min-width:0;max-width:100%}
.pb-msg.past{opacity:.72}
.pb-div{align-self:center;font:700 10px 'Inter',sans-serif;color:#8a8d91;text-transform:uppercase;letter-spacing:.5px;padding:4px 0}
.pb-cards{display:flex;gap:8px;overflow-x:auto;padding:6px 0 4px;scroll-snap-type:x mandatory;max-width:290px}
.pb-cards::-webkit-scrollbar{height:3px}.pb-cards::-webkit-scrollbar-thumb{background:#d0d3d8;border-radius:3px}
.pb-card{flex:0 0 150px;scroll-snap-align:start;border:1px solid #e4e6eb;border-radius:12px;overflow:hidden;background:#fff;text-decoration:none;color:#050505;display:flex;flex-direction:column;font-family:'Inter',sans-serif}
.pb-card-im{height:74px;background:#eef3fb;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.pb-card-im img{width:100%;height:100%;object-fit:cover}
.pb-card-im b{font-size:28px}
.pb-card-im span{position:absolute;left:6px;top:6px;background:rgba(0,0,0,.6);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:999px}
.pb-card-bd{padding:7px 8px 8px;display:flex;flex-direction:column;gap:2px;font-size:11px;line-height:1.35}
.pb-card-bd b{font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pb-card-bd .s{color:#65676b;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pb-card-bd .mt{color:#8a8d91}
.pb-card-bd .pr{font-weight:800;color:#050505}
.pb-card-bd .go{color:#1877F2;font-weight:700;margin-top:2px}
.pb-card.g .pb-card-im{height:44px;background:#f0f7f0}
.pb-card .gl{display:flex;gap:6px;margin-top:4px}
.pb-card .gl a{flex:1;text-align:center;border:1px solid #1877F2;color:#1877F2;border-radius:7px;padding:3px 0;font-weight:700;text-decoration:none}
.pb-gattr{font:500 10px 'Inter',sans-serif;color:#8a8d91;padding:0 2px 2px}
.pb-gload{font:500 11px 'Inter',sans-serif;color:#65676b;padding:6px 2px}
.pb-gload a{color:#1877F2;font-weight:700}
.pb-acts{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.pb-act{display:inline-flex;align-items:center;gap:3px;padding:6px 10px;border-radius:8px;background:#e7f0fd;color:#1877F2;border:none;font:700 11px 'Inter',sans-serif;cursor:pointer;text-decoration:none}
.pb-act:hover{background:#d3e4fc}
.pb-act.pri{background:#1877F2;color:#fff}
.pb-act.sos{background:#fee2e2;color:#b91c1c}
.pb-fb{border:none;background:none;cursor:pointer;font-size:11px;padding:0 2px;opacity:.45;filter:grayscale(1)}
.pb-fb:hover,.pb-fb.on{opacity:1;filter:none}
.pb-sup{display:flex;flex-direction:column;gap:6px;margin-top:4px;background:#fff;border:1px solid #e4e6eb;border-radius:12px;padding:10px;width:250px;max-width:100%}
.pb-sup textarea{resize:vertical;min-height:60px}
.pb-sup-err{color:#dc2626;font:600 11px 'Inter',sans-serif}
.pb-sup-ok{background:#ecfdf3;color:#067647;border-radius:10px;padding:8px 10px;font:600 12px 'Inter',sans-serif}
.pb-feat-open{margin-left:auto;font:700 11px 'Inter',sans-serif;color:#1877F2;text-decoration:none}
button.pb-feat-tag{border:none;font-family:'Inter',sans-serif}
.pb-loc-form{padding:14px 16px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1;font-family:'Inter',sans-serif}
.pb-loc-form h3{font-size:15px;font-weight:800;color:#050505;margin:2px 0 0}
.pb-loc-form p{font-size:12px;color:#65676b;margin:0}
.pb-loc-form label{font:700 11px 'Inter',sans-serif;color:#65676b;display:flex;flex-direction:column;gap:3px}
.pb-loc-row{display:flex;gap:8px}.pb-loc-row label{flex:1;min-width:0}
.pb-loc-msg{font:600 11px 'Inter',sans-serif;color:#1877F2;min-height:14px}
.pb-gps{width:100%;padding:9px;border-radius:10px;border:1.5px dashed #1877F2;background:#f5f9ff;color:#1877F2;font:700 12px 'Inter',sans-serif;cursor:pointer}
.pb-ghost{background:none;border:none;color:#dc2626;font:700 12px 'Inter',sans-serif;cursor:pointer;padding:4px}
.pb-note{font:500 11px 'Inter',sans-serif;color:#8a8d91;text-align:center}
@media (prefers-reduced-motion: reduce){#pb-ai-fab{animation:none}#pb-ai-panel{transition:none}}
`;
var styleEl = document.createElement('style');
styleEl.textContent = CSS;
document.head.appendChild(styleEl);

// ═══════════════════════════════════════════════════════════════
//  INJECT HTML
// ═══════════════════════════════════════════════════════════════
var HTML = `
<!-- FAB -->
<button id="pb-ai-fab" onclick="pbAI.toggle()" aria-label="PawBook AI assistant" aria-expanded="false" aria-controls="pb-ai-panel">
  <span class="pb-fab-icon">🤖</span>
  <span class="pb-fab-badge" id="pb-fab-badge"></span>
</button>

<!-- PANEL -->
<div id="pb-ai-panel" role="dialog" aria-label="PawBook AI">
  <div class="pb-ai-head">
    <div class="pb-ai-head-av">🐾</div>
    <div class="pb-ai-head-info">
      <div class="pb-ai-head-name">PawBook AI</div>
      <div class="pb-ai-head-status" id="pb-ai-status"><span class="pb-ai-head-dot"></span> Online</div>
    </div>
    <div class="pb-ai-head-actions">
      <button class="pb-ai-head-btn pb-tts-toggle" id="pb-tts-toggle" onclick="pbAI.toggleTTS()" title="Read replies aloud" aria-label="Read replies aloud">🔇</button>
      <button class="pb-ai-head-btn" id="pb-feat-btn" onclick="pbAI.toggleFeatures()" title="Browse PawBook features" aria-label="Browse PawBook features">📋</button>
      <button class="pb-ai-head-btn" onclick="pbAI.clearChat(this)" title="Clear conversation" aria-label="Clear conversation">🗑</button>
      <button class="pb-ai-head-btn" onclick="pbAI.openFull()" title="Open the full Assistant" aria-label="Open the full Assistant">⤢</button>
      <button class="pb-ai-head-btn" onclick="pbAI.toggle()" title="Close" aria-label="Close">✕</button>
    </div>
  </div>
  <div class="pb-ai-locbar" id="pb-ai-locbar"></div>

  <!-- Chat view -->
  <div id="pb-chat-view" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
    <div class="pb-ai-msgs" id="pb-ai-msgs" aria-live="polite"></div>
    <div class="pb-voice-bar" id="pb-voice-bar">🎙 Listening… <span id="pb-voice-interim" style="font-weight:400;margin-left:4px;opacity:.7"></span></div>
    <div class="pb-ai-input-row">
      <button class="pb-mic-btn" id="pb-mic-btn" onclick="pbAI.toggleVoice()" title="Speak your question" aria-label="Speak your question">🎙</button>
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
        <textarea id="pb-ai-input" placeholder="Ask me anything…" rows="1" maxlength="1000" aria-label="Your message"
          onkeydown="pbAI.handleKey(event)" oninput="pbAI.autoResize(this)"></textarea>
      </div>
      <button class="pb-send-btn" id="pb-send-btn" onclick="pbAI.send()" aria-label="Send">➤</button>
    </div>
  </div>

  <!-- Features guide -->
  <div id="pb-features-view" style="display:none;flex-direction:column;flex:1;overflow:hidden">
    <div style="padding:10px 12px 6px;border-bottom:1px solid #e4e6eb">
      <input id="pb-feat-search" type="text" placeholder="🔍 Search features…" oninput="pbAI.filterFeatures(this.value)" aria-label="Search features"
        style="width:100%;box-sizing:border-box;padding:7px 12px;border-radius:20px;border:1.5px solid #e4e6eb;font-size:12px;font-family:'Inter',sans-serif;outline:none"/>
    </div>
    <div id="pb-feat-list" style="flex:1;overflow-y:auto;padding:8px 10px"></div>
    <div style="padding:8px 12px;border-top:1px solid #e4e6eb;text-align:center">
      <button class="pb-back-btn" style="margin:0 auto" onclick="pbAI.toggleFeatures()">← Back to chat</button>
    </div>
  </div>

  <!-- Location -->
  <div id="pb-loc-view" style="display:none;flex-direction:column;flex:1;overflow:hidden">
    <form class="pb-loc-form" id="pb-loc-form" onsubmit="pbAI.saveLocation(event)" autocomplete="off">
      <button type="button" class="pb-back-btn" onclick="pbAI.showChat()">← Back to chat</button>
      <h3>📍 Where are you?</h3>
      <p>Used for vets, groomers, shelters and pets near you. It stays on this device and is shared with the Assistant page.</p>
      <button type="button" class="pb-gps" onclick="pbAI.useGps(this)">🎯 Use my current location</button>
      <label>City<input class="pb-finput" name="city" maxlength="80" placeholder="e.g. New Delhi, Pune"></label>
      <label>Area / locality<input class="pb-finput" name="area" maxlength="100" placeholder="e.g. Dwarka Sector 10"></label>
      <div class="pb-loc-row"><label>PIN code<input class="pb-finput" name="pin" inputmode="numeric" maxlength="6" placeholder="6 digits"></label><label>State<input class="pb-finput" name="state" maxlength="80" placeholder="optional"></label></div>
      <input type="hidden" name="lat"><input type="hidden" name="lng">
      <div class="pb-loc-msg" id="pb-loc-msg"></div>
      <button class="pb-fsubmit" type="submit">Save location</button>
      <button type="button" class="pb-ghost" id="pb-loc-clear" onclick="pbAI.clearLocation()">Clear my location</button>
    </form>
  </div>

  <!-- Sign in -->
  <div id="pb-login-view" style="display:none;flex-direction:column;flex:1;overflow:hidden">
    <div class="pb-login-form" id="pb-login-inner">
      <button class="pb-back-btn" onclick="pbAI.showChat()">← Back to chat</button>
      <div style="text-align:center;font-size:36px;margin:4px 0">🐾</div>
      <h3>Sign in to PawBook</h3>
      <p>So I can use your pets, vaccinations, bookings and orders</p>
      <div id="pb-login-err" class="pb-ferr" role="alert"></div>
      <a class="pb-social-btn" href="01_login.html" style="text-decoration:none;color:#050505"><svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google</a>
      <div class="pb-note">Opens the PawBook sign-in page</div>
      <div class="pb-divider">or email</div>
      <div id="pb-email-login">
        <input class="pb-finput" type="email" id="pb-w-email" placeholder="Email" autocomplete="email" style="margin-bottom:8px">
        <input class="pb-finput" type="password" id="pb-w-pass" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key==='Enter')pbAI.emailLogin()" style="margin-bottom:8px">
        <button class="pb-fsubmit" id="pb-w-submit" onclick="pbAI.emailLogin()">Sign In</button>
        <div class="pb-fswitch" style="margin-top:8px"><a href="01_login.html">Forgot password?</a> · New here? <a onclick="pbAI.showRegister()">Create account</a></div>
      </div>
      <div id="pb-email-register" style="display:none">
        <input class="pb-finput" type="text" id="pb-w-name" placeholder="Full name" autocomplete="name" style="margin-bottom:8px">
        <input class="pb-finput" type="email" id="pb-w-reg-email" placeholder="Email" autocomplete="email" style="margin-bottom:8px">
        <input class="pb-finput" type="password" id="pb-w-reg-pass" placeholder="Password (min 6 characters)" autocomplete="new-password" onkeydown="if(event.key==='Enter')pbAI.doRegister()" style="margin-bottom:8px">
        <button class="pb-fsubmit" id="pb-w-reg-submit" onclick="pbAI.doRegister()">Create Account</button>
        <div class="pb-fswitch" style="margin-top:8px">Have an account? <a onclick="pbAI.showLoginForm()">Sign in</a></div>
      </div>
    </div>
  </div>
</div>
`;
var container = document.createElement('div');
container.innerHTML = HTML;
document.body.appendChild(container);

// ═══════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════
var _open = false, _typing = false, _greeted = false, _busy = false;
var _currentUser = null, _token = '', _state = null, _stateAt = 0, _mode = 'guest';   // guest | live
var _loc = null, _gh = {}, _ghN = 0, _gmp = null, _lastQ = '';

function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k, v){ try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch(e){} }
function ssGet(k){ try { return sessionStorage.getItem(k); } catch(e){ return null; } }
function ssSet(k, v){ try { sessionStorage.setItem(k, v); } catch(e){} }

function readSession(){
  _token = lsGet('pb_token') || lsGet('pawbook_token') || lsGet('token') || '';
  // the old widget made fake "demo_" sign-ins — those are not real accounts, so drop them
  if (/^demo_/.test(_token)) { lsSet('pb_token', null); lsSet('pb_user', null); _token = ''; }
  try { _currentUser = JSON.parse(lsGet('pb_user') || 'null'); } catch(e){ _currentUser = null; }
  _mode = _token ? 'live' : 'guest';
}
function readLoc(){
  var l = null;
  try { l = JSON.parse(lsGet('pb_assist_loc') || 'null'); } catch(e){}
  if (!l || !(l.city || l.state || l.pin)) { try { var a = JSON.parse(lsGet('pb_adopt_loc') || 'null'); if (a && (a.city || a.pin)) l = {country: a.country || 'India', state: a.state || '', city: a.city || '', area: a.area || '', pin: a.pin || '', lat: a.lat, lng: a.lng}; } catch(e){} }
  _loc = l && (l.city || l.state || l.pin) ? l : null;
}
function locLabel(l){ l = l || _loc; if (!l) return ''; return [l.area, l.city].filter(Boolean).join(', ') || l.state || ('PIN ' + l.pin); }
function userName(){ var u = _currentUser || {}; var n = (_state && _state.name) || u.full_name || u.name || u.username || ''; return String(n).trim().split(/\s+/)[0] || ''; }

// ═══════════════════════════════════════════════════════════════
//  WHERE AM I — page awareness (the widget knows which page it is on)
// ═══════════════════════════════════════════════════════════════
var PAGE = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
var PAGE_CTX = {
  '07_home.html':            ['Home feed', 'Your feed of posts from pet parents you follow and the communities you are in.', ['Find a vet near me', 'Pets for adoption', 'When are my pet\'s vaccines due?']],
  '08_pet_profile.html':     ['Pet profile', 'Your pet\'s profile — photos, details and health information.', ['When are my pet\'s vaccines due?', 'Book a vet', 'Diet for my dog']],
  '09_marketplace.html':     ['Marketplace', 'Buy and sell pet products.', ['Dog food', 'Cat litter', 'My orders']],
  '10_vaccination.html':     ['Vaccinations', 'Keep your pet\'s vaccination records and see which doses are due.', ['When are my pet\'s vaccines due?', 'Puppy vaccine schedule', 'Book a vaccination visit']],
  '11_vet_booking.html':     ['Book a vet', 'Find vets listed on PawBook, book a visit and see your appointments.', ['Find a vet near me', 'My appointments', 'My dog is vomiting']],
  '12_notifications.html':   ['Notifications', 'Everything that needs your attention — replies, reminders and updates.', ['When are my pet\'s vaccines due?', 'My appointments', 'Raise a support request']],
  '13_messages.html':        ['Messages', 'Your private chats with other pet parents.', ['How do I report a user?', 'Communities near me']],
  '14_settings.html':        ['Settings', 'Your account, privacy, password and notification choices.', ['How do I delete my account?', 'I can\'t sign in', 'Raise a support request']],
  '16_vet_profile.html':     ['Vet profile', 'A vet\'s details, timings and booking.', ['My appointments', 'Find a vet near me']],
  '19_order_confirmation.html': ['Order confirmation', 'The details of the order you just placed.', ['My orders', 'Problem with my order']],
  '20_shelter_detail.html':  ['Shelter', 'A shelter\'s details and the pets they have for adoption.', ['How does adoption work?', 'Pets for adoption']],
  '21_pet_insurance.html':   ['Pet insurance', 'Pet insurance options. Always check exclusions, waiting periods and the claim process.', ['What should I check before buying pet insurance?', 'Book a vet']],
  '22_training.html':        ['Training & behaviour', 'Training guides for good manners and common problems.', ['How do I stop my dog pulling on the leash?', 'Potty training a puppy', 'My puppy bites']],
  '23_nutrition.html':       ['Meal planner', 'Meal plans and recipes for your pet.', ['Foods dogs must never eat', 'How much should my puppy eat?', 'Dog food']],
  '24_pet_travel.html':      ['Pet travel', 'Guides for travelling with your pet.', ['Travelling with my dog by train', 'Find pet boarding near me']],
  '25_analytics.html':       ['Analytics', 'How your posts and profile are doing.', ['Communities near me', 'Events near me']],
  '26_discover.html':        ['Discover', 'Find pet places near you on the map.', ['Pet groomers near me', 'Find pet boarding near me', 'Find a vet near me']],
  '27_register_business.html': ['Register a business', 'List your pet business on PawBook.', ['How do I sell on PawBook?', 'Raise a support request']],
  '27_stories.html':         ['Stories', 'Short photo and video stories from pet parents.', ['Communities near me', 'Events near me']],
  '28_reels.html':           ['Reels', 'Short pet videos.', ['Communities near me', 'Events near me']],
  '29_user_profile.html':    ['Profile', 'A pet parent\'s profile, pets and posts.', ['How do I report a user?', 'My pets']],
  '30_events.html':          ['Events', 'Pet meetups, adoption drives, camps and shows.', ['Events near me', 'Adoption drives']],
  '31_saved.html':           ['My PawBook', 'Things you have saved.', ['My pets', 'My orders']],
  '32_gallery.html':         ['Gallery', 'Your photos and videos.', ['My pets']],
  '33_breeds.html':          ['Breeds', 'Learn about dog and cat breeds.', ['Which dog breed suits a small flat?', 'Pets for adoption']],
  '34_live.html':            ['Live', 'Live videos from pet parents.', ['Communities near me', 'Events near me']],
  '35_pawmatch.html':        ['PawMatch', 'Find playdates, walk buddies and companions for your pet, then fix a date.', ['How does PawMatch work?', 'Is PawMatch safe?', 'Events near me']],
  '36_pet_life_record.html': ['My pets & health records', 'Your pets\' records — vaccinations, medicines and vet visits.', ['When are my pet\'s vaccines due?', 'My appointments', 'Book a vet']],
  '38_lost_pet_network.html':['Lost & Found', 'Report a lost or found pet and see cases near you.', ['My dog is missing — what should I do?', 'I found a pet', 'Lost pets near me']],
  '39_adoption_matching.html': ['Adopt a pet', 'Pets looking for homes, adoption rules and documents, and shelters near you.', ['What documents do I need to adopt?', 'Pets for adoption in my city', 'How does adoption work?']],
  '40_voice_pet_assistant.html': ['Voice assistant', 'Talk to the assistant using your voice.', ['Find a vet near me', 'When are my pet\'s vaccines due?']],
  'account-deletion.html':   ['Account deletion', 'How to delete your PawBook account and data.', ['How do I delete my account?', 'Raise a support request']],
  'privacy-policy.html':     ['Privacy policy', 'How PawBook handles your data.', ['How do I delete my account?', 'Raise a support request']],
  'legal.html':              ['Legal', 'PawBook\'s terms and policies.', ['Raise a support request']],
  'reset_password.html':     ['Reset password', 'Set a new password for your account.', ['I can\'t sign in', 'Raise a support request']]
};
function pageCtx(){ return PAGE_CTX[PAGE] || null; }

// ═══════════════════════════════════════════════════════════════
//  PAWBOOK PAGES the widget may link to (the same list the Assistant uses)
// ═══════════════════════════════════════════════════════════════
var P = {
  home: ['07_home.html', 'Home feed'], pets: ['36_pet_life_record.html', 'My pets & health records'], vacc: ['10_vaccination.html', 'Vaccinations'],
  vet: ['11_vet_booking.html', 'Book a vet'], appts: ['11_vet_booking.html?tab=appointments', 'My appointments'], health: ['37_pet_ai_health_agent.html', 'AI health check'],
  sos: ['37_pet_ai_health_agent.html?sos=1', 'Open Emergency SOS'], nearby: ['37_pet_ai_health_agent.html?tab=nearby', 'Nearby help (map)'], lost: ['38_lost_pet_network.html', 'Lost & Found'],
  adopt: ['39_adoption_matching.html', 'Adopt a pet'], shop: ['42_shop.html', 'Pet shop'], orders: ['53_shop_orders.html', 'My orders'], groups: ['03_groups.html', 'Communities'],
  events: ['30_events.html', 'Events'], search: ['15_search.html', 'Search'], abuse: ['36_abuse_reporting.html', 'Report animal cruelty'], training: ['22_training.html', 'Training & behaviour'],
  nutrition: ['23_nutrition.html', 'Meal planner'], travel: ['24_pet_travel.html', 'Pet travel'], insurance: ['21_pet_insurance.html', 'Pet insurance'], settings: ['14_settings.html', 'Settings'],
  breeds: ['33_breeds.html', 'Breeds'], pawmatch: ['35_pawmatch.html', 'PawMatch'], discover: ['26_discover.html', 'Discover map'], seller: ['49_seller_join.html', 'Sell on PawBook'],
  assistant: ['35_ai_agent.html', 'Full Assistant'], login: ['01_login.html', 'Sign in']
};
function act(k, label){ return {label: label || P[k][1], url: P[k][0]}; }

// ═══════════════════════════════════════════════════════════════
//  LOCAL BRAIN — instant, safe answers. Used for guests, when PawBook can't be reached,
//  for questions about the page you're on, and for emergencies (never waits for the network).
//  It never makes up listings, counts, prices, ratings or phone numbers.
// ═══════════════════════════════════════════════════════════════
var RX = [
  ['emergency', /\b(emergenc\w*|urgent(ly)?|bleed\w*|blood|poison\w*|toxic|not breathing|can'?t breathe|cannot breathe|breathing (hard|fast|difficult)|unconscious|collaps\w*|seizure\w*|fits?\b|convuls\w*|hit by|accident|heat ?stroke|choking|swallowed|bitten by (a )?snake|snake ?bite|dying|(ate|eaten|swallowed) (some )?(chocolate|grapes|raisins|xylitol|rat poison|medicine|tablets?))\b/i],
  ['abuse', /\b(abuse\w*|cruel\w*|beating|beaten|torture\w*|neglect\w*|chained|starv\w*)\b/i],
  ['pagehelp', /\b(this page|this screen|here\b.*(do|use)|how (do|can) i use (this|it)|what can i do here|what is this page|help me with this page)\b/i],
  ['lost', /\b(lost|missing|ran away|run away|found a (dog|cat|pet|puppy|kitten)|i found|stray)\b/i],
  ['adopt', /\b(adopt\w*|societ(y|ies)|landlord|rescue|rehom\w*|foster\w*|shelter dogs?|pets? for adoption)\b/i],
  ['places', /\b(groom\w*|boarding|kennel|daycare|day care|pet ?(shop|store)s?|shelters?|pet hotel|sitter)\b.*\b(near|nearby|around|in my|close)\b|\b(near|nearby|around)\b.*\b(groom\w*|boarding|kennel|daycare|pet ?(shop|store)s?|shelters?)\b/i],
  ['vacc', /\b(vaccin\w*|booster|rabies|deworm\w*|due (date|dose)|shots?)\b/i],
  ['vet', /\b(vets?|veterinar\w*|doctor|clinic|hospital|appointment|consult\w*|vomit\w*|diarrh\w*|limp\w*|not eating|sick|ill\b|fever|itch\w*|tick|flea)\b/i],
  ['orders', /\b(my orders?|order status|track(ing)? (my )?order|delivery|refund|return (my|an|the) order)\b/i],
  ['training', /\b(train\w*|potty|toilet|bark\w*|bit(e|es|ing)|chew\w*|pull\w* .*leash|leash .*pull\w*|behaviou?r|aggress\w*|commands?|sit\b|recall)\b/i],
  ['nutrition', /\b(diet|meal|nutrition|feed(ing)?|how much .*eat|can (dogs?|cats?) eat|chocolate|grapes|onion)\b/i],
  ['shop', /\b(shop|buy|offers?|discounts?|deals?|cheap\w*|price|brush|comb|food|kibble|treats?|toys?|litter|leash|harness|collar|bed|shampoo|accessor\w*)\b/i],
  ['pawmatch', /\b(paw ?match|playdate|play date|walk buddy|mate|mating|breeding partner|match ?making)\b/i],
  ['groups', /\b(communit\w*|groups?|club|pet parents near)\b/i],
  ['events', /\b(events?|meetups?|adoption drive|camp|show)\b/i],
  ['travel', /\b(travel\w*|flight|train journey|by train|airline|trip)\b/i],
  ['insurance', /\b(insur\w*|policy|claim)\b/i],
  ['breeds', /\b(breeds?|which dog|which cat|labrador|indie|pug|beagle|shih tzu|persian)\b/i],
  ['account', /\b(account|password|sign ?in|log ?in|sign ?up|register|profile|privacy|delete my|notification settings)\b/i],
  ['support', /\b(complain\w*|grievance|scam\w*|fraud\w*|harass\w*|not working|bug|error|support|customer care|talk to (a )?(human|person|someone)|report a user)\b/i],
  ['thanks', /^\s*(thanks|thank you|thx|ty|great|ok(ay)?|cool|nice)\b/i],
  ['greet', /^\s*(hi|hello|hey|namaste|hii+|good (morning|afternoon|evening))\b/i]
];
var ADVICE = {training: 1, nutrition: 1, travel: 1, breeds: 1, pawmatch: 1, insurance: 1};   // general advice the built-in guide covers well
function detectIntent(s){ for (var i = 0; i < RX.length; i++) if (RX[i][1].test(s)) return RX[i][0]; return 'general'; }
var GKIND = [   // what to look up on Google Maps (in the browser) — kind, words, emoji, text query
  [/groom/i, 'groomer', 'pet groomers', '✂️', 'pet grooming'], [/boarding|kennel|daycare|day care|hotel|sitter/i, 'boarding', 'pet boarding places', '🏨', 'pet boarding'],
  [/shop|store/i, 'petstore', 'pet shops', '🛍️', 'pet shop'], [/shelter/i, 'shelter', 'animal shelters', '🏠', 'animal shelter'], [/./, 'vet', 'vet clinics', '🩺', 'veterinary clinic']
];
function gHint(msg, intent){
  if (!_loc) return null;
  var k = intent === 'vet' ? GKIND[GKIND.length - 1] : (GKIND.filter(function(x){ return x[0].test(msg); })[0] || GKIND[GKIND.length - 1]);
  var near = locLabel();
  return {kind: k[1], word: k[2], emoji: k[3], text: k[4], lat: _loc.lat != null ? _loc.lat : null, lng: _loc.lng != null ? _loc.lng : null,
    address: [_loc.area, _loc.city, _loc.state, _loc.pin, _loc.country || 'India'].filter(Boolean).join(', '), near: near};
}
function signInLine(){ return _mode === 'live' ? '' : '\n\n🔐 **Sign in** and I can also use your own pets, vaccinations, appointments and PawBook listings.'; }

function localReply(msg){
  var intent = detectIntent(msg), m = msg.toLowerCase(), r = {intent: intent, text: '', actions: [], suggestions: []};
  var near = /\b(near ?me|nearby|around me|close to me|my (city|area))\b/i.test(msg);
  switch (intent) {
    case 'emergency':
      r.text = '🚨 **This sounds urgent — please don\'t wait.**\n• Take your pet to the **nearest vet or 24-hour animal hospital now**, and call them on the way.\n• Keep your pet calm, warm and still. Don\'t give human medicines.\n• For heatstroke: move to shade, cool with normal (not ice-cold) water, and go to a vet.\n• If a person is in danger, call **112**.\n\nOpen **Emergency SOS** for first aid steps and vets near you.';
      r.actions = [act('sos'), act('nearby', 'Vets near me (map)'), {label: 'Call 112', url: 'tel:112'}];
      r.suggestions = ['First aid for heatstroke', 'Find a vet near me']; r.noNet = true; break;
    case 'abuse':
      r.text = 'If an animal is being hurt right now, call **112**. Then report it on **Report animal cruelty** with photos, the place and the time. Keep yourself safe — don\'t confront anyone.';
      r.actions = [act('abuse'), {label: 'Call 112', url: 'tel:112'}]; break;
    case 'pagehelp':
      var c = pageCtx();
      r.text = c ? ('You\'re on **' + c[0] + '**. ' + c[1] + '\n\nAsk me anything about it, or try one of these:') : 'Ask me anything about PawBook — vets, vaccinations, adoption, lost & found, the shop, training or your account.';
      r.suggestions = c ? c[2] : ['Find a vet near me', 'Pets for adoption']; break;
    case 'lost':
      if (/found/.test(m)) { r.text = 'Thank you for helping! 🐾\n• Keep the pet safe, give water, and check for a collar or tag.\n• A vet can scan for a **microchip** for free or a small fee.\n• Post it on **Lost & Found** as a found pet with a clear photo and the place — owners nearby can see it.'; r.actions = [{label: 'I found a pet', url: '38_lost_pet_network.html?found=1'}, act('lost', 'See lost pets')]; }
      else { r.text = 'I\'m sorry — let\'s act fast. 🐾\n• **Report it on Lost & Found** now with a clear photo, the last place you saw your pet and the time.\n• Search the area at once, calling their name — most pets hide close by.\n• Tell nearby vets, shelters, guards and shopkeepers, and put up posters.\n• Check the lost & found cases every day — someone may have found your pet.'; r.actions = [act('lost', 'Report a lost pet'), {label: 'I found a pet', url: '38_lost_pet_network.html?found=1'}]; }
      r.suggestions = ['Lost pets near me', 'Find a vet near me']; break;
    case 'adopt':
      // the same policy / rules / documents / compliance as the Adopt a pet page (page 39)
      if (/document|docs?\b|paper|proof|\bid\b|agreement|bring|kyc/.test(m)) r.text = '**Adoption documents** — keep these ready:\n• **Your ID** — a government photo ID (voter ID, passport or driving licence). You don\'t need to share an Aadhaar number on PawBook.\n• **Address proof** — a utility bill or rent agreement.\n• **Landlord or society permission** (if you rent) — a message or letter saying pets are allowed.\n• **Signed adoption agreement** — you and the rescuer both sign it; keep a copy.\n• **Pet health records** you receive — vaccination card, deworming record, and sterilisation certificate and microchip number if done.\n• **After adoption** — register or license your dog if your city requires it.';
      else if (/rule|eligib|age|who can|requirement|criteria/.test(m)) r.text = '**Adoption rules** — every adopter agrees to:\n• Be **18 or older**, with everyone at home agreeing\n• **Meet the pet** first and allow a home visit if asked\n• **Lifelong care** — food, water, shelter, exercise, vet care\n• Keep **vaccinations and deworming** up to date\n• **Never sell, breed for sale or pass on** the pet — return them to the rescuer if needed\n• Share updates for the agreed period';
      else if (/fee|cost|price|pay|money|charge|polic|process|how does|how do|steps/.test(m)) r.text = '**How adoption works on PawBook:** send an interest request → the rescuer screens it and talks to you → meet & greet (and maybe a home visit) → sign the adoption agreement → hand-over.\n\n**Fees:** adoption is not a sale. A shelter may ask a **reasonable fee** for vaccination, sterilisation and care — they should tell you upfront and give a receipt.';
      else if (/law|legal|act\b|complian|societ|landlord|licen/.test(m)) r.text = '**Adoption compliance** (general information, not legal advice):\n• Cruelty and abandonment are offences under the **Prevention of Cruelty to Animals Act, 1960**\n• **Housing societies** cannot ban pets under the Animal Welfare Board of India\'s guidance — follow reasonable rules like cleaning up and leashes in common areas\n• **Community dogs** are sterilised and returned to their area under the **ABC Rules, 2023** — don\'t relocate them\n• Some cities require **dog registration or a licence**';
      else r.text = 'On **Adopt a pet** you can see pets looking for homes and find shelters and adoption centres near your area or PIN code.\n\nHow it works: send an interest request → the shelter reviews it → meet the pet → home visit and adoption.';
      r.text += (/document|rule|polic|complian|law|fee/.test(r.text.slice(0, 40).toLowerCase()) ? '\n\nYou read and agree to the full policy, rules, documents and compliance on **Adopt a pet** before applying — and can quit any time.' : '\n\n⚠️ Never pay anyone outside PawBook for a "free" adoption.') + signInLine();
      r.actions = [act('adopt')]; r.suggestions = ['What documents do I need to adopt?', 'Adoption rules', 'Is there an adoption fee?']; break;
    case 'places':
      var h = gHint(msg, intent);
      if (h) { r.text = '**' + cap(h.word) + ' near ' + h.near + '** from Google Maps are below (nearest first — not verified by PawBook, so call ahead).'; r.g = h; r.actions = [act('nearby', 'Open the map')]; }
      else { r.text = '📍 Tell me where you are and I\'ll find places near you. Tap **Set my location**, or open the map.'; r.actions = [{label: 'Set my location', url: '#location'}, act('discover')]; }
      break;
    case 'vacc':
      r.text = (/puppy|schedule/.test(m)
        ? 'A typical **puppy schedule** in India (your vet will tailor it):\n• **6–8 weeks** — first combination vaccine (DHPPi)\n• **9–12 weeks** — second dose, with leptospirosis\n• **12–16 weeks** — third dose + **rabies**\n• Then **yearly boosters**, and regular deworming.\nAlways follow your own vet\'s advice.'
        : 'On **Vaccinations** you can keep every dose your pet gets and see what is due next. PawBook reminds you before a dose is due.') + signInLine();
      r.actions = [act('vacc'), act('vet', 'Book a vaccination visit')]; r.suggestions = ['Puppy vaccine schedule', 'Find a vet near me']; break;
    case 'vet':
      var h2 = gHint(msg, 'vet');
      if (/vomit|diarrh|limp|not eating|sick|ill\b|fever|itch|tick|flea/.test(m)) {
        r.text = 'I can\'t diagnose, but here\'s a safe way to decide:\n• **Go to a vet today** if it keeps happening, there\'s blood, your pet is weak, very young or old, or not drinking.\n• Otherwise watch closely, keep fresh water available and note what you see.\n\nThe **AI health check** helps you judge how urgent it is.';
        r.actions = [act('health'), act('vet')]; r.suggestions = ['Find a vet near me', 'Emergency signs to watch for'];
      } else if (h2 && near) { r.text = '**Vet clinics near ' + h2.near + '** from Google Maps are below (nearest first — not verified by PawBook, so call ahead). Vets listed on PawBook can be booked on **Book a vet**.'; r.g = h2; r.actions = [act('vet'), act('nearby', 'Open the map')]; }
      else if (near) { r.text = '📍 Tell me where you are and I\'ll show vet clinics near you. Tap **Set my location**.'; r.actions = [{label: 'Set my location', url: '#location'}, act('vet')]; }
      else { r.text = 'On **Book a vet** you can find vets listed on PawBook, see their timings and book a visit.' + signInLine(); r.actions = [act('vet'), act('appts')]; r.suggestions = ['Find a vet near me', 'My dog is vomiting']; }
      break;
    case 'orders': r.text = 'You can see every order, its delivery status, invoices and returns on **My orders**. If something went wrong, I can help you raise a support request.'; r.actions = [act('orders'), {label: 'Raise a support request', url: '#support'}]; break;
    case 'shop':
      var mx = (msg.replace(/(\d),(\d)/g, '$1$2').match(/\b(?:under|below|less than|within|up ?to|max)\s*(?:rs\.?|₹)?\s*(\d{2,6})\b/i) || [])[1], sale = /\b(offers?|discounts?|deals?|sale)\b/i.test(msg);
      var sq = msg.replace(/(\d),(\d)/g, '$1$2').replace(/\b(?:under|below|less than|within|up ?to|max)\s*(?:rs\.?|₹)?\s*\d{2,6}\b/gi, ' ').replace(/\b(show|find|search|me|please|pls|i|want|need|to|buy|for|my|a|an|the|some|any|on|in the shop|offers?|discounts?|deals?|sale|cheap\w*|price)\b/gi, ' ').replace(/[?!.₹]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      var qs = [sq ? 'q=' + encodeURIComponent(sq) : '', mx ? 'max_price=' + mx : '', sale ? 'on_sale=1' : '', /\bcheap/i.test(msg) ? 'sort=price_asc' : ''].filter(Boolean).join('&');
      r.text = 'The **Pet shop** has food, treats, toys, grooming and care products — you can filter by pet, price and brand, compare products and see delivery times.' + (_mode === 'live' ? '' : '\n\n🔐 Sign in and I can find products for you by pet, price, brand and offers — and track your orders.');
      r.actions = (qs ? [{label: sq ? 'Search the shop for “' + sq + '”' + (mx ? ' under ₹' + mx : '') : (sale ? 'Offers in the shop' : 'Search the shop'), url: '43_shop_list.html?' + qs}] : []).concat([act('shop'), act('orders')]); r.suggestions = ['Dog food under 1000', 'Offers in the shop', 'Cat toys']; break;
    case 'pawmatch': r.text = '**PawMatch** helps you find playdates, walk buddies and companions for your pet. When both of you like each other it\'s a match — then you chat and fix a date and a public place. Your phone, email and exact location are never shared.\n\nSafety: meet in public, keep pets on leash at first, and make sure both are vaccinated.'; r.actions = [act('pawmatch')]; break;
    case 'groups': r.text = '**Communities** bring pet parents together by city, area, breed or interest. Join one to ask questions, share tips and find meetups.'; r.actions = [act('groups'), act('events')]; break;
    case 'events': r.text = 'Pet meetups, adoption drives, camps and shows are listed on **Events**.'; r.actions = [act('events')]; break;
    case 'nutrition':
      r.text = (/chocolate|grape|raisin|onion|garlic|xylitol|never eat|toxic|can (dogs?|cats?) eat/.test(m)
        ? 'Foods that are **dangerous for dogs and cats**: chocolate, grapes and raisins, onion and garlic, xylitol (sugar-free gum/sweets), alcohol, caffeine, and cooked bones. Cats must also avoid lilies. If your pet ate any of these, call a vet **now**.'
        : 'Good basics: a **complete and balanced** pet food for your pet\'s age, fixed meal times, fresh water always, and treats under 10% of the day\'s food. The amount depends on weight, age and activity — ask your vet.') + '\n\nThe **Meal planner** has meal plans and recipes.';
      r.actions = [act('nutrition'), act('shop', 'Pet food in the shop')]; break;
    case 'training':
      r.text = 'A few basics that work for most dogs:\n• **Reward what you want** — treat or praise within 2 seconds of the right behaviour\n• **Short sessions** — 5–10 minutes, a few times a day\n• **Be consistent** — same words and rules from everyone at home\n• **Never hit or shout** — it makes fear and biting worse\n\nSee **Training & behaviour** for step-by-step guides.';
      r.actions = [act('training')]; r.suggestions = ['Potty training a puppy', 'My puppy bites']; break;
    case 'travel': r.text = 'Before travelling, check the airline\'s or railway\'s current pet rules, carry your pet\'s **vaccination record**, and get a vet health certificate if needed. **Pet travel** has guides.'; r.actions = [act('travel'), act('vacc')]; break;
    case 'insurance': r.text = 'See **Pet insurance** for the options on PawBook. Before you buy any policy, check what is **excluded**, the **waiting period** and the **claim process**.'; r.actions = [act('insurance')]; break;
    case 'breeds': r.text = 'The **Breeds** guide covers size, energy, grooming and health for dog and cat breeds. Indian native dogs (Indies) are hardy, smart and great for Indian weather — and many are waiting for homes on **Adopt a pet**.'; r.actions = [act('breeds'), act('adopt')]; break;
    case 'account': r.text = 'Your name, photo, password, privacy and notification choices are in **Settings**. To delete your account, open Settings → Account. If you can\'t sign in, use "Forgot password" on the sign-in page.'; r.actions = [act('settings'), act('login', 'Sign-in page')]; break;
    case 'support': r.text = (_mode === 'live' ? 'I can raise a support request for the PawBook team — they reply in your notifications.' : 'Sign in and I can raise a support request for the PawBook team. You can also email **support@deemona.com**.') + ' To report cruelty to an animal, use **Report animal cruelty**.'; r.actions = _mode === 'live' ? [{label: 'Raise a support request', url: '#support'}, act('abuse')] : [act('login', 'Sign in'), act('abuse')]; break;
    case 'thanks': r.text = 'Happy to help! 🐾 Anything else for your pet?'; break;
    case 'greet': r.text = 'Hi' + (userName() ? ' ' + userName() : '') + '! 🐾 What can I help you and your pet with?'; break;
    default:
      r.text = 'I can help with **vets near you, vaccinations, adoption, lost & found, the pet shop, training, food and travel**, and how to use any PawBook page. Try asking it another way, or pick one below.' + signInLine();
      r.actions = [act('search', 'Search PawBook')];
  }
  if (!r.suggestions.length) r.suggestions = startersFor();
  return r;
}
function cap(s){ s = String(s || ''); return s.replace(/\b\w/g, function(c){ return c.toUpperCase(); }); }
function startersFor(){
  var c = pageCtx(), base = ['Find a vet near me', 'Pets for adoption', 'When are my pet\'s vaccines due?', 'My dog is missing — what should I do?'];
  var l = (c ? c[2] : []).concat(base), seen = {};
  return l.filter(function(x){ if (seen[x]) return false; seen[x] = 1; return true; }).slice(0, 4);
}

// ═══════════════════════════════════════════════════════════════
//  PAWBOOK API
// ═══════════════════════════════════════════════════════════════
function api(path, o){
  o = o || {}; var h = {}; if (_token) h.Authorization = 'Bearer ' + _token; var body = o.body;
  if (body) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  var ctl = window.AbortController ? new AbortController() : null, t = ctl ? setTimeout(function(){ ctl.abort(); }, o.timeout || 40000) : null;
  return fetch(API_BASE + path, {method: o.method || 'GET', headers: h, body: body, signal: ctl ? ctl.signal : undefined}).then(function(r){
    if (t) clearTimeout(t);
    return r.json().catch(function(){ return {}; }).then(function(j){
      if (!r.ok || j.success === false) { var e = new Error(j.message || ('HTTP ' + r.status)); e.status = r.status; throw e; }
      return j.data !== undefined ? j.data : j;
    });
  }, function(e){ if (t) clearTimeout(t); e.status = 0; throw e; });
}
function onExpired(){   // the saved sign-in is not valid any more
  _mode = 'guest'; _state = null; _token = ''; setHeadStatus();
  botMsg({text: 'Your sign-in has expired, so I\'m answering in guest mode. Sign in again to get answers about your own pets and bookings.', actions: [{label: 'Sign in', url: '#login'}]});
}
function loadState(force){
  if (_mode !== 'live') return Promise.resolve(null);
  if (_state && !force && Date.now() - _stateAt < 120000) return Promise.resolve(_state);
  return api('/assistant/state', {timeout: 15000}).then(function(d){ _state = d; _stateAt = Date.now(); saveNudge(d); setHeadStatus(); return d; })
    .catch(function(e){ if (e.status === 401) { _mode = 'guest'; _token = ''; setHeadStatus(); } return null; });
}

// ── reminders on the button (vaccines due within 7 days / overdue, appointments today or tomorrow) ──
function todayStr(off){ var d = new Date(Date.now() + (off || 0) * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function soonItems(d){
  var out = []; if (!d) return out; var wk = todayStr(7), t0 = todayStr(0), t1 = todayStr(1);
  (d.due || []).forEach(function(v){ if (v.overdue || (v.due && v.due <= wk)) out.push({kind: 'vacc', v: v}); });
  (d.appts || []).forEach(function(a){ if (a.date === t0 || a.date === t1) out.push({kind: 'appt', a: a}); });
  return out;
}
function saveNudge(d){ ssSet('pb_ai_nudge', JSON.stringify({at: Date.now(), n: soonItems(d).length})); showBadge(); }
function showBadge(){
  var b = document.getElementById('pb-fab-badge'); if (!b || _open) return; var n = 0;
  try { var x = JSON.parse(ssGet('pb_ai_nudge') || 'null'); if (x) n = x.n; } catch(e){}
  if (n > 0) { b.textContent = n > 9 ? '9+' : String(n); b.classList.add('show'); b.title = n + ' reminder' + (n > 1 ? 's' : ''); }
  else b.classList.remove('show');
}
function fdate(d){ var x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'}); }

// ═══════════════════════════════════════════════════════════════
//  RENDERING
// ═══════════════════════════════════════════════════════════════
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function fmt(t){ return esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\n)[•\-\*] /g, '$1• ').replace(/\n/g, '<br>'); }
function hm(v){ var d = v ? new Date(v) : new Date(); return d.toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'}); }
function scrollBottom(){ var el = document.getElementById('pb-ai-msgs'); if (el) el.scrollTop = el.scrollHeight; }
var TEMOJI = {pets: '🐾', vets: '🩺', communities: '🤝', products: '🛍️', adoption: '🏡', lost: '📍', events: '🎉', shelters: '🏠', people: '👤'};
function safeUrl(u){ return /^(tel:112$|[0-9]{2}_[a-z_0-9]+\.html([?#][^"'<>\s]*)?$)/.test(String(u || '')); }
function cardHTML(c){
  if (c.src === 'google') {
    return '<div class="pb-card g"><div class="pb-card-im"><b>' + esc(c.emoji || '📍') + '</b></div><div class="pb-card-bd"><b>' + esc(c.title) + '</b>' + (c.sub ? '<span class="s">' + esc(c.sub) + '</span>' : '') + (c.meta ? '<span class="mt">' + esc(c.meta) + '</span>' : '')
      + '<span class="gl">' + (c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">Directions</a>' : '') + (c.phone ? '<a href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, '')) + '">Call</a>' : '') + '</span></div></div>';
  }
  var href = safeUrl(c.url) ? c.url : '#';
  return '<a class="pb-card" href="' + esc(href) + '"><div class="pb-card-im">' + (c.img ? '<img src="' + esc(c.img) + '" alt="" loading="lazy" onerror="this.remove()">' : '<b>' + (TEMOJI[c.type] || '🐾') + '</b>') + (c.badge ? '<span>' + esc(c.badge) + '</span>' : c.near ? '<span>Near you</span>' : '') + '</div>'
    + '<div class="pb-card-bd"><b>' + esc(c.title) + '</b>' + (c.sub ? '<span class="s">' + esc(c.sub) + '</span>' : '') + (c.price != null ? '<span class="pr">₹' + Number(c.price).toLocaleString('en-IN') + '</span>' : '') + (c.meta ? '<span class="mt">' + esc(c.meta) + '</span>' : '') + '<span class="go">' + esc(c.action || 'Open') + ' →</span></div></a>';
}
function actHTML(a, gid){
  if (a.url === '#gnear') return gid ? '<button class="pb-act" onclick="pbAI._runG(\'' + gid + '\')">🗺️ ' + esc(a.label) + '</button>' : '';
  if (a.url === '#location') return '<button class="pb-act" onclick="pbAI.showLocation()">📍 ' + esc(a.label) + '</button>';
  if (a.url === '#support') return _mode === 'live' ? '<button class="pb-act" onclick="pbAI.showSupport()">✉️ ' + esc(a.label) + '</button>' : '';
  if (a.url === '#tickets') return '<a class="pb-act" href="35_ai_agent.html?tickets=1">🎫 ' + esc(a.label) + '</a>';
  if (a.url === '#login') return '<button class="pb-act pri" onclick="pbAI.showLoginView()">🔐 ' + esc(a.label) + '</button>';
  if (!safeUrl(a.url)) return '';
  var sos = /sos=1|^tel:/.test(a.url);
  return '<a class="pb-act' + (sos ? ' sos' : '') + '" href="' + esc(a.url) + '">' + (/^tel:/.test(a.url) ? '📞 ' : sos ? '🚨 ' : '') + esc(a.label) + ' ↗</a>';
}
// m: {text, cards, actions, suggestions, id, at, g, offline, past}
function botMsg(m, pills, extraHtml){
  if (typeof m === 'string') m = {text: m, suggestions: pills || null, extra: extraHtml || null};
  var msgs = document.getElementById('pb-ai-msgs'); if (!msgs) return null;
  var d = document.createElement('div'); d.className = 'pb-msg bot' + (m.past ? ' past' : ''); if (m.id) d.setAttribute('data-id', m.id);
  var gid = null, acts = (m.actions || []).slice();
  var g = m.g || (acts.filter(function(a){ return a.url === '#gnear' && a.g; })[0] || {}).g;
  if (g) { gid = 'g' + (++_ghN); _gh[gid] = g; }
  var h = '<div class="pb-msg-av">🐾</div><div class="pb-msg-body"><div class="pb-msg-bubble">' + fmt(m.text) + '</div>';
  if (m.extra) h += '<div style="margin-top:4px">' + m.extra + '</div>';
  if (m.cards && m.cards.length) h += '<div class="pb-cards">' + m.cards.map(cardHTML).join('') + '</div>' + (m.cards.some(function(c){ return c.src === 'google'; }) ? '<div class="pb-gattr">Places from <b>Google Maps</b> · not verified by PawBook — call ahead</div>' : '');
  if (gid) h += '<div class="pb-gx" id="pb-gx-' + gid + '"></div>';
  var ah = acts.map(function(a){ return actHTML(a, gid); }).join('');
  if (ah) h += '<div class="pb-acts">' + ah + '</div>';
  if (m.retry) h += '<div class="pb-acts"><button class="pb-act" data-q="' + esc(m.retry) + '" onclick="pbAI._retry(this)">↻ Try again</button></div>';
  if (!m.past && m.suggestions && m.suggestions.length) h += '<div class="pb-qr-row">' + m.suggestions.slice(0, 4).map(function(p){ return '<button class="pb-qr-btn" data-q="' + esc(p) + '" onclick="pbAI._pill(this)">' + esc(p) + '</button>'; }).join('') + '</div>';
  h += '<div class="pb-msg-time">' + esc(hm(m.at)) + (m.offline ? ' · general answer' : '') + (m.id && !m.past ? ' · <button class="pb-fb' + (m.helpful === true ? ' on' : '') + '" title="Helpful" aria-label="Helpful" onclick="pbAI._rate(this,true)">👍</button><button class="pb-fb' + (m.helpful === false ? ' on' : '') + '" title="Not helpful" aria-label="Not helpful" onclick="pbAI._rate(this,false)">👎</button>' : '') + '</div></div>';
  d.innerHTML = h; msgs.appendChild(d);
  // remove older suggestion pills so only the latest set shows
  var rows = msgs.querySelectorAll('.pb-qr-row'); for (var i = 0; i < rows.length - 1; i++) rows[i].remove();
  scrollBottom();
  if (gid && !m.past) setTimeout(function(){ pbAI._runG(gid); }, 30);
  return d;
}
function userMsg(text, past, at){
  var msgs = document.getElementById('pb-ai-msgs'); if (!msgs) return;
  var d = document.createElement('div'); d.className = 'pb-msg user' + (past ? ' past' : '');
  var init = (userName() || 'You').charAt(0).toUpperCase();
  d.innerHTML = '<div class="pb-msg-av">' + esc(init) + '</div><div class="pb-msg-body"><div class="pb-msg-bubble">' + esc(text) + '</div><div class="pb-msg-time" style="text-align:right">' + esc(hm(at)) + '</div></div>';
  msgs.appendChild(d); scrollBottom();
}
function divider(t){ var msgs = document.getElementById('pb-ai-msgs'); if (!msgs) return; var d = document.createElement('div'); d.className = 'pb-div'; d.textContent = t; msgs.appendChild(d); }
function showTyping(){
  var msgs = document.getElementById('pb-ai-msgs'); if (!msgs || _typing) return; _typing = true;
  var d = document.createElement('div'); d.className = 'pb-msg bot'; d.id = 'pb-typing';
  d.innerHTML = '<div class="pb-msg-av">🐾</div><div class="pb-typing"><span></span><span></span><span></span></div>'; msgs.appendChild(d); scrollBottom();
}
function hideTyping(){ var el = document.getElementById('pb-typing'); if (el) el.remove(); _typing = false; }
function setHeadStatus(){
  var s = document.getElementById('pb-ai-status'); if (s) s.innerHTML = '<span class="pb-ai-head-dot"></span> ' + (_mode === 'live' ? 'Signed in' : 'Guest mode');
  var l = document.getElementById('pb-ai-locbar');
  if (l) { var c = pageCtx(); l.innerHTML = '<button type="button" onclick="pbAI.showLocation()" title="Set your location">📍 ' + esc(_loc ? locLabel() : 'Set location') + '</button>' + (c ? '<span title="The page you are on">📄 ' + esc(c[0]) + '</span>' : '') + (_mode === 'live' ? '' : '<button type="button" class="pb-signin" onclick="pbAI.showLoginView()">Sign in</button>'); }
}

// ═══════════════════════════════════════════════════════════════
//  GOOGLE MAPS — nearby places, looked up in the browser with the website's Maps key
// ═══════════════════════════════════════════════════════════════
var GMAPS_KEY = 'AIzaSyC1qmdaaKwEUJTI2Fa1yVPjECTNU-ZnEYk';
function loadMaps(){
  if (window.google && google.maps && google.maps.places && google.maps.places.Place && google.maps.Geocoder) return Promise.resolve(google.maps);
  if (_gmp) return _gmp;
  if (window.google && google.maps && google.maps.importLibrary) { _gmp = Promise.all([google.maps.importLibrary('places'), google.maps.importLibrary('geocoding')]).then(function(){ return google.maps; }); return _gmp; }
  _gmp = new Promise(function(res, rej){
    window._pbAiMaps = function(){ res(google.maps); };
    var s = document.createElement('script'); s.src = 'https://maps.googleapis.com/maps/api/js?key=' + GMAPS_KEY + '&libraries=places&v=weekly&region=IN&callback=_pbAiMaps'; s.async = true;
    s.onerror = function(){ _gmp = null; rej(new Error('maps')); }; document.head.appendChild(s);
  });
  return _gmp;
}
function km(a, b, c, d){ var r = function(x){ return x * Math.PI / 180; }, dl = r(c - a), dn = r(d - b), h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) * Math.sin(dn / 2); return 6371 * 2 * Math.asin(Math.sqrt(h)); }
var GQ = {vet: 'veterinary clinic', shelter: 'animal shelter', groomer: 'pet grooming', boarding: 'pet boarding', petstore: 'pet shop'};
function runG(id){
  var g = _gh[id], box = document.getElementById('pb-gx-' + id); if (!g || !box) return;
  var put = function(h){ var b = document.getElementById('pb-gx-' + id); if (b) b.innerHTML = h; scrollBottom(); };
  put('<div class="pb-gload">⏳ Looking up ' + esc(g.word) + ' near ' + esc(g.near) + ' on Google Maps…</div>');
  var failed = function(){ put('<div class="pb-gload">Couldn\'t load places from Google Maps right now. <a href="' + P.nearby[0] + '">Open the map</a> instead.</div>'); };
  loadMaps().then(function(gm){
    var center = g.lat != null ? Promise.resolve({lat: Number(g.lat), lng: Number(g.lng)}) : new Promise(function(res){ try { new gm.Geocoder().geocode({address: g.address}, function(r, st){ if (st === 'OK' && r[0]) { var l = r[0].geometry.location; res({lat: l.lat(), lng: l.lng()}); } else res(null); }); } catch(e){ res(null); } });
    return center.then(function(c){
      if (!c || !gm.places || !gm.places.Place) return failed();
      var req = {textQuery: GQ[g.kind] || g.text || 'veterinary clinic', fields: ['displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'nationalPhoneNumber', 'googleMapsURI', 'businessStatus', 'regularOpeningHours', 'utcOffsetMinutes'], locationBias: {center: c, radius: 8000}, maxResultCount: 10, region: 'in'};
      if (gm.places.SearchByTextRankPreference) req.rankPreference = gm.places.SearchByTextRankPreference.DISTANCE;
      return gm.places.Place.searchByText(req).then(function(r){
        var list = (r.places || []).filter(function(p){ return p.location && p.businessStatus !== 'CLOSED_PERMANENTLY'; }).map(function(p){
          var la = typeof p.location.lat === 'function' ? p.location.lat() : p.location.lat, ln = typeof p.location.lng === 'function' ? p.location.lng() : p.location.lng;
          return {p: p, km: km(c.lat, c.lng, la, ln)}; }).filter(function(x){ return x.km <= 25; }).sort(function(a, b){ return a.km - b.km; }).slice(0, 6);
        if (!list.length) return put('<div class="pb-gload">Google Maps has no ' + esc(g.word) + ' listed near ' + esc(g.near) + '. <a href="' + P.nearby[0] + '">Open the map</a> to look further out.</div>');
        return Promise.all(list.map(function(x){ return (x.p.isOpen ? Promise.resolve(x.p.isOpen()).catch(function(){ return undefined; }) : Promise.resolve(undefined)).then(function(o){ x.open = o; return x; }); })).then(function(list){
          var cards = list.map(function(x){ var p = x.p, name = typeof p.displayName === 'string' ? p.displayName : (p.displayName && p.displayName.text) || 'Place';
            var url = /^https:\/\/(maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl|goo\.gl)/.test(p.googleMapsURI || '') ? p.googleMapsURI : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + ' ' + (p.formattedAddress || ''));
            return {src: 'google', emoji: g.emoji, title: name, sub: (p.formattedAddress || '').replace(/, India$/, ''), phone: p.nationalPhoneNumber || null, url: url,
              meta: [x.km < 1 ? Math.round(x.km * 1000) + ' m away' : (Math.round(x.km * 10) / 10) + ' km away', x.open === true ? 'Open now' : x.open === false ? 'Closed now' : null, p.rating ? '★ ' + p.rating + (p.userRatingCount ? ' (' + p.userRatingCount + ')' : '') : null].filter(Boolean).join(' · ')}; });
          put('<div class="pb-cards">' + cards.map(cardHTML).join('') + '</div><div class="pb-gattr">Places from <b>Google Maps</b> · not verified by PawBook — call ahead before visiting</div>');
        });
      });
    });
  }).catch(failed);
}

// ═══════════════════════════════════════════════════════════════
//  MAIN PUBLIC API — window.pbAI
// ═══════════════════════════════════════════════════════════════
window.pbAI = {

  toggle: function(){
    _open = !_open;
    var panel = document.getElementById('pb-ai-panel'), fab = document.getElementById('pb-ai-fab');
    if (_open) {
      panel.classList.add('open'); fab.classList.add('open'); fab.setAttribute('aria-expanded', 'true');
      var badge = document.getElementById('pb-fab-badge'); if (badge) badge.classList.remove('show');
      readSession(); readLoc(); setHeadStatus();
      if (!_greeted) { _greeted = true; this._greet(); }
      setTimeout(function(){ var inp = document.getElementById('pb-ai-input'); if (inp && window.innerWidth > 600) inp.focus(); }, 300);
    } else {
      panel.classList.remove('open'); fab.classList.remove('open'); fab.setAttribute('aria-expanded', 'false');
      window.speechSynthesis && window.speechSynthesis.cancel();
    }
  },

  // Greeting: who you are, what's due for your pets, and what you can do on this page
  _greet: function(){
    var self = this, h = new Date().getHours(), g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening', c = pageCtx();
    if (_mode !== 'live') {
      botMsg({text: g + '! 🐾 I\'m **PawBook AI**.\n\n' + (c ? 'You\'re on **' + c[0] + '** — ' + c[1] + '\n\n' : '') + 'I can find **vets, groomers and shelters near you**, guide you through **adoption, lost & found, vaccinations, training and food**, and help with any PawBook page.\n\n🔐 **Sign in** and I can also use your own pets, vaccinations and bookings.',
        actions: [{label: 'Sign in', url: '#login'}].concat(_loc ? [] : [{label: 'Set my location', url: '#location'}]), suggestions: startersFor()});
      return;
    }
    showTyping();
    loadState(true).then(function(d){
      hideTyping();
      if (!d) { if (_mode !== 'live') return self._greet(); botMsg({text: g + '! 🐾 I couldn\'t reach PawBook just now, so I\'ll give general answers for a bit. In an emergency, open SOS.', actions: [act('sos')], suggestions: startersFor()}); return; }
      var past = (d.messages || []).slice(-6);
      if (past.length) {
        divider('Earlier — your conversation with the PawBook Assistant');
        past.forEach(function(m){ if (m.role === 'user') userMsg(m.text, true, m.at); else botMsg({text: m.text, cards: m.cards, actions: (m.actions || []).filter(function(a){ return a.url !== '#gnear'; }), at: m.at, past: true}); });
        divider('Today');
      }
      var name = d.name || userName(), L = [g + (name ? ', ' + name : '') + '! 🐾'];
      var soon = soonItems(d);
      if (soon.length) {
        L.push('\n**Coming up for your pets:**');
        soon.slice(0, 4).forEach(function(x){
          if (x.kind === 'vacc') L.push('• **' + x.v.pet + '** — ' + x.v.vaccine + (x.v.overdue ? ' was due **' + fdate(x.v.due) + '** (overdue)' : ' due **' + fdate(x.v.due) + '**'));
          else L.push('• Vet visit' + (x.a.pet ? ' for **' + x.a.pet + '**' : '') + ' — **' + fdate(x.a.date) + (x.a.time ? ', ' + x.a.time : '') + '**' + (x.a.vet ? ' with ' + x.a.vet : '') + (x.a.clinic ? ' (' + x.a.clinic + ')' : ''));
        });
      } else if ((d.pets || []).length) L.push('\nNothing is due for ' + d.pets.map(function(p){ return p.name; }).slice(0, 3).join(', ') + ' in the next week. ✅');
      else L.push('\nAdd your pet on **My pets** and I\'ll keep track of vaccinations and vet visits for you.');
      if (c) L.push('\nYou\'re on **' + c[0] + '** — ask me anything about it.');
      if (!_loc) L.push('\n📍 Set your location for vets and places near you.');
      var acts = [];
      if (soon.some(function(x){ return x.kind === 'vacc'; })) acts.push(act('vet', 'Book a vaccination visit'), act('vacc'));
      if (soon.some(function(x){ return x.kind === 'appt'; })) acts.push(act('appts'));
      if (!(d.pets || []).length) acts.push(act('pets', 'Add my pet'));
      if (!_loc) acts.push({label: 'Set my location', url: '#location'});
      if (d.open_tickets) acts.push({label: 'My support requests (' + d.open_tickets + ' open)', url: '#tickets'});
      botMsg({text: L.join('\n'), actions: acts.slice(0, 4), suggestions: startersFor()});
    });
  },

  send: function(){
    var inp = document.getElementById('pb-ai-input'), text = inp.value.trim();
    if (!text || _busy) return;
    inp.value = ''; inp.style.height = '';
    this._process(text);
  },
  quick: function(text){ this._process(text); },
  _pill: function(b){ this._process(b.getAttribute('data-q')); },
  _retry: function(b){ var q = b.getAttribute('data-q'); var m = b.closest('.pb-msg'); if (m) m.remove(); this._process(q, true); },

  _process: function(text, isRetry){
    text = String(text || '').trim().slice(0, 1000); if (!text || _busy) return;
    var low = text.toLowerCase(), viaVoice = this._viaVoice; this._viaVoice = false;
    if (low === 'browse all features') { this.toggleFeatures(); return; }
    if (low === 'set my location') { this.showLocation(); return; }
    if (low === 'open sos') { location.href = P.sos[0]; return; }
    if (low === 'raise a support request') { if (_mode === 'live') { this.showSupport(); return; } }
    if (!isRetry) userMsg(text);
    _lastQ = text;
    var self = this, intent = detectIntent(text), done = function(m){ hideTyping(); _busy = false; var b = document.getElementById('pb-send-btn'); if (b) b.disabled = false; if (m) { botMsg(m); self._speak(m.text, viaVoice); } };
    // instant, safe answers that never wait for the network
    if (intent === 'emergency' || intent === 'pagehelp' || _mode !== 'live') {
      showTyping(); _busy = true;
      setTimeout(function(){ done(localReply(text)); }, intent === 'emergency' ? 50 : 350);
      return;
    }
    _busy = true; document.getElementById('pb-send-btn').disabled = true; showTyping();
    api('/assistant/chat', {method: 'POST', body: {message: text, location: _loc || undefined}}).then(function(d){
      // when the server answered from simple rules (no AI) and misread an advice question (e.g. "leash" read as shopping),
      // the built-in guide answers it better — use that, unless the server found real listings
      if (d.source !== 'ai' && ADVICE[intent] && d.intent !== intent && !(d.cards && d.cards.length)) { var lr = localReply(text); lr.at = d.at; done(lr); _stateAt = 0; return; }
      done({id: d.id, text: d.text, cards: d.cards, actions: d.actions, suggestions: d.suggestions && d.suggestions.length ? d.suggestions : startersFor(), at: d.at});
      _stateAt = 0;   // the next greeting re-reads what's due
    }).catch(function(e){
      if (e.status === 401) { done(null); onExpired(); botMsg(localReply(text)); return; }
      if (e.status === 429) { done({text: 'You\'re sending messages very fast — please wait a minute and try again.', retry: text}); return; }
      var r = localReply(text); r.offline = true; r.retry = text;
      r.text = 'I couldn\'t reach PawBook just now, so here\'s a general answer:\n\n' + r.text;
      done(r);
    });
  },

  _rate: function(b, v){
    var m = b.closest('.pb-msg'), id = m && m.getAttribute('data-id'); if (!id || _mode !== 'live') return;
    api('/assistant/messages/' + encodeURIComponent(id) + '/feedback', {method: 'POST', body: {helpful: v}}).then(function(){
      b.parentNode.querySelectorAll('.pb-fb').forEach(function(x){ x.classList.remove('on'); }); b.classList.add('on'); b.title = 'Thanks for the feedback!';
    }).catch(function(){});
  },

  _runG: function(id){ runG(id); },

  handleKey: function(e){ if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } },
  autoResize: function(el){ el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 90) + 'px'; },

  clearChat: function(btn){
    var self = this, reset = function(){ var msgs = document.getElementById('pb-ai-msgs'); if (msgs) msgs.innerHTML = ''; _greeted = true; self._greet(); };
    if (_mode !== 'live') { reset(); return; }
    if (btn && btn.getAttribute('data-sure') !== '1') {
      btn.setAttribute('data-sure', '1'); btn.textContent = '✓'; btn.title = 'Tap again to clear the conversation';
      setTimeout(function(){ btn.removeAttribute('data-sure'); btn.textContent = '🗑'; btn.title = 'Clear conversation'; }, 4000); return;
    }
    if (btn) { btn.removeAttribute('data-sure'); btn.textContent = '🗑'; }
    api('/assistant/history', {method: 'DELETE'}).then(function(){ if (_state) _state.messages = []; reset(); }).catch(function(){ reset(); });
  },

  openFull: function(){ location.href = _mode === 'live' ? P.assistant[0] : P.login[0]; },

  // ── LOCATION (shared with the Assistant page; used for "near me") ──
  _view: function(id){
    ['pb-chat-view', 'pb-login-view', 'pb-features-view', 'pb-loc-view'].forEach(function(v){ var el = document.getElementById(v); if (el) el.style.display = v === id ? 'flex' : 'none'; });
    var fb = document.getElementById('pb-feat-btn'); if (fb) fb.style.background = id === 'pb-features-view' ? 'rgba(255,255,255,.4)' : '';
    this._featVisible = id === 'pb-features-view';
  },
  showLocation: function(){
    readLoc(); var f = document.getElementById('pb-loc-form'), l = _loc || {};
    f.city.value = l.city || ''; f.area.value = l.area || ''; f.pin.value = l.pin || ''; f.state.value = l.state || ''; f.lat.value = l.lat != null ? l.lat : ''; f.lng.value = l.lng != null ? l.lng : '';
    document.getElementById('pb-loc-msg').textContent = ''; document.getElementById('pb-loc-clear').style.display = _loc ? '' : 'none';
    this._view('pb-loc-view'); setTimeout(function(){ f.city.focus(); }, 50);
  },
  saveLocation: function(e){
    if (e) e.preventDefault();
    var f = document.getElementById('pb-loc-form'), m = document.getElementById('pb-loc-msg');
    var l = {country: 'India', state: f.state.value.trim(), city: f.city.value.trim(), area: f.area.value.trim(), pin: f.pin.value.replace(/\D/g, '').slice(0, 6)};
    if (!l.city && l.pin.length !== 6) { m.textContent = 'Type your city, or a 6-digit PIN code.'; f.city.focus(); return; }
    if (l.pin && l.pin.length !== 6) { m.textContent = 'A PIN code has 6 digits.'; f.pin.focus(); return; }
    var la = parseFloat(f.lat.value), ln = parseFloat(f.lng.value); if (isFinite(la) && isFinite(ln)) { l.lat = la; l.lng = ln; }
    var finish = function(){ lsSet('pb_assist_loc', JSON.stringify(l)); _loc = l; setHeadStatus(); pbAI._view('pb-chat-view'); botMsg({text: '📍 Got it — I\'ll use **' + locLabel(l) + '** for places near you.', suggestions: ['Find a vet near me', 'Pet groomers near me', 'Pets for adoption in my city']}); };
    if (l.lat != null) return finish();
    // find the map point once, so "near me" lookups are accurate (works without it too)
    loadMaps().then(function(gm){ new gm.Geocoder().geocode({address: [l.area, l.city, l.state, l.pin, 'India'].filter(Boolean).join(', ')}, function(r, st){
      if (st === 'OK' && r && r[0]) { var p = r[0].geometry.location; l.lat = Math.round(p.lat() * 1e5) / 1e5; l.lng = Math.round(p.lng() * 1e5) / 1e5; } finish(); }); }).catch(finish);
  },
  clearLocation: function(){ lsSet('pb_assist_loc', null); _loc = null; readLoc(); setHeadStatus(); this._view('pb-chat-view'); botMsg({text: _loc ? '📍 Cleared. I\'m now using the area you picked on Adopt a pet: **' + locLabel() + '**.' : '📍 Location cleared.'}); },
  useGps: function(b){
    var m = document.getElementById('pb-loc-msg'), f = document.getElementById('pb-loc-form');
    if (!navigator.geolocation) { m.textContent = 'Location is not available in this browser — type your city instead.'; return; }
    b.disabled = true; b.textContent = '⏳ Finding you…';
    var done = function(t){ b.disabled = false; b.textContent = '🎯 Use my current location'; if (t) m.textContent = t; };
    navigator.geolocation.getCurrentPosition(function(pos){
      var la = pos.coords.latitude, ln = pos.coords.longitude; f.lat.value = Math.round(la * 1e5) / 1e5; f.lng.value = Math.round(ln * 1e5) / 1e5;
      loadMaps().then(function(gm){ new gm.Geocoder().geocode({location: {lat: la, lng: ln}}, function(r, st){
        if (st !== 'OK' || !r || !r[0]) { done('Found you on the map — type your city and save.'); return; }
        var comps = r[0].address_components || [], gt = function(t){ var x = comps.filter(function(a){ return a.types.indexOf(t) >= 0; })[0]; return x ? x.long_name : ''; };
        f.city.value = gt('locality') || gt('administrative_area_level_3') || gt('administrative_area_level_2'); f.state.value = gt('administrative_area_level_1');
        f.area.value = gt('sublocality_level_1') || gt('sublocality') || gt('neighborhood') || ''; f.pin.value = gt('postal_code');
        done('Found: ' + [f.area.value, f.city.value, f.pin.value].filter(Boolean).join(', ') + ' — check and save.'); }); })
      .catch(function(){ done('Found you on the map — type your city and save.'); });
    }, function(){ done('Location permission was not given — type your city instead.'); }, {timeout: 10000, maximumAge: 600000});
  },

  // ── SUPPORT REQUEST (signed in) ──
  showSupport: function(){
    var self = this, TOP = [['account', 'Account & sign-in'], ['payment', 'Payment or refund'], ['order', 'Shop order'], ['vet', 'Vet booking'], ['listing', 'Fake or wrong listing'], ['safety', 'Safety or harassment'], ['bug', 'Something is not working'], ['grievance', 'Grievance (IT Rules)'], ['other', 'Other']];
    var html = '<form class="pb-sup" onsubmit="pbAI.submitSupport(event)"><select name="topic" class="pb-finput" required><option value="">What is it about?</option>' + TOP.map(function(t){ return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('') + '</select>'
      + '<input name="subject" class="pb-finput" maxlength="150" placeholder="Short title" required>'
      + '<textarea name="message" class="pb-finput" rows="3" maxlength="4000" placeholder="What happened? (at least 15 characters — never share passwords, OTPs, card or ID numbers)" required></textarea>'
      + '<div class="pb-sup-err"></div><button class="pb-fsubmit" type="submit">Send to the PawBook team</button></form>';
    botMsg({text: '✉️ Tell the PawBook team what happened. They reply in your **notifications**, usually within 24 hours.', extra: html});
  },
  submitSupport: function(e){
    e.preventDefault(); var f = e.target, err = f.querySelector('.pb-sup-err'), b = f.querySelector('button');
    var body = {topic: f.topic.value, subject: f.subject.value.trim(), message: f.message.value.trim(), page_url: PAGE};
    if (!body.topic || body.subject.length < 4 || body.message.length < 15) { err.textContent = 'Pick a topic, add a short title and at least 15 characters.'; return; }
    b.disabled = true; b.textContent = 'Sending…';
    api('/assistant/support', {method: 'POST', body: body}).then(function(d){
      f.outerHTML = '<div class="pb-sup-ok">✅ Request <b>' + esc(d.ticket && d.ticket.ref || '') + '</b> sent. You\'ll get the reply in your notifications.</div>';
      botMsg({text: 'Your support request is raised. Anything else I can help with?', actions: [{label: 'My support requests', url: '#tickets'}]});
    }).catch(function(x){ b.disabled = false; b.textContent = 'Send to the PawBook team'; err.textContent = x.status === 401 ? 'Please sign in again.' : (x.message || 'Could not send — try again.'); });
  },

  // ── VOICE ENGINE ──────────────────────────────────────────────
  _voiceRecog: null,
  _voiceActive: false,
  _ttsEnabled: lsGet('pb_ai_tts') === '1',   // read replies aloud (off by default; questions asked by voice are always answered aloud)
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
      botMsg('Voice input isn\'t available in this browser. Try Chrome or Edge, or type your question. 🎙');
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
        setTimeout(function(){ pbAI._viaVoice = true; pbAI.send(); }, 100);
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

  _speak: function(text, force){
    if(!text || (!this._ttsEnabled && !force)) return;
    if(!window.speechSynthesis) return;
    // Strip markdown symbols for cleaner speech
    var clean = text
      .replace(/\*\*(.*?)\*\*/g,'$1')
      .replace(/\*(.*?)\*/g,'$1')
      .replace(/#{1,6}\s/g,'')
      .replace(/`([^`]+)`/g,'$1')
      .replace(/\n/g,'. ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,'').replace(/•/g,'').substring(0, 600); // cap length, no emoji read out

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
    this._ttsEnabled = !this._ttsEnabled; lsSet('pb_ai_tts', this._ttsEnabled ? '1' : '0');
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
  _initTTSButton: function(){ var b = document.getElementById('pb-tts-toggle'); if (b) { b.textContent = this._ttsEnabled ? '🔊' : '🔇'; b.classList.toggle('muted', !this._ttsEnabled); b.title = this._ttsEnabled ? 'Reading replies aloud — tap to stop' : 'Read replies aloud'; } },

  // ── FEATURES GUIDE (what PawBook has, and where) ──
  _FEATURES: [
    {icon: '🏠', title: 'Home feed', desc: 'Posts from pet parents and communities you follow.', tags: ['Communities near me', 'Events near me'], page: '07_home.html', section: 'Social'},
    {icon: '🤝', title: 'Communities', desc: 'Groups by city, area, breed or interest.', tags: ['Communities near me'], page: '03_groups.html', section: 'Social'},
    {icon: '🎉', title: 'Events', desc: 'Meetups, adoption drives, camps and shows.', tags: ['Events near me', 'Adoption drives'], page: '30_events.html', section: 'Social'},
    {icon: '💞', title: 'PawMatch', desc: 'Playdates, walk buddies and companions for your pet — match, chat and fix a date.', tags: ['How does PawMatch work?', 'Is PawMatch safe?'], page: '35_pawmatch.html', section: 'Social'},
    {icon: '💬', title: 'Messages', desc: 'Private chats with other pet parents.', tags: ['How do I report a user?'], page: '13_messages.html', section: 'Social'},
    {icon: '🩺', title: 'Book a vet', desc: 'Vets listed on PawBook — timings, booking and your appointments.', tags: ['Find a vet near me', 'My appointments'], page: '11_vet_booking.html', section: 'Pet care'},
    {icon: '💉', title: 'Vaccinations', desc: 'Your pet\'s vaccination records and what is due next.', tags: ['When are my pet\'s vaccines due?', 'Puppy vaccine schedule'], page: '10_vaccination.html', section: 'Pet care'},
    {icon: '📋', title: 'My pets & health records', desc: 'Vaccinations, medicines and vet visits in one place.', tags: ['My pets'], page: '36_pet_life_record.html', section: 'Pet care'},
    {icon: '🤖', title: 'AI health check & SOS', desc: 'Judge how urgent a symptom is, first aid steps and nearby help.', tags: ['My dog is vomiting', 'First aid for heatstroke'], page: '37_pet_ai_health_agent.html', section: 'Pet care'},
    {icon: '📍', title: 'Lost & Found', desc: 'Report a lost or found pet and see cases near you.', tags: ['My dog is missing — what should I do?', 'I found a pet'], page: '38_lost_pet_network.html', section: 'Pet care'},
    {icon: '🏡', title: 'Adopt a pet', desc: 'Pets looking for homes, adoption rules and documents, and shelters near you.', tags: ['What documents do I need to adopt?', 'Pets for adoption in my city'], page: '39_adoption_matching.html', section: 'Pet care'},
    {icon: '🎓', title: 'Training & behaviour', desc: 'Guides for good manners and common problems.', tags: ['Potty training a puppy', 'How do I stop my dog pulling on the leash?'], page: '22_training.html', section: 'Pet care'},
    {icon: '🥣', title: 'Meal planner', desc: 'Meal plans and recipes for your pet.', tags: ['Foods dogs must never eat', 'How much should my puppy eat?'], page: '23_nutrition.html', section: 'Pet care'},
    {icon: '✈️', title: 'Pet travel', desc: 'Guides for travelling with your pet.', tags: ['Travelling with my dog by train'], page: '24_pet_travel.html', section: 'Pet care'},
    {icon: '📚', title: 'Breeds', desc: 'Size, energy, grooming and health for dog and cat breeds.', tags: ['Which dog breed suits a small flat?'], page: '33_breeds.html', section: 'Pet care'},
    {icon: '🛍️', title: 'Pet shop', desc: 'Food, treats, toys, grooming and care products.', tags: ['Dog food', 'Cat litter', 'My orders'], page: '42_shop.html', section: 'Shop & services'},
    {icon: '🗺️', title: 'Discover map', desc: 'Pet places near you on the map.', tags: ['Pet groomers near me', 'Find pet boarding near me'], page: '26_discover.html', section: 'Shop & services'},
    {icon: '🛡️', title: 'Pet insurance', desc: 'Insurance options — check exclusions and waiting periods.', tags: ['What should I check before buying pet insurance?'], page: '21_pet_insurance.html', section: 'Shop & services'},
    {icon: '🏪', title: 'Sell on PawBook', desc: 'List your products after a quick verification.', tags: ['How do I sell on PawBook?'], page: '49_seller_join.html', section: 'Shop & services'},
    {icon: '⚙️', title: 'Settings', desc: 'Account, privacy, password and notifications.', tags: ['How do I delete my account?', 'I can\'t sign in'], page: '14_settings.html', section: 'Account & help'},
    {icon: '🚩', title: 'Report animal cruelty', desc: 'Report cruelty with photos, place and time.', tags: ['How do I report animal cruelty?'], page: '36_abuse_reporting.html', section: 'Account & help'},
    {icon: '✉️', title: 'Help & support', desc: 'Raise a support request to the PawBook team, or email support@deemona.com.', tags: ['Raise a support request'], page: '35_ai_agent.html?support=1', section: 'Account & help'}
  ],
  _featVisible: false,
  toggleFeatures: function(){
    if (this._featVisible) { this._view('pb-chat-view'); return; }
    this._view('pb-features-view'); this._renderFeatureCards(document.getElementById('pb-feat-search').value || '');
  },
  filterFeatures: function(q){ this._renderFeatureCards(q || ''); },
  _renderFeatureCards: function(q){
    var list = document.getElementById('pb-feat-list'); if (!list) return;
    var query = (q || '').toLowerCase().trim(), fs = this._FEATURES.filter(function(f){ return !query || (f.title + ' ' + f.desc + ' ' + f.tags.join(' ')).toLowerCase().indexOf(query) !== -1; });
    if (!fs.length) { list.innerHTML = '<div style="text-align:center;padding:24px;color:#65676b;font-size:12px">Nothing found for "' + esc(q) + '" — ask me in the chat instead.</div>'; return; }
    var html = '', sec = '';
    fs.forEach(function(f, i){
      if (!query && f.section !== sec) { sec = f.section; html += '<div class="pb-feat-section">' + esc(sec) + '</div>'; }
      html += '<div class="pb-feat-card"><div class="pb-feat-card-head"><span class="pb-feat-card-icon">' + f.icon + '</span><span class="pb-feat-card-title">' + esc(f.title) + '</span>'
        + '<a class="pb-feat-open" href="' + esc(f.page) + '">Open ↗</a></div><div class="pb-feat-card-desc">' + esc(f.desc) + '</div><div class="pb-feat-card-tags">'
        + f.tags.map(function(t){ return '<button type="button" class="pb-feat-tag" data-q="' + esc(t) + '" onclick="pbAI._featQuick(this)">' + esc(t) + '</button>'; }).join('') + '</div></div>';
    });
    list.innerHTML = html;
  },
  _featQuick: function(b){ this._view('pb-chat-view'); this._process(b.getAttribute('data-q')); },

  // ── SIGN IN (real PawBook accounts only) ──
  showLoginView: function(reg){ this._view('pb-login-view'); if (reg) this.showRegister(); else this.showLoginForm(); },
  showChat: function(){ this._view('pb-chat-view'); },
  showRegister: function(){ document.getElementById('pb-email-login').style.display = 'none'; document.getElementById('pb-email-register').style.display = 'block'; document.getElementById('pb-login-err').style.display = 'none'; },
  showLoginForm: function(){ document.getElementById('pb-email-register').style.display = 'none'; document.getElementById('pb-email-login').style.display = 'block'; document.getElementById('pb-login-err').style.display = 'none'; },
  _loginErr: function(msg){ var el = document.getElementById('pb-login-err'); el.textContent = msg; el.style.display = 'block'; },
  _loginSuccess: function(d){
    var tok = d.token || (d.data && d.data.token), ud = d.user || (d.data && d.data.user) || {}, ref = d.refresh || (d.data && d.data.refresh);
    lsSet('pb_token', tok); if (ref) lsSet('pb_refresh', ref); lsSet('pb_user', JSON.stringify(ud));
    readSession(); _state = null; this._view('pb-chat-view');
    if (typeof window.renderUserChip === 'function') try { window.renderUserChip(); } catch(e){}
    var msgs = document.getElementById('pb-ai-msgs'); if (msgs) msgs.innerHTML = '';
    _greeted = true; this._greet();
  },
  emailLogin: function(){
    var email = document.getElementById('pb-w-email').value.trim(), pass = document.getElementById('pb-w-pass').value;
    if (!email || !pass) { this._loginErr('Enter your email and password.'); return; }
    var btn = document.getElementById('pb-w-submit'), self = this; btn.disabled = true; btn.textContent = 'Signing in…';
    fetch(API_BASE + '/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'include', body: JSON.stringify({email: email, password: pass})})
      .then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(d){ btn.disabled = false; btn.textContent = 'Sign In'; if (d.token || (d.data && d.data.token)) self._loginSuccess(d); else self._loginErr(d.message || 'Wrong email or password.'); })
      .catch(function(){ btn.disabled = false; btn.textContent = 'Sign In'; self._loginErr('Could not connect. Check your internet and try again.'); });
  },
  doRegister: function(){
    var name = document.getElementById('pb-w-name').value.trim(), email = document.getElementById('pb-w-reg-email').value.trim(), pass = document.getElementById('pb-w-reg-pass').value;
    if (!name || !email || !pass) { this._loginErr('Fill in all the fields.'); return; }
    if (pass.length < 6) { this._loginErr('Use at least 6 characters for your password.'); return; }
    var btn = document.getElementById('pb-w-reg-submit'), self = this; btn.disabled = true; btn.textContent = 'Creating…';
    fetch(API_BASE + '/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'include', body: JSON.stringify({full_name: name, email: email, password: pass})})
      .then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(d){ btn.disabled = false; btn.textContent = 'Create Account'; if (d.token || (d.data && d.data.token)) self._loginSuccess(d); else self._loginErr(d.message || 'Could not create the account.'); })
      .catch(function(){ btn.disabled = false; btn.textContent = 'Create Account'; self._loginErr('Could not connect. Check your internet and try again.'); });
  }
};

// Esc closes the panel
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && _open) pbAI.toggle(); });
// Keep sign-in in step with other tabs/pages
window.addEventListener('storage', function(e){ if (e.key === 'pb_token' || e.key === 'pb_user') { var was = _mode; readSession(); if (was !== _mode) { _state = null; setHeadStatus(); } } if (e.key === 'pb_assist_loc') { readLoc(); setHeadStatus(); } });

// Reminders on the button: once in a while (at most every 30 minutes per tab session), check what's due
readSession(); readLoc(); showBadge(); pbAI._initTTSButton();
(function(){
  var last = 0; try { last = (JSON.parse(ssGet('pb_ai_nudge') || 'null') || {}).at || 0; } catch(e){}
  if (_mode === 'live' && Date.now() - last > 30 * 60000) setTimeout(function(){ if (!_open) loadState(true); }, 4000);
})();

})(); // end IIFE
