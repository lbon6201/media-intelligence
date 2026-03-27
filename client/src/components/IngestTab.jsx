import React, { useState } from 'react';
import { api } from '../api';
import { parseFactiva } from '../lib/parser';
import { fingerprint } from '../lib/helpers';

export default function IngestTab({ workstream }) {
  const [mode, setMode] = useState('factiva');
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState({ headline: '', outlet: '', author: '', publish_date: '', full_text: '' });
  const [urlText, setUrlText] = useState('');
  const [urlPreview, setUrlPreview] = useState([]);

  function handleParse() {
    const articles = parseFactiva(rawText, workstream.id);
    setPreview(articles);
    setResult(null);
  }

  async function handleIngest() {
    setLoading(true);
    try { const res = await api.ingestArticles(preview); setResult(res); setPreview([]); setRawText(''); }
    catch (e) { alert('Ingest error: ' + e.message); }
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
      setResult({ ingested: res.ingested, duplicates: res.duplicates, errors: res.failed?.map(f => ({ headline: f.url, error: f.error })) || [] });
      if (res.failed?.length > 0) {
        setResult(prev => ({ ...prev, failed: res.failed }));
      }
      setUrlPreview([]);
      setUrlText('');
    } catch (e) { alert('Error: ' + e.message); }
    finally { setLoading(false); }
  }

  const modes = [['factiva', 'Factiva Paste'], ['manual', 'Single Article'], ['urls', 'URLs']];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-semibold text-[#002855]">Ingest Articles</h2>
        <div className="flex bg-[#f0f5fb] rounded-lg p-0.5">
          {modes.map(([key, label]) => (
            <button key={key} onClick={() => setMode(key)} className={`px-3 py-1.5 text-sm rounded-md ${mode === key ? 'bg-white shadow-sm font-medium text-[#002855]' : 'text-[#4a6080]'}`}>{label}</button>
          ))}
        </div>
      </div>

      {mode === 'factiva' && (
        <div className="space-y-4">
          <textarea className="w-full border border-[#b8cce0] rounded-lg px-4 py-3 text-sm font-mono h-64 focus:ring-2 focus:ring-[#0096d6]/30 focus:border-[#0057b8]" placeholder="Paste Factiva export text here..." value={rawText} onChange={e => setRawText(e.target.value)} />
          <div className="flex gap-3">
            <button onClick={handleParse} disabled={!rawText.trim()} className="bg-[#002855] text-white px-4 py-2 rounded text-sm hover:bg-[#0057b8] disabled:opacity-40">Parse Articles</button>
            {preview.length > 0 && <button onClick={handleIngest} disabled={loading} className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855] disabled:opacity-50">{loading ? 'Ingesting...' : `Ingest ${preview.length} Articles`}</button>}
          </div>
          {preview.length > 0 && (
            <div className="border border-[#b8cce0] rounded-lg divide-y divide-[#b8cce0]/30 max-h-96 overflow-y-auto">
              {preview.map((a, i) => (
                <div key={i} className="px-4 py-3">
                  <p className="font-medium text-sm text-[#002855]">{a.headline}</p>
                  <p className="text-xs text-[#4a6080]">{[a.outlet, a.author, a.publish_date, `${a.word_count} words`].filter(Boolean).join(' · ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSubmit} className="bg-white border border-[#b8cce0] rounded-lg p-6 space-y-4 max-w-2xl">
          <div><label className="block text-sm font-medium text-[#002855] mb-1">Headline *</label><input className="w-full border border-[#b8cce0] rounded px-3 py-2 text-sm" value={manual.headline} onChange={e => setManual({ ...manual, headline: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-[#002855] mb-1">Outlet</label><input className="w-full border border-[#b8cce0] rounded px-3 py-2 text-sm" value={manual.outlet} onChange={e => setManual({ ...manual, outlet: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-[#002855] mb-1">Author</label><input className="w-full border border-[#b8cce0] rounded px-3 py-2 text-sm" value={manual.author} onChange={e => setManual({ ...manual, author: e.target.value })} /></div>
            <div><label className="block text-sm font-medium text-[#002855] mb-1">Publish Date</label><input type="date" className="w-full border border-[#b8cce0] rounded px-3 py-2 text-sm" value={manual.publish_date} onChange={e => setManual({ ...manual, publish_date: e.target.value })} /></div>
          </div>
          <div><label className="block text-sm font-medium text-[#002855] mb-1">Full Text *</label><textarea className="w-full border border-[#b8cce0] rounded px-3 py-2 text-sm h-48 font-mono" value={manual.full_text} onChange={e => setManual({ ...manual, full_text: e.target.value })} /></div>
          <button type="submit" disabled={loading} className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855] disabled:opacity-50">{loading ? 'Ingesting...' : 'Ingest Article'}</button>
        </form>
      )}

      {mode === 'urls' && (
        <div className="space-y-4">
          <textarea className="w-full border border-[#b8cce0] rounded-lg px-4 py-3 text-sm font-mono h-48 focus:ring-2 focus:ring-[#0096d6]/30 focus:border-[#0057b8]" placeholder="Paste URLs, one per line..." value={urlText} onChange={e => setUrlText(e.target.value)} />
          <div className="flex gap-3">
            <button onClick={handleParseUrls} disabled={!urlText.trim()} className="bg-[#002855] text-white px-4 py-2 rounded text-sm hover:bg-[#0057b8] disabled:opacity-40">Parse URLs</button>
            {urlPreview.length > 0 && <button onClick={handleIngestUrls} disabled={loading} className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855] disabled:opacity-50">{loading ? 'Fetching & Ingesting...' : `Fetch ${urlPreview.length} URLs`}</button>}
          </div>
          {urlPreview.length > 0 && (
            <div className="border border-[#b8cce0] rounded-lg divide-y divide-[#b8cce0]/30 max-h-64 overflow-y-auto">
              {urlPreview.map((u, i) => <div key={i} className="px-4 py-2 text-xs text-[#0057b8] font-mono truncate">{u}</div>)}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-emerald-800">Ingest complete</p>
          <p className="text-emerald-700">{result.ingested} ingested, {result.duplicates} duplicates skipped{result.errors?.length > 0 && `, ${result.errors.length} errors`}</p>
          {result.failed?.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.failed.map((f, i) => (
                <p key={i} className="text-xs text-red-600">{f.url}: {f.error}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
