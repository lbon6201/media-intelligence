import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const CATEGORY_META = {
  external: { label: 'External', color: 'bg-purple-100 text-purple-700', desc: 'Voices outside the industry' },
  internal: { label: 'Internal', color: 'bg-amber-100 text-amber-700', desc: 'People at the firms' },
};

const ROLE_LABELS = {
  regulator: 'Regulator', legislator: 'Legislator', academic: 'Academic', rating_agency: 'Rating Agency',
  legal_expert: 'Legal Expert', former_official: 'Former Official', journalist: 'Journalist',
  analyst: 'Analyst', investor_advocate: 'Investor Advocate', other: 'Other',
  fund_executive: 'Fund Executive', portfolio_manager: 'Portfolio Manager', spokesperson: 'Spokesperson',
  trade_association: 'Trade Association', institutional_investor: 'Institutional Investor',
};

function stanceColor(s) {
  if (s === 'positive') return 'bg-emerald-100 text-emerald-700';
  if (s === 'negative') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

export default function QuotesTab({ workstream }) {
  const [quotes, setQuotes] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [filters, setFilters] = useState({ type: '', stance: '', search: '', role: '' });
  const [view, setView] = useState('quotes'); // quotes | speakers
  const [expandedSpeaker, setExpandedSpeaker] = useState(null);

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
      const params = { format };
      if (filters.type) params.type = filters.type;
      else params.type = 'external,internal';
      if (filters.stance) params.stance = filters.stance;
      else params.stance = 'negative,neutral,positive';
      if (filters.search) params.search = filters.search;
      if (filters.role) params.role = filters.role;
      await api.downloadQuoteExport(workstream.id, params);
    } catch (e) { alert('Export error: ' + e.message); }
  }

  // Group quotes by category
  const grouped = { external: [], internal: [] };
  quotes.forEach(q => {
    const cat = q.type || 'external';
    if (grouped[cat]) grouped[cat].push(q);
    else grouped.external.push(q);
  });

  // Stats
  const totalQuotes = quotes.length;
  const stanceCounts = { positive: 0, neutral: 0, negative: 0 };
  quotes.forEach(q => {
    const s = (q.stance || '').toLowerCase();
    if (s === 'positive') stanceCounts.positive++;
    else if (s === 'negative') stanceCounts.negative++;
    else stanceCounts.neutral++;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Quotes</h2>
          <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <button onClick={() => setView('quotes')} className="px-3 py-1 text-xs font-medium" style={{ background: view === 'quotes' ? 'var(--accent-subtle)' : 'var(--bg-card)', color: view === 'quotes' ? 'var(--accent)' : 'var(--text-muted)' }}>Quotes</button>
            <button onClick={() => setView('speakers')} className="px-3 py-1 text-xs font-medium" style={{ background: view === 'speakers' ? 'var(--accent-subtle)' : 'var(--bg-card)', color: view === 'speakers' ? 'var(--accent)' : 'var(--text-muted)' }}>Speakers</button>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleExportQuotes('xlsx')} disabled={totalQuotes === 0} className="btn-primary px-3 py-1.5 text-xs">Export Excel</button>
          <button onClick={() => handleExportQuotes('docx')} disabled={totalQuotes === 0} className="btn-secondary px-3 py-1.5 text-xs">Export Word</button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 items-center">
        <div className="flex gap-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
          <span><strong style={{ color: 'var(--text-primary)' }}>{totalQuotes}</strong> quotes</span>
          <span><strong style={{ color: 'var(--text-primary)' }}>{speakers.length}</strong> speakers</span>
        </div>
        {totalQuotes > 0 && (
          <div className="flex items-center gap-1">
            <div className="flex h-2 w-32 rounded-full overflow-hidden">
              {stanceCounts.positive > 0 && <div className="bg-emerald-500" style={{ width: `${(stanceCounts.positive / totalQuotes) * 100}%` }} />}
              {stanceCounts.neutral > 0 && <div className="bg-slate-300" style={{ width: `${(stanceCounts.neutral / totalQuotes) * 100}%` }} />}
              {stanceCounts.negative > 0 && <div className="bg-red-500" style={{ width: `${(stanceCounts.negative / totalQuotes) * 100}%` }} />}
            </div>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{stanceCounts.positive}+ {stanceCounts.neutral}= {stanceCounts.negative}-</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <input placeholder="Search quotes, speakers..." value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} style={{ width: 200 }} />
        <select value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}>
          <option value="">All Categories</option>
          <option value="external">External</option>
          <option value="internal">Internal</option>
        </select>
        <select value={filters.role} onChange={e => setFilters({ ...filters, role: e.target.value })}>
          <option value="">All Roles</option>
          <optgroup label="External">
            <option value="regulator">Regulator</option>
            <option value="legislator">Legislator</option>
            <option value="academic">Academic</option>
            <option value="rating_agency">Rating Agency</option>
            <option value="legal_expert">Legal Expert</option>
            <option value="former_official">Former Official</option>
            <option value="journalist">Journalist</option>
            <option value="analyst">Analyst</option>
            <option value="investor_advocate">Investor Advocate</option>
            <option value="institutional_investor">Institutional Investor</option>
          </optgroup>
          <optgroup label="Internal">
            <option value="fund_executive">Fund Executive</option>
            <option value="portfolio_manager">Portfolio Manager</option>
            <option value="spokesperson">Spokesperson</option>
            <option value="trade_association">Trade Association</option>
          </optgroup>
        </select>
        <select value={filters.stance} onChange={e => setFilters({ ...filters, stance: e.target.value })}>
          <option value="">All Stances</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
        </select>
        {(filters.search || filters.type || filters.stance || filters.role) && (
          <button onClick={() => setFilters({ type: '', stance: '', search: '', role: '' })} className="text-xs" style={{ color: 'var(--accent)' }}>Clear</button>
        )}
      </div>

      {view === 'quotes' ? (
        /* ── Quotes view: grouped by category ── */
        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, catQuotes]) => {
            if (catQuotes.length === 0) return null;
            const meta = CATEGORY_META[cat] || CATEGORY_META.external;
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.color}`}>{meta.label}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{meta.desc} · {catQuotes.length} quotes</span>
                </div>
                <div className="space-y-1.5">
                  {catQuotes.map(q => (
                    <div key={q.id} className="card p-3 flex gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm italic" style={{ color: 'var(--text-primary)' }}>"{q.text}"</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{q.speaker || 'Unknown'}</span>
                          {q.role && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ROLE_LABELS[q.role] || q.role}</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${stanceColor(q.stance)}`}>{q.stance}</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0" style={{ maxWidth: 200 }}>
                        <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{q.article_headline}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{q.article_outlet} · {q.article_date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {totalQuotes === 0 && <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>No quotes found. Classify articles to extract quotes.</p>}
        </div>
      ) : (
        /* ── Speakers view: table with expandable rows ── */
        <div className="card overflow-hidden">
          <table className="mip-table">
            <thead>
              <tr>
                <th>Speaker</th>
                <th>Type</th>
                <th>Quotes</th>
                <th>Stance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {speakers.map(s => {
                const total = s.total;
                const pos = (s.stances.positive || 0);
                const neg = (s.stances.negative || 0) + (s.stances.bearish || 0);
                const neu = total - pos - neg;
                const isExpanded = expandedSpeaker === s.name;
                const meta = CATEGORY_META[s.type] || CATEGORY_META.external;
                return (
                  <React.Fragment key={s.name}>
                    <tr onClick={() => setExpandedSpeaker(isExpanded ? null : s.name)} className="cursor-pointer">
                      <td className="font-medium" style={{ color: 'var(--text-primary)' }}>{s.name}</td>
                      <td><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span></td>
                      <td className="font-mono text-xs">{total}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex h-2 w-20 rounded-full overflow-hidden">
                            {pos > 0 && <div className="bg-emerald-500" style={{ width: `${(pos / total) * 100}%` }} />}
                            {neu > 0 && <div className="bg-slate-300" style={{ width: `${(neu / total) * 100}%` }} />}
                            {neg > 0 && <div className="bg-red-500" style={{ width: `${(neg / total) * 100}%` }} />}
                          </div>
                          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{pos}+ {neu}= {neg}-</span>
                        </div>
                      </td>
                      <td className="text-right"><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span></td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--bg-content)', padding: '8px 12px' }}>
                          <div className="space-y-1.5">
                            {quotes.filter(q => q.speaker === s.name).map(q => (
                              <div key={q.id} className="flex gap-2 text-xs">
                                <span className={`px-1.5 py-0.5 rounded-full flex-shrink-0 ${stanceColor(q.stance)}`}>{q.stance}</span>
                                <p className="italic" style={{ color: 'var(--text-secondary)' }}>"{q.text}"</p>
                                <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{q.article_outlet}</span>
                              </div>
                            ))}
                            {quotes.filter(q => q.speaker === s.name).length === 0 && (
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No quotes loaded — try clearing filters</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {speakers.length === 0 && <tr><td colSpan={5} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No speakers found</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
