# LinkedIn X-ray Sourcer

Google X-ray search for LinkedIn /in/ profiles, powered by Serper.dev.  
Deployed on Vercel — API key lives server-side, never in the browser.

## Project structure

```
xray-sourcer/
├── api/
│   └── serper.js        ← Vercel serverless function (proxies Serper)
├── src/
│   ├── main.jsx
│   └── App.jsx          ← React frontend
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "init"
gh repo create xray-sourcer --public --push
# or: git remote add origin https://github.com/Manubarki/xray-sourcer.git && git push -u origin main
```

### 2. Import on Vercel

1. Go to vercel.com → New Project → Import your GitHub repo
2. Framework preset: **Vite**
3. Build command: `npm run build`
4. Output directory: `dist`

### 3. Add environment variable

In Vercel → Project → Settings → Environment Variables:

| Name | Value |
|------|-------|
| `SERPER_API_KEY` | your key from serper.dev |

### 4. Redeploy

Trigger a redeploy after adding the env var (Settings → Deployments → Redeploy).

## Local development

```bash
npm install
vercel dev        # runs both Vite frontend + /api/* serverless functions locally
```

If you don't have the Vercel CLI:
```bash
npm install -g vercel
vercel login
```

## How it works

- The browser calls `/api/serper` (same origin — no CORS issue)
- `api/serper.js` runs on Vercel's edge, injects `SERPER_API_KEY`, and proxies to `google.serper.dev`
- Results are parsed client-side: LinkedIn /in/ URL filter, SHA-1 dedup, title/company extraction
