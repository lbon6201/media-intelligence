import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

export default function QuotesTab({ workstream }) {
  const [quotes, setQuotes] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [filters, setFilters] = useState({ type: '', stance: '', search: '' });

  const load = useCallback(async () => {
    const [q, s] = await Promise.all([
      api.getQuotes({ workstream_id: workstream.id, ...filters }),
      api.getSpeakers(workstream.id),
    ]);
    setQuotes(q);
    setSpeakers(s);
  }, [workstream.id, filters]);

  useEffect(() => { load(); }, [load]);

  async function handleExportQuotes(format) {
    try {
      await api.downloadQuoteExport(workstream.id, {
        format,
        stance: filters.stance || 'negative,neutral,positive',
        type: filters.type || 'external,institutional_investor',
      });
    } catch (e) {
      alert('Export error: ' + e.message);
    }
  }

  const stanceColor = (s) => {
    if (s === 'positive' || s === 'bullish') return 'bg-emerald-100 text-emerald-700';
    if (s === 'negative' || s === 'bearish') return 'bg-red-100 text-red-700';
    if (s === 'cautious') return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#002855]">Quotes</h2>
        <div className="flex gap-2">
          <button onClick={() => handleExportQuotes('xlsx')} disabled={quotes.length === 0}
            className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm hover:bg-emerald-700 disabled:opacity-50">Export Excel</button>
          <button onClick={() => handleExportQuotes('docx')} disabled={quotes.length === 0}
            className="bg-[#0057b8] text-white px-3 py-1.5 rounded text-sm hover:bg-[#002855] disabled:opacity-50">Export Word</button>
        </div>
      </div>

      {/* Speaker Tracker */}
      {speakers.length > 0 && (
        <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-[#002855] mb-3">Speaker Tracker</h3>
          <div className="flex flex-wrap gap-2">
            {speakers.map(s => {
              const total = s.total;
              const pos = (s.stances.positive || 0) + (s.stances.bullish || 0);
              const neg = (s.stances.negative || 0) + (s.stances.bearish || 0);
              const neu = total - pos - neg;
              return (
                <div key={s.name} className="flex items-center gap-2 bg-[#f0f5fb] rounded px-2 py-1.5">
                  <span className="text-xs font-medium text-[#002855]">{s.name}</span>
                  <span className="text-xs text-[#4a6080]">({total})</span>
                  <div className="flex h-2 w-16 rounded-full overflow-hidden">
                    {pos > 0 && <div className="bg-emerald-500" style={{ width: `${(pos / total) * 100}%` }} />}
                    {neu > 0 && <div className="bg-slate-300" style={{ width: `${(neu / total) * 100}%` }} />}
                    {neg > 0 && <div className="bg-red-500" style={{ width: `${(neg / total) * 100}%` }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <input className="border border-[#b8cce0] rounded px-3 py-1.5 text-sm w-48" placeholder="Search quotes, speakers..."
          value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
        <select className="border border-[#b8cce0] rounded px-3 py-1.5 text-sm" value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}>
          <option value="">All Types</option>
          <option value="institutional_investor">Institutional Investor</option>
          <optgroup label="External Roles">
            <option value="external">All External</option>
            <option value="regulator">Regulator</option>
            <option value="legislator">Legislator</option>
            <option value="academic">Academic</option>
            <option value="rating_agency">Rating Agency</option>
            <option value="trade_group">Trade Group</option>
            <option value="legal_expert">Legal Expert</option>
            <option value="industry_executive">Industry Executive</option>
            <option value="former_official">Former Official</option>
            <option value="journalist">Journalist</option>
            <option value="analyst">Analyst</option>
            <option value="investor_advocate">Investor Advocate</option>
            <option value="other">Other</option>
          </optgroup>
        </select>
        <select className="border border-[#b8cce0] rounded px-3 py-1.5 text-sm" value={filters.stance} onChange={e => setFilters({ ...filters, stance: e.target.value })}>
          <option value="">All Stances</option>
          <option value="positive">Positive</option>
          <option value="bullish">Bullish</option>
          <option value="neutral">Neutral</option>
          <option value="cautious">Cautious</option>
          <option value="negative">Negative</option>
          <option value="bearish">Bearish</option>
        </select>
        <span className="text-sm text-[#4a6080]">{quotes.length} quotes</span>
      </div>

      {/* Quote List */}
      <div className="space-y-2">
        {quotes.map(q => (
          <div key={q.id} className="bg-white border border-[#b8cce0] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-sm text-[#002855]">{q.speaker || 'Unknown'}</span>
              {q.role && <span className="text-xs text-[#4a6080]">({q.role})</span>}
              <span className={`text-xs px-2 py-0.5 rounded-full ${q.type === 'institutional_investor' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                {q.type === 'institutional_investor' ? 'Institutional' : 'External'}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${stanceColor(q.stance)}`}>{q.stance}</span>
            </div>
            <p className="text-sm text-[#4a6080] italic">"{q.text}"</p>
            <p className="text-xs text-[#4a6080] mt-2">
              From: <span className="font-medium">{q.article_headline}</span> — {q.article_outlet}, {q.article_date}
            </p>
          </div>
        ))}
        {quotes.length === 0 && <p className="text-center py-8 text-[#4a6080]">No quotes found. Classify articles to extract quotes.</p>}
      </div>
    </div>
  );
}
