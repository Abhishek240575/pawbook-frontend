# PawBook — Production Deployment Guide

## Architecture
- **Backend**: Node.js/Express → **Railway** (free tier)
- **Frontend**: Vanilla HTML/JS → **Vercel** (free tier)  
- **Database**: Neon PostgreSQL (already cloud-hosted ✅)
- **Domain**: pawbook.app (optional — Vercel gives free `.vercel.app` subdomain)

---

## STEP 1 — Prepare Backend for Production

### 1a. Update `package.json` (in `pawbook_api/`)
```json
{
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### 1b. Create `pawbook_api/.env.production`
```env
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@YOUR_NEON_HOST/neondb?sslmode=require
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
PORT=4000
NODE_ENV=production
CORS_ORIGIN=https://pawbook.vercel.app
```

### 1c. Update CORS in `src/index.js`
```js
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:62814',
  credentials: true,
};
app.use(cors(corsOptions));
```

### 1d. Create `pawbook_api/Procfile` (for Railway)
```
web: node src/index.js
```

---

## STEP 2 — Deploy Backend to Railway

1. Go to **railway.app** → Sign up with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `pawbook` repository → choose `pawbook_api` as root directory
4. Railway auto-detects Node.js

### Add Environment Variables in Railway dashboard:
```
DATABASE_URL = (your Neon connection string)
JWT_SECRET   = pawbook-prod-secret-2024-change-me
NODE_ENV     = production
CORS_ORIGIN  = https://pawbook.vercel.app
PORT         = 4000
```

5. Click **Deploy** → Railway gives you a URL like:
   `https://pawbook-api.up.railway.app`

### Test your API:
```
https://pawbook-api.up.railway.app/api/v1/health
```

---

## STEP 3 — Update Frontend API Base URL

### Edit `pawbook_v2/api.js` — change the BASE_URL:
```js
// Replace this:
const BASE_URL = 'http://localhost:4000/api/v1';

// With this:
const BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:4000/api/v1'
  : 'https://pawbook-api.up.railway.app/api/v1';
```

---

## STEP 4 — Deploy Frontend to Vercel

1. Go to **vercel.com** → Sign up with GitHub
2. Click **Add New Project** → Import your GitHub repo
3. Set **Root Directory** to `pawbook_v2`
4. **Framework Preset**: Other (static HTML)
5. **Build Command**: (leave empty)
6. **Output Directory**: `.` (current directory)
7. Click **Deploy**

Vercel gives you: `https://pawbook.vercel.app`

### Add `vercel.json` in `pawbook_v2/`:
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/$1.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

---

## STEP 5 — PWA Setup (Add to Home Screen)

### Create `pawbook_v2/manifest.json`:
```json
{
  "name": "PawBook",
  "short_name": "PawBook",
  "description": "Pet Social Network — India's Facebook for Pets",
  "start_url": "/07_home.html",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1a4db3",
  "orientation": "portrait",
  "icons": [
    { "src": "https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=192&q=80", "sizes": "192x192", "type": "image/png" },
    { "src": "https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=512&q=80", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Add to every HTML page's `<head>`:
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1a4db3">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="PawBook">
```

---

## STEP 6 — Custom Domain (Optional)

### On Vercel:
1. Settings → Domains → Add `pawbook.app`
2. Add DNS records at your domain registrar:
   ```
   A     @    76.76.19.61
   CNAME www  cname.vercel-dns.com
   ```

### On Railway (for API subdomain):
1. Settings → Domains → Add `api.pawbook.app`
2. Add CNAME: `api → your-railway-url.up.railway.app`

---

## STEP 7 — Post-Deployment Checklist

```
□ Backend health check: https://pawbook-api.up.railway.app/api/v1/health
□ Login works with: abhishek@pawbook.app / Test@1234
□ Home feed loads posts
□ Post creation with image works
□ Marketplace products load
□ Discover map loads
□ Notifications load
□ Messages send/receive
□ Test on mobile (Chrome + Safari)
□ PWA "Add to Home Screen" works on Android
□ PWA "Add to Home Screen" works on iPhone
```

---

## Cost Summary

| Service | Free Tier |
|---------|-----------|
| Railway | $5/month free credit (enough for hobby) |
| Vercel | Completely free for static sites |
| Neon PostgreSQL | Already on free tier ✅ |
| Total | **$0/month** to start |

---

## Quick Deploy Commands

```bash
# 1. Push to GitHub
cd pawbook
git init
git add .
git commit -m "PawBook v1.0 — Launch"
git remote add origin https://github.com/YOUR_USERNAME/pawbook.git
git push -u origin main

# 2. Railway auto-deploys from GitHub on every push
# 3. Vercel auto-deploys from GitHub on every push
```

---

## Environment Files to Create

### `pawbook_api/.env` (local dev):
```
DATABASE_URL=postgresql://neondb_owner:...@...neon.tech/neondb
JWT_SECRET=dev-secret-key
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:62814
```

### `pawbook_api/.gitignore` (add if missing):
```
node_modules/
.env
.env.production
*.log
```
