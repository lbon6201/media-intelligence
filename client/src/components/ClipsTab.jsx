import React, { useState, useContext } from 'react';
import { AppContext } from '../App';

export default function ClipsTab({ workstream, selectedArticleIds }) {
  const { addToast } = useContext(AppContext);
  const [mode, setMode] = useState(selectedArticleIds?.length > 0 ? 'selection' : 'date');
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [headerTo, setHeaderTo] = useState(workstream.client || '');
  const [headerRe, setHeaderRe] = useState('');
  const [headerDate, setHeaderDate] = useState('');
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const body = {
        header_to: headerTo,
        header_re: headerRe || undefined,
        header_date: headerDate || undefined,
      };

      if (mode === 'selection' && selectedArticleIds?.length > 0) {
        body.article_ids = selectedArticleIds;
      } else {
        body.date_from = dateFrom;
        body.date_to = dateTo || undefined;
      }

      const token = localStorage.getItem('mip-token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`/api/clips/${workstream.id}/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Export failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const cd = res.headers.get('content-disposition') || '';
      const match = cd.match(/filename=(.+)/);
      a.href = url;
      a.download = match ? match[1] : `clips_${dateFrom}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      addToast?.('success', 'Clips document downloaded');
    } catch (e) {
      addToast?.('error', e.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Clips</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Generate a formatted Word document with AI-generated summary, key narratives, article index, and full article text.
        </p>
      </div>

      {/* Header Configuration */}
      <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Document Header</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>TO</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--border)' }}
              placeholder="Recipient name"
              value={headerTo}
              onChange={e => setHeaderTo(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>DATE (override)</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--border)' }}
              placeholder="Auto-generated if empty"
              value={headerDate}
              onChange={e => setHeaderDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>RE (subject)</label>
          <input
            className="w-full border rounded px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--border)' }}
            placeholder={`${workstream.name} – Media Coverage Report`}
            value={headerRe}
            onChange={e => setHeaderRe(e.target.value)}
          />
        </div>
      </div>

      {/* Article Selection Mode */}
      <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Article Selection</h3>

        <div className="flex gap-2">
          <button
            onClick={() => setMode('date')}
            className={`px-3 py-1.5 rounded text-sm ${mode === 'date' ? 'bg-[#0057b8] text-white' : ''}`}
            style={mode !== 'date' ? { background: 'var(--bg-content)', color: 'var(--text-muted)' } : {}}
          >
            By Date Range
          </button>
          {selectedArticleIds?.length > 0 && (
            <button
              onClick={() => setMode('selection')}
              className={`px-3 py-1.5 rounded text-sm ${mode === 'selection' ? 'bg-[#0057b8] text-white' : ''}`}
              style={mode !== 'selection' ? { background: 'var(--bg-content)', color: 'var(--text-muted)' } : {}}
            >
              Selected Articles ({selectedArticleIds.length})
            </button>
          )}
        </div>

        {mode === 'date' && (
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>From</label>
              <input
                type="date"
                className="border rounded px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--border)' }}
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>To</label>
              <input
                type="date"
                className="border rounded px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--border)' }}
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </div>
            <div className="self-end">
              <button
                onClick={() => { const t = new Date().toISOString().split('T')[0]; setDateFrom(t); setDateTo(t); }}
                className="text-xs px-2 py-2 rounded hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                Today
              </button>
            </div>
          </div>
        )}

        {mode === 'selection' && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {selectedArticleIds?.length} article(s) selected from the Articles tab. Go back to Articles to change the selection.
          </p>
        )}
      </div>

      {/* Generate */}
      <button
        onClick={handleGenerate}
        disabled={generating || (mode === 'date' && !dateFrom)}
        className="bg-[#0057b8] text-white px-6 py-2.5 rounded text-sm font-medium hover:bg-[#002855] disabled:opacity-50"
      >
        {generating ? 'Generating Clips...' : 'Generate Clips Document'}
      </button>

      {generating && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Claude is generating the summary and key narratives. This may take a moment...
        </p>
      )}
    </div>
  );
}
