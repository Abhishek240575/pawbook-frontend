/* ═══════════════════════════════════════════════════════════════
   PAWBOOK API CLIENT
   Backend: https://pawbook-api-cquc.onrender.com/api/v1
═══════════════════════════════════════════════════════════════ */

const API_BASE = 'https://pawbook-api-cquc.onrender.com/api/v1';

// ── HELPERS ───────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem('pb_token') || '';
}

function setToken(token) {
  localStorage.setItem('pb_token', token);
}

function clearToken() {
  localStorage.removeItem('pb_token');
  localStorage.removeItem('pb_user');
}

async function request(method, path, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && getToken()) {
    headers['Authorization'] = 'Bearer ' + getToken();
  }
  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw { status: res.status, ...data };
    return data;
  } catch (e) {
    console.error('[PawBook API]', method, path, e);
    throw e;
  }
}

const get    = (path, auth)       => request('GET',    path, null, auth);
const post   = (path, body, auth) => request('POST',   path, body, auth);
const patch  = (path, body)       => request('PATCH',  path, body);
const del    = (path)             => request('DELETE', path, null);

// ── AUTH ──────────────────────────────────────────────────────
const Auth = {
  isLoggedIn() {
    return !!getToken();
  },
  async login(email, password) {
    const res = await post('/auth/login', { email, password }, false);
    if (res.data?.token) setToken(res.data.token);
    if (res.data?.user) localStorage.setItem('pb_user', JSON.stringify(res.data.user));
    return res;
  },
  async register(data) {
    const res = await post('/auth/register', data, false);
    if (res.data?.token) setToken(res.data.token);
    if (res.data?.user) localStorage.setItem('pb_user', JSON.stringify(res.data.user));
    return res;
  },
  async me() {
    return get('/auth/me');
  },
  logout() {
    clearToken();
    window.location.href = '01_login.html';
  },
  require() {
    if (!this.isLoggedIn()) {
      window.location.href = '01_login.html';
      return false;
    }
    return true;
  },
  currentUser() {
    try { return JSON.parse(localStorage.getItem('pb_user') || 'null'); }
    catch { return null; }
  }
};

// ── AUTH API ──────────────────────────────────────────────────
// (AuthAPI defined in aliases section below)

// ── USER API ──────────────────────────────────────────────────
const UserAPI = {
  search:        (q, page)    => get(`/users/search?q=${q}&page=${page||1}`),
  profile:       (username)   => get(`/users/${username}/profile`, false),
  followers:     (id, page)   => get(`/users/${id}/followers?page=${page||1}`),
  following:     (id, page)   => get(`/users/${id}/following?page=${page||1}`),
  posts:         (id, page)   => get(`/users/${id}/posts?page=${page||1}`),
  updateProfile: (data)       => patch('/users/me', data),
  follow:        (id)         => post(`/users/${id}/follow`),
  block:         (id)         => post(`/users/${id}/block`),
  notifications: (page)       => get(`/users/me/notifications?page=${page||1}`),
  deactivate:    ()           => del('/users/me'),
};

// ── PET API ───────────────────────────────────────────────────
const PetAPI = {
  myPets:          ()      => get('/pets/my'),
  get:             (id)    => get(`/pets/${id}`, false),
  create:          (data)  => post('/pets', data),
  update:          (id, d) => patch(`/pets/${id}`, d),
  delete:          (id)    => del(`/pets/${id}`),
  health:          (id)    => get(`/pets/${id}/health`),
  vaccinationsDue: ()      => get('/pets/vaccinations/due'),
  addVaccination:  (id, d) => post(`/pets/${id}/vaccinations`, d),
};

// ── POST API ──────────────────────────────────────────────────
const PostAPI = {
  feed:      (page, limit) => get(`/posts/feed?page=${page||1}&limit=${limit||15}`),
  get:       (id)          => get(`/posts/${id}`, false),
  userPosts: (id, page)    => get(`/users/${id}/posts?page=${page||1}`),
  create:    (data)        => post('/posts', data),
  update:    (id, data)    => patch(`/posts/${id}`, data),
  delete:    (id)          => del(`/posts/${id}`),
  like:      (id)          => post(`/posts/${id}/like`),
  comments:  (id, page)    => get(`/posts/${id}/comments?page=${page||1}`),
  comment:   (id, text)    => post(`/posts/${id}/comments`, { content: text }),
};

// ── VET API ───────────────────────────────────────────────────
const VetAPI = {
  list:       (params) => get(`/vets?${new URLSearchParams(params||{})}`),
  get:        (id)     => get(`/vets/${id}`, false),
  book:       (data)   => post('/vets/appointments', data),
  myAppts:    (page)   => get(`/vets/appointments/my?page=${page||1}`),
  register:   (data)   => post('/vets/register', data),
  available:  ()       => get('/vets/available', false),
};

// ── GROUP API ─────────────────────────────────────────────────
const GroupAPI = {
  list:   (params) => get(`/groups?${new URLSearchParams(params||{})}`),
  get:    (id)     => get(`/groups/${id}`, false),
  create: (data)   => post('/groups', data),
  join:   (id)     => post(`/groups/${id}/join`),
  leave:  (id)     => post(`/groups/${id}/leave`),
  posts:  (id, p)  => get(`/groups/${id}/posts?page=${p||1}`),
};

// ── LOST PET API ──────────────────────────────────────────────
const LostPetAPI = {
  list:     (params) => get(`/lost-pets?${new URLSearchParams(params||{})}`),
  get:      (id)     => get(`/lost-pets/${id}`, false),
  report:   (data)   => post('/lost-pets', data),
  update:   (id, d)  => patch(`/lost-pets/${id}`, d),
  sighting: (id, d)  => post(`/lost-pets/${id}/sightings`, d),
};

// ── MARKETPLACE API ───────────────────────────────────────────
const MarketAPI = {
  list:   (params) => get(`/marketplace?${new URLSearchParams(params||{})}`),
  get:    (id)     => get(`/marketplace/${id}`, false),
  create: (data)   => post('/marketplace', data),
  update: (id, d)  => patch(`/marketplace/${id}`, d),
  delete: (id)     => del(`/marketplace/${id}`),
};

// ── TRAINING API ──────────────────────────────────────────────
const TrainingAPI = {
  list:   (params) => get(`/training?${new URLSearchParams(params||{})}`),
  get:    (id)     => get(`/training/${id}`, false),
  enroll: (id)     => post(`/training/${id}/enroll`),
};

// ── INSURANCE API ─────────────────────────────────────────────
const InsuranceAPI = {
  plans:  ()       => get('/insurance/plans', false),
  apply:  (data)   => post('/insurance/apply', data),
  my:     ()       => get('/insurance/my'),
};

// ── ANALYTICS API ─────────────────────────────────────────────
const AnalyticsAPI = {
  me: () => get('/users/me/analytics'),
};

// ── HEALTH CHECK ──────────────────────────────────────────────
async function checkAPIHealth() {
  try {
    const res = await fetch(API_BASE + '/health');
    const data = await res.json();
    console.log('[PawBook API] Health:', data);
    return data.success;
  } catch(e) {
    console.warn('[PawBook API] Offline - using demo data');
    return false;
  }
}

// Check on load
checkAPIHealth();

// ── BACKWARD COMPATIBILITY ALIASES ───────────────────────────
// Some pages use AuthAPI.login, UserAPI.notifications etc.
const AuthAPI = {
  login:          (email, password) => Auth.login(email, password),
  register:       (data)            => Auth.register(data),
  me:             ()                => Auth.me(),
  logout:         ()                => Auth.logout(),
  changePassword: (data)            => patch('/auth/password', data),
  notifications:  (page)            => get('/users/me/notifications?page=' + (page||1)),
};
