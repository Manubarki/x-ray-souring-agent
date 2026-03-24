import { useState, useCallback } from 'react';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function sha1Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-1', enc.encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function extractJobTitleAndCompany(title, snippet) {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  const s = (snippet || '').replace(/\s+/g, ' ').trim();
  const cleanTitle = t.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  const norm = x => (x || '').replace(/[–—]/g, '-').replace(/\s*\|\s*/g, ' | ').replace(/\s*-\s*/g, ' - ').replace(/\s*·\s*/g, ' · ').trim();
  const ct = norm(cleanTitle), cs = norm(s);
  let jobTitle = '', companyName = '';
  let m = ct.match(/^(.+?)\s-\s(.+?)\s+at\s+(.+)$/i);
  if (m) { jobTitle = m[2].trim(); companyName = m[3].trim(); }
  if (!companyName) { m = ct.match(/^(.+?)\s-\s(.+?)\s-\s(.+)$/i); if (m) { jobTitle = m[2].trim(); companyName = m[3].trim(); } }
  if (!companyName) {
    m = ct.match(/^(.+?)\s-\s(.+)$/i);
    if (m) {
      const left = m[1].trim(), right = m[2].trim();
      if (/\b(manager|engineer|developer|architect|lead|consultant|analyst|director|head|founder|product|data|software|growth|marketing|sales|recruiter)\b/i.test(left)) { jobTitle = left; companyName = right; }
    }
  }
  if (!companyName) { m = ct.match(/^(.+?)\s\|\s(.+)$/i); if (m) companyName = m[2].trim(); }
  if (!companyName) { m = cs.match(/\bat\s+([A-Z][A-Za-z0-9&.,()'\s-]{2,})\b/); if (m) companyName = m[1].trim(); }
  if (!companyName) { m = cs.match(/(^|[\.\|\-•])\s*([A-Z][A-Za-z0-9&.,()'\s-]{2,})\s+·\s+(Full-time|Part-time|Contract|Internship|Freelance|Self-employed)\b/i); if (m) companyName = m[2].trim(); }
  const cleanup = c => (c || '').replace(/\s*\|\s*LinkedIn.*$/i, '').replace(/\b(linkedin|profile|profiles)\b/gi, '').replace(/\s+-\s+View.*$/i, '').replace(/[|,;\s]+$/g, '').trim();
  companyName = cleanup(companyName);
  const bad = new Set(['LinkedIn', 'India', 'Bengaluru', 'Bangalore', 'Mumbai', 'Delhi', 'Hyderabad']);
  if (bad.has(companyName)) companyName = '';
  return { jobTitle: jobTitle || '', companyName: companyName || '' };
}

function buildQuery({ country, titles, mustHave, niceToHave }) {
  const countryMap = { IN: 'in.linkedin.com', US: 'linkedin.com', UK: 'uk.linkedin.com', SG: 'sg.linkedin.com' };
  const site = `site:${countryMap[country] || 'in.linkedin.com'}/in`;
  const titleStr = titles.filter(Boolean).length ? `(${titles.filter(Boolean).map(t => `intitle:"${t}"`).join(' OR ')})` : '';
  const mustStr = mustHave.filter(Boolean).map(k => `(${k})`).join(' ');
  const niceStr = niceToHave.filter(Boolean).length ? `(${niceToHave.filter(Boolean).join(' OR ')})` : '';
  return [site, titleStr, mustStr, niceStr].filter(Boolean).join(' ');
}

async function runSearch({ query, pages, onProgress }) {
  const seen = new Set();
  const results = [];
  for (let page = 1; page <= pages; page++) {
    onProgress(`Fetching page ${page} of ${pages}…`);
    let organic = [];
    try {
      const res = await fetch('/api/serper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, page, num: 10, gl: 'in', hl: 'en' }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); onProgress(`Error on page ${page}: ${err.error || res.status}`); break; }
      const json = await res.json();
      organic = json.organic || [];
    } catch (e) { onProgress(`Network error on page ${page}: ${e.message}`); break; }
    for (const it of organic) {
      const url = (it.link || '').trim();
      if (!/^https?:\/\/(www\.)?(in\.|uk\.|sg\.)?linkedin\.com\/in\//i.test(url)) continue;
      if (seen.has(url.toLowerCase())) continue;
      seen.add(url.toLowerCase());
      const key = await sha1Hex(url.toLowerCase());
      const { jobTitle, companyName } = extractJobTitleAndCompany(it.title || '', it.snippet || '');
      results.push({ key, profileUrl: url, resultTitle: it.title || '', snippet: it.snippet || '', jobTitle, companyName, queryUsed: query, capturedAt: new Date().toISOString() });
    }
    await new Promise(r => setTimeout(r, 220));
  }
  return results;
}

async function fetchSheetKeys() {
  const res = await fetch('/api/sheets');
  if (!res.ok) throw new Error(`Sheet keys fetch failed: ${res.status}`);
  const data = await res.json();
  return new Set(data.keys || []);
}

async function saveToSheet(rows) {
  const res = await fetch('/api/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Sheets error ${res.status}`);
  return data;
}

async function updateCronQuery(query, secret) {
  const res = await fetch('/api/cron-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, secret }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update cron query');
  return data;
}

// ─── design tokens ────────────────────────────────────────────────────────────

const P = {
  900: '#1a0a2e', 800: '#2d1654', 700: '#3f2070', 600: '#533ab7',
  500: '#6d52d4', 400: '#8b72e8', 300: '#b09ef2', 200: '#d4c9f8',
  100: '#ede8fd', 50: '#f7f5ff',
};

const css = {
  wrap: {
    maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem',
    fontFamily: "'IBM Plex Sans', sans-serif",
    color: P[900], background: '#fafaf9', minHeight: '100vh',
  },
  label: {
    display: 'block', fontSize: 10, fontWeight: 600, color: P[600],
    marginBottom: 5, letterSpacing: '0.09em', textTransform: 'uppercase',
  },
  input: {
    width: '100%', padding: '8px 11px', fontSize: 13,
    border: `1px solid ${P[200]}`, borderRadius: 7,
    background: '#fff', color: P[900],
    fontFamily: "'IBM Plex Mono', monospace", outline: 'none',
    transition: 'border-color 0.15s',
  },
  tag: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 9px', borderRadius: 20, fontSize: 11,
    background: P[100], border: `1px solid ${P[200]}`,
    color: P[700], fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
  },
  tagX: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, color: P[400], padding: 0 },
  tabBtn: (active) => ({
    padding: '8px 18px', fontSize: 12, fontWeight: active ? 600 : 400,
    background: active ? P[600] : 'transparent',
    border: 'none',
    borderRadius: 20,
    color: active ? '#fff' : P[500],
    cursor: 'pointer', transition: 'all 0.15s',
  }),
  runBtn: (running) => ({
    padding: '8px 22px', fontSize: 13, fontWeight: 600,
    background: running ? P[200] : `linear-gradient(135deg, ${P[600]}, ${P[500]})`,
    color: running ? P[400] : '#fff',
    border: 'none', borderRadius: 8,
    cursor: running ? 'not-allowed' : 'pointer',
    boxShadow: running ? 'none' : `0 2px 12px ${P[300]}`,
    transition: 'all 0.2s',
  }),
  outlineBtn: (disabled, active) => ({
    padding: '7px 14px', fontSize: 12, fontWeight: 500,
    background: active ? P[100] : 'transparent',
    color: disabled ? P[300] : active ? P[600] : P[600],
    border: `1px solid ${disabled ? P[200] : P[300]}`,
    borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap', transition: 'all 0.15s',
  }),
  card: {
    background: '#fff', borderRadius: 10,
    border: `1px solid ${P[100]}`,
    boxShadow: `0 1px 4px ${P[100]}`,
  },
  th: {
    textAlign: 'left', padding: '9px 13px', fontSize: 10, fontWeight: 600,
    color: P[500], borderBottom: `1px solid ${P[100]}`,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    background: P[50],
  },
  td: { padding: '10px 13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
};

// ─── TagInput ─────────────────────────────────────────────────────────────────

function TagInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !value.includes(v)) onChange([...value, v]); setDraft(''); };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '5px 8px', border: `1px solid ${P[200]}`, borderRadius: 7, background: '#fff', minHeight: 38, alignItems: 'center' }}>
      {value.map((v, i) => (
        <span key={i} style={css.tag}>{v}<button style={css.tagX} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></span>
      ))}
      <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} placeholder={value.length === 0 ? placeholder : ''} style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: P[900], minWidth: 100, flex: 1 }} />
    </div>
  );
}

// ─── SnippetTooltip ───────────────────────────────────────────────────────────

function SnippetTooltip({ snippet, visible }) {
  if (!visible || !snippet) return null;
  return (
    <div style={{
      position: 'absolute', bottom: '110%', left: 0, zIndex: 100,
      background: P[900], color: '#fff', borderRadius: 8,
      padding: '10px 13px', fontSize: 11, lineHeight: 1.6,
      maxWidth: 360, minWidth: 200, boxShadow: `0 8px 24px rgba(0,0,0,0.18)`,
      pointerEvents: 'none',
    }}>
      {snippet}
      <div style={{ position: 'absolute', bottom: -5, left: 20, width: 10, height: 10, background: P[900], transform: 'rotate(45deg)', borderRadius: 2 }} />
    </div>
  );
}

const COUNTRIES = [{ v: 'IN', l: 'India (in.linkedin.com)' }, { v: 'US', l: 'Global (linkedin.com)' }, { v: 'UK', l: 'UK (uk.linkedin.com)' }, { v: 'SG', l: 'Singapore (sg.linkedin.com)' }];

const DEFAULT_CRON_QUERY = 'site:in.linkedin.com/in (intitle:"Staff Engineer" OR intitle:"Architect" OR intitle:"principal engineer") (lakehouse) (iceberg)';

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [country, setCountry] = useState('IN');
  const [titles, setTitles] = useState(['product manager', 'Tech Product Manager']);
  const [mustHave, setMustHave] = useState(['API', 'platform']);
  const [niceToHave, setNiceToHave] = useState(['integrations', 'data connectors', 'data ingestion']);
  const [pages, setPages] = useState(5);
  const [useRaw, setUseRaw] = useState(false);
  const [rawQuery, setRawQuery] = useState('');

  const [cronQuery, setCronQuery] = useState(DEFAULT_CRON_QUERY);
  const [cronSecret, setCronSecret] = useState('');
  const [cronSaving, setCronSaving] = useState(false);
  const [cronSaved, setCronSaved] = useState(false);
  const [cronMsg, setCronMsg] = useState('');

  const [status, setStatus] = useState('idle');
  const [sheetStatus, setSheetStatus] = useState('idle');
  const [sheetMsg, setSheetMsg] = useState('');
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState([]);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [log, setLog] = useState([]);
  const [tab, setTab] = useState('config');
  const [filter, setFilter] = useState('');
  const [hoveredRow, setHoveredRow] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);

  const addLog = useCallback(msg => setLog(l => [...l, { t: new Date().toLocaleTimeString(), msg }]), []);
  const finalQuery = useRaw ? rawQuery : buildQuery({ country, titles, mustHave, niceToHave });
  const isRunning = status === 'running';
  const isSaving = sheetStatus === 'saving';
  const newRows = results.filter(r => !savedKeys.has(r.key));

  const handleRun = async () => {
    setStatus('running'); setResults([]); setLog([]); setTab('results');
    setExpandedRow(null); setSheetStatus('idle'); setSheetMsg('');
    const onProgress = msg => { setProgress(msg); addLog(msg); };
    try {
      const found = await runSearch({ query: finalQuery, pages, onProgress });
      setResults(found);
      addLog(`Done — ${found.length} unique profiles found`);
      setStatus('done'); setProgress(`${found.length} profiles found`);
    } catch (e) {
      addLog(`Error: ${e.message}`); setStatus('error'); setProgress(`Error: ${e.message}`);
    }
  };

  const handleSaveToSheet = async () => {
    if (newRows.length === 0) return;
    setSheetStatus('saving'); setSheetMsg(`Saving ${newRows.length} rows…`);
    addLog(`Saving ${newRows.length} new profiles to sheet…`);
    try {
      addLog('Fetching existing sheet keys for dedup…');
      const existingKeys = await fetchSheetKeys();
      const dedupedRows = newRows.filter(r => !existingKeys.has(r.key));
      addLog(`${dedupedRows.length} rows after dedup`);
      if (dedupedRows.length === 0) {
        setSavedKeys(prev => new Set([...prev, ...results.map(r => r.key)]));
        setSheetStatus('saved'); setSheetMsg('All profiles already in sheet');
        addLog('All profiles already in sheet'); return;
      }
      const result = await saveToSheet(dedupedRows);
      setSavedKeys(prev => new Set([...prev, ...results.map(r => r.key)]));
      setSheetStatus('saved'); setSheetMsg(`Saved ${result.appended} new profiles to sheet`);
      addLog(`Appended ${result.appended} rows`);
    } catch (e) {
      setSheetStatus('error'); setSheetMsg(`Sheet error: ${e.message}`);
      addLog(`Sheet error: ${e.message}`);
    }
  };

  const handleSaveCronQuery = async () => {
    setCronSaving(true); setCronMsg('');
    try {
      addLog(`Updating cron query…`);
      setCronSaved(true);
      setCronMsg('Cron query saved — takes effect next Monday run');
      addLog('Cron query updated successfully');
    } catch (e) {
      setCronMsg(`Error: ${e.message}`);
    } finally {
      setCronSaving(false);
    }
  };

  const downloadCSV = () => {
    const cols = ['profileUrl', 'jobTitle', 'companyName', 'resultTitle', 'snippet', 'capturedAt'];
    const header = cols.join(',');
    const rows = results.map(r => cols.map(c => `"${(r[c] || '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'xray_results.csv'; a.click();
  };

  const filtered = results.filter(r => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return r.profileUrl.toLowerCase().includes(f) || r.jobTitle.toLowerCase().includes(f) || r.companyName.toLowerCase().includes(f) || r.snippet.toLowerCase().includes(f);
  });

  const dotColor = { idle: P[300], running: '#22c55e', done: P[500], error: '#ef4444' }[status];
  const sheetBadgeStyle = {
    saved: { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' },
    error: { background: '#fff0f0', border: '1px solid #fcc', color: '#c00' },
    saving: { background: P[50], border: `1px solid ${P[200]}`, color: P[600] },
    idle: null,
  }[sheetStatus];

  return (
    <div style={css.wrap}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, boxShadow: status === 'running' ? `0 0 0 3px ${P[200]}` : 'none', transition: 'all 0.3s' }} />
            <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.5px', color: P[800] }}>LinkedIn X-ray Sourcer</span>
          </div>
          <p style={{ fontSize: 12, color: P[400], margin: 0, marginLeft: 19 }}>Google X-ray search · weekly cron · saves to Google Sheets</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {results.length > 0 && (
            <>
              <button onClick={downloadCSV} style={css.outlineBtn(false, false)}>Export CSV</button>
              <button onClick={handleSaveToSheet} disabled={isSaving || newRows.length === 0} style={{
                ...css.outlineBtn(isSaving || newRows.length === 0, sheetStatus === 'saved'),
                background: sheetStatus === 'saved' ? '#f0fdf4' : 'transparent',
                color: sheetStatus === 'saved' ? '#15803d' : (isSaving || newRows.length === 0 ? P[300] : P[600]),
                border: sheetStatus === 'saved' ? '1px solid #bbf7d0' : `1px solid ${isSaving || newRows.length === 0 ? P[200] : P[300]}`,
              }}>
                {isSaving ? 'Saving…' : sheetStatus === 'saved' ? 'Saved to Sheet' : newRows.length > 0 ? `Save ${newRows.length} to Sheet` : 'Save to Sheet'}
              </button>
            </>
          )}
          <button onClick={handleRun} disabled={isRunning} style={css.runBtn(isRunning)}>
            {isRunning ? 'Running…' : 'Run Search'}
          </button>
        </div>
      </div>

      {/* Pages */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
        <label style={{ ...css.label, margin: 0 }}>Pages</label>
        <input type="number" min={1} max={10} value={pages} onChange={e => setPages(Number(e.target.value))} style={{ ...css.input, width: 64, textAlign: 'center' }} />
        <span style={{ fontSize: 11, color: P[400] }}>× 10 results = up to {pages * 10} profiles</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1.25rem', background: P[50], padding: 4, borderRadius: 12, width: 'fit-content' }}>
        {[['config', 'Query Builder'], ['cron', 'Cron Config'], ['results', `Results${results.length ? ` (${results.length})` : ''}`], ['log', `Log${log.length ? ` (${log.length})` : ''}`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={css.tabBtn(tab === id)}>{label}</button>
        ))}
      </div>

      {/* ── QUERY BUILDER ── */}
      {tab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ fontSize: 12, color: P[500], display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={useRaw} onChange={e => setUseRaw(e.target.checked)} />
            Use raw Boolean query
          </label>
          {!useRaw ? (
            <>
              <div>
                <label style={css.label}>Country / LinkedIn subdomain</label>
                <select value={country} onChange={e => setCountry(e.target.value)} style={{ ...css.input, width: 'auto', cursor: 'pointer' }}>
                  {COUNTRIES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
              </div>
              <div>
                <label style={css.label}>Job titles <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: P[400] }}>— press Enter after each</span></label>
                <TagInput value={titles} onChange={setTitles} placeholder='"product manager"' />
              </div>
              <div>
                <label style={css.label}>Must-have keywords <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: P[400] }}>— each becomes AND (...)</span></label>
                <TagInput value={mustHave} onChange={setMustHave} placeholder="e.g. API" />
              </div>
              <div>
                <label style={css.label}>Nice-to-have <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: P[400] }}>— joined with OR</span></label>
                <TagInput value={niceToHave} onChange={setNiceToHave} placeholder="e.g. integrations" />
              </div>
              <div style={{ padding: '10px 13px', background: P[50], borderRadius: 8, border: `1px solid ${P[100]}` }}>
                <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: P[400] }}>Generated query preview</p>
                <code style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: P[700], wordBreak: 'break-all', lineHeight: 1.7 }}>{finalQuery || <em>Fill in fields above</em>}</code>
              </div>
            </>
          ) : (
            <div>
              <label style={css.label}>Raw Boolean query</label>
              <textarea value={rawQuery} onChange={e => setRawQuery(e.target.value)} rows={5} placeholder={'site:in.linkedin.com/in (intitle:"product manager") (API) ...'} style={{ ...css.input, resize: 'vertical', lineHeight: 1.6, fontSize: 12 }} />
            </div>
          )}
        </div>
      )}

      {/* ── CRON CONFIG ── */}
      {tab === 'cron' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ ...css.card, padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: P[800] }}>Weekly Cron — Every Monday 08:00 IST</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: P[400], fontFamily: "'IBM Plex Mono', monospace" }}>30 2 * * 1 UTC</span>
            </div>
            <div>
              <label style={css.label}>Cron search query <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: P[400] }}>— this runs automatically every Monday</span></label>
              <textarea value={cronQuery} onChange={e => { setCronQuery(e.target.value); setCronSaved(false); }} rows={4} style={{ ...css.input, resize: 'vertical', lineHeight: 1.6, fontSize: 12, marginBottom: 8 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <div style={{ flex: 1, padding: '8px 11px', background: P[50], borderRadius: 7, border: `1px solid ${P[100]}`, fontSize: 11, color: P[500], fontFamily: "'IBM Plex Mono', monospace" }}>
                To apply changes: update <code style={{ background: P[100], padding: '1px 5px', borderRadius: 4 }}>XRAY_QUERY</code> in Vercel env vars with this query
              </div>
              <button onClick={() => { navigator.clipboard.writeText(cronQuery); setCronSaved(true); setCronMsg('Copied to clipboard — paste into XRAY_QUERY in Vercel'); }} style={{ ...css.outlineBtn(false, cronSaved), whiteSpace: 'nowrap' }}>
                {cronSaved ? 'Copied!' : 'Copy query'}
              </button>
            </div>
            {cronMsg && <p style={{ margin: '8px 0 0', fontSize: 12, color: P[600] }}>{cronMsg}</p>}
          </div>

          <div style={{ ...css.card, padding: '1rem 1.25rem' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: P[800] }}>Test cron manually</p>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: P[500] }}>Run the cron job right now to verify it works.</p>
            <div style={{ background: P[900], borderRadius: 7, padding: '10px 13px' }}>
              <code style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: P[200], lineHeight: 1.8, wordBreak: 'break-all' }}>
                curl -X GET https://your-app.vercel.app/api/cron \<br />
                {'  '}-H "Authorization: Bearer YOUR_CRON_SECRET"
              </code>
            </div>
          </div>
        </div>
      )}

      {/* ── RESULTS ── */}
      {tab === 'results' && (
        <div>
          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: P[300], fontSize: 13 }}>
              {isRunning ? progress : 'No results yet — configure your query and run a search'}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name, title, company, snippet…" style={{ ...css.input, maxWidth: 340 }} />
                <span style={{ fontSize: 11, color: P[400], whiteSpace: 'nowrap' }}>{filtered.length} of {results.length} profiles</span>
              </div>
              <div style={{ ...css.card, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {[['', '4%'], ['Profile handle', '36%'], ['Job Title', '24%'], ['Company', '23%'], ['Time', '13%']].map(([h, w]) => (
                        <th key={h + w} style={{ ...css.th, width: w }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const inSheet = savedKeys.has(r.key);
                      const isHovered = hoveredRow === i;
                      return (
                        <>
                          <tr
                            key={r.key}
                            onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                            onMouseEnter={() => setHoveredRow(i)}
                            onMouseLeave={() => setHoveredRow(null)}
                            style={{
                              borderBottom: expandedRow === i ? 'none' : `1px solid ${P[50]}`,
                              cursor: 'pointer',
                              background: isHovered ? P[50] : expandedRow === i ? P[50] : '#fff',
                              transition: 'background 0.1s',
                            }}
                          >
                            <td style={{ ...css.td, textAlign: 'center', paddingRight: 4 }}>
                              {inSheet && <div title="Saved to sheet" style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', margin: '0 auto' }} />}
                            </td>
                            <td style={{ ...css.td, position: 'relative' }}>
                              <a href={r.profileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: P[600], textDecoration: 'none', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 500 }}>
                                {r.profileUrl.replace(/https?:\/\/(www\.)?(in\.|uk\.|sg\.)?linkedin\.com\/in\//, '').replace(/\/$/, '')}
                              </a>
                              <SnippetTooltip snippet={r.snippet} visible={isHovered && !expandedRow} />
                            </td>
                            <td style={{ ...css.td, color: r.jobTitle ? P[800] : P[300] }}>{r.jobTitle || '—'}</td>
                            <td style={{ ...css.td, color: r.companyName ? P[800] : P[300] }}>{r.companyName || '—'}</td>
                            <td style={{ ...css.td, color: P[300], fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{r.capturedAt.slice(11, 16)}</td>
                          </tr>
                          {expandedRow === i && (
                            <tr key={r.key + '_exp'}>
                              <td colSpan={5} style={{ padding: '10px 15px 15px', borderBottom: `1px solid ${P[100]}`, background: P[50] }}>
                                <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 600, color: P[400], letterSpacing: '0.07em', textTransform: 'uppercase' }}>Snippet</p>
                                <p style={{ margin: '0 0 10px', fontSize: 12, color: P[700], lineHeight: 1.65 }}>{r.snippet || <em style={{ color: P[300] }}>No snippet available</em>}</p>
                                <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 600, color: P[400], letterSpacing: '0.07em', textTransform: 'uppercase' }}>Full title</p>
                                <p style={{ margin: '0 0 10px', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: P[600] }}>{r.resultTitle}</p>
                                <a href={r.profileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: P[600], textDecoration: 'none', fontWeight: 500 }}>Open on LinkedIn →</a>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── LOG ── */}
      {tab === 'log' && (
        <div style={{ background: P[900], borderRadius: 10, padding: '12px 15px', minHeight: 80 }}>
          {log.length === 0
            ? <p style={{ fontSize: 12, color: P[500], margin: 0, fontFamily: "'IBM Plex Mono', monospace" }}>No log entries yet</p>
            : log.map((l, i) => (
              <div key={i} style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", padding: '4px 0', borderBottom: i < log.length - 1 ? `1px solid ${P[800]}` : 'none', display: 'flex', gap: 12 }}>
                <span style={{ color: P[500], flexShrink: 0 }}>{l.t}</span>
                <span style={{ color: P[200] }}>{l.msg}</span>
              </div>
            ))
          }
        </div>
      )}

      {/* Status bars */}
      {(isRunning || status === 'done' || status === 'error') && (
        <div style={{ marginTop: 12, padding: '8px 13px', borderRadius: 7, background: status === 'error' ? '#fff0f0' : P[50], border: `1px solid ${status === 'error' ? '#fcc' : P[100]}`, fontSize: 12, color: status === 'error' ? '#c00' : P[600], display: 'flex', alignItems: 'center', gap: 8 }}>
          {isRunning && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />}
          {progress}
        </div>
      )}
      {sheetMsg && sheetBadgeStyle && (
        <div style={{ marginTop: 6, padding: '8px 13px', borderRadius: 7, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, ...sheetBadgeStyle }}>
          {isSaving && <div style={{ width: 7, height: 7, borderRadius: '50%', background: P[400], flexShrink: 0 }} />}
          {sheetMsg}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: `1px solid ${P[100]}`, fontSize: 11, color: P[300], lineHeight: 1.8 }}>
        All API keys stored as Vercel environment variables — never sent to the browser. Cron runs every <strong style={{ color: P[400] }}>Monday 08:00 IST</strong>.
      </div>
    </div>
  );
}
