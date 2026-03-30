import React, { useState } from 'react';
import { api } from '../api';
import { fingerprint } from '../lib/helpers';

export default function IngestTab({ workstream }) {
  const [mode, setMode] = useState('paste');
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [parseStatus, setParseStatus] = useState('');
  const [manual, setManual] = useState({ headline: '', outlet: '', author: '', publish_date: '', full_text: '' });
  const [urlText, setUrlText] = useState('');
  const [urlPreview, setUrlPreview] = useState([]);

  async function handleParse() {
    setLoading(true);
    setParseStatus('Sending to Claude for parsing...');
    setResult(null);
    try {
      const res = await api.parseArticles(rawText, workstream.id);
      setPreview(res.articles.map(a => ({ ...a, fingerprint: fingerprint(a.headline, a.outlet, a.publish_date) })));
      if (res.errors?.length > 0) {
        setParseStatus(`Parsed ${res.articles.length} articles (${res.errors.length} blocks skipped)`);
      } else {
        setParseStatus(`Parsed ${res.articles.length} articles from ${res.total_blocks} blocks`);
      }
    } catch (e) {
      setParseStatus('Parse error: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  // Allow editing preview before ingesting
  function updatePreview(idx, field, value) {
    setPreview(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value, fingerprint: field === 'headline' || field === 'outlet' || field === 'publish_date' ? fingerprint(field === 'headline' ? value : a.headline, field === 'outlet' ? value : a.outlet, field === 'publish_date' ? value : a.publish_date) : a.fingerprint } : a));
  }

  function removePreview(idx) {
    setPreview(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleIngest() {
    setLoading(true);
    try {
      const res = await api.ingestArticles(preview);
      setResult(res);
      setPreview([]);
      setRawText('');
      setParseStatus('');
    } catch (e) { alert('Ingest error: ' + e.message); }
    finally { setLoading(false); }
  }

  async function handleManualSubmit(e) {
    e.preventDefault();
    if (!manual.headline || !manual.full_text) return alert('Headline and text required');
    setLoading(true);
    try {
      const fp = fingerprint(manual.headline, manual.outlet, manual.publish_date);
      const res = await api.ingestArticles([{ ...manual, workstream_id: workstream.id, source_type: 'paste', word_count: manual.full_text.split(/\s+/).length, fingerprint: fp }]);
      setResult(res);
      setManual({ headline: '', outlet: '', author: '', publish_date: '', full_text: '' });
    } catch (e) { alert('Error: ' + e.message); }
    finally { setLoading(false); }
  }

  function handleParseUrls() {
    const urls = urlText.split(/[\n,\s]+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));
    setUrlPreview(urls);
    setResult(null);
  }

  async function handleIngestUrls() {
    setLoading(true);
    try {
      const res = await api.ingestUrls(workstream.id, urlPreview);
      setResult({ ingested: res.ingested, duplicates: res.duplicates, errors: res.failed?.map(f => ({ headline: f.url, error: f.error })) || [], failed: res.failed });
      setUrlPreview([]);
      setUrlText('');
    } catch (e) { alert('Error: ' + e.message); }
    finally { setLoading(false); }
  }

  const modes = [['paste', 'Paste Articles'], ['manual', 'Single Article'], ['urls', 'URLs']];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Ingest Articles</h2>
        <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {modes.map(([key, label]) => (
            <button key={key} onClick={() => setMode(key)} className="px-3 py-1.5 text-xs font-medium" style={{ background: mode === key ? 'var(--accent-subtle)' : 'var(--bg-card)', color: mode === key ? 'var(--accent)' : 'var(--text-muted)' }}>{label}</button>
          ))}
        </div>
      </div>

      {mode === 'paste' && (
        <div className="space-y-4">
          <div>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              Paste article text — from Factiva, web pages, or any source. Separate multiple articles with *** on its own line. Claude will extract headlines, authors, dates, and outlets automatically.
            </p>
            <textarea className="w-full rounded-lg px-4 py-3 text-sm font-mono h-64 outline-none" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} placeholder="Paste articles here. Use *** between articles if pasting multiple..." value={rawText} onChange={e => setRawText(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleParse} disabled={!rawText.trim() || loading} className="btn-primary px-4 py-2 text-sm">
              {loading ? parseStatus || 'Parsing...' : 'Parse with AI'}
            </button>
            {preview.length > 0 && (
              <button onClick={handleIngest} disabled={loading} className="btn-primary px-4 py-2 text-sm" style={{ background: 'var(--status-approved)' }}>
                {loading ? 'Ingesting...' : `Ingest ${preview.length} Articles`}
              </button>
            )}
            {parseStatus && !loading && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{parseStatus}</span>}
          </div>

          {/* Editable preview */}
          {preview.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Preview — edit any field before ingesting</h3>
              {preview.map((a, i) => (
                <div key={i} className="card p-3">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1 space-y-1.5">
                      <input className="w-full text-sm font-medium rounded px-2 py-1 outline-none" style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }} value={a.headline} onChange={e => updatePreview(i, 'headline', e.target.value)} />
                      <div className="flex gap-2">
                        <input className="flex-1 text-xs rounded px-2 py-1 outline-none" style={{ border: '1px solid var(--border-subtle)' }} placeholder="Author" value={a.author || ''} onChange={e => updatePreview(i, 'author', e.target.value)} />
                        <input className="flex-1 text-xs rounded px-2 py-1 outline-none" style={{ border: '1px solid var(--border-subtle)' }} placeholder="Outlet" value={a.outlet || ''} onChange={e => updatePreview(i, 'outlet', e.target.value)} />
                        <input className="w-32 text-xs rounded px-2 py-1 outline-none" style={{ border: '1px solid var(--border-subtle)' }} placeholder="Date" value={a.publish_date || ''} onChange={e => updatePreview(i, 'publish_date', e.target.value)} />
                        <span className="text-xs self-center font-mono" style={{ color: 'var(--text-muted)' }}>{a.word_count}w</span>
                      </div>
                    </div>
                    <button onClick={() => removePreview(i)} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-muted)' }} title="Remove">x</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="card p-6 space-y-4 max-w-2xl">
          <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Headline *</label><input className="w-full rounded px-3 py-2 text-sm outline-none" style={{ border: '1px solid var(--border)' }} value={manual.headline} onChange={e => setManual({ ...manual, headline: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Outlet</label><input className="w-full rounded px-3 py-2 text-sm outline-none" style={{ border: '1px solid var(--border)' }} value={manual.outlet} onChange={e => setManual({ ...manual, outlet: e.target.value })} /></div>
            <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Author</label><input className="w-full rounded px-3 py-2 text-sm outline-none" style={{ border: '1px solid var(--border)' }} value={manual.author} onChange={e => setManual({ ...manual, author: e.target.value })} /></div>
            <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Date</label><input type="date" className="w-full rounded px-3 py-2 text-sm outline-none" style={{ border: '1px solid var(--border)' }} value={manual.publish_date} onChange={e => setManual({ ...manual, publish_date: e.target.value })} /></div>
          </div>
          <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Full Text *</label><textarea className="w-full rounded px-3 py-2 text-sm h-48 font-mono outline-none" style={{ border: '1px solid var(--border)' }} value={manual.full_text} onChange={e => setManual({ ...manual, full_text: e.target.value })} /></div>
          <button type="submit" disabled={loading} className="btn-primary px-4 py-2 text-sm">{loading ? 'Ingesting...' : 'Ingest Article'}</button>
        </form>
      )}

      {mode === 'urls' && (
        <div className="space-y-4">
          <textarea className="w-full rounded-lg px-4 py-3 text-sm font-mono h-48 outline-none" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} placeholder="Paste URLs, one per line..." value={urlText} onChange={e => setUrlText(e.target.value)} />
          <div className="flex gap-3">
            <button onClick={handleParseUrls} disabled={!urlText.trim()} className="btn-primary px-4 py-2 text-sm">Parse URLs</button>
            {urlPreview.length > 0 && <button onClick={handleIngestUrls} disabled={loading} className="btn-primary px-4 py-2 text-sm" style={{ background: 'var(--status-approved)' }}>{loading ? 'Fetching...' : `Fetch ${urlPreview.length} URLs`}</button>}
          </div>
          {urlPreview.length > 0 && (
            <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
              {urlPreview.map((u, i) => <div key={i} className="px-4 py-2 text-xs font-mono truncate" style={{ color: 'var(--accent)' }}>{u}</div>)}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="card p-4 text-sm" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
          <p className="font-medium" style={{ color: '#166534' }}>Ingest complete</p>
          <p style={{ color: '#15803d' }}>{result.ingested} ingested, {result.duplicates} duplicates{result.errors?.length > 0 && `, ${result.errors.length} errors`}</p>
          {result.failed?.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.failed.map((f, i) => <p key={i} className="text-xs" style={{ color: '#dc2626' }}>{f.url || f.headline}: {f.error}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
