import { useState, useCallback } from 'react';

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

const css = {
  wrap: { maxWidth: 860, margin: '0 auto', padding: '2rem 1.5rem', color: '#1a1a18', fontFamily: "'IBM Plex Sans', sans-serif" },
  label: { display: 'block', fontSize: 10, fontWeight: 500, color: '#666', marginBottom: 5, letterSpacing: '0.08em', textTransform: 'uppercase' },
  input: { width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6, background: '#fff', color: '#1a1a18', fontFamily: "'IBM Plex Mono', monospace", outline: 'none' },
  tag: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 4, fontSize: 11, background: '#f0f0ee', border: '1px solid #e0e0de', color: '#1a1a18', fontFamily: "'IBM Plex Mono', monospace" },
  tagX: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#999', padding: 0 },
  tabBtn: (active) => ({ padding: '7px 16px', fontSize: 12, fontWeight: active ? 500 : 400, background: 'transparent', border: 'none', borderBottom: active ? '2px solid #1a1a18' : '2px solid transparent', color: active ? '#1a1a18' : '#888', cursor: 'pointer', marginBottom: -1 }),
  runBtn: (running) => ({ padding: '7px 20px', fontSize: 13, fontWeight: 500, background: running ? '#e8e8e6' : '#1a1a18', color: running ? '#999' : '#fff', border: 'none', borderRadius: 6, cursor: running ? 'not-allowed' : 'pointer' }),
  outlineBtn: (disabled) => ({ padding: '6px 13px', fontSize: 12, background: 'transparent', color: disabled ? '#ccc' : '#1a1a18', border: `1px solid ${disabled ? '#eee' : '#ddd'}`, borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }),
  preview: { padding: '10px 12px', background: '#f5f5f3', borderRadius: 6, border: '1px solid #e8e8e6' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 500, color: '#888', borderBottom: '1px solid #e8e8e6', letterSpacing: '0.07em', textTransform: 'uppercase', background: '#f9f9f7' },
  td: { padding: '9px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  logRow: { fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", padding: '4px 0', display: 'flex', gap: 12 },
};

function TagInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !value.includes(v)) onChange([...value, v]); setDraft(''); };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', minHeight: 36, alignItems: 'center' }}>
      {value.map((v, i) => (
        <span key={i} style={css.tag}>{v}<button style={css.tagX} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></span>
      ))}
      <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} placeholder={value.length === 0 ? placeholder : ''} style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: '#1a1a18', minWidth: 100, flex: 1 }} />
    </div>
  );
}

const COUNTRIES = [{ v: 'IN', l: 'India (in.linkedin.com)' }, { v: 'US', l: 'Global (linkedin.com)' }, { v: 'UK', l: 'UK (uk.linkedin.com)' }, { v: 'SG', l: 'Singapore (sg.linkedin.com)' }];

export default function App() {
  const [country, setCountry] = useState('IN');
  const [titles, setTitles] = useState(['product manager', 'Tech Product Manager']);
  const [mustHave, setMustHave] = useState(['API', 'platform']);
  const [niceToHave, setNiceToHave] = useState(['integrations', 'data connectors', 'data ingestion']);
  const [pages, setPages] = useState(5);
  const [useRaw, setUseRaw] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [status, setStatus] = useState('idle');
  const [sheetStatus, setSheetStatus] = useState('idle');
  const [sheetMsg, setSheetMsg] = useState('');
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState([]);
  const [savedKeys, setSavedKeys] = useState(new Set());
  const [log, setLog] = useState([]);
  const [tab, setTab] = useState('config');
  const [filter, setFilter] = useState('');
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
      setStatus('done');
      setProgress(`${found.length} profiles found`);
    } catch (e) {
      addLog(`Error: ${e.message}`);
      setStatus('error');
      setProgress(`Error: ${e.message}`);
    }
  };

  const handleSaveToSheet = async () => {
    if (newRows.length === 0) return;
    setSheetStatus('saving');
    setSheetMsg(`Saving ${newRows.length} rows…`);
    addLog(`Saving ${newRows.length} new profiles to sheet…`);
    try {
      addLog('Fetching existing sheet keys for dedup…');
      const existingKeys = await fetchSheetKeys();
      const dedupedRows = newRows.filter(r => !existingKeys.has(r.key));
      addLog(`${dedupedRows.length} rows after dedup against sheet`);
      if (dedupedRows.length === 0) {
        setSavedKeys(prev => new Set([...prev, ...results.map(r => r.key)]));
        setSheetStatus('saved');
        setSheetMsg('All profiles already in sheet — nothing new to append');
        addLog('All profiles already in sheet');
        return;
      }
      const result = await saveToSheet(dedupedRows);
      setSavedKeys(prev => new Set([...prev, ...results.map(r => r.key)]));
      setSheetStatus('saved');
      setSheetMsg(`Saved ${result.appended} new profiles to sheet`);
      addLog(`Appended ${result.appended} rows → ${result.updatedRange || 'sheet'}`);
    } catch (e) {
      setSheetStatus('error');
      setSheetMsg(`Sheet error: ${e.message}`);
      addLog(`Sheet error: ${e.message}`);
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

  const dotColor = { idle: '#bbb', running: '#22c55e', done: '#3b82f6', error: '#ef4444' }[status];
  const sheetBadgeStyle = { saved: { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }, error: { background: '#fff0f0', border: '1px solid #fcc', color: '#c00' }, saving: { background: '#f5f5f3', border: '1px solid #e8e8e6', color: '#666' }, idle: null }[sheetStatus];

  return (
    <div style={css.wrap}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
            <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.3px' }}>LinkedIn X-ray Sourcer</span>
          </div>
          <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Google X-ray search · weekly cron · saves to Google Sheets</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {results.length > 0 && (
            <>
              <button onClick={downloadCSV} style={css.outlineBtn(false)}>Export CSV</button>
              <button onClick={handleSaveToSheet} disabled={isSaving || newRows.length === 0} style={{ ...css.outlineBtn(isSaving || newRows.length === 0), background: sheetStatus === 'saved' ? '#f0fdf4' : 'transparent', color: sheetStatus === 'saved' ? '#15803d' : (isSaving || newRows.length === 0 ? '#ccc' : '#1a1a18'), border: sheetStatus === 'saved' ? '1px solid #bbf7d0' : `1px solid ${isSaving || newRows.length === 0 ? '#eee' : '#ddd'}` }}>
                {isSaving ? 'Saving…' : sheetStatus === 'saved' ? 'Saved to Sheet' : newRows.length > 0 ? `Save ${newRows.length} to Sheet` : 'Save to Sheet'}
              </button>
            </>
          )}
          <button onClick={handleRun} disabled={isRunning} style={css.runBtn(isRunning)}>
            {isRunning ? 'Running…' : 'Run Search'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
        <label style={{ ...css.label, margin: 0 }}>Pages</label>
        <input type="number" min={1} max={10} value={pages} onChange={e => setPages(Number(e.target.value))} style={{ ...css.input, width: 64, textAlign: 'center' }} />
        <span style={{ fontSize: 11, color: '#aaa' }}>× 10 results = up to {pages * 10} profiles</span>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e6', marginBottom: '1.25rem' }}>
        {[['config', 'Query Builder'], ['results', `Results${results.length ? ` (${results.length})` : ''}`], ['log', `Log${log.length ? ` (${log.length})` : ''}`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={css.tabBtn(tab === id)}>{label}</button>
        ))}
      </div>

      {tab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
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
                <label style={css.label}>Job titles <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#aaa' }}>— press Enter after each</span></label>
                <TagInput value={titles} onChange={setTitles} placeholder='"product manager"' />
              </div>
              <div>
                <label style={css.label}>Must-have keywords <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#aaa' }}>— each becomes AND (...)</span></label>
                <TagInput value={mustHave} onChange={setMustHave} placeholder="e.g. API" />
              </div>
              <div>
                <label style={css.label}>Nice-to-have <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#aaa' }}>— joined with OR</span></label>
                <TagInput value={niceToHave} onChange={setNiceToHave} placeholder="e.g. integrations" />
              </div>
              <div style={css.preview}>
                <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#aaa' }}>Generated query preview</p>
                <code style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: '#555', wordBreak: 'break-all', lineHeight: 1.7 }}>{finalQuery || <em>Fill in fields above</em>}</code>
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

      {tab === 'results' && (
        <div>
          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#bbb', fontSize: 13 }}>
              {isRunning ? progress : 'No results yet — configure your query and run a search'}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name, title, company, snippet…" style={{ ...css.input, maxWidth: 340 }} />
                <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap' }}>{filtered.length} of {results.length}</span>
              </div>
              <div style={{ border: '1px solid #e8e8e6', borderRadius: 8, overflow: 'hidden' }}>
                <table style={css.table}>
                  <thead>
                    <tr>
                      {[['', '4%'], ['Profile handle', '37%'], ['Job Title', '25%'], ['Company', '21%'], ['Time', '13%']].map(([h, w]) => (
                        <th key={h + w} style={{ ...css.th, width: w }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const inSheet = savedKeys.has(r.key);
                      return (
                        <>
                          <tr key={r.key} onClick={() => setExpandedRow(expandedRow === i ? null : i)} style={{ borderBottom: expandedRow === i ? 'none' : '1px solid #f0f0ee', cursor: 'pointer', background: expandedRow === i ? '#f9f9f7' : '#fff' }}>
                            <td style={{ ...css.td, textAlign: 'center', paddingRight: 4 }}>
                              {inSheet && <div title="Saved to sheet" style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', margin: '0 auto' }} />}
                            </td>
                            <td style={css.td}>
                              <a href={r.profileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#2563eb', textDecoration: 'none', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                                {r.profileUrl.replace(/https?:\/\/(www\.)?(in\.|uk\.|sg\.)?linkedin\.com\/in\//, '').replace(/\/$/, '')}
                              </a>
                            </td>
                            <td style={{ ...css.td, color: r.jobTitle ? '#1a1a18' : '#ccc' }}>{r.jobTitle || '—'}</td>
                            <td style={{ ...css.td, color: r.companyName ? '#1a1a18' : '#ccc' }}>{r.companyName || '—'}</td>
                            <td style={{ ...css.td, color: '#bbb', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>{r.capturedAt.slice(11, 16)}</td>
                          </tr>
                          {expandedRow === i && (
                            <tr key={r.key + '_exp'}>
                              <td colSpan={5} style={{ padding: '10px 14px 14px', borderBottom: '1px solid #e8e8e6', background: '#f9f9f7' }}>
                                <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 500, color: '#aaa', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Result title</p>
                                <p style={{ margin: '0 0 10px', fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: '#333' }}>{r.resultTitle}</p>
                                <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 500, color: '#aaa', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Snippet</p>
                                <p style={{ margin: '0 0 12px', fontSize: 12, color: '#444', lineHeight: 1.65 }}>{r.snippet || <em style={{ color: '#ccc' }}>No snippet available</em>}</p>
                                <a href={r.profileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>Open on LinkedIn →</a>
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

      {tab === 'log' && (
        <div style={{ background: '#f5f5f3', borderRadius: 8, padding: '10px 14px', minHeight: 80 }}>
          {log.length === 0
            ? <p style={{ fontSize: 12, color: '#bbb', margin: 0 }}>No log entries yet</p>
            : log.map((l, i) => (
              <div key={i} style={{ ...css.logRow, borderBottom: i < log.length - 1 ? '1px solid #ebebeb' : 'none' }}>
                <span style={{ color: '#bbb', flexShrink: 0 }}>{l.t}</span>
                <span style={{ color: '#666' }}>{l.msg}</span>
              </div>
            ))
          }
        </div>
      )}

      {(isRunning || status === 'done' || status === 'error') && (
        <div style={{ marginTop: 12, padding: '7px 12px', borderRadius: 6, background: status === 'error' ? '#fff0f0' : '#f5f5f3', border: `1px solid ${status === 'error' ? '#fcc' : '#e8e8e6'}`, fontSize: 12, color: status === 'error' ? '#c00' : '#666', display: 'flex', alignItems: 'center', gap: 8 }}>
          {isRunning && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />}
          {progress}
        </div>
      )}

      {sheetMsg && sheetBadgeStyle && (
        <div style={{ marginTop: 6, padding: '7px 12px', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, ...sheetBadgeStyle }}>
          {isSaving && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#888', flexShrink: 0 }} />}
          {sheetMsg}
        </div>
      )}

      <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #f0f0ee', fontSize: 11, color: '#bbb', lineHeight: 1.8 }}>
        All API keys stored as Vercel environment variables — never sent to the browser.
        Cron runs every <strong style={{ color: '#aaa' }}>Monday 08:00 IST</strong> and appends new profiles automatically.
      </div>
    </div>
  );
}
