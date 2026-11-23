/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   PAWBOOK API CLIENT  v2
   Backend: https://pawbook.deemona.com/api/v1
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const API_BASE = 'https://pawbook.deemona.com/api/v1';

// â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Include Bearer token for backward-compat (mobile/Postman); cookie is preferred by server
  if (auth && getToken()) headers['Authorization'] = 'Bearer ' + getToken();
  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      credentials: 'include',   // send httpOnly pb_token cookie automatically
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

// â”€â”€ AUTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  logout() {
    // Clear localStorage immediately — never wait for API
    clearToken();
    // Fire-and-forget to clear httpOnly cookie server-side
    try { fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {}); } catch(e) {}
    window.location.href = '01_login.html';
  },
  require() {
    // Logged-in if we have a stored user OR a Bearer token (cookie is invisible to JS)
    if (!this.isLoggedIn()) { window.location.href = '01_login.html'; return false; }
    return true;
  },
  isLoggedIn() {
    // Token in localStorage OR pb_user (means we authenticated this session)
    return !!getToken() || !!localStorage.getItem('pb_user');
  },
  currentUser() {
    try { return JSON.parse(localStorage.getItem('pb_user') || 'null'); }
    catch { return null; }
  }
};

// â”€â”€ AUTH API (alias) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AuthAPI = {
  login:          (email, password) => Auth.login(email, password),
  register:       (data)            => Auth.register(data),
  me:             ()                => Auth.me(),
  logout:         ()                => Auth.logout(),
  changePassword: (data)            => patch('/auth/password', data),
  forgotPassword: (email)           => post('/auth/forgot-password', { email }, false),
  verifyOtp:      (email, otp)      => post('/auth/verify-otp', { email, otp }, false),
  resetPassword:  (email, otp, password) => post('/auth/reset-password', { email, otp, new_password: password }, false),
  async googleLogin(id_token) {
    const res = await post('/auth/google', { id_token }, false);
    if (res.data?.token) setToken(res.data.token);
    if (res.data?.user)  localStorage.setItem('pb_user', JSON.stringify(res.data.user));
    return res;
  },
};

// â”€â”€ USER API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ PET API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PetAPI = {
  myPets: ()  => get('/pets/my'),
  mine:    ()          => get('/pets/my'),
  get:            (id)        => get(`/pets/${id}`, false),
  create:         (data)      => post('/pets', data),
  update:         (id, d)     => patch(`/pets/${id}`, d),
  delete:         (id)        => del(`/pets/${id}`),
  health:         (id)        => get(`/pets/${id}/health`),
  vaccinationsDue:()          => get('/pets/vaccinations/due'),
  addVaccination: (id, d)     => post(`/pets/${id}/vaccinations`, d),
};

// â”€â”€ POST API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PostAPI = {
  feed:      (page, limit) => get(`/posts/feed?page=${page||1}&limit=${limit||15}`),
  get:       (id)          => get(`/posts/${id}`, false),
  userPosts: (id, page)    => get(`/users/${id}/posts?page=${page||1}`),
  create:    (data)        => post('/posts', data),
  update:    (id, data)    => patch(`/posts/${id}`, data),
  delete:    (id)          => del(`/posts/${id}`),
  react:     (id, type)    => post(`/posts/${id}/react`, { reaction_type: type||'love' }),
  comments:  (id, page)    => get(`/posts/${id}/comments?page=${page||1}`),
  addComment: (id, text) => post(`/posts/${id}/comments`, {content:text}, true),
  comment: (id, text) => post(`/posts/${id}/comments`, { body: text }),
  deleteComment: (cid)     => del(`/posts/comments/${cid}`),
  save:      (id)          => post(`/saved/${id}`),
  unsave:    (id)          => del(`/saved/${id}`),
};

// â”€â”€ VET API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ NOTIFICATION API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const NotifAPI = {
  list:       (page)      => get(`/notifications?page=${page||1}`),
  markAll:    ()          => patch('/notifications/read-all'),
  markOne:    (id)        => patch(`/notifications/${id}/read`),
  delete:     (id)        => del(`/notifications/${id}`),
};

// â”€â”€ MESSAGE API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ SAVED API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SavedAPI = {
  list:   (page) => get(`/saved?page=${page||1}`),
  save:   (id)   => post(`/saved/${id}`),
  unsave: (id)   => del(`/saved/${id}`),
};

// â”€â”€ MEDIA API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const headers = {};
    if (getToken()) headers['Authorization'] = 'Bearer ' + getToken();
    const res = await fetch(API_BASE + '/media/upload', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: fd
    });
    return res.json();
  },
};

// â”€â”€ GROUP API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GroupAPI = {
  list:    (params) => get(`/groups?${new URLSearchParams(params||{})}`),
  get:     (id)     => get(`/groups/${id}`, false),
  create:  (data)   => post('/groups', data),
  join:    (id)     => post(`/groups/${id}/join`),
  leave:   (id)     => post(`/groups/${id}/leave`),
  posts:   (id, p)  => get(`/groups/${id}/posts?limit=20&offset=${((p||1)-1)*20}`),
  feed:    (id, p)  => get(`/groups/${id}/posts?limit=20&offset=${((p||1)-1)*20}`), // alias
  post:    (id, d)  => post(`/groups/${id}/posts`, d),
  members: (id)     => get(`/groups/${id}/members`),
  media:   (id)     => get(`/groups/${id}/media`),
};

// â”€â”€ LOST PET API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LostPetAPI = {
  list:     (params) => get(`/lost-pets?${new URLSearchParams(params||{})}`),
  get:      (id)     => get(`/lost-pets/${id}`, false),
  report:   (data)   => post('/lost-pets', data),
  update:   (id, d)  => patch(`/lost-pets/${id}`, d),
  sighting: (id, d)  => post(`/lost-pets/${id}/sightings`, d),
};

// â”€â”€ ADOPTION API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AdoptionAPI = {
  pets:       (params) => get(`/adoptions/pets?${new URLSearchParams(params||{})}`),
  pet:        (id)     => get(`/adoptions/pets/${id}`, false),
  shelters:   ()       => get('/adoptions/shelters', false),
  inquire:    (data)   => post('/adoptions/inquire', data),
  myInquiries:()       => get('/adoptions/my-inquiries'),
};

// â”€â”€ MARKETPLACE API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  addCart:        (product_id, quantity) => post('/marketplace/cart', { product_id, quantity: quantity || 1 }),
  updateCart:     (id, qty)=> patch(`/marketplace/cart/${id}`, { quantity: qty }),
  removeCart:     (id)     => del(`/marketplace/cart/${id}`),
  placeOrder:     (data)   => post('/marketplace/orders', data),
  myOrders:       (page)   => get(`/marketplace/orders?page=${page||1}`),
  order:          (id)     => get(`/marketplace/orders/${id}`),
  myStore:        ()       => get('/marketplace/store/me'),
  createStore:    (data)   => post('/marketplace/store', data),
};

// â”€â”€ EVENTS API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const EventAPI = {
  list:   (page)  => get(`/events?page=${page||1}`),
  get:    (id)    => get(`/events/${id}`),
  create: (data)  => post('/events', data),
  rsvp:   (id)    => post(`/events/${id}/rsvp`),
  delete: (id)    => del(`/events/${id}`),
};

// â”€â”€ TRAINING API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TrainingAPI = {
  programs:   ()          => get('/training/programs', false),
  lessons:    (id)        => get(`/training/programs/${id}/lessons`, false),
  my:         ()          => get('/training/my'),
  enroll:     (id)        => post('/training/enroll', { program_id: id }),
  progress:   (id, data)  => patch(`/training/progress/${id}`, data),
};

// â”€â”€ INSURANCE API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const InsuranceAPI = {
  plans:      ()      => get('/insurance/plans', false),
  my:         ()      => get('/insurance/my'),
  subscribe:  (id)    => post('/insurance/subscribe', { plan_id: id }),
  cancel:     (id)    => del(`/insurance/${id}`),
};

// â”€â”€ NUTRITION API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const NutritionAPI = {
  plans:      ()      => get('/nutrition/plans', false),
  plan:       (id)    => get(`/nutrition/plans/${id}`, false),
  foods:      ()      => get('/nutrition/foods', false),
  recommend:  ()      => get('/nutrition/recommend', false),
  myPlans:    ()      => get('/nutrition/my-plans'),
  savePlan:   (data)  => post('/nutrition/my-plans', data),
  removePlan: (id)    => del(`/nutrition/my-plans/${id}`),
};

// â”€â”€ ANALYTICS API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AnalyticsAPI = {
  me: () => get('/analytics/me'),
};

// â”€â”€ TRAVEL API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TravelAPI = {
  destinations: ()      => get('/travel/destinations', false),
  destination:  (id)    => get(`/travel/destinations/${id}`, false),
  saved:        ()      => get('/travel/saved'),
  save:         (id)    => post('/travel/save', { dest_id: id }),
  unsave:       (id)    => del(`/travel/save/${id}`),
};

// â”€â”€ FUNDRAISING API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FundraisingAPI = {
  list:     (page)  => get(`/fundraising?page=${page||1}`),
  get:      (id)    => get(`/fundraising/${id}`),
  create:   (data)  => post('/fundraising', data),
  donate:   (id, d) => post(`/fundraising/${id}/donate`, d),
};

// â”€â”€ ACTIVITY API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ActivityAPI = {
  list: (page) => get(`/activity?page=${page||1}`),
  log:  (data) => post('/activity', data),
};

// â”€â”€ MEMORIES API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MemoriesAPI = {
  memories:  () => get('/memories'),
  birthdays: () => get('/birthdays'),
};

// â”€â”€ SEARCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SearchAPI = {
  all: (q, category) => get(`/search?q=${encodeURIComponent(q)}&category=${category||'all'}`),
};

// â”€â”€ PAWMATCH API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PawMatchAPI = {
  candidates: (params) => get(`/pawmatch?${new URLSearchParams(params||{})}`),
  like:       (id)     => post(`/pawmatch/${id}/like`),
  pass:       (id)     => post(`/pawmatch/${id}/pass`),
  matches:    ()       => get('/pawmatch/matches'),
};

// â”€â”€ HEALTH CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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



