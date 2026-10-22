/* ==========================================================================
   PAWBOOK  socket.js  — Socket.io real-time client
   Connects to backend wss://pawbook-api-cquc.onrender.com
   Provides:
     PawSocket.connect()          — call once after login
     PawSocket.disconnect()
     PawSocket.on(event, fn)      — subscribe to server events
     PawSocket.off(event, fn)
     PawSocket.emit(event, data)  — send to server
     PawSocket.sendMessage(conversationId, content)
     PawSocket.joinConversation(conversationId)
     PawSocket.leaveConversation(conversationId)
     PawSocket.isConnected()

   Server events you can listen to:
     'new_message'      → { conversation_id, message: {...} }
     'new_notification' → { notification: {...} }
     'user_online'      → { user_id }
     'user_offline'     → { user_id }
     'typing'           → { conversation_id, user_id, is_typing }
   ========================================================================== */

(function (global) {
  'use strict';

  const SOCKET_URL = 'https://pawbook-api-cquc.onrender.com';

  let _socket = null;
  let _listeners = {};
  let _reconnectTimer = null;
  let _notifBadge = 0;

  function _token() {
    return localStorage.getItem('pb_token') || localStorage.getItem('token') || '';
  }

  function _loadSocketIO(cb) {
    if (typeof io !== 'undefined') return cb();
    const s = document.createElement('script');
    s.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
    s.onload = cb;
    s.onerror = () => console.warn('[PawSocket] Could not load socket.io');
    document.head.appendChild(s);
  }

  const PawSocket = {
    connect() {
      _loadSocketIO(() => {
        if (_socket && _socket.connected) return;

        _socket = io(SOCKET_URL, {
          transports: ['websocket', 'polling'],
          auth: { token: _token() },
          reconnectionDelay: 2000,
          reconnectionAttempts: 10,
        });

        _socket.on('connect', () => {
          console.log('[PawSocket] Connected:', _socket.id);
          _emit_local('connect');
        });

        _socket.on('disconnect', (reason) => {
          console.log('[PawSocket] Disconnected:', reason);
          _emit_local('disconnect', reason);
        });

        _socket.on('connect_error', (err) => {
          console.warn('[PawSocket] Connection error:', err.message);
        });

        // ── Server events → forward to local listeners ──────────────────────

        _socket.on('new_message', (data) => {
          _emit_local('new_message', data);
          // Update chat UI if open
          if (typeof onNewMessage === 'function') onNewMessage(data);
        });

        _socket.on('new_notification', (data) => {
          _emit_local('new_notification', data);
          _notifBadge++;
          _updateNotifBadge(_notifBadge);
          if (typeof onNewNotification === 'function') onNewNotification(data);
        });

        _socket.on('user_online', (data) => _emit_local('user_online', data));
        _socket.on('user_offline', (data) => _emit_local('user_offline', data));

        _socket.on('typing', (data) => {
          _emit_local('typing', data);
          _showTypingIndicator(data);
        });

        _socket.on('message_read', (data) => _emit_local('message_read', data));
        _socket.on('post_liked',   (data) => _emit_local('post_liked', data));
      });
    },

    disconnect() {
      if (_socket) { _socket.disconnect(); _socket = null; }
    },

    on(event, fn) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },

    off(event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    },

    emit(event, data) {
      if (_socket && _socket.connected) _socket.emit(event, data);
      else console.warn('[PawSocket] Not connected — cannot emit', event);
    },

    isConnected() {
      return !!(_socket && _socket.connected);
    },

    // ── Conversation helpers ─────────────────────────────────────────────────

    joinConversation(conversationId) {
      this.emit('join_conversation', { conversation_id: conversationId });
    },

    leaveConversation(conversationId) {
      this.emit('leave_conversation', { conversation_id: conversationId });
    },

    sendMessage(conversationId, content) {
      this.emit('send_message', { conversation_id: conversationId, content });
    },

    sendTyping(conversationId, isTyping) {
      this.emit('typing', { conversation_id: conversationId, is_typing: isTyping });
    },

    markRead(conversationId) {
      this.emit('mark_read', { conversation_id: conversationId });
    },

    resetNotifBadge() {
      _notifBadge = 0;
      _updateNotifBadge(0);
    },
  };

  // ── Internal helpers ───────────────────────────────────────────────────────

  function _emit_local(event, data) {
    (_listeners[event] || []).forEach(fn => { try { fn(data); } catch(_) {} });
  }

  function _updateNotifBadge(count) {
    // Update any .notif-dot or .notif-count elements on the page
    document.querySelectorAll('.notif-count,[data-notif-count]').forEach(el => {
      el.textContent = count > 99 ? '99+' : count || '';
      el.style.display = count ? '' : 'none';
    });
    document.querySelectorAll('.notif-dot').forEach(el => {
      el.style.display = count ? '' : 'none';
    });
    // Browser tab title
    if (count > 0) {
      const base = document.title.replace(/^\(\d+\)\s*/, '');
      document.title = `(${count}) ${base}`;
    } else {
      document.title = document.title.replace(/^\(\d+\)\s*/, '');
    }
  }

  function _showTypingIndicator(data) {
    const el = document.getElementById('typing-indicator-' + data.conversation_id);
    if (!el) return;
    if (data.is_typing) {
      el.style.display = 'block';
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
    } else {
      el.style.display = 'none';
    }
  }

  // Auto-connect when logged in
  if (typeof localStorage !== 'undefined' && localStorage.getItem('pb_token')) {
    // Defer so api.js has loaded first
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => PawSocket.connect());
    } else {
      setTimeout(() => PawSocket.connect(), 100);
    }
  }

  global.PawSocket = PawSocket;

})(window);
