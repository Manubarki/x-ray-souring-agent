# LinkedIn X-ray Sourcer

Google X-ray search for LinkedIn /in/ profiles, powered by Serper.dev.  
Runs on demand via the UI **and** automatically every Monday at 08:00 IST via Vercel Cron.  
New profiles are appended to a Google Sheet (deduped by SHA-1 URL hash).

---

## Project structure

```
xray-sourcer/
├── api/
│   ├── _search.js       ← shared search + extraction logic
│   ├── _sheets.js       ← Google Sheets auth + append (service account)
│   ├── serper.js        ← frontend proxy (POST /api/serper)
│   └── cron.js          ← weekly cron job (GET /api/cron)
├── src/
│   ├── main.jsx
│   └── App.jsx
├── index.html
├── vite.config.js
├── vercel.json          ← cron schedule defined here
└── package.json
```

---

## One-time setup

### 1. Google Service Account

1. Go to console.cloud.google.com
2. Create a project (or pick an existing one)
3. Enable the Google Sheets API (APIs & Services → Enable APIs)
4. Go to IAM & Admin → Service Accounts → Create Service Account
   - Name: xray-sourcer
5. Open the service account → Keys → Add Key → Create new key → JSON
6. Download the JSON — you need two values:
   - client_email  →  GOOGLE_SERVICE_ACCOUNT_EMAIL
   - private_key   →  GOOGLE_PRIVATE_KEY

### 2. Share your Google Sheet with the service account

1. Open your Google Sheet
2. Click Share
3. Paste the client_email (e.g. xray-sourcer@my-project.iam.gserviceaccount.com)
4. Set role to Editor
5. Make sure the tab is named New_candidates (or set GOOGLE_SHEET_NAME to match)

### 3. Get your Spreadsheet ID

From the Sheet URL:
https://docs.google.com/spreadsheets/d/THIS_PART/edit

---

## Deploy to Vercel

### Push changes to GitHub

```bash
git add .
git commit -m "add cron + sheets"
git push
```

### Import on Vercel

1. vercel.com → New Project → import xray-sourcer
2. Framework: Vite, build: npm run build, output: dist

### Environment variables

Add all of these in Vercel → Project → Settings → Environment Variables:

| Variable                       | Value                                              |
|--------------------------------|----------------------------------------------------|
| SERPER_API_KEY                 | Your key from serper.dev                           |
| GOOGLE_SERVICE_ACCOUNT_EMAIL   | client_email from the JSON file                    |
| GOOGLE_PRIVATE_KEY             | private_key from the JSON (paste the whole value)  |
| GOOGLE_SPREADSHEET_ID          | The ID from your Sheet URL                         |
| GOOGLE_SHEET_NAME              | New_candidates (or your tab name)                  |
| XRAY_QUERY                     | (optional) override the default Boolean query      |
| XRAY_PAGES                     | (optional) number of Serper pages, default 5       |
| CRON_SECRET                    | Any random string for manual cron triggers         |

Important for GOOGLE_PRIVATE_KEY: paste the raw value from the JSON exactly,
including the -----BEGIN PRIVATE KEY----- header. Vercel handles escaping.

### Redeploy after adding env vars

Vercel → Deployments → ... → Redeploy

---

## Cron schedule

Defined in vercel.json:
  schedule: "30 2 * * 1"  =  02:30 UTC  =  08:00 IST, every Monday

View logs: Vercel → Project → Logs → filter by /api/cron

### Trigger manually

curl -X GET https://your-app.vercel.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

---

## Local development

```bash
npm install
vercel dev
```
