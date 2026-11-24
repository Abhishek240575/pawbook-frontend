// Appends the Marketplace 2.0 /shop routes to both route files (once).
// Usage on the server:  node add_shop_routes.js
const fs = require('fs');
const path = require('path');
const API = '/var/www/1015d59e-67f5-4aea-838c-7f7392731800/api';
const FILES = [path.join(API, 'src/routes/index.js'), path.join(API, 'routes/index.js')];

const BLOCK = `
// ── MARKETPLACE 2.0: SHOP (Phase 1 discovery) ───────────────────────────────
const shopCtrl = require('../controllers/shop.controller');
const shopRouter = require('express').Router();
shopRouter.get('/home',               shopCtrl.home);
shopRouter.get('/products',           shopCtrl.listProducts);
shopRouter.get('/products/:id',       shopCtrl.getProduct);
shopRouter.get('/suggest',            shopCtrl.suggest);
shopRouter.get('/wishlist',           authenticate, shopCtrl.getWishlist);
shopRouter.post('/wishlist/:id',      authenticate, shopCtrl.addWishlist);
shopRouter.delete('/wishlist/:id',    authenticate, shopCtrl.removeWishlist);
shopRouter.post('/newsletter',        shopCtrl.newsletter);
router.use('/shop', shopRouter);
// ── END SHOP ─────────────────────────────────────────────────────────────────
`;

for (const f of FILES) {
  if (!fs.existsSync(f)) { console.log('skip (missing):', f); continue; }
  const src = fs.readFileSync(f, 'utf8');
  if (src.includes("require('../controllers/shop.controller')")) { console.log('already patched:', f); continue; }
  fs.copyFileSync(f, f + '.bak-shop');
  fs.writeFileSync(f, src.replace(/\s*$/, '\n') + BLOCK);
  console.log('patched:', f, '(backup: ' + path.basename(f) + '.bak-shop)');
}
