/* ══════════════════════════════════════════════════════════════════
   PAWBOOK API CLIENT  v2
   Backend: https://pawbook-api-cquc.onrender.com/api/v1
══════════════════════════════════════════════════════════════════ */

const API_BASE = 'https://pawbook-api-cquc.onrender.com/api/v1';

// ── HELPERS ──────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('pb_token') || ''; }
function setToken(t) { localStorage.setItem('pb_token', t); }
function clearToken() {
  localStorage.removeItem('pb_token');
  localStorage.removeItem('pb_user');
}
function authHeaders() {
  var h = { 'Content-Type': 'application/json' };
  var t = getToken();
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

async function request(method, path, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && getToken()) headers['Authorization'] = 'Bearer ' + getToken();
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

const get  = (path, auth)       => request('GET',    path, null, auth);
const post = (path, body, auth) => request('POST',   path, body, auth);
const patch= (path, body)       => request('PATCH',  path, body);
const del  = (path)             => request('DELETE', path, null);

// ── AUTH ─────────────────────────────────────────────────────────
const Auth = {
  isLoggedIn() { return !!getToken(); },
  async login(email, password) {
    const res = await post('/auth/login', { email, password }, false);
    if (res.data?.token) setToken(res.data.token);
    if (res.data?.user)  localStorage.setItem('pb_user', JSON.stringify(res.data.user));
    return res;
  },
  async register(data) {
    const res = await post('/auth/register', data, false);
    if (res.data?.token) setToken(res.data.token);
    if (res.data?.user)  localStorage.setItem('pb_user', JSON.stringify(res.data.user));
    return res;
  },
  async me() { return get('/auth/me'); },
  logout() { clearToken(); window.location.href = '01_login.html'; },
  require() {
    if (!this.isLoggedIn()) { window.location.href = '01_login.html'; return false; }
    return true;
  },
  currentUser() {
    try { return JSON.parse(localStorage.getItem('pb_user') || 'null'); }
    catch { return null; }
  }
};

// ── AUTH API (alias) ──────────────────────────────────────────────
const AuthAPI = {
  login:          (email, password) => Auth.login(email, password),
  register:       (data)            => Auth.register(data),
  me:             ()                => Auth.me(),
  logout:         ()                => Auth.logout(),
  changePassword: (data)            => patch('/auth/password', data),
  forgotPassword: (email)           => post('/auth/forgot-password', { email }, false),
  verifyOtp:      (email, otp)      => post('/auth/verify-otp', { email, otp }, false),
  resetPassword:  (email, otp, password) => post('/auth/reset-password', { email, otp, new_password: password }, false),
};

// ── USER API ──────────────────────────────────────────────────────
const UserAPI = {
  search:         (q, page)   => get(`/users/search?q=${encodeURIComponent(q)}&page=${page||1}`),
  profile:        (username)  => get(`/users/${username}/profile`, false),
  followers:      (id, page)  => get(`/users/${id}/followers?page=${page||1}`),
  following:      (id, page)  => get(`/users/${id}/following?page=${page||1}`),
  posts:          (id, page)  => get(`/users/${id}/posts?page=${page||1}`),
  updateProfile:  (data)      => patch('/users/me', data),
  updatePrefs:    (data)      => patch('/users/me/preferences', data),
  follow:         (id)        => post(`/users/${id}/follow`),
  block:          (id)        => post(`/users/${id}/block`),
  deactivate:     ()          => del('/users/me'),
};

// ── PET API ───────────────────────────────────────────────────────
const PetAPI = {
  myPets:         ()          => get('/pets/my'),
  get:            (id)        => get(`/pets/${id}`, false),
  create:         (data)      => post('/pets', data),
  update:         (id, d)     => patch(`/pets/${id}`, d),
  delete:         (id)        => del(`/pets/${id}`),
  health:         (id)        => get(`/pets/${id}/health`),
  vaccinationsDue:()          => get('/pets/vaccinations/due'),
  addVaccination: (id, d)     => post(`/pets/${id}/vaccinations`, d),
};

// ── POST API ──────────────────────────────────────────────────────
const PostAPI = {
  feed:      (page, limit) => get(`/posts/feed?page=${page||1}&limit=${limit||15}`),
  get:       (id)          => get(`/posts/${id}`, false),
  userPosts: (id, page)    => get(`/users/${id}/posts?page=${page||1}`),
  create:    (data)        => post('/posts', data),
  update:    (id, data)    => patch(`/posts/${id}`, data),
  delete:    (id)          => del(`/posts/${id}`),
  react:     (id, type)    => post(`/posts/${id}/react`, { reaction_type: type||'love' }),
  comments:  (id, page)    => get(`/posts/${id}/comments?page=${page||1}`),
  comment:   (id, text)    => post(`/posts/${id}/comments`, { body: text }),
  deleteComment: (cid)     => del(`/posts/comments/${cid}`),
  save:      (id)          => post(`/saved/${id}`),
  unsave:    (id)          => del(`/saved/${id}`),
};

// ── VET API ───────────────────────────────────────────────────────
const VetAPI = {
  list:       (params)    => get(`/vets?${new URLSearchParams(params||{})}`),
  get:        (id)        => get(`/vets/${id}`, false),
  slots:      (id)        => get(`/vets/${id}/slots`),
  review:     (id, data)  => post(`/vets/${id}/review`, data),
  book:       (data)      => post('/appointments', data),
  myAppts:    (page)      => get(`/appointments?page=${page||1}`),
  getAppt:    (id)        => get(`/appointments/${id}`),
  updateAppt: (id, data)  => patch(`/appointments/${id}`, data),
  prescriptions: (page)  => get(`/prescriptions?page=${page||1}`),
  register:   (data)      => post('/vets/register', data),
};

// ── NOTIFICATION API ──────────────────────────────────────────────
const NotifAPI = {
  list:       (page)      => get(`/notifications?page=${page||1}`),
  markAll:    ()          => patch('/notifications/read-all'),
  markOne:    (id)        => patch(`/notifications/${id}/read`),
  delete:     (id)        => del(`/notifications/${id}`),
};

// ── MESSAGE API ───────────────────────────────────────────────────
const MsgAPI = {
  users:          ()          => get('/messages/users'),
  searchUsers:    (q)         => get(`/messages/search-users?q=${encodeURIComponent(q)}`),
  conversations:  (page)      => get(`/conversations?page=${page||1}`),
  getOrCreate:    (uid)       => post('/conversations', { other_user_id: uid }),
  messages:       (cid, page) => get(`/conversations/${cid}/messages?page=${page||1}`),
  send:           (cid, text) => post(`/conversations/${cid}/messages`, { content: text }),
  edit:           (cid, mid, text) => patch(`/conversations/${cid}/messages/${mid}`, { content: text }),
  delete:         (cid, mid) => del(`/conversations/${cid}/messages/${mid}`),
  groupConvs:     (page)      => get(`/group-conversations?page=${page||1}`),
  createGroup:    (data)      => post('/group-conversations', data),
  groupMessages:  (gid, page) => get(`/group-conversations/${gid}/messages?page=${page||1}`),
  sendGroup:      (gid, text) => post(`/group-conversations/${gid}/messages`, { content: text }),
};

// ── SAVED API ─────────────────────────────────────────────────────
const SavedAPI = {
  list:   (page) => get(`/saved?page=${page||1}`),
  save:   (id)   => post(`/saved/${id}`),
  unsave: (id)   => del(`/saved/${id}`),
};

// ── MEDIA API ─────────────────────────────────────────────────────
const MediaAPI = {
  gallery:    (page)   => get(`/media/gallery?page=${page||1}`),
  highlights: ()       => get('/media/highlights'),
  tagged:     (page)   => get(`/media/tagged?page=${page||1}`),
  albums:     ()       => get('/media/albums'),
  album:      (id)     => get(`/media/albums/${id}`),
  createAlbum:(data)   => post('/media/albums', data),
  update:     (id, d)  => patch(`/media/${id}`, d),
  delete:     (id)     => del(`/media/${id}`),
  upload:     async (file) => {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(API_BASE + '/media/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      body: fd
    });
    return res.json();
  },
};

// ── GROUP API ─────────────────────────────────────────────────────
const GroupAPI = {
  list:   (params) => get(`/groups?${new URLSearchParams(params||{})}`),
  get:    (id)     => get(`/groups/${id}`, false),
  create: (data)   => post('/groups', data),
  join:   (id)     => post(`/groups/${id}/join`),
  leave:  (id)     => post(`/groups/${id}/leave`),
  posts:  (id, p)  => get(`/groups/${id}/posts?page=${p||1}`),
};

// ── LOST PET API ──────────────────────────────────────────────────
const LostPetAPI = {
  list:     (params) => get(`/lost-pets?${new URLSearchParams(params||{})}`),
  get:      (id)     => get(`/lost-pets/${id}`, false),
  report:   (data)   => post('/lost-pets', data),
  update:   (id, d)  => patch(`/lost-pets/${id}`, d),
  sighting: (id, d)  => post(`/lost-pets/${id}/sightings`, d),
};

// ── ADOPTION API ──────────────────────────────────────────────────
const AdoptionAPI = {
  pets:       (params) => get(`/adoptions/pets?${new URLSearchParams(params||{})}`),
  pet:        (id)     => get(`/adoptions/pets/${id}`, false),
  shelters:   ()       => get('/adoptions/shelters', false),
  inquire:    (data)   => post('/adoptions/inquire', data),
  myInquiries:()       => get('/adoptions/my-inquiries'),
};

// ── MARKETPLACE API ───────────────────────────────────────────────
const MarketAPI = {
  products:       (params) => get(`/marketplace/products?${new URLSearchParams(params||{})}`),
  product:        (id)     => get(`/marketplace/products/${id}`, false),
  listings:       (params) => get(`/marketplace/listings?${new URLSearchParams(params||{})}`),
  listing:        (id)     => get(`/marketplace/listings/${id}`, false),
  createListing:  (data)   => post('/marketplace/listings', data),
  updateListing:  (id, d)  => patch(`/marketplace/listings/${id}`, d),
  deleteListing:  (id)     => del(`/marketplace/listings/${id}`),
  reviews:        (id)     => get(`/marketplace/listings/${id}/reviews`, false),
  addReview:      (id, d)  => post(`/marketplace/listings/${id}/reviews`, d),
  cart:           ()       => get('/marketplace/cart'),
  addCart:        (data)   => post('/marketplace/cart', data),
  updateCart:     (id, qty)=> patch(`/marketplace/cart/${id}`, { quantity: qty }),
  removeCart:     (id)     => del(`/marketplace/cart/${id}`),
  placeOrder:     (data)   => post('/marketplace/orders', data),
  myOrders:       (page)   => get(`/marketplace/orders?page=${page||1}`),
  order:          (id)     => get(`/marketplace/orders/${id}`),
  myStore:        ()       => get('/marketplace/store/me'),
  createStore:    (data)   => post('/marketplace/store', data),
};

// ── EVENTS API ────────────────────────────────────────────────────
const EventAPI = {
  list:   (page)  => get(`/events?page=${page||1}`),
  get:    (id)    => get(`/events/${id}`),
  create: (data)  => post('/events', data),
  rsvp:   (id)    => post(`/events/${id}/rsvp`),
  delete: (id)    => del(`/events/${id}`),
};

// ── TRAINING API ──────────────────────────────────────────────────
const TrainingAPI = {
  programs:   ()          => get('/training/programs', false),
  lessons:    (id)        => get(`/training/programs/${id}/lessons`, false),
  my:         ()          => get('/training/my'),
  enroll:     (id)        => post('/training/enroll', { program_id: id }),
  progress:   (id, data)  => patch(`/training/progress/${id}`, data),
};

// ── INSURANCE API ─────────────────────────────────────────────────
const InsuranceAPI = {
  plans:      ()      => get('/insurance/plans', false),
  my:         ()      => get('/insurance/my'),
  subscribe:  (id)    => post('/insurance/subscribe', { plan_id: id }),
  cancel:     (id)    => del(`/insurance/${id}`),
};

// ── NUTRITION API ─────────────────────────────────────────────────
const NutritionAPI = {
  plans:      ()      => get('/nutrition/plans', false),
  plan:       (id)    => get(`/nutrition/plans/${id}`, false),
  foods:      ()      => get('/nutrition/foods', false),
  recommend:  ()      => get('/nutrition/recommend', false),
  myPlans:    ()      => get('/nutrition/my-plans'),
  savePlan:   (data)  => post('/nutrition/my-plans', data),
  removePlan: (id)    => del(`/nutrition/my-plans/${id}`),
};

// ── ANALYTICS API ─────────────────────────────────────────────────
const AnalyticsAPI = {
  me: () => get('/analytics/me'),
};

// ── TRAVEL API ────────────────────────────────────────────────────
const TravelAPI = {
  destinations: ()      => get('/travel/destinations', false),
  destination:  (id)    => get(`/travel/destinations/${id}`, false),
  saved:        ()      => get('/travel/saved'),
  save:         (id)    => post('/travel/save', { dest_id: id }),
  unsave:       (id)    => del(`/travel/save/${id}`),
};

// ── FUNDRAISING API ───────────────────────────────────────────────
const FundraisingAPI = {
  list:     (page)  => get(`/fundraising?page=${page||1}`),
  get:      (id)    => get(`/fundraising/${id}`),
  create:   (data)  => post('/fundraising', data),
  donate:   (id, d) => post(`/fundraising/${id}/donate`, d),
};

// ── ACTIVITY API ──────────────────────────────────────────────────
const ActivityAPI = {
  list: (page) => get(`/activity?page=${page||1}`),
  log:  (data) => post('/activity', data),
};

// ── MEMORIES API ──────────────────────────────────────────────────
const MemoriesAPI = {
  memories:  () => get('/memories'),
  birthdays: () => get('/birthdays'),
};

// ── SEARCH ────────────────────────────────────────────────────────
const SearchAPI = {
  all: (q, category) => get(`/search?q=${encodeURIComponent(q)}&category=${category||'all'}`),
};

// ── PAWMATCH API ──────────────────────────────────────────────────
const PawMatchAPI = {
  candidates: (params) => get(`/pawmatch?${new URLSearchParams(params||{})}`),
  like:       (id)     => post(`/pawmatch/${id}/like`),
  pass:       (id)     => post(`/pawmatch/${id}/pass`),
  matches:    ()       => get('/pawmatch/matches'),
};

// ── HEALTH CHECK ──────────────────────────────────────────────────
async function checkAPIHealth() {
  try {
    const res = await fetch(API_BASE + '/health');
    const data = await res.json();
    console.log('[PawBook API] Health:', data);
    return data.success;
  } catch(e) {
    console.warn('[PawBook API] Offline');
    return false;
  }
}
checkAPIHealth();
