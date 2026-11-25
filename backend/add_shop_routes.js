// Installs/upgrades the Marketplace 2.0 /shop routes in both route files.
// Replaces an earlier shop block if present; otherwise appends. Backs up first.
// Usage on the server:  node add_shop_routes.js
const fs = require('fs');
const path = require('path');
const API = '/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api';
const FILES = [path.join(API, 'src/routes/index.js'), path.join(API, 'routes/index.js')];
const START = '// ── MARKETPLACE 2.0: SHOP';
const END = '// ── END SHOP';

const BLOCK = `${START} (v18: search) ─────────────────────────────
const shopCtrl = require('../controllers/shop.controller');
const shopRouter = require('express').Router();
const shopRL = require('express-rate-limit');
const shopWriteLimit = (shopRL.rateLimit || shopRL)({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
// public browse
shopRouter.get('/home',                     shopCtrl.home);
shopRouter.get('/categories',               shopCtrl.listCategories);
shopRouter.get('/products',                 shopCtrl.listProducts);
shopRouter.get('/products/:id',             shopCtrl.getProduct);
shopRouter.get('/products/:id/together',    shopCtrl.boughtTogether);
shopRouter.get('/products/:id/questions',   shopCtrl.listQuestions);
shopRouter.get('/suggest',                  shopCtrl.suggest);
shopRouter.get('/brands',                   shopCtrl.listBrands);
shopRouter.get('/brands/:slug',             shopCtrl.getBrand);
shopRouter.get('/compare',                  shopCtrl.compare);
shopRouter.get('/recommendations',          shopCtrl.recommendations);
shopRouter.get('/loved',                    shopCtrl.loved);
shopRouter.post('/newsletter',              shopWriteLimit, shopCtrl.newsletter);
// signed-in users
shopRouter.post('/products/:id/questions',  authenticate, shopWriteLimit, shopCtrl.askQuestion);
shopRouter.post('/questions/:qid/answers',  authenticate, shopWriteLimit, shopCtrl.answerQuestion);
shopRouter.get('/wishlist',                 authenticate, shopCtrl.getWishlist);
shopRouter.post('/wishlist/:id',            authenticate, shopCtrl.addWishlist);
shopRouter.delete('/wishlist/:id',          authenticate, shopCtrl.removeWishlist);
// admin
shopRouter.get('/admin/categories',         authenticate, requireRole('admin'), shopCtrl.adminCategories);
shopRouter.post('/admin/categories',        authenticate, requireRole('admin'), shopCtrl.adminSaveCategory);
shopRouter.patch('/admin/categories/:slug', authenticate, requireRole('admin'), shopCtrl.adminSaveCategory);
shopRouter.get('/admin/brands',             authenticate, requireRole('admin'), shopCtrl.adminBrands);
shopRouter.put('/admin/brands',             authenticate, requireRole('admin'), shopCtrl.adminSaveBrand);
shopRouter.get('/admin/questions',          authenticate, requireRole('admin'), shopCtrl.adminQuestions);
shopRouter.patch('/admin/questions/:id',    authenticate, requireRole('admin'), shopCtrl.adminModerate);
shopRouter.patch('/admin/answers/:id',      authenticate, requireRole('admin'), shopCtrl.adminModerate);
shopRouter.get('/admin/synonyms',           authenticate, requireRole('admin'), shopCtrl.adminSynonyms);
shopRouter.put('/admin/synonyms',           authenticate, requireRole('admin'), shopCtrl.adminSaveSynonym);
// seller (Phase 2)
const sellerCtrl = require('../controllers/seller.controller');
const sellerWriteLimit = (shopRL.rateLimit || shopRL)({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: false });
shopRouter.get('/seller/me',                 authenticate, sellerCtrl.me);
shopRouter.post('/seller/register',          authenticate, shopWriteLimit, sellerCtrl.register);
shopRouter.patch('/seller/me',               authenticate, sellerWriteLimit, sellerCtrl.update);
shopRouter.get('/seller/products',           authenticate, sellerCtrl.listProducts);
shopRouter.post('/seller/products',          authenticate, sellerWriteLimit, sellerCtrl.createProduct);
shopRouter.get('/seller/products/:id',       authenticate, sellerCtrl.getProduct);
shopRouter.put('/seller/products/:id',       authenticate, sellerWriteLimit, sellerCtrl.updateProduct);
shopRouter.patch('/seller/products/:id',     authenticate, sellerWriteLimit, sellerCtrl.quickUpdate);
shopRouter.delete('/seller/products/:id',    authenticate, sellerWriteLimit, sellerCtrl.archiveProduct);
shopRouter.get('/seller/orders',             authenticate, sellerCtrl.listOrders);
shopRouter.patch('/seller/orders/:order_id', authenticate, sellerWriteLimit, sellerCtrl.updateOrder);
shopRouter.get('/seller/questions',          authenticate, sellerCtrl.listQuestions);
shopRouter.get('/admin/sellers',             authenticate, requireRole('admin'), sellerCtrl.adminList);
shopRouter.patch('/admin/sellers/:user_id',  authenticate, requireRole('admin'), sellerCtrl.adminUpdate);
// cart, addresses, checkout, buyer orders (Phase 3, cash on delivery)
const coCtrl = require('../controllers/checkout.controller');
const orderLimit = (shopRL.rateLimit || shopRL)({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });
const cartLimit = (shopRL.rateLimit || shopRL)({ windowMs: 5 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
shopRouter.get('/cart',                      authenticate, coCtrl.getCart);
shopRouter.post('/cart',                     authenticate, cartLimit, coCtrl.addToCart);
shopRouter.put('/cart',                      authenticate, cartLimit, coCtrl.setCartQty);
shopRouter.delete('/cart',                   authenticate, cartLimit, coCtrl.removeFromCart);
shopRouter.post('/cart/merge',               authenticate, cartLimit, coCtrl.mergeCart);
shopRouter.get('/addresses',                 authenticate, coCtrl.listAddresses);
shopRouter.post('/addresses',                authenticate, shopWriteLimit, coCtrl.saveAddress);
shopRouter.put('/addresses/:id',             authenticate, shopWriteLimit, coCtrl.saveAddress);
shopRouter.delete('/addresses/:id',          authenticate, shopWriteLimit, coCtrl.deleteAddress);
shopRouter.post('/checkout/quote',           authenticate, require('../controllers/fulfil.controller').limit('quote', 120, 600), coCtrl.quote);
shopRouter.post('/orders',                   authenticate, orderLimit, coCtrl.placeOrder);
shopRouter.get('/orders',                    authenticate, coCtrl.myOrders);
shopRouter.get('/orders/:id',                authenticate, coCtrl.myOrder);
shopRouter.post('/orders/:id/cancel',        authenticate, orderLimit, coCtrl.cancelOrder);
// verified reviews, coupons (Phase 6)
const expCtrl = require('../controllers/experience.controller');
shopRouter.get('/products/:id/review-eligibility', authenticate, expCtrl.reviewEligibility);
shopRouter.post('/products/:id/reviews',     authenticate, shopWriteLimit, expCtrl.postReview);
shopRouter.get('/reviews/pending',           authenticate, expCtrl.pendingReviews);
shopRouter.get('/coupons',                   authenticate, expCtrl.listCoupons);
shopRouter.get('/admin/reviews',             authenticate, requireRole('admin'), expCtrl.adminReviews);
shopRouter.patch('/admin/reviews/:id',       authenticate, requireRole('admin'), expCtrl.adminModerateReview);
shopRouter.get('/admin/coupons',             authenticate, requireRole('admin'), expCtrl.adminCoupons);
shopRouter.post('/admin/coupons',            authenticate, requireRole('admin'), expCtrl.adminSaveCoupon);
shopRouter.put('/admin/coupons/:code',       authenticate, requireRole('admin'), expCtrl.adminSaveCoupon);
// seller KYC + listing approval (Phase 4)
const trustCtrl = require('../controllers/trust.controller');
shopRouter.get('/seller/kyc',                authenticate, trustCtrl.getKyc);
shopRouter.put('/seller/kyc',                authenticate, sellerWriteLimit, trustCtrl.saveKyc);
shopRouter.post('/seller/kyc/docs',          authenticate, sellerWriteLimit, trustCtrl.uploadMiddleware, trustCtrl.uploadDoc);
shopRouter.post('/seller/kyc/submit',        authenticate, sellerWriteLimit, trustCtrl.submitKyc);
shopRouter.get('/kyc/docs/:id',              authenticate, trustCtrl.getDoc);
shopRouter.get('/admin/kyc',                 authenticate, requireRole('admin'), trustCtrl.adminKycList);
shopRouter.get('/admin/kyc/:user_id',        authenticate, requireRole('admin'), trustCtrl.adminKycGet);
shopRouter.patch('/admin/kyc/:user_id',      authenticate, requireRole('admin'), trustCtrl.adminKycDecide);
shopRouter.get('/admin/listings',            authenticate, requireRole('admin'), trustCtrl.adminListings);
shopRouter.patch('/admin/listings/:id',      authenticate, requireRole('admin'), trustCtrl.adminDecideListing);
shopRouter.get('/admin/settings',            authenticate, requireRole('admin'), trustCtrl.adminGetSettings);
shopRouter.put('/admin/settings',            authenticate, requireRole('admin'), trustCtrl.adminSaveSettings);
// Phase 7: admin orders, reports, exports, payouts; seller earnings
const repCtrl = require('../controllers/reports.controller');
shopRouter.get('/admin/orders',              authenticate, requireRole('admin'), repCtrl.adminOrders);
shopRouter.get('/admin/orders/:id',          authenticate, requireRole('admin'), repCtrl.adminOrder);
shopRouter.patch('/admin/orders/:id',        authenticate, requireRole('admin'), repCtrl.adminUpdateOrder);
shopRouter.get('/admin/reports',             authenticate, requireRole('admin'), repCtrl.adminReports);
shopRouter.get('/admin/export',              authenticate, requireRole('admin'), repCtrl.adminExport);
shopRouter.get('/admin/payouts',             authenticate, requireRole('admin'), repCtrl.adminPayouts);
shopRouter.put('/admin/payouts/settings',    authenticate, requireRole('admin'), repCtrl.adminPayoutSettings);
shopRouter.post('/admin/payouts',            authenticate, requireRole('admin'), repCtrl.adminCreatePayout);
shopRouter.get('/admin/payouts/:id',         authenticate, requireRole('admin'), repCtrl.adminPayout);
shopRouter.get('/seller/earnings',           authenticate, repCtrl.sellerEarnings);
shopRouter.get('/seller/payouts/:id',        authenticate, repCtrl.sellerPayout);
// Phase 5 (rest) + 8: returns & refunds, packing slip, ship-by, health, sitemap
const fulCtrl = require('../controllers/fulfil.controller');
shopRouter.get('/health',                    fulCtrl.health);
shopRouter.get('/sitemap.xml',               fulCtrl.sitemap);
shopRouter.get('/fulfilment-settings',       fulCtrl.publicSettings);
shopRouter.get('/returns',                   authenticate, fulCtrl.myReturns);
shopRouter.post('/orders/:id/returns',       authenticate, fulCtrl.limit('returns', 10, 3600), fulCtrl.createReturn);
shopRouter.post('/returns/:id/cancel',       authenticate, fulCtrl.limit('returns', 10, 3600), fulCtrl.cancelReturn);
shopRouter.get('/seller/returns',            authenticate, fulCtrl.sellerReturns);
shopRouter.patch('/seller/returns/:id',      authenticate, sellerWriteLimit, fulCtrl.sellerDecide);
shopRouter.get('/seller/orders/:id',         authenticate, fulCtrl.sellerOrder);
shopRouter.get('/admin/returns',             authenticate, requireRole('admin'), fulCtrl.adminReturns);
shopRouter.patch('/admin/returns/:id',       authenticate, requireRole('admin'), fulCtrl.adminDecide);
shopRouter.get('/admin/fulfilment',          authenticate, requireRole('admin'), fulCtrl.adminGetFulfil);
shopRouter.put('/admin/fulfilment',          authenticate, requireRole('admin'), fulCtrl.adminSaveFulfil);
router.use('/shop', shopRouter);
// Pet Health page (36): real per-pet records
const pcCtrl = require('../controllers/petcare.controller');
const petcareRouter = require('express').Router();
const pcWrite = fulCtrl.limit('petcare', 120, 600);
petcareRouter.get('/pets',                       authenticate, pcCtrl.listPets);
petcareRouter.post('/pets',                      authenticate, fulCtrl.limit('petcare-new', 20, 3600), pcCtrl.createPet);
petcareRouter.patch('/pets/:id',                 authenticate, pcWrite, pcCtrl.updatePet);
petcareRouter.get('/pets/:id/overview',          authenticate, pcCtrl.overview);
petcareRouter.post('/pets/:id/logs',             authenticate, pcWrite, pcCtrl.createLog);
petcareRouter.put('/pets/:id/goal',              authenticate, pcWrite, pcCtrl.setGoal);
petcareRouter.post('/pets/:id/vaccinations',     authenticate, pcWrite, pcCtrl.addVaccination);
petcareRouter.get('/pets/:id/vaccines',          authenticate, pcCtrl.vaccineDiary);
petcareRouter.patch('/pets/:id/vaccinations/:vid', authenticate, pcWrite, pcCtrl.updateVaccination);
petcareRouter.delete('/pets/:id/vaccinations/:vid', authenticate, pcWrite, pcCtrl.deleteVaccination);
petcareRouter.put('/pets/:id/vaccine-settings',  authenticate, pcWrite, pcCtrl.setVaccineSettings);
petcareRouter.post('/pets/:id/medicines',        authenticate, pcWrite, pcCtrl.addMedicine);
petcareRouter.post('/pets/:id/documents',        authenticate, fulCtrl.limit('petcare-doc', 30, 3600), pcCtrl.uploadMiddleware, pcCtrl.uploadDoc);
petcareRouter.delete('/logs/:id',                authenticate, pcWrite, pcCtrl.deleteLog);
petcareRouter.post('/medicines/:id/given',       authenticate, pcWrite, pcCtrl.medGiven);
petcareRouter.patch('/medicines/:id',            authenticate, pcWrite, pcCtrl.updateMedicine);
petcareRouter.get('/documents/:id',              authenticate, pcCtrl.getDoc);
petcareRouter.delete('/documents/:id',           authenticate, pcWrite, pcCtrl.deleteDoc);
router.use('/petcare', petcareRouter);
const vcCtrl = require('../controllers/vetcare.controller');
const vetcareRouter = require('express').Router();
const vcWrite = fulCtrl.limit('vetcare', 240, 600);
vetcareRouter.get('/me',                          authenticate, vcCtrl.me);
vetcareRouter.get('/dashboard',                   authenticate, vcCtrl.dashboard);
vetcareRouter.get('/schedule',                    authenticate, vcCtrl.schedule);
vetcareRouter.post('/appointments',               authenticate, vcWrite, vcCtrl.createAppointment);
vetcareRouter.patch('/appointments/:id',          authenticate, vcWrite, vcCtrl.updateAppointment);
vetcareRouter.post('/queue',                      authenticate, vcWrite, vcCtrl.checkIn);
vetcareRouter.patch('/queue/:id',                 authenticate, vcWrite, vcCtrl.updateQueue);
vetcareRouter.get('/patients',                    authenticate, vcCtrl.patients);
vetcareRouter.get('/patients/:pet_id',            authenticate, vcCtrl.patient);
vetcareRouter.post('/patients/:pet_id/notes',     authenticate, vcWrite, vcCtrl.addNote);
vetcareRouter.post('/patients/:pet_id/prescriptions', authenticate, vcWrite, vcCtrl.addPrescription);
vetcareRouter.post('/patients/:pet_id/vaccinations',  authenticate, vcWrite, vcCtrl.addVaccination);
vetcareRouter.get('/vaccinations',                authenticate, vcCtrl.vaccinations);
vetcareRouter.get('/owners',                      authenticate, vcCtrl.owners);
vetcareRouter.get('/consultations',               authenticate, vcCtrl.consultations);
vetcareRouter.get('/analytics',                   authenticate, vcCtrl.analytics);
vetcareRouter.get('/staff',                       authenticate, vcCtrl.staff);
vetcareRouter.post('/staff',                      authenticate, fulCtrl.limit('vetcare-staff', 20, 3600), vcCtrl.addStaff);
vetcareRouter.delete('/staff/:id',                authenticate, vcWrite, vcCtrl.removeStaff);
router.use('/vetcare', vetcareRouter);
const peCtrl = require('../controllers/petevents.controller');
const peRouter = require('express').Router();
const peWrite = fulCtrl.limit('petevents', 120, 600);
peRouter.get('/config',                         authenticate, peCtrl.config);
peRouter.get('/mine',                           authenticate, peCtrl.mine);
peRouter.get('/admin/queue',                    authenticate, peCtrl.adminQueue);
peRouter.post('/admin/reports/:rid',            authenticate, peWrite, peCtrl.resolveReport);
peRouter.post('/admin/:id/moderate',            authenticate, peWrite, peCtrl.moderate);
peRouter.post('/registrations/:rid/verify',     authenticate, peWrite, peCtrl.verifyPayment);
peRouter.post('/registrations/:rid/pay',        authenticate, fulCtrl.limit('petevents-pay', 20, 600), peCtrl.payLater);
peRouter.post('/registrations/:rid/cancel',     authenticate, peWrite, peCtrl.cancelRegistration);
peRouter.patch('/registrations/:rid',           authenticate, peWrite, peCtrl.hostAction);
peRouter.get('/',                               authenticate, peCtrl.list);
peRouter.post('/',                              authenticate, fulCtrl.limit('petevents-new', 10, 3600), peCtrl.create);
peRouter.get('/:id',                            authenticate, peCtrl.detail);
peRouter.patch('/:id',                          authenticate, peWrite, peCtrl.update);
peRouter.post('/:id/cancel',                    authenticate, peWrite, peCtrl.cancel);
peRouter.post('/:id/interest',                  authenticate, peWrite, peCtrl.interest);
peRouter.post('/:id/register',                  authenticate, fulCtrl.limit('petevents-reg', 30, 600), peCtrl.register);
peRouter.get('/:id/registrations',              authenticate, peCtrl.registrations);
peRouter.post('/:id/report',                    authenticate, fulCtrl.limit('petevents-report', 10, 3600), peCtrl.report);
router.use('/petevents', peRouter);
const mpCtrl = require('../controllers/mypawbook.controller');
const mpRouter = require('express').Router();
const mpWrite = fulCtrl.limit('mypawbook', 240, 600);
mpRouter.get('/summary',                        authenticate, mpCtrl.summary);
mpRouter.get('/collection',                     authenticate, mpCtrl.collection);
mpRouter.post('/collection/items',              authenticate, mpWrite, mpCtrl.saveItem);
mpRouter.delete('/collection/items/:kind/:ref', authenticate, mpWrite, mpCtrl.removeItem);
mpRouter.post('/collections',                   authenticate, mpWrite, mpCtrl.createCollection);
mpRouter.patch('/collections/:id',              authenticate, mpWrite, mpCtrl.updateCollection);
mpRouter.delete('/collections/:id',             authenticate, mpWrite, mpCtrl.deleteCollection);
mpRouter.put('/collections/:id/items',          authenticate, mpWrite, mpCtrl.collectionItem);
mpRouter.get('/memories',                       authenticate, mpCtrl.memories);
mpRouter.post('/memories',                      authenticate, mpWrite, mpCtrl.createMemory);
mpRouter.post('/memories/flag',                 authenticate, mpWrite, mpCtrl.flagMemory);
mpRouter.patch('/memories/:id',                 authenticate, mpWrite, mpCtrl.updateMemory);
mpRouter.delete('/memories/:id',                authenticate, mpWrite, mpCtrl.deleteMemory);
mpRouter.get('/journey',                        authenticate, mpCtrl.journey);
mpRouter.get('/journey/export',                 authenticate, fulCtrl.limit('mypawbook-export', 10, 3600), mpCtrl.exportJourney);
mpRouter.post('/journey/hide',                  authenticate, mpWrite, mpCtrl.hideJourney);
mpRouter.post('/journey/clear',                 authenticate, mpWrite, mpCtrl.clearJourney);
mpRouter.delete('/journey/clear',               authenticate, mpWrite, mpCtrl.clearJourney);
mpRouter.get('/celebrations',                   authenticate, mpCtrl.celebrations);
mpRouter.put('/celebrations/pets/:id',          authenticate, mpWrite, mpCtrl.setMilestones);
mpRouter.post('/celebrations/wish',             authenticate, fulCtrl.limit('mypawbook-wish', 40, 3600), mpCtrl.wish);
router.use('/mypawbook', mpRouter);
const adCtrl = require('../controllers/adopt.controller');
const adRouter = require('express').Router();
const adWrite = fulCtrl.limit('adopt', 240, 600);
adRouter.get('/config',                              authenticate, adCtrl.config);
adRouter.get('/pets',                                authenticate, adCtrl.list);
adRouter.get('/pets/:id',                            authenticate, adCtrl.detail);
adRouter.post('/pets/:id/apply',                     authenticate, fulCtrl.limit('adopt-apply', 10, 3600), adCtrl.apply);
adRouter.post('/pets/:id/wish',                      authenticate, adWrite, adCtrl.toggleWish);
adRouter.delete('/pets/:id/wish',                    authenticate, adWrite, adCtrl.toggleWish);
adRouter.get('/wishlist',                            authenticate, adCtrl.wishlist);
adRouter.put('/preferences',                         authenticate, adWrite, adCtrl.savePrefs);
adRouter.delete('/preferences',                      authenticate, adWrite, adCtrl.clearPrefs);
adRouter.get('/applications',                        authenticate, adCtrl.myApplications);
adRouter.post('/applications/:id/withdraw',          authenticate, adWrite, adCtrl.withdraw);
adRouter.post('/applications/:id/story',             authenticate, fulCtrl.limit('adopt-story', 5, 3600), adCtrl.shareStory);
adRouter.get('/shelters',                            authenticate, adCtrl.shelters);
adRouter.post('/partners/apply',                     authenticate, fulCtrl.limit('adopt-partner', 3, 86400), adCtrl.applyPartner);
adRouter.get('/partner',                             authenticate, adCtrl.partner);
adRouter.post('/partner/pets',                       authenticate, adWrite, adCtrl.createPet);
adRouter.patch('/partner/pets/:id',                  authenticate, adWrite, adCtrl.updatePet);
adRouter.patch('/partner/applications/:id',          authenticate, adWrite, adCtrl.updateApplication);
adRouter.post('/partner/applications/:id/followups', authenticate, adWrite, adCtrl.addFollowup);
adRouter.post('/reports',                            authenticate, fulCtrl.limit('adopt-report', 10, 3600), adCtrl.report);
adRouter.get('/foster',                              authenticate, adCtrl.myFoster);
adRouter.put('/foster',                              authenticate, adWrite, adCtrl.saveFoster);
adRouter.get('/stories',                             authenticate, adCtrl.stories);
adRouter.get('/admin/queue',                         authenticate, adCtrl.adminQueue);
adRouter.post('/admin/:kind/:id',                    authenticate, adWrite, adCtrl.adminAction);
router.use('/adopt', adRouter);
const lfCtrl = require('../controllers/lostfound.controller');
const lfRouter = require('express').Router();
const lfWrite = fulCtrl.limit('lostfound', 240, 600);
lfRouter.get('/config',                         authenticate, lfCtrl.config);
lfRouter.get('/cases',                          authenticate, lfCtrl.list);
lfRouter.get('/cases/:type/:id',                authenticate, lfCtrl.detail);
lfRouter.post('/lost',                          authenticate, fulCtrl.limit('lostfound-report', 8, 3600), lfCtrl.reportLost);
lfRouter.post('/found',                         authenticate, fulCtrl.limit('lostfound-report', 8, 3600), lfCtrl.reportFound);
lfRouter.patch('/cases/:type/:id',              authenticate, lfWrite, lfCtrl.update);
lfRouter.post('/cases/:type/:id/status',        authenticate, lfWrite, lfCtrl.setStatus);
lfRouter.post('/cases/:type/:id/sightings',     authenticate, fulCtrl.limit('lostfound-sighting', 20, 3600), lfCtrl.addSighting);
lfRouter.patch('/sightings/:id',                authenticate, lfWrite, lfCtrl.markSighting);
lfRouter.get('/cases/:type/:id/messages',       authenticate, lfCtrl.messages);
lfRouter.post('/cases/:type/:id/messages',      authenticate, fulCtrl.limit('lostfound-msg', 60, 3600), lfCtrl.sendMessage);
lfRouter.post('/cases/:type/:id/flag',          authenticate, fulCtrl.limit('lostfound-flag', 20, 3600), lfCtrl.flag);
lfRouter.post('/cases/:type/:id/translate',     authenticate, fulCtrl.limit('lostfound-tr', 120, 3600), lfCtrl.translate);
lfRouter.get('/mine',                           authenticate, lfCtrl.mine);
lfRouter.put('/prefs',                          authenticate, lfWrite, lfCtrl.savePrefs);
lfRouter.put('/volunteer',                      authenticate, lfWrite, lfCtrl.saveVolunteer);
lfRouter.get('/help',                           authenticate, lfCtrl.help);
lfRouter.get('/admin/queue',                    authenticate, lfCtrl.adminQueue);
lfRouter.post('/admin/:type/:id',               authenticate, lfWrite, lfCtrl.adminAction);
router.use('/lostfound', lfRouter);
const haCtrl = require('../controllers/healthagent.controller');
const haRouter = require('express').Router();
const haWrite = fulCtrl.limit('healthagent', 120, 600);
haRouter.post('/pets/:id/chat',              authenticate, fulCtrl.limit('healthagent-chat', 40, 3600), haCtrl.chat);
haRouter.get('/pets/:id/vitals',             authenticate, haCtrl.vitals);
haRouter.post('/pets/:id/vitals',            authenticate, haWrite, haCtrl.addVitals);
haRouter.delete('/vitals/:vid',              authenticate, haWrite, haCtrl.deleteVitals);
haRouter.get('/pets/:id/checks',             authenticate, haCtrl.checks);
haRouter.post('/pets/:id/checks',            authenticate, haWrite, haCtrl.addCheck);
haRouter.delete('/checks/:cid',              authenticate, haWrite, haCtrl.deleteCheck);
haRouter.get('/contacts',                    authenticate, haCtrl.contacts);
haRouter.get('/nearby',                      authenticate, haCtrl.nearby);
haRouter.post('/contacts',                   authenticate, haWrite, haCtrl.addContact);
haRouter.delete('/contacts/:cid',            authenticate, haWrite, haCtrl.deleteContact);
router.use('/healthagent', haRouter);
const cmCtrl = require('../controllers/communities.controller');
const cmRouter = require('express').Router();
const cmWrite = fulCtrl.limit('communities', 240, 600);
cmRouter.get('/config',                       authenticate, cmCtrl.config);
cmRouter.get('/meetups',                      authenticate, cmCtrl.meetups);
cmRouter.post('/report',                      authenticate, fulCtrl.limit('communities-report', 20, 3600), cmCtrl.report);
cmRouter.get('/admin/queue',                  authenticate, cmCtrl.adminQueue);
cmRouter.post('/admin/:kind/:id',             authenticate, cmWrite, cmCtrl.adminAction);
cmRouter.delete('/posts/:pid',                authenticate, cmWrite, cmCtrl.deletePost);
cmRouter.post('/posts/:pid/pin',              authenticate, cmWrite, cmCtrl.modPost);
cmRouter.post('/posts/:pid/hide',             authenticate, cmWrite, cmCtrl.modPost);
cmRouter.post('/posts/:pid/like',             authenticate, cmWrite, cmCtrl.like);
cmRouter.post('/posts/:pid/rsvp',             authenticate, cmWrite, cmCtrl.rsvp);
cmRouter.get('/posts/:pid/comments',          authenticate, cmCtrl.comments);
cmRouter.post('/posts/:pid/comments',         authenticate, fulCtrl.limit('communities-comment', 60, 3600), cmCtrl.addComment);
cmRouter.delete('/comments/:cid',             authenticate, cmWrite, cmCtrl.deleteComment);
cmRouter.get('/',                             authenticate, cmCtrl.list);
cmRouter.post('/',                            authenticate, fulCtrl.limit('communities-create', 5, 86400), cmCtrl.create);
cmRouter.get('/:id',                          authenticate, cmCtrl.detail);
cmRouter.patch('/:id',                        authenticate, cmWrite, cmCtrl.update);
cmRouter.post('/:id/join',                    authenticate, fulCtrl.limit('communities-join', 30, 3600), cmCtrl.join);
cmRouter.post('/:id/leave',                   authenticate, cmWrite, cmCtrl.leave);
cmRouter.get('/:id/requests',                 authenticate, cmCtrl.requests);
cmRouter.post('/:id/requests/:rid',           authenticate, cmWrite, cmCtrl.decide);
cmRouter.get('/:id/members',                  authenticate, cmCtrl.members);
cmRouter.patch('/:id/members/:uid',           authenticate, cmWrite, cmCtrl.setRole);
cmRouter.delete('/:id/members/:uid',          authenticate, cmWrite, cmCtrl.setRole);
cmRouter.get('/:id/posts',                    authenticate, cmCtrl.posts);
cmRouter.post('/:id/posts',                   authenticate, fulCtrl.limit('communities-post', 30, 3600), cmCtrl.createPost);
router.use('/communities', cmRouter);
const srCtrl = require('../controllers/search.controller');
const srRouter = require('express').Router();
const srLimit = fulCtrl.limit('pbsearch', 240, 600);
srRouter.get('/home',                         authenticate, srCtrl.home);
srRouter.get('/',                             authenticate, srLimit, srCtrl.search);
router.use('/pbsearch', srRouter);
${END} ─────────────────────────────────────────────────────────────────
`;

// Guard for the old /marketplace order endpoints, placed right after marketRouter is created so it runs first:
// only admins may change an order's status there, and old order placement gets real prices from the database.
const G_START = '// ── SHOP GUARD: legacy marketplace orders';
const G_END = '// ── END SHOP GUARD';
const GUARD = `${G_START} ──
marketRouter.patch('/orders/:order_id/status', authenticate, requireRole('admin'));
marketRouter.post('/orders', authenticate, require('../controllers/checkout.controller').legacyOrderPrices);
marketRouter.post('/listings/:listing_id/reviews', authenticate, require('../controllers/experience.controller').legacyReview);
${G_END} ──
`;
// Guard for the old /lost-pets endpoints, placed just before the old lost-pet routes so it answers first:
// public lists never show phone numbers or exact locations, and new reports go through Lost & Found 2.0.
const L_START = '// ── LOST & FOUND GUARD: legacy lost-pets';
const L_END = '// ── END LOST & FOUND GUARD';
const LGUARD = `${L_START} ──
const lfLegacy = require('../controllers/lostfound.controller');
router.get('/lost-pets', lfLegacy.legacyList);
router.get('/lost-pets/mine', authenticate, lfLegacy.legacyMine);
router.get('/lost-pets/:alert_id', lfLegacy.legacyGet);
router.post('/lost-pets', authenticate, lfLegacy.legacyCreate);
router.patch('/lost-pets/:alert_id', authenticate, lfLegacy.legacyUpdate);
router.post('/lost-pets/:alert_id/sighting', authenticate, lfLegacy.legacySighting);
router.post('/lost-pets/:alert_id/sightings', authenticate, lfLegacy.legacySighting);
${L_END} ──
`;
const LP = /[^\n]*const\s+lostPetCtrl\s*=\s*require\([^)]*lost_pet\.controller[^)]*\)[^\n]*\n/;
const MR = /const\s+marketRouter\s*=\s*require\(['"]express['"]\)\.Router\(\);?[^\n]*\n/;

for (const f of FILES) {
  if (!fs.existsSync(f)) { console.log('skip (missing):', f); continue; }
  const src = fs.readFileSync(f, 'utf8');
  fs.copyFileSync(f, f + '.bak-shop18');
  let out;
  // END must be searched after START and must not be the guard's "END SHOP GUARD" marker
  const a = src.indexOf(START);
  let b = a >= 0 ? src.indexOf(END, a) : -1;
  while (b >= 0 && src.startsWith(G_END, b)) b = src.indexOf(END, b + 1);
  if (a >= 0 && b > a) {
    const lineEnd = src.indexOf('\n', b);
    out = src.slice(0, a) + BLOCK + src.slice(lineEnd >= 0 ? lineEnd + 1 : src.length);
    console.log('upgraded shop block:', f);
  } else {
    out = src.replace(/\s*$/, '\n\n') + BLOCK;
    console.log('added shop block:', f);
  }
  // legacy guard (idempotent)
  const ga = out.indexOf(G_START), gb = out.indexOf(G_END);
  if (ga >= 0 && gb > ga) { const le = out.indexOf('\n', gb); out = out.slice(0, ga) + GUARD + out.slice(le + 1); console.log('  legacy guard refreshed'); }
  else if (MR.test(out)) { out = out.replace(MR, m => m + GUARD); console.log('  legacy guard added'); }
  else console.log('  NOTE: marketRouter line not found in this file — legacy guard not added');
  // legacy lost-pets guard (idempotent); must sit before the old routes so it answers first
  const la = out.indexOf(L_START), lb = out.indexOf(L_END);
  if (la >= 0 && lb > la) { const le = out.indexOf('\n', lb); out = out.slice(0, la) + LGUARD + out.slice(le + 1); console.log('  lost-pets guard refreshed'); }
  else if (LP.test(out)) { out = out.replace(LP, m => LGUARD + m); console.log('  lost-pets guard added'); }
  else console.log('  NOTE: old lost-pets routes not found in this file — guard not needed');
  fs.writeFileSync(f, out);
}
console.log('Backups saved as index.js.bak-shop18 — restart the app from the MilesWeb panel.');
