/**
 * PawBook API Client v2
 * All frontend pages import this one file.
 * Change API_BASE if deploying to production.
 */

const API_BASE = 'http://localhost:4000/api/v1';

// ── Token storage ─────────────────────────────────────────────────────────────
const Auth = {
  getToken:   () => localStorage.getItem('pb_token'),
  getRefresh: () => localStorage.getItem('pb_refresh'),
  getUser:    () => JSON.parse(localStorage.getItem('pb_user') || 'null'),

  save(data) {
    localStorage.setItem('pb_token',   data.token);
    localStorage.setItem('pb_refresh', data.refresh);
    localStorage.setItem('pb_user',    JSON.stringify(data.user));
  },

  clear() {
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_refresh');
    localStorage.removeItem('pb_user');
  },

  isLoggedIn: () => !!localStorage.getItem('pb_token'),

  require() {
    if (!Auth.isLoggedIn()) {
      window.location.href = '01_login.html';
      return false;
    }
    return true;
  }
};

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && Auth.getRefresh()) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch(path, options);
    Auth.clear();
    window.location.href = '01_login.html';
    return null;
  }

  if (!res.ok) {
    throw new APIError(data.message || 'Request failed', res.status, data.errors);
  }
  return data;
}

async function tryRefresh() {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: Auth.getRefresh() })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('pb_token',   data.data.token);
      localStorage.setItem('pb_refresh', data.data.refresh);
      return true;
    }
  } catch {}
  return false;
}

class APIError extends Error {
  constructor(message, status, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

// ── API modules ───────────────────────────────────────────────────────────────

const AuthAPI = {
  async register(data) {
    const res = await apiFetch('/auth/register', {
      method: 'POST', body: JSON.stringify(data)
    });
    if (res?.data) Auth.save(res.data);
    return res;
  },

  async login(email, password) {
    const res = await apiFetch('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    if (res?.data) Auth.save(res.data);
    return res;
  },

  async me() {
    return apiFetch('/auth/me');
  },

  logout() {
    Auth.clear();
    window.location.href = '01_login.html';
  }
};

const PostAPI = {
  feed(page = 1, limit = 20) {
    return apiFetch(`/posts/feed?page=${page}&limit=${limit}`);
  },
  get(post_id) {
    return apiFetch(`/posts/${post_id}`);
  },
  create(data) {
    return apiFetch('/posts', { method: 'POST', body: JSON.stringify(data) });
  },
  react(post_id, reaction_type = 'love') {
    return apiFetch(`/posts/${post_id}/react`, {
      method: 'POST', body: JSON.stringify({ reaction_type })
    });
  },
  getComments(post_id, page = 1) {
    return apiFetch(`/posts/${post_id}/comments?page=${page}`);
  },
  addComment(post_id, body, parent_id = null) {
    return apiFetch(`/posts/${post_id}/comments`, {
      method: 'POST', body: JSON.stringify({ body, parent_id })
    });
  },
  delete(post_id) {
    return apiFetch(`/posts/${post_id}`, { method: 'DELETE' });
  }
};

const PetAPI = {
  mine() { return apiFetch('/pets/my'); },
  get(pet_id) { return apiFetch(`/pets/${pet_id}`); },
  create(data) { return apiFetch('/pets', { method: 'POST', body: JSON.stringify(data) }); },
  update(pet_id, data) { return apiFetch(`/pets/${pet_id}`, { method: 'PATCH', body: JSON.stringify(data) }); },
  health(pet_id) { return apiFetch(`/pets/${pet_id}/health`); },
  addVaccination(pet_id, data) {
    return apiFetch(`/pets/${pet_id}/vaccinations`, { method: 'POST', body: JSON.stringify(data) });
  },
  vaccinationsDue() { return apiFetch('/pets/vaccinations/due'); }
};

const VetAPI = {
  list(params = {}) {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/vets?${q}`);
  },
  nearby(lat, lng, km = 10) { return apiFetch(`/vets/nearby?lat=${lat}&lng=${lng}&km=${km}`); },
  get(user_id) { return apiFetch(`/vets/${user_id}`); },
  book(data) { return apiFetch('/vets/appointments', { method: 'POST', body: JSON.stringify(data) }); },
  myAppointments(page = 1, status = '') {
    return apiFetch(`/vets/appointments/mine?page=${page}${status ? '&status=' + status : ''}`);
  },
  updateAppointment(appointment_id, data) {
    return apiFetch(`/vets/appointments/${appointment_id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  rate(appointment_id, rating, review) {
    return apiFetch(`/vets/appointments/${appointment_id}/rate`, {
      method: 'POST', body: JSON.stringify({ rating, review })
    });
  }
};

const UserAPI = {
  profile(username) { return apiFetch(`/users/${username}/profile`); },
  update(data) { return apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify(data) }); },
  follow(user_id) { return apiFetch(`/users/${user_id}/follow`, { method: 'POST' }); },
  search(q, page = 1) { return apiFetch(`/users/search?q=${encodeURIComponent(q)}&page=${page}`); },
  notifications(page = 1) { return apiFetch(`/notifications?page=${page}`); }
};

const SearchAPI = {
  all(q, category = 'all') {
    return apiFetch(`/search?q=${encodeURIComponent(q)}&category=${category}`);
  }
};

// ── NEW: Groups API ───────────────────────────────────────────────────────────
const GroupAPI = {
  list(params = {}) {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/groups?${q}`);
  },
  get(group_id) { return apiFetch(`/groups/${group_id}`); },
  create(data) { return apiFetch('/groups', { method: 'POST', body: JSON.stringify(data) }); },
  join(group_id) { return apiFetch(`/groups/${group_id}/join`, { method: 'POST' }); },
  feed(group_id, page = 1) { return apiFetch(`/groups/${group_id}/posts?page=${page}`); },
  post(group_id, data) {
    return apiFetch(`/groups/${group_id}/posts`, { method: 'POST', body: JSON.stringify(data) });
  },
  members(group_id, page = 1) { return apiFetch(`/groups/${group_id}/members?page=${page}`); }
};

// ── NEW: Lost Pet API ─────────────────────────────────────────────────────────
const LostPetAPI = {
  list(params = {}) {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/lost-pets?${q}`);
  },
  get(alert_id) { return apiFetch(`/lost-pets/${alert_id}`); },
  report(data) { return apiFetch('/lost-pets', { method: 'POST', body: JSON.stringify(data) }); },
  sighting(alert_id, data) {
    return apiFetch(`/lost-pets/${alert_id}/sightings`, { method: 'POST', body: JSON.stringify(data) });
  },
  update(alert_id, status) {
    return apiFetch(`/lost-pets/${alert_id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }
};

// ── NEW: Marketplace API ──────────────────────────────────────────────────────
const MarketAPI = {
  products(params = {}) {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/marketplace/products?${q}`);
  },
  product(product_id) { return apiFetch(`/marketplace/products/${product_id}`); },
  getCart() { return apiFetch('/marketplace/cart'); },
  addToCart(product_id, quantity = 1) {
    return apiFetch('/marketplace/cart', { method: 'POST', body: JSON.stringify({ product_id, quantity }) });
  },
  updateCart(cart_id, quantity) {
    return apiFetch(`/marketplace/cart/${cart_id}`, { method: 'PATCH', body: JSON.stringify({ quantity }) });
  },
  removeFromCart(cart_id) {
    return apiFetch(`/marketplace/cart/${cart_id}`, { method: 'DELETE' });
  },
  placeOrder(data) { return apiFetch('/marketplace/orders', { method: 'POST', body: JSON.stringify(data) }); },
  myOrders(page = 1) { return apiFetch(`/marketplace/orders?page=${page}`); },
  order(order_id) { return apiFetch(`/marketplace/orders/${order_id}`); }
};

// ── NEW: Analytics API ────────────────────────────────────────────────────────
const AnalyticsAPI = {
  me() { return apiFetch('/analytics/me'); }
};

// ── NEW: Insurance API ────────────────────────────────────────────────────────
const InsuranceAPI = {
  enroll(data) { return apiFetch('/insurance/enroll', { method: 'POST', body: JSON.stringify(data) }); },
  myPlan() { return apiFetch('/insurance/my-plan'); }
};

// ── NEW: Training API ─────────────────────────────────────────────────────────
const TrainingAPI = {
  book(data) { return apiFetch('/training/sessions', { method: 'POST', body: JSON.stringify(data) }); },
  mySessions(page = 1) { return apiFetch(`/training/sessions/mine?page=${page}`); },
  updateProgress(session_id, data) {
    return apiFetch(`/training/sessions/${session_id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
};

// ── UI helpers ────────────────────────────────────────────────────────────────

function toast(message, type = 'success', duration = 3000) {
  const existing = document.querySelector('.pb-toast');
  if (existing) existing.remove();

  const t = document.createElement('div');
  t.className = 'pb-toast';
  t.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:${type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#1a4db3'};
    color:#fff; padding:10px 20px; border-radius:24px; font-size:13px;
    font-weight:700; z-index:9999; box-shadow:0 4px 16px rgba(0,0,0,0.25);
    font-family:'Nunito',sans-serif; max-width:300px; text-align:center;
    animation: fadeInUp 0.3s ease;
  `;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function setLoading(btn, loading, originalText) {
  if (loading) {
    btn.disabled = true;
    btn.dataset.original = btn.textContent;
    btn.textContent = '...';
    btn.style.opacity = '0.7';
  } else {
    btn.disabled = false;
    btn.textContent = originalText || btn.dataset.original;
    btn.style.opacity = '1';
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmt(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function fmtRupee(n) {
  if (!n) return '₹0';
  return '₹' + Number(n).toLocaleString('en-IN');
}

function showError(msg, containerId) {
  const el = document.getElementById(containerId);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function speciesEmoji(s) {
  const m = { dog: '🐕', cat: '🐈', bird: '🦜', rabbit: '🐇', fish: '🐠', hamster: '🐹' };
  return m[s?.toLowerCase()] || '🐾';
}

function renderUserBadge() {
  const user = Auth.getUser();
  if (!user) return;
  const badge = document.getElementById('user-badge');
  if (badge) badge.textContent = user.username?.[0]?.toUpperCase() || '?';
}

// Skeleton loader
function skeletonCard(h = 120) {
  return `<div class="pb-skeleton" style="height:${h}px;border-radius:12px;margin-bottom:12px"></div>`;
}

// Add CSS animations once
if (!document.getElementById('pb-anim')) {
  const s = document.createElement('style');
  s.id = 'pb-anim';
  s.textContent = `
    @keyframes fadeInUp {
      from { opacity:0; transform:translateX(-50%) translateY(10px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0); }
    }
    .pb-toast { animation: fadeInUp 0.3s ease; }
    .pb-skeleton {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 8px;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(s);
}
