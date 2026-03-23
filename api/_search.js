// ─── SHA-1 (Node-compatible) ─────────────────────────────────────────────────
import { createHash } from 'crypto';

export function sha1Hex(str) {
  return createHash('sha1').update(str, 'utf8').digest('hex');
}

// ─── Title / company extraction (ported from Apps Script) ────────────────────
export function extractJobTitleAndCompany(title, snippet) {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  const s = (snippet || '').replace(/\s+/g, ' ').trim();
  const cleanTitle = t.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  const norm = x =>
    (x || '')
      .replace(/[–—]/g, '-')
      .replace(/\s*\|\s*/g, ' | ')
      .replace(/\s*-\s*/g, ' - ')
      .replace(/\s*·\s*/g, ' · ')
      .trim();
  const ct = norm(cleanTitle), cs = norm(s);
  let jobTitle = '', companyName = '';

  let m = ct.match(/^(.+?)\s-\s(.+?)\s+at\s+(.+)$/i);
  if (m) { jobTitle = m[2].trim(); companyName = m[3].trim(); }
  if (!companyName) {
    m = ct.match(/^(.+?)\s-\s(.+?)\s-\s(.+)$/i);
    if (m) { jobTitle = m[2].trim(); companyName = m[3].trim(); }
  }
  if (!companyName) {
    m = ct.match(/^(.+?)\s-\s(.+)$/i);
    if (m) {
      const left = m[1].trim(), right = m[2].trim();
      if (/\b(manager|engineer|developer|architect|lead|consultant|analyst|director|head|founder|product|data|software|growth|marketing|sales|recruiter)\b/i.test(left)) {
        jobTitle = left; companyName = right;
      }
    }
  }
  if (!companyName) { m = ct.match(/^(.+?)\s\|\s(.+)$/i); if (m) companyName = m[2].trim(); }
  if (!companyName) { m = cs.match(/\bat\s+([A-Z][A-Za-z0-9&.,()'\s-]{2,})\b/); if (m) companyName = m[1].trim(); }
  if (!companyName) {
    m = cs.match(/(^|[\.\|\-•])\s*([A-Z][A-Za-z0-9&.,()'\s-]{2,})\s+·\s+(Full-time|Part-time|Contract|Internship|Freelance|Self-employed)\b/i);
    if (m) companyName = m[2].trim();
  }
  const cleanup = c =>
    (c || '')
      .replace(/\s*\|\s*LinkedIn.*$/i, '')
      .replace(/\b(linkedin|profile|profiles)\b/gi, '')
      .replace(/\s+-\s+View.*$/i, '')
      .replace(/[|,;\s]+$/g, '')
      .trim();
  companyName = cleanup(companyName);
  const bad = new Set(['LinkedIn', 'India', 'Bengaluru', 'Bangalore', 'Mumbai', 'Delhi', 'Hyderabad']);
  if (bad.has(companyName)) companyName = '';
  return { jobTitle: jobTitle || '', companyName: companyName || '' };
}

// ─── Serper search (all pages) ───────────────────────────────────────────────
export async function runSearch({ query, pages = 5, serperApiKey }) {
  const seen = new Set();
  const results = [];

  for (let page = 1; page <= pages; page++) {
    let organic = [];
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperApiKey },
        body: JSON.stringify({ q: query, page, num: 10, gl: 'in', hl: 'en' }),
      });
      if (!res.ok) { console.error(`Serper page ${page} error: ${res.status}`); break; }
      const json = await res.json();
      organic = json.organic || [];
    } catch (e) {
      console.error(`Serper page ${page} fetch failed: ${e.message}`);
      break;
    }

    for (const it of organic) {
      const url = (it.link || '').trim();
      if (!/^https?:\/\/(www\.)?(in\.|uk\.|sg\.)?linkedin\.com\/in\//i.test(url)) continue;
      if (seen.has(url.toLowerCase())) continue;
      seen.add(url.toLowerCase());
      const key = sha1Hex(url.toLowerCase());
      const { jobTitle, companyName } = extractJobTitleAndCompany(it.title || '', it.snippet || '');
      results.push({
        key,
        profileUrl: url,
        resultTitle: it.title || '',
        snippet: it.snippet || '',
        jobTitle,
        companyName,
        queryUsed: query,
        capturedAt: new Date().toISOString(),
      });
    }
    await new Promise(r => setTimeout(r, 220));
  }
  return results;
}
