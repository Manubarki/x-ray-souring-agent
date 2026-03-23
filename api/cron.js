import { runSearch } from './_search.js';
import { appendRowsToSheet, fetchExistingKeys } from './_sheets.js';

const QUERY = process.env.XRAY_QUERY ||
  'site:in.linkedin.com/in (intitle:"Staff Engineer" OR intitle:"Architect" OR intitle:"principal engineer") (lakehouse) (iceberg)';

const PAGES = parseInt(process.env.XRAY_PAGES || '5', 10);

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorised = isVercelCron || (cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isAuthorised) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`[cron] Starting — ${new Date().toISOString()}`);
  console.log('[cron] GOOGLE_SHEET_NAME:', process.env.GOOGLE_SHEET_NAME);
  console.log('[cron] GOOGLE_SPREADSHEET_ID:', process.env.GOOGLE_SPREADSHEET_ID);

  try {
    console.log('[cron] Fetching existing keys from sheet…');
    const existingKeys = await fetchExistingKeys();
    console.log(`[cron] ${existingKeys.size} existing keys loaded`);

    console.log(`[cron] Running search: ${QUERY}`);
    const allResults = await runSearch({
      query: QUERY,
      pages: PAGES,
      serperApiKey: process.env.SERPER_API_KEY,
    });
    console.log(`[cron] ${allResults.length} total results from Serper`);

    const newRows = allResults.filter(r => !existingKeys.has(r.key));
    console.log(`[cron] ${newRows.length} new profiles after dedup`);
    console.log('[cron] GOOGLE_SHEET_NAME:', process.env.GOOGLE_SHEET_NAME);
    console.log('[cron] GOOGLE_SPREADSHEET_ID:', process.env.GOOGLE_SPREADSHEET_ID);

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
