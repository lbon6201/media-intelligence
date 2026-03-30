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

const ROLE_ORDER = ['regulator', 'legislator', 'academic', 'rating_agency', 'legal_expert', 'former_official', 'journalist', 'analyst', 'investor_advocate', 'institutional_investor', 'fund_executive', 'portfolio_manager', 'spokesperson', 'trade_association', 'other'];

function stanceColor(s) {
  if (s === 'positive') return 'bg-emerald-100 text-emerald-700';
  if (s === 'negative') return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
}

function stanceDot(s) {
  if (s === 'positive') return '#059669';
  if (s === 'negative') return '#DC2626';
  return '#94A3B8';
}

function copyQuote(q) {
  const text = `"${q.text}"\n— ${q.speaker || 'Unknown'}${q.role ? ` (${ROLE_LABELS[q.role] || q.role})` : ''}\n${q.article_headline}, ${q.article_outlet}, ${q.article_date}`;
  navigator.clipboard.writeText(text);
}

export default function QuotesTab({ workstream }) {
  const [quotes, setQuotes] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [filters, setFilters] = useState({ type: '', stance: '', search: '', role: '', date_from: '', date_to: '' });
  const [sort, setSort] = useState('date_desc'); // date_desc | date_asc | speaker | stance
  const [view, setView] = useState('quotes'); // quotes | speakers | analysis
  const [expandedSpeaker, setExpandedSpeaker] = useState(null);
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    const params = { workstream_id: workstream.id };
    if (filters.type) params.type = filters.type;
    if (filters.stance) params.stance = filters.stance;
    if (filters.search) params.search = filters.search;
    if (filters.role) params.role = filters.role;
    const [q, s] = await Promise.all([
      api.getQuotes(params),
      api.getSpeakers(workstream.id),
    ]);
    setQuotes(q);
    setSpeakers(s);
  }, [workstream.id, filters]);

  useEffect(() => { load(); }, [load]);

  async function handleExportQuotes(format) {
    try {
      const params = { format };
      if (filters.type) params.type = filters.type; else params.type = 'external,internal';
      if (filters.stance) params.stance = filters.stance; else params.stance = 'negative,neutral,positive';
      if (filters.search) params.search = filters.search;
      if (filters.role) params.role = filters.role;
      await api.downloadQuoteExport(workstream.id, params);
    } catch (e) { alert('Export error: ' + e.message); }
  }

  function handleCopy(q) {
    copyQuote(q);
    setCopied(q.id);
    setTimeout(() => setCopied(null), 2000);
  }

  // Apply date filter client-side (quotes come with article_date)
  let filtered = quotes;
  if (filters.date_from) filtered = filtered.filter(q => (q.article_date || '') >= filters.date_from);
  if (filters.date_to) filtered = filtered.filter(q => (q.article_date || '') <= filters.date_to);

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'date_asc') return (a.article_date || '').localeCompare(b.article_date || '');
    if (sort === 'speaker') return (a.speaker || '').localeCompare(b.speaker || '');
    if (sort === 'stance') { const order = { negative: 0, neutral: 1, positive: 2 }; return (order[a.stance] || 1) - (order[b.stance] || 1); }
    return (b.article_date || '').localeCompare(a.article_date || ''); // date_desc default
  });

  // Group quotes by category
  const grouped = { external: [], internal: [] };
  sorted.forEach(q => {
    const cat = q.type || 'external';
    if (grouped[cat]) grouped[cat].push(q); else grouped.external.push(q);
  });

  // Stats
  const totalQuotes = sorted.length;
  const stanceCounts = { positive: 0, neutral: 0, negative: 0 };
  sorted.forEach(q => { stanceCounts[q.stance || 'neutral']++; });

  // Stance by role analysis
  const roleStances = {};
  sorted.forEach(q => {
    const role = q.role || 'other';
    if (!roleStances[role]) roleStances[role] = { positive: 0, neutral: 0, negative: 0, total: 0 };
    roleStances[role][q.stance || 'neutral']++;
    roleStances[role].total++;
  });

  // Group speakers by role
  const speakersByRole = {};
  speakers.forEach(s => {
    const role = s.type === 'internal' ? 'internal' : (s.role || 'other');
    if (!speakersByRole[role]) speakersByRole[role] = [];
    speakersByRole[role].push(s);
  });

  const hasFilters = filters.search || filters.type || filters.stance || filters.role || filters.date_from || filters.date_to;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Quotes</h2>
          <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {[['quotes', 'Quotes'], ['speakers', 'Speakers'], ['analysis', 'Analysis']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} className="px-3 py-1 text-xs font-medium" style={{ background: view === k ? 'var(--accent-subtle)' : 'var(--bg-card)', color: view === k ? 'var(--accent)' : 'var(--text-muted)' }}>{l}</button>
            ))}
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
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{stanceCounts.positive}+ {stanceCounts.neutral}= {stanceCounts.negative}-</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <input placeholder="Search quotes, speakers..." value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} style={{ width: 180 }} />
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
        <input type="date" value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} title="From date" />
        <input type="date" value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} title="To date" />
        <select value={sort} onChange={e => setSort(e.target.value)} title="Sort">
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="speaker">By speaker</option>
          <option value="stance">By stance</option>
        </select>
        {hasFilters && (
          <button onClick={() => setFilters({ type: '', stance: '', search: '', role: '', date_from: '', date_to: '' })} className="text-xs" style={{ color: 'var(--accent)' }}>Clear</button>
        )}
      </div>

      {/* ── Quotes View ── */}
      {view === 'quotes' && (
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
                    <div key={q.id} className="card p-3 flex gap-3 group">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm italic" style={{ color: 'var(--text-primary)' }}>"{q.text}"</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{q.speaker || 'Unknown'}</span>
                          {q.role && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{ROLE_LABELS[q.role] || q.role}</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${stanceColor(q.stance)}`}>{q.stance}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end justify-between flex-shrink-0" style={{ maxWidth: 200 }}>
                        <div className="text-right">
                          <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{q.article_headline}</p>
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{q.article_outlet} · {q.article_date}</p>
                        </div>
                        <button onClick={() => handleCopy(q)} className="text-[10px] mt-1 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded" style={{ color: copied === q.id ? 'var(--status-approved)' : 'var(--accent)', background: 'var(--bg-content)' }}>
                          {copied === q.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {totalQuotes === 0 && <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>No quotes found. Classify articles to extract quotes.</p>}
        </div>
      )}

      {/* ── Speakers View (grouped by role) ── */}
      {view === 'speakers' && (
        <div className="space-y-6">
          {ROLE_ORDER.filter(role => speakersByRole[role]?.length > 0).map(role => (
            <div key={role}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{ROLE_LABELS[role] || role}</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{speakersByRole[role].length} speakers</span>
              </div>
              <div className="card overflow-hidden">
                <table className="mip-table">
                  <thead>
                    <tr>
                      <th>Speaker</th>
                      <th>Quotes</th>
                      <th>Stance</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {speakersByRole[role].sort((a, b) => b.total - a.total).map(s => {
                      const total = s.total;
                      const pos = s.stances.positive || 0;
                      const neg = s.stances.negative || 0;
                      const neu = total - pos - neg;
                      const isExpanded = expandedSpeaker === s.name;
                      return (
                        <React.Fragment key={s.name}>
                          <tr onClick={() => setExpandedSpeaker(isExpanded ? null : s.name)} className="cursor-pointer">
                            <td className="font-medium" style={{ color: 'var(--text-primary)' }}>{s.name}</td>
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
                              <td colSpan={4} style={{ background: 'var(--bg-content)', padding: '8px 12px' }}>
                                <div className="space-y-1.5">
                                  {quotes.filter(q => q.speaker === s.name).map(q => (
                                    <div key={q.id} className="flex gap-2 text-xs items-start group">
                                      <span className={`px-1.5 py-0.5 rounded-full flex-shrink-0 ${stanceColor(q.stance)}`}>{q.stance}</span>
                                      <p className="italic flex-1" style={{ color: 'var(--text-secondary)' }}>"{q.text}"</p>
                                      <span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{q.article_outlet} · {q.article_date}</span>
                                      <button onClick={(e) => { e.stopPropagation(); handleCopy(q); }} className="opacity-0 group-hover:opacity-100 text-[10px] px-1 rounded" style={{ color: copied === q.id ? 'var(--status-approved)' : 'var(--accent)' }}>{copied === q.id ? '✓' : 'Copy'}</button>
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
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {/* Internal speakers */}
          {speakersByRole['internal']?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Internal</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{speakersByRole['internal'].length} speakers</span>
              </div>
              <div className="card overflow-hidden">
                <table className="mip-table">
                  <thead><tr><th>Speaker</th><th>Quotes</th><th>Stance</th><th></th></tr></thead>
                  <tbody>
                    {speakersByRole['internal'].sort((a, b) => b.total - a.total).map(s => {
                      const total = s.total; const pos = s.stances.positive || 0; const neg = s.stances.negative || 0; const neu = total - pos - neg;
                      const isExpanded = expandedSpeaker === s.name;
                      return (
                        <React.Fragment key={s.name}>
                          <tr onClick={() => setExpandedSpeaker(isExpanded ? null : s.name)} className="cursor-pointer">
                            <td className="font-medium" style={{ color: 'var(--text-primary)' }}>{s.name}</td>
                            <td className="font-mono text-xs">{total}</td>
                            <td><div className="flex items-center gap-2"><div className="flex h-2 w-20 rounded-full overflow-hidden">{pos > 0 && <div className="bg-emerald-500" style={{ width: `${(pos / total) * 100}%` }} />}{neu > 0 && <div className="bg-slate-300" style={{ width: `${(neu / total) * 100}%` }} />}{neg > 0 && <div className="bg-red-500" style={{ width: `${(neg / total) * 100}%` }} />}</div></div></td>
                            <td className="text-right"><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{isExpanded ? '▲' : '▼'}</span></td>
                          </tr>
                          {isExpanded && <tr><td colSpan={4} style={{ background: 'var(--bg-content)', padding: '8px 12px' }}><div className="space-y-1.5">{quotes.filter(q => q.speaker === s.name).map(q => (<div key={q.id} className="flex gap-2 text-xs items-start group"><span className={`px-1.5 py-0.5 rounded-full flex-shrink-0 ${stanceColor(q.stance)}`}>{q.stance}</span><p className="italic flex-1" style={{ color: 'var(--text-secondary)' }}>"{q.text}"</p><span className="flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{q.article_outlet}</span><button onClick={(e) => { e.stopPropagation(); handleCopy(q); }} className="opacity-0 group-hover:opacity-100 text-[10px] px-1 rounded" style={{ color: copied === q.id ? 'var(--status-approved)' : 'var(--accent)' }}>{copied === q.id ? '✓' : 'Copy'}</button></div>))}</div></td></tr>}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {speakers.length === 0 && <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No speakers found</p>}
        </div>
      )}

      {/* ── Analysis View (stance by role) ── */}
      {view === 'analysis' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Stance Distribution by Role</h3>
          <div className="card overflow-hidden">
            <table className="mip-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Quotes</th>
                  <th>Positive</th>
                  <th>Neutral</th>
                  <th>Negative</th>
                  <th>Distribution</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_ORDER.filter(r => roleStances[r]).map(role => {
                  const d = roleStances[role];
                  return (
                    <tr key={role}>
                      <td className="font-medium" style={{ color: 'var(--text-primary)' }}>{ROLE_LABELS[role] || role}</td>
                      <td className="font-mono text-xs">{d.total}</td>
                      <td className="font-mono text-xs" style={{ color: '#059669' }}>{d.positive}</td>
                      <td className="font-mono text-xs" style={{ color: '#94A3B8' }}>{d.neutral}</td>
                      <td className="font-mono text-xs" style={{ color: '#DC2626' }}>{d.negative}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex h-3 w-32 rounded-full overflow-hidden">
                            {d.positive > 0 && <div className="bg-emerald-500" style={{ width: `${(d.positive / d.total) * 100}%` }} />}
                            {d.neutral > 0 && <div className="bg-slate-300" style={{ width: `${(d.neutral / d.total) * 100}%` }} />}
                            {d.negative > 0 && <div className="bg-red-500" style={{ width: `${(d.negative / d.total) * 100}%` }} />}
                          </div>
                          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                            {d.total > 0 ? `${Math.round((d.negative / d.total) * 100)}% neg` : ''}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Top quoted speakers */}
          <h3 className="text-sm font-semibold mt-6" style={{ color: 'var(--text-primary)' }}>Most Quoted Speakers</h3>
          <div className="card overflow-hidden">
            <table className="mip-table">
              <thead>
                <tr><th>#</th><th>Speaker</th><th>Role</th><th>Quotes</th><th>Stance</th></tr>
              </thead>
              <tbody>
                {speakers.slice(0, 15).map((s, i) => {
                  const total = s.total; const pos = s.stances.positive || 0; const neg = s.stances.negative || 0; const neu = total - pos - neg;
                  return (
                    <tr key={s.name}>
                      <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td className="font-medium" style={{ color: 'var(--text-primary)' }}>{s.name}</td>
                      <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{ROLE_LABELS[s.type === 'internal' ? 'fund_executive' : (s.role || 'other')] || s.type}</td>
                      <td className="font-mono text-xs">{total}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex h-2 w-20 rounded-full overflow-hidden">
                            {pos > 0 && <div className="bg-emerald-500" style={{ width: `${(pos / total) * 100}%` }} />}
                            {neu > 0 && <div className="bg-slate-300" style={{ width: `${(neu / total) * 100}%` }} />}
                            {neg > 0 && <div className="bg-red-500" style={{ width: `${(neg / total) * 100}%` }} />}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
