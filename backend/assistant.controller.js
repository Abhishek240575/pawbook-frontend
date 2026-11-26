'use strict';
/* ============================================================================
   PawBook Assistant (page 35) — mounted under /api/v1/assistant (see add_shop_routes.js).
   - Answers questions about PawBook and pet care, and points to the right PawBook page.
   - Finds REAL listings (vets, pets for adoption, lost & found, products, communities, events) through the
     same search as page 15 (search.controller.find) — it never invents listings, counts, prices or phone numbers.
   - Knows the user's own pets, vaccinations that are due and upcoming vet appointments.
   - Emergencies get a fixed, safe reply at once (SOS on page 37, 112, the vet) — never waits for the AI.
   - Uses Claude when ANTHROPIC_API_KEY is set (same key as the AI Health Agent); otherwise answers from rules.
   - Keeps the conversation per user (pb_assistant_messages) and takes support requests (pb_support_tickets).
   Migration: 020_assistant.sql.
   ========================================================================== */
const db = require('../config/db');
const { query } = db;
const R = require('../utils/response');
const search = require('./search.controller');

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const uid = u => String(u && (u.user_id || u.id) || '');
const fail = (res, where, e) => { console.error('[Assistant] ' + where + ':', e.message); return R.serverError(res); };
const bad = (res, fields, msg) => res.status(422).json({ success: false, message: msg || 'Please check the highlighted fields.', fields });
const first = n => (n ? String(n).trim().split(/\s+/)[0] : null);
const d10 = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10); };
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const qi = n => '"' + String(n).replace(/"/g, '') + '"';
const SCHEMA = {};
async function cols(t) { if (SCHEMA[t]) return SCHEMA[t]; const { rows } = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [t]); const m = {}; rows.forEach(r => { m[r.column_name] = true; }); if (rows.length) SCHEMA[t] = m; return m; }
const pick = (c, l) => l.find(n => c[n]) || null;

async function me(req) {
  const id = uid(req.user), u = await cols('users');
  const { rows } = await query(`SELECT full_name, ${u.role ? 'role' : 'NULL AS role'}${u.user_no ? ', user_no::text AS no' : ''}${u.city ? ', city' : ''} FROM users WHERE user_id::text = $1`, [id]);
  const r = rows[0] || {}; return { id, ids: [id].concat(r.no ? [r.no] : []), name: r.full_name || null, admin: r.role === 'admin', city: r.city || null };
}
async function notify(userId, title, body, link) {
  try { await query(`INSERT INTO notifications (user_id, type, title, body, link_url, icon_emoji) VALUES ($1,'system',$2,$3,$4,'🐾')`, [userId, String(title).slice(0, 200), body ? String(body).slice(0, 500) : null, link || null]); }
  catch (e) { console.error('[Assistant] notify:', e.message); }
}

// ── PawBook pages the assistant may send people to (the only links it uses) ──
const PAGES = {
  home: ['07_home.html', 'Home feed'], pets: ['36_pet_life_record.html', 'My pets & health records'], vacc: ['10_vaccination.html', 'Vaccinations'],
  vet: ['11_vet_booking.html', 'Book a vet'], appts: ['11_vet_booking.html?tab=appointments', 'My appointments'], health: ['37_pet_ai_health_agent.html', 'AI health check'],
  sos: ['37_pet_ai_health_agent.html?sos=1', 'Emergency SOS'], nearby: ['37_pet_ai_health_agent.html?tab=nearby', 'Nearby help'], lost: ['38_lost_pet_network.html', 'Lost & Found'],
  adopt: ['39_adoption_matching.html', 'Adopt a pet'], shop: ['42_shop.html', 'Pet shop'], orders: ['53_shop_orders.html', 'My orders'], groups: ['03_groups.html', 'Communities'],
  events: ['30_events.html', 'Events'], search: ['15_search.html', 'Search'], saved: ['31_saved.html', 'My PawBook'], abuse: ['36_abuse_reporting.html', 'Report animal cruelty'],
  training: ['22_training.html', 'Training & behaviour'], insurance: ['21_pet_insurance.html', 'Pet insurance'], settings: ['14_settings.html', 'Settings'], messages: ['13_messages.html', 'Messages'],
  notifications: ['12_notifications.html', 'Notifications'], seller: ['49_seller_join.html', 'Sell on PawBook'], profile: ['29_user_profile.html', 'My profile']
};
const act = (k, label) => ({ label: label || PAGES[k][1], url: PAGES[k][0] });

// ── intents ──────────────────────────────────────────────────────────────────
const RX = {
  emergency: /\b(emergenc\w*|urgent(ly)?|bleed\w*|vomit\w* blood|blood in|poison\w*|toxic|not breathing|can'?t breathe|cannot breathe|breathing (hard|fast|difficult)|unconscious|collaps\w*|seizure\w*|fits?\b|convuls\w*|hit by|(road|car|bike) accident|met with (an )?accident|chok\w*|heat ?stroke|dying|swallowed|ate (rat|chocolate|grapes|poison|medicine|tablets?)|snake ?bite|electrocut\w*|broken (leg|bone)|can'?t stand|paraly\w*)/i,
  abuse: /\b(abuse\w*|cruel\w*|beat(ing|en)?|torture\w*|neglect\w*|chained|starv\w*)\b/i,
  support: /\b(complain\w*|grievance|refund|scam\w*|fraud\w*|cheat\w*|harass\w*|not working|bug|error|broken page|problem with|issue with|support|customer care|help ?desk|contact (you|the team|support|pawbook)|talk to (a )?(human|person|someone))\b/i,
  orders: /\b(my orders?|order status|track(ing)? (my )?order|delivery|delivered|return (my|an) order|cancel (my|the) order)\b/i,
  appts: /\b(my appointments?|my bookings?|upcoming (visit|appointment)s?|when is my (vet|appointment))\b/i,
  vacc: /\b(vaccin\w*|booster|rabies|deworm\w*|due (date|dose)|shots?)\b/i,
  mypets: /\b(my pets?|my dogs?|my cats?|my puppy|my kitten|pet profile|health record)\b/i,
  lost: /\b(lost|missing|ran away|run away|found a (dog|cat|pet|puppy|kitten)|stray)\b/i,
  adopt: /\b(adopt\w*|rescue|foster\w*|rehom\w*)\b/i,
  vet: /\b(vets?|veterinar\w*|doctor|clinic|hospital|consult\w*|check-?up)\b/i,
  places: /\b(shelters?|ngos?|groom\w*|salons?|pet spa|boarding|daycare|day care|kennels?|pet hostel|pet (shop|store)s?|pet hotels?)\b/i,
  shop: /\b(buy|shop\w*|food|treats?|toys?|leash|collar|harness|bed|shampoo|litter|kibble|products?|price|cheap|deal)\b/i,
  groups: /\b(groups?|communit\w*|meetups?|clubs?|pet parents near)\b/i,
  events: /\b(events?|shows?|camps?|workshops?|festival|competition)\b/i,
  training: /\b(train\w*|bark\w*|bit(e|ing|es)|nipp\w*|potty|toilet|pee\w*|poop\w*|leash pulling|pulls on|obedien\w*|behaviou?r\w*|aggressi\w*|commands?)\b/i,
  insurance: /\b(insurance|insure|policy|claim)\b/i,
  account: /\b(password|log ?in|sign ?in|account|privacy|delete my account|settings|profile photo|change (my )?(name|email|phone))\b/i,
  sell: /\b(sell|seller|my store|list my product)\b/i,
  search: /\b(find|search|look(ing)? for|show me|near me|where can i)\b/i,
  greet: /^\s*(hi+|hello+|hey+|namaste|hola|good (morning|afternoon|evening)|yo)\b[\s!.]*$/i,
  thanks: /^\s*(thanks?|thank you|thx|ty|great|ok(ay)?|cool|nice)\b[\s!.]*$/i,
  capabilities: /\b(what can you do|what do you do|help me|capabilit\w*|features?|how does pawbook work|what is pawbook)\b/i
};
const ORDER = ['emergency', 'abuse', 'support', 'orders', 'appts', 'vacc', 'lost', 'adopt', 'vet', 'places', 'groups', 'events', 'training', 'insurance', 'sell', 'shop', 'account', 'mypets', 'capabilities', 'greet', 'thanks', 'search'];
function detect(msg) { const hits = ORDER.filter(k => RX[k].test(msg)); return { main: hits[0] || 'general', all: hits }; }

const CITIES = ['delhi', 'new delhi', 'mumbai', 'bombay', 'bangalore', 'bengaluru', 'chennai', 'kolkata', 'hyderabad', 'pune', 'ahmedabad', 'jaipur', 'lucknow', 'chandigarh', 'gurgaon', 'gurugram', 'noida', 'ghaziabad', 'faridabad', 'kochi', 'thiruvananthapuram', 'coimbatore', 'indore', 'bhopal', 'nagpur', 'surat', 'vadodara', 'patna', 'bhubaneswar', 'guwahati', 'dehradun', 'mysore', 'mysuru', 'mangalore', 'visakhapatnam', 'vijayawada', 'nashik', 'kanpur', 'varanasi', 'agra', 'amritsar', 'ludhiana', 'raipur', 'ranchi', 'goa', 'panaji', 'shimla', 'srinagar', 'jammu', 'udaipur', 'jodhpur', 'madurai', 'trichy', 'thane', 'navi mumbai'];
function cityOf(msg) { const m = ' ' + msg.toLowerCase().replace(/[^a-z ]+/g, ' ') + ' '; let best = null; CITIES.forEach(c => { if (m.includes(' ' + c + ' ') && (!best || c.length > best.length)) best = c; }); return best; }
const FILLER = new Set(('i me my we you your a an the to for of in on at near nearby around close closest nearest city town area place location locality neighbourhood neighborhood is are am be was it this that there here please pls plz can could would should will want wanna need looking look find search show me give tell list any some all available ' +
  'how what where which who when do does get got have has with and or from by about best good top new latest cheap online ' +
  'adopt adoption adopting rescue foster vet vets veterinarian veterinary doctor doctors clinic clinics hospital book booking appointment consult consultation ' +
  'buy shop shopping product products price order lost missing found stray group groups community communities meetup meetups event events pet pets animal animals').split(' '));
function termsOf(msg, city) {
  let t = msg.toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ');
  if (city) t = (' ' + t + ' ').replace(' ' + city + ' ', ' ');
  return t.split(/\s+/).filter(w => w.length >= 2 && !FILLER.has(w)).slice(0, 5).join(' ');
}

// ── the user's own data ──────────────────────────────────────────────────────
async function myData(M) {
  const out = { pets: [], due: [], appts: [] };
  try {
    const p = await cols('pets'); if (!p.name) return out;
    const id = pick(p, ['id', 'pet_id']), owner = pick(p, ['user_id', 'owner_id']); if (!id || !owner) return out;
    const { rows } = await query(`SELECT ${qi(id)}::text AS id, name, ${p.species ? 'species' : 'NULL AS species'}, ${p.breed ? 'breed' : 'NULL AS breed'} FROM pets WHERE ${qi(owner)}::text = ANY($1) ORDER BY name LIMIT 12`, [M.ids]);
    out.pets = rows;
    const v = await cols('pet_vaccinations'), vn = pick(v, ['vaccine_name', 'name', 'vaccine']), vd = pick(v, ['next_due_date', 'next_due', 'due_date']);
    if (rows.length && vn && vd && v.pet_id) {
      const r = await query(`SELECT pet_id::text AS pet, ${qi(vn)} AS vaccine, ${qi(vd)} AS due FROM pet_vaccinations WHERE pet_id::text = ANY($1) AND ${qi(vd)} IS NOT NULL AND ${qi(vd)} <= (CURRENT_DATE + 60) ORDER BY ${qi(vd)} LIMIT 10`, [rows.map(x => x.id)]);
      const nm = {}; rows.forEach(x => { nm[x.id] = x.name; });
      // keep only the latest record per pet + vaccine (an older dose's "next due" is replaced by the newer dose)
      const seen = {}; out.due = r.rows.filter(x => { const k = x.pet + '|' + String(x.vaccine).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }).map(x => ({ pet: nm[x.pet] || 'Your pet', pet_id: x.pet, vaccine: x.vaccine, due: d10(x.due), overdue: d10(x.due) < todayIST() }));
    }
    const a = await cols('vet_appointments');
    if (a.appt_date && a.user_id) {
      const r = await query(`SELECT a.appt_date, a.appt_time, a.reason, v.first_name, v.last_name, v.clinic_name, p.name AS pet FROM vet_appointments a LEFT JOIN vets v ON v.vet_id = a.vet_id LEFT JOIN pets p ON p.${qi(id)}::text = a.pet_id::text
        WHERE a.user_id::text = ANY($1) AND a.status = 'upcoming' AND a.appt_date >= CURRENT_DATE ORDER BY a.appt_date, a.appt_time LIMIT 5`, [M.ids]);
      out.appts = r.rows.map(x => ({ date: d10(x.appt_date), time: x.appt_time ? String(x.appt_time).slice(0, 5) : null, pet: x.pet || null, vet: [x.first_name, x.last_name].filter(Boolean).length ? 'Dr. ' + [x.first_name, x.last_name].filter(Boolean).join(' ') : null, clinic: x.clinic_name || null, reason: x.reason || null }));
    }
  } catch (e) { console.error('[Assistant] myData:', e.message); }
  return out;
}
const fmtDate = d => { if (!d) return ''; const x = new Date(d + 'T00:00:00'); return x.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); };

// ── listings from PawBook (real data only) ───────────────────────────────────
const TYPES_FOR = { adopt: ['adoption'], vet: ['vets'], lost: ['lost'], shop: ['products'], groups: ['communities'], events: ['events'], search: null, general: null };
async function listings(req, intent, msg, city, loc) {
  if (!(intent in TYPES_FOR)) return null;
  const terms = termsOf(msg, city);
  const types = TYPES_FOR[intent] || ['pets', 'vets', 'communities', 'products', 'adoption', 'lost', 'events', 'shelters'];
  const specific = !!TYPES_FOR[intent];
  let r;
  if (terms && terms.length >= 2) r = await search.find(req, terms, { types, city: city || '', lim: city ? 12 : 4, noPartial: true });
  else if (specific && (city || intent === 'adopt' || intent === 'events' || intent === 'lost')) r = await search.find(req, '', { types, city: city || '', lim: city ? 12 : 4, browse: true });   // e.g. "pets for adoption near me"
  else return city ? { q: '', city, terms: '', total: 0, match: 'none', cards: [], sections: [], near: 0, area: loc && loc.area } : null;
  let cards = [];
  r.sections.forEach(s => s.items.forEach(x => cards.push(Object.assign({ type: s.type }, pickCard(x)))));
  let total = r.total, sections = r.sections.map(s => ({ type: s.type, count: s.count }));
  // a city was given and some results are there: show ONLY those (never mix in other cities); the chosen area comes first
  if (city && cards.some(c => c.near)) {
    cards = cards.filter(c => c.near);
    const ar = loc && loc.area ? loc.area.toLowerCase() : '';
    if (ar) cards.sort((a, b) => (JSON.stringify(b).toLowerCase().includes(ar) ? 1 : 0) - (JSON.stringify(a).toLowerCase().includes(ar) ? 1 : 0));
    const byType = {}; cards.forEach(c => { byType[c.type] = (byType[c.type] || 0) + 1; });
    sections = Object.keys(byType).map(t => ({ type: t, count: byType[t] })); total = cards.length;
  }
  cards = cards.slice(0, 6);
  const near = cards.filter(c => c.near).length, ar2 = loc && loc.area ? loc.area.toLowerCase() : '', areaHits = ar2 ? cards.filter(c => JSON.stringify(c).toLowerCase().includes(ar2)).length : 0;
  return { q: terms, city, terms, total, match: r.match, cards, sections, near, area: loc && loc.area, areaHits, inCityOnly: !!(city && near) };
}
// a chosen location from the page: country / state / district or city / area / PIN
const DISTRICT_CITY = { 'bengaluru urban': 'bengaluru', 'bengaluru rural': 'bengaluru', 'bangalore urban': 'bengaluru', 'mumbai suburban': 'mumbai', 'gautam buddha nagar': 'noida', 'medchal malkajgiri': 'hyderabad', 'rangareddy': 'hyderabad', 'ranga reddy': 'hyderabad', 'gurgaon': 'gurugram', 'kolkata': 'kolkata', 'north 24 parganas': 'kolkata', 'south 24 parganas': 'kolkata', 'ernakulam': 'kochi', 'thane': 'thane' };
function locOf(b) {
  const l = b && typeof b.location === 'object' && b.location ? b.location : null; if (!l) return null;
  const o = { country: str(l.country, 60) || 'India', state: str(l.state, 80), city: str(l.city, 80), area: str(l.area, 100), pin: /^\d{6}$/.test(str(l.pin, 6)) ? str(l.pin, 6) : '' };
  if (!o.state && !o.city && !o.pin) return null;
  let c = o.city.toLowerCase().replace(/\s+district$/, '').trim();
  if (/^(nct of )?delhi$/i.test(o.state)) c = 'new delhi';
  else c = DISTRICT_CITY[c] || c.replace(/\s+(urban|rural)$/, '');
  o.searchCity = c;
  o.label = [o.area, o.city, o.state].filter(Boolean).join(', ') + (o.pin ? ' ' + o.pin : '');
  const la = Number(l.lat), ln = Number(l.lng);
  if (isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && (la || ln)) { o.lat = Math.round(la * 1e5) / 1e5; o.lng = Math.round(ln * 1e5) / 1e5; }
  return o;
}
function pickCard(x) { const o = {}; ['title', 'sub', 'meta', 'img', 'url', 'action', 'badge', 'price', 'mrp', 'at', 'near', 'verified', 'phone'].forEach(k => { if (x[k] != null && x[k] !== '') o[k] = x[k]; }); return o; }
const TYPE_ONE = { adoption: 'pet for adoption', vets: 'vet', lost: 'lost & found case', products: 'product', communities: 'community', events: 'event', pets: 'pet', shelters: 'shelter', people: 'person' };
const TYPE_WORD = { adoption: 'pets for adoption', vets: 'vets', lost: 'lost & found cases', products: 'products', communities: 'communities', events: 'events', pets: 'pets', shelters: 'shelters', people: 'people' };

// ── rule-based replies (used when the AI is off, and as the safe base for every reply) ──
const SUGG = {
  general: ['Find a vet near me', 'Pets for adoption', 'My vaccinations', 'Report a lost pet'],
  emergency: ['Open SOS', 'First aid for heatstroke', 'Find a vet near me'],
  vacc: ['Book a vaccination visit', 'My pets', 'Puppy vaccine schedule'],
  vet: ['My appointments', 'Vets in Delhi', 'AI health check'],
  adopt: ['Dogs for adoption', 'Cats for adoption', 'How does adoption work?'],
  lost: ['Report a lost pet', 'I found a pet', 'Lost pets near me'],
  shop: ['Dog food', 'Cat litter', 'My orders'],
  groups: ['Communities near me', 'Create a community', 'Upcoming meetups'],
  events: ['Events this weekend', 'Communities near me'],
  training: ['Stop leash pulling', 'Potty training a puppy', 'Find a trainer'],
  support: ['Raise a support request', 'Report a listing', 'My support requests'],
  account: ['Change my password', 'Privacy settings', 'Delete my account'],
  places: ['Vets near me', 'Animal shelters near me', 'Pet groomers near me']
};
function rules(intent, msg, ctx) {
  const { M, mine, found } = ctx, name = first(M.name);
  const L = []; let actions = [], text = '';
  const foundLine = f => { if (!f || !f.total) return null;
    const what = f.sections.map(s => (s.count === 1 ? TYPE_ONE[s.type] : TYPE_WORD[s.type]) || s.type).join(', ');
    if (f.city && !f.near) return `There's nothing listed in ${cap(f.city)} yet, so here are the closest matches elsewhere on PawBook (${f.total} ${what}):`;
    return `I found ${f.total} ${what} on PawBook${f.city ? ' in ' + cap(f.city) : ''}${f.areaHits && f.inCityOnly ? ' (' + cap(f.area) + ' first)' : ''}${f.match === 'close' ? ' (closest spellings)' : ''}:`; };
  const none = (what, page) => found && !found.q && found.city ? `No ${what.replace(/^an? /, '').replace(/ matching that$/, 's').replace(/ss$/, 's')} are listed on PawBook in ${cap(found.city)} yet. You can check the ${PAGES[page][1]} page, which is updated as new ones join.` : `I couldn't find ${what}${found && found.city ? ' in ' + cap(found.city) : ''} on PawBook right now. You can browse everything on the ${PAGES[page][1]} page.`;
  switch (intent) {
    case 'greet': text = `Hi${name ? ' ' + name : ''}! 🐾 I can find vets, pets for adoption, products and communities on PawBook, check your pets' vaccinations and appointments, or answer pet-care questions. What do you need?`; break;
    case 'thanks': text = 'Happy to help! 🐾 Ask me anything else whenever you need.'; break;
    case 'capabilities': case 'general':
      text = found && found.total ? foundLine(found) : `I can help you with:\n• **Finding** vets, pets for adoption, lost & found cases, products, communities and events on PawBook\n• **Your pets** — vaccinations due and upcoming vet visits\n• **Pet-care questions** — food, training, grooming, health basics\n• **Help & complaints** — I can raise a support request for you\n\nTry: “Labrador for adoption in Delhi” or “When is Bruno's next vaccine?”`;
      if (!found || !found.total) actions = [act('search'), act('vet'), act('adopt'), act('health')]; else actions = [act('search', 'See all results')];
      break;
    case 'vacc': case 'mypets': case 'appts': {
      if (intent !== 'appts') {
        if (!mine.pets.length) { text = `You haven't added a pet yet. Add your pet on **My pets** to track vaccinations, medicines and vet visits — I'll remind you when a dose is due.`; actions = [act('pets', 'Add my pet')]; break; }
        L.push(`Your pets: ${mine.pets.map(p => '**' + p.name + '**' + (p.breed ? ' (' + p.breed + ')' : p.species ? ' (' + p.species + ')' : '')).join(', ')}.`);
        if (mine.due.length) L.push('\nVaccinations due soon:\n' + mine.due.map(d => `• ${d.pet} — ${d.vaccine}: ${d.overdue ? '**overdue** since ' : ''}${fmtDate(d.due)}`).join('\n'));
        else if (intent === 'vacc') L.push('\nNothing is due in the next 60 days based on the records you have added. 👍');
      }
      if (intent !== 'mypets' || mine.appts.length) {
        if (mine.appts.length) L.push((L.length ? '\n' : '') + 'Upcoming vet visits:\n' + mine.appts.map(a => `• ${fmtDate(a.date)}${a.time ? ' at ' + a.time : ''}${a.pet ? ' — ' + a.pet : ''}${a.vet ? ' with ' + a.vet : ''}${a.clinic ? ', ' + a.clinic : ''}`).join('\n'));
        else if (intent === 'appts') L.push('You have no upcoming vet appointments.');
      }
      text = L.join('\n'); actions = intent === 'appts' ? [act('appts'), act('vet')] : [act('vacc'), act('pets'), act('vet', 'Book a vaccination visit')];
      break; }
    case 'vet': text = found && found.total ? foundLine(found) + '\nOpen a vet to see their timings and book a visit.' : (found ? none('a vet matching that', 'vet') : `You can book in-clinic or video visits with verified vets on **Book a vet**. Tell me your city (e.g. “vets in Pune”) and I'll look for vets on PawBook.`)
      + `\n\nIf your pet seems unwell right now, the **AI health check** can help you judge how urgent it is.`; actions = found && !found.total ? [act('vet'), act('nearby', 'Clinics near me on the map'), act('health')] : [act('vet'), act('appts'), act('health')]; break;
    case 'adopt': text = found && found.total ? foundLine(found) : (found ? none('pets for adoption matching that', 'adopt') : `Pets waiting for a home are listed by shelters and rescuers on **Adopt a pet**. Tell me what you're looking for — e.g. “indie puppy in Delhi” or “cat for adoption in Pune”.`)
      + `\n\nAdoption on PawBook: send an interest request → the shelter reviews it → meet the pet → home visit and adoption. Never pay anyone outside PawBook for a “free” adoption.`; actions = [act('adopt')]; break;
    case 'lost': text = (found && found.total ? foundLine(found) + '\n\n' : '') + `**Lost your pet?** Report it on **Lost & Found** with a clear photo and the area it was last seen — people nearby are alerted, and your phone number stays hidden.\n**Found a pet?** Post it there too, keep it safe, and check for a collar tag. A vet can scan for a microchip for free in most clinics.`;
      actions = [act('lost', 'Report a lost pet'), act('lost', 'I found a pet')]; actions[1].url = PAGES.lost[0] + '?found=1'; break;
    case 'shop': text = found && found.total ? foundLine(found) : (found ? none('products matching that', 'shop') : `The **Pet shop** has food, treats, toys, grooming and care products from verified sellers. Tell me what you need — e.g. “puppy food” or “cat litter”.`); actions = [act('shop'), act('orders')]; break;
    case 'orders': text = `You can see every order, its delivery status, invoices and returns on **My orders**. If something went wrong with an order, I can raise a support request for you.`; actions = [act('orders'), { label: 'Raise a support request', url: '#support' }]; break;
    case 'groups': text = found && found.total ? foundLine(found) : (found ? none('a community matching that', 'groups') : `**Communities** bring together pet parents by city, area, breed or interest. Public ones you can join at once; private ones need an admin's approval. You can also start your own.`); actions = [act('groups'), { label: 'Create a community', url: '03_groups.html?create=1' }]; break;
    case 'events': text = found && found.total ? foundLine(found) : (found ? none('events matching that', 'events') : `Pet events — meetups, adoption drives, camps and shows — are listed on **Events**.`); actions = [act('events'), act('groups')]; break;
    case 'training': text = `A few basics that work for most dogs:\n• **Reward what you want** — treat or praise within 2 seconds of the right behaviour\n• **Short sessions** — 5–10 minutes, a few times a day\n• **Potty training** — take puppies out after waking, eating and play; reward outside, don't punish accidents\n• **Leash pulling** — stop when the leash goes tight, move again when it's loose\n• **Biting / nipping** — stop play for a moment and offer a chew toy instead\n\nFor aggression or fear, please see a qualified trainer or your vet.`; actions = [act('training'), act('groups', 'Ask other pet parents')]; break;
    case 'insurance': text = `See the **Pet insurance** page for the options available on PawBook. Before you buy any policy, check what is excluded, the waiting period and the claim process.`; actions = [act('insurance')]; break;
    case 'account': text = `Your name, photo, password, privacy and notification choices are in **Settings**. To delete your account, open Settings → Account. If you can't sign in, use “Forgot password” on the login page.`; actions = [act('settings'), act('profile')]; break;
    case 'sell': text = `Sellers can list products in the PawBook shop after a quick verification. Start on **Sell on PawBook**.`; actions = [act('seller')]; break;
    case 'abuse': text = `If an animal is being hurt right now, call **112**. Then report it on **Report animal cruelty** with photos, the place and time — the report goes to verified animal-welfare organisations, and you can stay anonymous.`; actions = [act('abuse'), act('nearby')]; break;
    case 'support': text = `I'm sorry about the trouble${name ? ', ' + name : ''}. I can raise a **support request** for the PawBook team — you'll get a reference number and a reply in your notifications. You can also write to **support@deemona.com**.\n\nFor grievances under the IT Rules, 2021, write to the Grievance Officer, Deemona Global Solutions, New Delhi 110075 (support@deemona.com).`;
      actions = [{ label: 'Raise a support request', url: '#support' }, { label: 'My support requests', url: '#tickets' }]; break;
    case 'search': text = found && found.total ? foundLine(found) : (found ? `I couldn't find anything matching “${found.q}” on PawBook. Try other words, or browse with **Search**.` : `What should I look for? Try a breed, a vet's name, a product or a city.`); actions = [act('search', found && found.total ? 'See all results' : 'Open Search')]; if (found && found.q) actions[0].url = PAGES.search[0] + '?q=' + encodeURIComponent(found.q); break;
  }
  return { text, actions, suggestions: SUGG[intent] || SUGG.general };
}
const cap = s => String(s || '').replace(/\b\w/g, m => m.toUpperCase());

// ── emergency: fixed safe reply (never waits for the AI) ─────────────────────
function emergencyReply() {
  return {
    text: `🚨 **This sounds like an emergency.**\n\n1. **Go to a vet now** — the nearest open clinic is better than waiting. Call ahead if you can.\n2. Open **Emergency SOS** for first-aid steps and vets & shelters near you.\n3. If a person is in danger or you need police or an ambulance, call **112**. For government mobile veterinary units, **1962** (available in many states, mainly for livestock).\n\nWhile you travel: keep your pet calm and warm, don't give human medicines, and don't make your pet vomit unless a vet tells you to.`,
    actions: [act('sos', 'Open Emergency SOS'), act('nearby', 'Vets & shelters near me'), { label: 'Call 112', url: 'tel:112' }],
    suggestions: ['First aid for bleeding', 'First aid for heatstroke', 'My pet ate chocolate']
  };
}

// ── Claude (optional) ────────────────────────────────────────────────────────
// ── Google Maps Places (server side) ─────────────────────────────────────────
// Uses the Google key already in .env (first of these names that is set). Only called when someone asks for vets,
// shelters, groomers, boarding or pet shops near a place. Results are shown live with "Google Maps" attribution and
// are never stored. A daily cap (PB_GOOGLE_DAILY_CAP, default 300 calls) keeps the bill predictable.
const GKEYS = ['GOOGLE_MAPS_SERVER_KEY', 'GOOGLE_PLACES_API_KEY', 'GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_KEY', 'GOOGLE_API_KEY', 'MAPS_API_KEY', 'GMAPS_KEY', 'GOOGLE_KEY'];
const gKey = () => { const n = GKEYS.find(k => process.env[k] && String(process.env[k]).trim().length > 20); return n ? { name: n, key: String(process.env[n]).trim() } : null; };
const G = { off: 0, err: null, day: '', calls: 0 };
const gOn = () => (process.env.PB_GOOGLE_MOCK === '1' || !!gKey()) && process.env.PB_GOOGLE_PLACES !== '0' && Date.now() > G.off;
function gBudget() { const d = todayIST(); if (G.day !== d) { G.day = d; G.calls = 0; } const cap = parseInt(process.env.PB_GOOGLE_DAILY_CAP, 10) || 300; if (G.calls >= cap) return false; G.calls++; return true; }
async function gFetch(url, body, mask) {
  if (process.env.PB_GOOGLE_MOCK === '1') { const c = body.locationRestriction || body.locationBias; const la = c.circle.center.latitude, ln = c.circle.center.longitude;   // tests only
    return { places: [{ id: 'g1', displayName: { text: 'Mock Pet Clinic' }, shortFormattedAddress: 'Sector 10, Dwarka', location: { latitude: la + 0.01, longitude: ln }, rating: 4.6, userRatingCount: 120, currentOpeningHours: { openNow: true }, nationalPhoneNumber: '011 0000 0000', googleMapsUri: 'https://maps.google.com/?cid=1', businessStatus: 'OPERATIONAL' },
      { id: 'g2', displayName: { text: 'Closed Forever Vet' }, location: { latitude: la, longitude: ln }, businessStatus: 'CLOSED_PERMANENTLY' }, { id: 'g3', displayName: { text: 'Mock Animal Hospital' }, shortFormattedAddress: 'Sector 6, Dwarka', location: { latitude: la + 0.002, longitude: ln }, googleMapsUri: 'https://evil.example/x', businessStatus: 'OPERATIONAL' }] }; }
  const k = gKey(); if (!k || !gBudget()) return null;
  const r = await fetch(url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(9000), headers: Object.assign({ 'X-Goog-Api-Key': k.key, 'content-type': 'application/json' }, mask ? { 'X-Goog-FieldMask': mask } : {}), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = (j.error && (j.error.status + ' ' + String(j.error.message || '').slice(0, 160))) || ('HTTP ' + r.status);
    if (r.status === 403 || r.status === 401 || r.status === 400) { G.off = Date.now() + 30 * 60000; }   // key not allowed for this: stop trying for 30 min
    if (G.err !== why) console.error('[Assistant] Google (' + k.name + '):', why); G.err = why;
    return null;
  }
  G.err = null; return j;
}
const KM = (a, b, c, d) => { const r = x => x * Math.PI / 180, dl = r(c - a), dn = r(d - b), h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)); };
async function gCenter(loc) {
  if (!loc) return null; if (loc.lat != null) return { lat: loc.lat, lng: loc.lng };
  if (process.env.PB_GOOGLE_MOCK === '1') return { lat: 28.59, lng: 77.05 };
  const k = gKey(); if (!k) return null;
  const addr = [loc.area, loc.city, loc.state, loc.pin, loc.country || 'India'].filter(Boolean).join(', ');
  if (!gBudget()) return null;
  try {
    const r = await fetch('https://maps.googleapis.com/maps/api/geocode/json?region=in&address=' + encodeURIComponent(addr) + '&key=' + encodeURIComponent(k.key), { signal: AbortSignal.timeout(8000) });
    const j = await r.json(); const g = j.results && j.results[0];
    if (!g) { if (j.status && j.status !== 'ZERO_RESULTS' && G.err !== j.status) { console.error('[Assistant] Google geocode (' + k.name + '):', j.status, String(j.error_message || '').slice(0, 160)); G.err = j.status; if (j.status === 'REQUEST_DENIED') G.off = Date.now() + 30 * 60000; } return null; }
    return { lat: g.geometry.location.lat, lng: g.geometry.location.lng };
  } catch (e) { return null; }
}
const GKIND = [
  [/\b(shelters?|ngos?|rescue)\b/i, 'shelter', { textQuery: 'animal shelter' }, '🏠', 'animal shelters'],
  [/\bgroom\w*|salons?|pet spa\b/i, 'groomer', { textQuery: 'pet grooming' }, '✂️', 'pet groomers'],
  [/\b(boarding|daycare|day care|kennels?|pet hostel|pet hotels?)\b/i, 'boarding', { textQuery: 'pet boarding' }, '🏨', 'pet boarding places'],
  [/\bpet (shop|store)s?\b/i, 'petstore', { includedTypes: ['pet_store'] }, '🛍️', 'pet shops'],
  [/./, 'vet', { includedTypes: ['veterinary_care'] }, '🏥', 'vet clinics']];
async function googlePlaces(msg, intent, loc) {
  if (!gOn() || !loc || !['vet', 'places'].includes(intent)) return null;
  const kind = intent === 'vet' ? GKIND[GKIND.length - 1] : (GKIND.find(k => k[0].test(msg)) || GKIND[GKIND.length - 1]);
  const c = await gCenter(loc); if (!c) return null;
  const mask = 'places.id,places.displayName,places.shortFormattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,places.nationalPhoneNumber,places.googleMapsUri,places.businessStatus';
  const circle = { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: 8000 } };
  const j = kind[2].includedTypes
    ? await gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: kind[2].includedTypes, maxResultCount: 8, rankPreference: 'DISTANCE', locationRestriction: circle, languageCode: 'en', regionCode: 'IN' }, mask)
    : await gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: kind[2].textQuery, maxResultCount: 8, rankPreference: 'DISTANCE', locationBias: circle, languageCode: 'en', regionCode: 'IN' }, mask);
  if (!j) return null;
  const list = (j.places || []).filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY' && p.location).map(p => {
    const km = KM(c.lat, c.lng, p.location.latitude, p.location.longitude), oh = p.currentOpeningHours;
    return { type: 'google', src: 'google', emoji: kind[3], title: (p.displayName && p.displayName.text) || 'Place', sub: p.shortFormattedAddress || '', km: Math.round(km * 10) / 10,
      meta: [km < 1 ? Math.round(km * 1000) + ' m away' : (Math.round(km * 10) / 10) + ' km away', oh && oh.openNow === true ? 'Open now' : oh && oh.openNow === false ? 'Closed now' : null, p.rating ? '★ ' + p.rating + (p.userRatingCount ? ' (' + p.userRatingCount + ')' : '') : null].filter(Boolean).join(' · '),
      phone: p.nationalPhoneNumber || null, url: /^https:\/\/(maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl|goo\.gl)/.test(p.googleMapsUri || '') ? p.googleMapsUri : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(((p.displayName && p.displayName.text) || '') + ' ' + (p.shortFormattedAddress || '')), action: 'Directions' };
  }).sort((a, b) => a.km - b.km).slice(0, 6);
  return { kind: kind[1], word: kind[4], cards: list, near: loc.area || loc.city || '' };
}

const SYSTEM = `You are the PawBook Assistant, a friendly helper inside PawBook — an Indian pet social & care app.
Rules:
- Be warm, clear and short (under 130 words). Use simple words. Use **bold** for key words and "• " bullets when listing. Reply in the language the user writes in (English, Hindi or Hinglish).
- Only mention PawBook pages from the PAGES list, by their name. Never write URLs; the app adds buttons for you.
- Never invent listings, people, vets, shelters, prices, member counts, ratings, phone numbers, plans or features. Only use facts given under PAWBOOK DATA and USER. If the data has no results, say so and suggest the right page.
- The only phone numbers you may give: 112 (national emergency) and 1962 (government mobile vet units, mainly livestock, not in every state). Email: support@deemona.com.
- Health: give general guidance only, never a diagnosis or medicine doses. For anything worrying, tell them to see a vet and mention the AI health check. For emergencies tell them to go to a vet now and open Emergency SOS.
- Never ask for passwords, OTPs, card or bank details, Aadhaar or other ID numbers.
- If the user wants to complain or needs a human, tell them you can raise a support request (the app shows the button).
- If USER CHOSEN LOCATION is given, that is where the user is: use it and NEVER ask for their city or area again. If PAWBOOK DATA has no results there, say so plainly and point to the right page (for vets also "Nearby help", which shows clinics on a map).
- Do not start with a greeting or the user's name unless the user greeted you. Get straight to the answer.
- GOOGLE MAPS results are real places near the user but are NOT verified by PawBook and cannot be booked on PawBook; say they come from Google Maps. Suggest calling ahead. Do not repeat their phone numbers in the text (the cards show them).`;
async function claude(system, messages) {
  if (process.env.PB_AI_MOCK === '1') return 'MOCK ASSISTANT · ' + messages[messages.length - 1].content.slice(0, 60);
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw Object.assign(new Error('no key'), { code: 'NOKEY' });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.PB_ASSISTANT_MODEL || process.env.PB_HEALTH_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 600, system, messages }) });
  if (!r.ok) throw new Error('AI HTTP ' + r.status);
  const j = await r.json(); return ((j.content || []).find(c => c.type === 'text') || {}).text || '';
}
const aiOn = () => process.env.PB_ASSISTANT_AI !== '0' && (process.env.PB_AI_MOCK === '1' || !!process.env.ANTHROPIC_API_KEY);   // PB_ASSISTANT_AI=0 in .env turns the AI off (rules only)
function contextBlock(M, mine, found, base, intent) {
  const L = ['PAGES: ' + Object.values(PAGES).map(p => p[1]).join(', '), 'Today: ' + todayIST(), 'Detected topic: ' + intent];
  L.push('USER: first name ' + (first(M.name) || 'unknown') + (M.city ? ', city ' + M.city : ''));
  L.push('USER PETS: ' + (mine.pets.length ? mine.pets.map(p => p.name + ' (' + [p.species, p.breed].filter(Boolean).join(', ') + ')').join('; ') : 'none added'));
  if (mine.due.length) L.push('VACCINES DUE (next 60 days): ' + mine.due.map(d => d.pet + ' — ' + d.vaccine + ' ' + (d.overdue ? 'OVERDUE since ' : 'due ') + d.due).join('; '));
  if (mine.appts.length) L.push('UPCOMING VET VISITS: ' + mine.appts.map(a => a.date + (a.time ? ' ' + a.time : '') + ' ' + (a.pet || '') + ' ' + (a.vet || '') + ' ' + (a.clinic || '')).join('; '));
  if (found) L.push('PAWBOOK DATA for "' + found.q + '"' + (found.city ? ' in ' + found.city : '') + ': ' + (found.total ? found.cards.map(c => c.type + ': ' + c.title + (c.sub ? ' — ' + c.sub : '') + (c.meta ? ' — ' + c.meta : '') + (c.price != null ? ' — ₹' + c.price : '')).join(' | ') + ' (these are shown to the user as cards below your reply; total ' + found.total + ')' : 'no results'));
  L.push('A SAFE DRAFT ANSWER (facts you may rely on; improve the wording, keep the facts): ' + base.text.replace(/\n/g, ' '));
  return L.join('\n');
}

// ── store ────────────────────────────────────────────────────────────────────
async function save(M, role, body, extra) {
  extra = extra || {};
  const { rows } = await query(`INSERT INTO pb_assistant_messages (user_id, role, body, intent, cards, actions, source) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING id, created_at`,
    [M.id, role, String(body).slice(0, 6000), extra.intent || null, JSON.stringify(extra.cards || []), JSON.stringify(extra.actions || []), extra.source || null]);
  return rows[0];
}
const outMsg = r => ({ id: String(r.id), role: r.role, text: r.body, intent: r.intent || null, cards: r.cards || [], actions: r.actions || [], source: r.source || null, helpful: r.helpful, at: r.created_at });

// GET /assistant/state — greeting data: my pets, due vaccines, appointments, recent conversation
exports.state = async (req, res) => {
  try {
    const M = await me(req), mine = await myData(M);
    const { rows } = await query(`SELECT * FROM (SELECT * FROM pb_assistant_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 60) x ORDER BY id`, [M.id]);
    const t = await query(`SELECT COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open FROM pb_support_tickets WHERE user_id = $1`, [M.id]);
    return R.ok(res, { name: first(M.name), admin: M.admin, ai: aiOn(), maps: gOn(), pets: mine.pets.map(p => ({ id: p.id, name: p.name, species: p.species, breed: p.breed })), due: mine.due, appts: mine.appts, messages: rows.map(outMsg), open_tickets: t.rows[0].open });
  } catch (e) { return fail(res, 'state', e); }
};

// POST /assistant/chat {message}
exports.chat = async (req, res) => {
  try {
    const msg = str((req.body || {}).message, 1000).replace(/\s+/g, ' ');
    if (msg.length < 1) return bad(res, ['message'], 'Type a message first.');
    const M = await me(req);
    const { main: intent } = detect(msg);
    await save(M, 'user', msg, { intent });
    let reply;
    if (intent === 'emergency') { const e = emergencyReply(); reply = { text: e.text, actions: e.actions, cards: [], suggestions: e.suggestions, source: 'rules' }; }
    else {
      const loc = locOf(req.body), named = cityOf(msg), city = named || (loc && loc.searchCity) || null;
      const wantsNear = /\b(near ?me|nearby|my (city|area|locality)|around me|close to me|in my town)\b/i.test(msg);
      const needMine = ['vacc', 'mypets', 'appts', 'general', 'capabilities', 'greet'].includes(intent) || /\b(my|mine)\b/i.test(msg);
      const [mine, found, gp] = await Promise.all([needMine ? myData(M) : Promise.resolve({ pets: [], due: [], appts: [] }), listings(req, intent, msg, city, loc).catch(e => { console.error('[Assistant] listings:', e.message); return null; }),
        googlePlaces(msg, intent, loc).catch(e => { console.error('[Assistant] Google:', e.message); return null; })]);
      const base = rules(intent, msg, { M, mine, found });
      if (wantsNear && !city && TYPES_FOR[intent] !== undefined) { base.text = '📍 Which city or area should I look in? Set your location with the **📍 location** button above the chat (country, state, city, area and PIN code) — or just tell me, e.g. “vets in Pune”.\n\n' + base.text; base.actions = [{ label: 'Set my location', url: '#location' }].concat(base.actions).slice(0, 4); }
      let hint = null;
      if (gp && gp.cards.length) {
        const lead = `**${gp.cards.length} ${gp.word} near ${cap(gp.near)}** from Google Maps (nearest first — not verified by PawBook, so call ahead):`;
        if (intent === 'vet' && found && found.total && found.near) base.text = base.text.replace('\nOpen a vet to see their timings and book a visit.', '\nPawBook vets can be booked right here. ') + '\n\nAlso nearby — ' + lead;
        else base.text = ((intent === 'vet' ? (found && found.total && !found.near ? `No PawBook vets are listed in ${cap(found.city)} yet.` : found && !found.total && found.city ? `No PawBook vets are listed in ${cap(found.city)} yet.` : '') + ' Here are ' : 'Here are ') + lead).trim();
        if (intent === 'vet' && found && found.total && !found.near) found.cards = [];   // don't show far-away PawBook vets next to nearby clinics
        base.actions = [{ label: 'Open the map', url: PAGES.nearby[0] }].concat(base.actions.filter(a => a.url !== PAGES.nearby[0])).slice(0, 4);
      } else if (['vet', 'places'].includes(intent) && loc) {
        // no server key: the PAGE looks these up with the website's Google Maps key (browser), and shows them under the reply
        const kind = intent === 'vet' ? GKIND[GKIND.length - 1] : (GKIND.find(k => k[0].test(msg)) || GKIND[GKIND.length - 1]);
        const near = cap(loc.area || loc.city || loc.state);
        hint = { kind: kind[1], word: kind[4], emoji: kind[3], types: kind[2].includedTypes || null, text: kind[2].textQuery || null, lat: loc.lat != null ? loc.lat : null, lng: loc.lng != null ? loc.lng : null,
          address: [loc.area, loc.city, loc.state, loc.pin, loc.country || 'India'].filter(Boolean).join(', '), near };
        const gl = `**${cap(kind[4])} near ${near}** from Google Maps are below (nearest first — not verified by PawBook, so call ahead).`;
        if (intent === 'vet') {
          if (found && found.total && found.near) base.text = base.text.replace('\nOpen a vet to see their timings and book a visit.', '\nPawBook vets can be booked right here.') + '\n\n' + gl;
          else { base.text = (found && found.city ? `No PawBook vets are listed in ${cap(found.city)} yet. ` : '') + gl; if (found) found.cards = []; }
        } else base.text = gl;
        base.actions = [{ label: 'Show ' + kind[4] + ' near ' + near, url: '#gnear', g: hint }].concat(base.actions.filter(a => a.url !== PAGES.nearby[0])).slice(0, 3).concat([act('nearby', 'Open the map')]);
      } else if (intent === 'places') {
        base.text = 'Set your location with the **📍 location** button above the chat and I\'ll find places near you — or open **Nearby help** to see them on the map.';
        base.actions = [{ label: 'Set my location', url: '#location' }, act('nearby', 'Open the map')];
      }
      let text = base.text, source = 'rules';
      if (aiOn() && !['greet', 'thanks'].includes(intent)) {
        try {
          const { rows } = await query(`SELECT role, body FROM (SELECT id, role, body FROM pb_assistant_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 9) x ORDER BY id`, [M.id]);
          const msgs = []; rows.forEach(h => { const role = h.role === 'assistant' ? 'assistant' : 'user'; if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + h.body; else msgs.push({ role, content: h.body.slice(0, 1500) }); });
          while (msgs.length && msgs[0].role !== 'user') msgs.shift();
          if (!msgs.length || msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: msg });
          const ai = await claude(SYSTEM + '\n\n' + contextBlock(M, mine, found, base, intent) + (gp && gp.cards.length ? '\nGOOGLE MAPS (shown as cards under your reply): ' + gp.cards.map(c => c.title + ' — ' + c.meta).join(' | ') : '') + (hint ? '\nGOOGLE MAPS: the app will list ' + hint.word + ' near ' + hint.near + ' from Google Maps right under your reply. Say so in one short line; do not name or invent any of those places.' : '') + (loc ? '\nUSER CHOSEN LOCATION: ' + loc.label : '\nUSER LOCATION: not set (they can set it with the location button above the chat)'), msgs);
          if (ai && ai.trim().length > 1) { text = ai.trim().slice(0, 3000); source = 'ai'; }
        } catch (e) { console.error('[Assistant] AI:', e.message); }
      }
      reply = { text, actions: base.actions, cards: (found && found.total ? found.cards : []).concat(gp && gp.cards.length ? gp.cards : []).slice(0, 10), suggestions: base.suggestions, source };
      if (found && found.q && found.total > found.cards.length) reply.actions = [{ label: 'See all ' + found.total + ' results', url: PAGES.search[0] + '?q=' + encodeURIComponent(found.q) + (found.city ? '&city=' + encodeURIComponent(cap(found.city)) : '') }].concat(reply.actions).slice(0, 4);
    }
    const r = await save(M, 'assistant', reply.text, { intent, cards: reply.cards, actions: reply.actions, source: reply.source });
    return R.ok(res, { id: String(r.id), role: 'assistant', text: reply.text, intent, cards: reply.cards, actions: reply.actions, suggestions: reply.suggestions, source: reply.source, at: r.created_at });
  } catch (e) { return fail(res, 'chat', e); }
};

// DELETE /assistant/history — start over
exports.clear = async (req, res) => {
  try { const { rowCount } = await query(`DELETE FROM pb_assistant_messages WHERE user_id = $1`, [uid(req.user)]); return R.ok(res, { deleted: rowCount }); }
  catch (e) { return fail(res, 'clear', e); }
};

// POST /assistant/messages/:id/feedback {helpful: true|false}
exports.feedback = async (req, res) => {
  try {
    const h = (req.body || {}).helpful; if (typeof h !== 'boolean') return bad(res, ['helpful']);
    const { rowCount } = await query(`UPDATE pb_assistant_messages SET helpful = $3 WHERE id::text = $1 AND user_id = $2 AND role = 'assistant'`, [String(req.params.id), uid(req.user), h]);
    if (!rowCount) return R.notFound(res, 'Message not found');
    return R.ok(res, { helpful: h });
  } catch (e) { return fail(res, 'feedback', e); }
};

// ── support requests ─────────────────────────────────────────────────────────
const TOPICS = { account: 'Account & sign-in', payment: 'Payment or refund', order: 'Shop order', vet: 'Vet booking', listing: 'Fake or wrong listing', safety: 'Safety or harassment', bug: 'Something is not working', grievance: 'Grievance (IT Rules)', other: 'Other' };
const ticketOut = t => ({ id: String(t.id), ref: t.ref, topic: t.topic, topic_label: TOPICS[t.topic] || t.topic, subject: t.subject, message: t.message, status: t.status, reply: t.reply || null, replied_at: t.replied_at, at: t.created_at, updated_at: t.updated_at });
exports.topics = async (req, res) => R.ok(res, { topics: Object.keys(TOPICS).map(k => ({ id: k, label: TOPICS[k] })) });

// POST /assistant/support {topic, subject, message, page_url}
exports.createTicket = async (req, res) => {
  try {
    const b = req.body || {}, topic = TOPICS[b.topic] ? b.topic : '', subject = str(b.subject, 150), message = str(b.message, 4000), e = [];
    if (!topic) e.push('topic'); if (subject.length < 4) e.push('subject'); if (message.length < 15) e.push('message');
    if (e.length) return bad(res, e);
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{0,4}\b/.test(message + ' ' + subject)) return bad(res, ['message'], 'Please remove card, bank or ID numbers — our team will never ask for them.');
    const M = await me(req);
    const n = await query(`SELECT COUNT(*)::int AS n FROM pb_support_tickets WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day'`, [M.id]);
    if (n.rows[0].n >= 5) return res.status(429).json({ success: false, message: 'You have raised 5 requests today. Our team will reply to those first.' });
    let row = null;
    for (let i = 0; i < 5 && !row; i++) {
      const ref = 'PB-' + todayIST().slice(2).replace(/-/g, '') + '-' + String(Math.floor(1000 + Math.random() * 9000));
      try { const { rows } = await query(`INSERT INTO pb_support_tickets (ref, user_id, topic, subject, message, page_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [ref, M.id, topic, subject, message, str(b.page_url, 300) || null]); row = rows[0]; }
      catch (x) { if (x.code !== '23505') throw x; }
    }
    await notify(M.id, 'Support request ' + row.ref + ' received', 'We\'ll reply here in your notifications. Topic: ' + TOPICS[topic] + '.', '35_ai_agent.html?tickets=1');
    try { const u = await cols('users'); if (u.role) { const { rows } = await query(`SELECT user_id::text AS u FROM users WHERE role = 'admin' LIMIT 20`); for (const a of rows) await notify(a.u, 'New support request ' + row.ref, TOPICS[topic] + ': ' + subject, '35_ai_agent.html?admin=1'); } } catch (x) { console.error('[Assistant] admin notify:', x.message); }
    await save(M, 'assistant', `✅ Your support request **${row.ref}** is raised (${TOPICS[topic]}). The PawBook team will reply in your notifications — usually within 24 hours.`, { intent: 'support', source: 'rules', actions: [{ label: 'My support requests', url: '#tickets' }] });
    return res.status(201).json({ success: true, data: { ticket: ticketOut(row) } });
  } catch (e) { return fail(res, 'createTicket', e); }
};
// GET /assistant/support — my requests
exports.myTickets = async (req, res) => {
  try { const { rows } = await query(`SELECT * FROM pb_support_tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [uid(req.user)]); return R.ok(res, { tickets: rows.map(ticketOut) }); }
  catch (e) { return fail(res, 'myTickets', e); }
};
// GET /assistant/admin/support?status=open — PawBook admins only
exports.adminTickets = async (req, res) => {
  try {
    const M = await me(req); if (!M.admin) return res.status(403).json({ success: false, message: 'Only PawBook admins can do this.' });
    const st = ['open', 'in_progress', 'resolved', 'closed'].includes(req.query.status) ? [req.query.status] : ['open', 'in_progress'];
    const { rows } = await query(`SELECT t.*, u.full_name FROM pb_support_tickets t LEFT JOIN users u ON u.user_id::text = t.user_id WHERE t.status = ANY($1) ORDER BY t.created_at LIMIT 100`, [st]);
    return R.ok(res, { tickets: rows.map(t => Object.assign(ticketOut(t), { user: t.full_name || null, page_url: t.page_url || null })) });
  } catch (e) { return fail(res, 'adminTickets', e); }
};
// POST /assistant/admin/support/:id {status, reply}
exports.adminReply = async (req, res) => {
  try {
    const M = await me(req); if (!M.admin) return res.status(403).json({ success: false, message: 'Only PawBook admins can do this.' });
    const b = req.body || {}, status = ['open', 'in_progress', 'resolved', 'closed'].includes(b.status) ? b.status : null, reply = str(b.reply, 4000);
    if (!status && !reply) return bad(res, ['reply']);
    const { rows } = await query(`UPDATE pb_support_tickets SET status = COALESCE($2, status), reply = COALESCE(NULLIF($3, ''), reply), replied_by = CASE WHEN $3 <> '' THEN $4 ELSE replied_by END,
        replied_at = CASE WHEN $3 <> '' THEN NOW() ELSE replied_at END, updated_at = NOW() WHERE id::text = $1 RETURNING *`, [String(req.params.id), status, reply, M.id]);
    if (!rows[0]) return R.notFound(res, 'Request not found');
    const t = rows[0];
    if (reply) await notify(t.user_id, 'Reply to your request ' + t.ref, reply.slice(0, 300), '35_ai_agent.html?tickets=1');
    else if (status === 'resolved') await notify(t.user_id, 'Your request ' + t.ref + ' is resolved', null, '35_ai_agent.html?tickets=1');
    return R.ok(res, { ticket: ticketOut(t) });
  } catch (e) { return fail(res, 'adminReply', e); }
};
// GET /assistant/areas?state=&city= — area / locality names already used on PawBook in that city (for the area picker)
exports.areas = async (req, res) => {
  try {
    const l = locOf({ location: { state: req.query.state, city: req.query.city } }); if (!l || !l.searchCity) return R.ok(res, { areas: [] });
    const names = ({ 'new delhi': ['new delhi', 'delhi'], delhi: ['delhi', 'new delhi'], bengaluru: ['bengaluru', 'bangalore'], gurugram: ['gurugram', 'gurgaon'], mumbai: ['mumbai', 'bombay'] })[l.searchCity] || [l.searchCity];
    const out = {};
    const add = rows => rows.forEach(r => { const a = String(r.a || '').trim(); if (a.length >= 3 && a.length <= 60) { const k = a.toLowerCase(); if (!out[k]) out[k] = a.replace(/\b\w/g, m => m.toUpperCase()); } });
    for (const [t, col, cityCol] of [['"Group"', 'area', 'city'], ['lost_pet_reports', 'area', 'city'], ['found_pet_reports', 'area', 'city']]) {
      try { const { rows } = await query(`SELECT DISTINCT ${col} AS a FROM ${t} WHERE lower(trim(COALESCE(${cityCol}, ''))) = ANY($1) AND ${col} IS NOT NULL LIMIT 100`, [names]); add(rows); } catch (e) { /* table not there */ }
    }
    return R.ok(res, { areas: Object.values(out).sort().slice(0, 80) });
  } catch (e) { return fail(res, 'areas', e); }
};
exports._test = { detect, cityOf, termsOf, locOf };
