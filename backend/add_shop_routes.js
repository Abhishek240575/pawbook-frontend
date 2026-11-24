// Installs/upgrades the Marketplace 2.0 /shop routes in both route files.
// Replaces an earlier shop block if present; otherwise appends. Backs up first.
// Usage on the server:  node add_shop_routes.js
const fs = require('fs');
const path = require('path');
const API = '/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api';
const FILES = [path.join(API, 'src/routes/index.js'), path.join(API, 'routes/index.js')];
const START = '// ── MARKETPLACE 2.0: SHOP';
const END = '// ── END SHOP';

const BLOCK = `${START} (v3: seller side) ─────────────────────────────
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
router.use('/shop', shopRouter);
${END} ─────────────────────────────────────────────────────────────────
`;

for (const f of FILES) {
  if (!fs.existsSync(f)) { console.log('skip (missing):', f); continue; }
  const src = fs.readFileSync(f, 'utf8');
  fs.copyFileSync(f, f + '.bak-shop3');
  let out;
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a >= 0 && b > a) {
    const lineEnd = src.indexOf('\n', b);
    out = src.slice(0, a) + BLOCK + src.slice(lineEnd >= 0 ? lineEnd + 1 : src.length);
    console.log('upgraded shop block:', f);
  } else {
    out = src.replace(/\s*$/, '\n\n') + BLOCK;
    console.log('added shop block:', f);
  }
  fs.writeFileSync(f, out);
}
console.log('Backups saved as index.js.bak-shop3 — restart the app from the MilesWeb panel.');
