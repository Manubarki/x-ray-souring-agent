// Vercel Cron Job — runs every Monday at 08:00 IST (02:30 UTC)
// Triggered automatically by Vercel; can also be called manually via GET /api/cron
// with header: Authorization: Bearer <CRON_SECRET>

import { runSearch } from './_search.js';
import { appendRowsToSheet, fetchExistingKeys } from './_sheets.js';

const QUERY = process.env.XRAY_QUERY ||
  'site:in.linkedin.com/in (intitle:"product manager" OR "Tech Product Manager") (API) (platform) (integrations OR "data connectors" OR "data ingestion")';

const PAGES = parseInt(process.env.XRAY_PAGES || '5', 10);

export const config = {
  maxDuration: 60, // seconds — Vercel Pro allows up to 300
};

export default async function handler(req, res) {
  // Vercel calls cron jobs as GET requests internally.
  // For manual triggers, require the secret.
  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;

  // Allow Vercel's internal cron invocation (no auth header) OR manual call with secret
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorised = isVercelCron || (cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isAuthorised) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`[cron] Starting X-ray search — ${new Date().toISOString()}`);

  try {
    // 1. Fetch keys already in the sheet so we don't re-append duplicates
    console.log('[cron] Fetching existing keys from sheet…');
    const existingKeys = await fetchExistingKeys();
    console.log(`[cron] ${existingKeys.size} existing keys loaded`);

    // 2. Run the search
    console.log(`[cron] Running search: ${QUERY}`);
    const allResults = await runSearch({
      query: QUERY,
      pages: PAGES,
      serperApiKey: process.env.SERPER_API_KEY,
    });
    console.log(`[cron] ${allResults.length} total results from Serper`);

    // 3. Filter out duplicates
    const newRows = allResults.filter(r => !existingKeys.has(r.key));
    console.log(`[cron] ${newRows.length} new profiles after dedup`);

    // 4. Append to sheet
    if (newRows.length > 0) {
      await appendRowsToSheet(newRows);
      console.log(`[cron] Appended ${newRows.length} rows to sheet`);
    } else {
      console.log('[cron] Nothing new to append');
    }

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      totalFound: allResults.length,
      newAppended: newRows.length,
      query: QUERY,
    });
  } catch (err) {
    console.error('[cron] Error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
