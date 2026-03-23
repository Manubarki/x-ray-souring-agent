import { appendRowsToSheet, fetchExistingKeys } from './_sheets.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    try {
      const keys = await fetchExistingKeys();
      return res.status(200).json({ ok: true, keys: [...keys], count: keys.size });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
  if (req.method === 'POST') {
    const { rows } = req.body || {};
    if (!rows || !Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ ok: false, error: 'Missing or empty rows array' });
    try {
      const result = await appendRowsToSheet(rows);
      return res.status(200).json({ ok: true, appended: rows.length, updatedRange: result?.updates?.updatedRange || null });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
