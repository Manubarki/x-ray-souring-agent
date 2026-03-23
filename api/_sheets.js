// Google Sheets append via Service Account (JWT / OAuth2)
// Env vars required:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  — e.g. xray-sourcer@my-project.iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY            — the private_key value from the JSON (with \n newlines)
//   GOOGLE_SPREADSHEET_ID         — the long ID from the Sheet URL
//   GOOGLE_SHEET_NAME             — tab name, e.g. New_candidates

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const COLUMNS = ['key', 'profileUrl', 'resultTitle', 'snippet', 'jobTitle', 'companyName', 'queryUsed', 'capturedAt'];

// ─── JWT helpers ─────────────────────────────────────────────────────────────

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeJWT(email, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: email, sub: email,
    scope: SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));

  const signingInput = `${header}.${payload}`;

  // Import the PEM key
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const keyDer = Buffer.from(pemBody, 'base64');

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(sig)}`;
}

async function getAccessToken(email, privateKeyPem) {
  const jwt = await makeJWT(email, privateKeyPem);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ─── Sheets append ────────────────────────────────────────────────────────────

export async function appendRowsToSheet(rows) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'New_candidates';

  if (!email || !rawKey || !spreadsheetId) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, or GOOGLE_SPREADSHEET_ID');
  }

  // Vercel stores \n as literal \\n in env vars — fix that
  const privateKeyPem = rawKey.replace(/\\n/g, '\n');

  const token = await getAccessToken(email, privateKeyPem);

  const values = rows.map(r => COLUMNS.map(c => r[c] || ''));
  const range = `${sheetName}!A1`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Sheets append failed: ${err.error?.message || res.status}`);
  }
  return await res.json();
}

// ─── Fetch existing keys (for dedup) ─────────────────────────────────────────

export async function fetchExistingKeys() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'New_candidates';

  if (!email || !rawKey || !spreadsheetId) return new Set();

  const privateKeyPem = rawKey.replace(/\\n/g, '\n');
  const token = await getAccessToken(email, privateKeyPem);

  const range = `${sheetName}!A:A`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return new Set();
  const data = await res.json();
  const keys = (data.values || []).flat().filter(Boolean);
  return new Set(keys);
}
