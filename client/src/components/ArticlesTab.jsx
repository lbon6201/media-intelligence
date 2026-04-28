import React, { useState, useEffect, useCallback, useContext } from 'react';
import { api } from '../api';
import { sentimentColor, tierBadge, statusBadge, formatDate, sentimentLabel } from '../lib/helpers';
import { AppContext } from '../App';

export default function ArticlesTab({ workstream, onExportClips }) {
  const { density } = useContext(AppContext);
  const [articles, setArticles] = useState([]);
  const [filters, setFilters] = useState({ status: '', topic: '', search: '', sentiment_min: '', sentiment_max: '', date_from: '', date_to: '' });
  const [sort, setSort] = useState({ by: 'ingested_at', dir: 'DESC' });
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(null);

  const loadArticles = useCallback(async () => {
    try {
      const data = await api.getArticles({
        workstream_id: workstream.id,
        status: filters.status || undefined,
        topic: filters.topic || undefined,
        search: filters.search || undefined,
        sentiment_min: filters.sentiment_min || undefined,
        sentiment_max: filters.sentiment_max || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        sort_by: sort.by,
        sort_dir: sort.dir,
      });
      setArticles(data);
    } catch (e) {
      console.error(e);
    }
  }, [workstream.id, filters, sort]);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} article(s)?`)) return;
    await api.bulkDelete([...selected]);
    setSelected(new Set());
    loadArticles();
  }

  async function handleDeleteOne(id) {
    if (!confirm('Delete this article?')) return;
    await api.deleteArticle(id);
    loadArticles();
  }

  function toggleSort(col) {
    setSort(prev => ({ by: col, dir: prev.by === col && prev.dir === 'DESC' ? 'ASC' : 'DESC' }));
  }

  function toggleSelect(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function toggleSelectAll() {
    setSelected(selected.size === articles.length ? new Set() : new Set(articles.map(a => a.id)));
  }

  function clearFilters() {
    setFilters({ status: '', topic: '', search: '', sentiment_min: '', sentiment_max: '', date_from: '', date_to: '' });
  }

  const hasFilters = Object.values(filters).some(v => v);
  const topics = workstream.taxonomy?.topics || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Articles</h2>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{selected.size} selected</span>
              <button onClick={() => onExportClips?.([...selected])} className="bg-[#0057b8] text-white px-3 py-1.5 rounded text-sm hover:bg-[#002855]">Export Clips</button>
              <button onClick={handleBulkDelete} className="bg-slate-600 text-white px-3 py-1.5 rounded text-sm hover:bg-slate-700">Delete</button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border rounded-lg p-3 flex flex-wrap gap-3 items-center" style={{ borderColor: 'var(--border)' }}>
        <input className="border rounded px-3 py-1.5 text-sm w-48" style={{ borderColor: 'var(--border)' }} placeholder="Search headline, author..." value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
        <select className="border rounded px-3 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="classified">Classified</option>
        </select>
        <select className="border rounded px-3 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} value={filters.topic} onChange={e => setFilters({ ...filters, topic: e.target.value })}>
          <option value="">All Topics</option>
          {topics.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>Sentiment</span>
          <input type="number" min="1" max="7" className="border rounded px-2 py-1.5 w-14 text-sm" style={{ borderColor: 'var(--border)' }} placeholder="1" value={filters.sentiment_min} onChange={e => setFilters({ ...filters, sentiment_min: e.target.value })} />
          <span>—</span>
          <input type="number" min="1" max="7" className="border rounded px-2 py-1.5 w-14 text-sm" style={{ borderColor: 'var(--border)' }} placeholder="7" value={filters.sentiment_max} onChange={e => setFilters({ ...filters, sentiment_max: e.target.value })} />
        </div>
        <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>Date</span>
          <input type="date" className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} />
          <span>—</span>
          <input type="date" className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} />
        </div>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{articles.length} articles</span>
        {hasFilters && <button onClick={clearFilters} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>Clear all</button>}
      </div>

      {/* Table */}
      <div className="bg-white border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-sm">
          <thead className="border-b" style={{ background: 'var(--bg-content)', borderColor: 'var(--border)' }}>
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" checked={selected.size === articles.length && articles.length > 0} onChange={toggleSelectAll} />
              </th>
              <SortHeader label="Headline" col="headline" sort={sort} onSort={toggleSort} />
              <SortHeader label="Author" col="author" sort={sort} onSort={toggleSort} />
              <SortHeader label="Outlet" col="outlet" sort={sort} onSort={toggleSort} />
              <SortHeader label="Date" col="publish_date" sort={sort} onSort={toggleSort} />
              <SortHeader label="Status" col="cl_status" sort={sort} onSort={toggleSort} />
              <SortHeader label="Sentiment" col="cl_sentiment_score" sort={sort} onSort={toggleSort} />
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Topics</th>
              <SortHeader label="Tier" col="cl_relevance_tier" sort={sort} onSort={toggleSort} />
              <th className="w-20 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ '--tw-divide-opacity': '0.3' }}>
            {articles.map(a => (
              <React.Fragment key={a.id}>
                <tr className="hover:bg-[#f0f5fb]/50 cursor-pointer" style={expanded === a.id ? { background: 'var(--bg-content)' } : {}} onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} />
                  </td>
                  <td className="px-3 py-2 font-medium max-w-xs truncate" style={{ color: 'var(--text-primary)' }}>{a.headline}</td>
                  <td className="px-3 py-2 max-w-[120px] truncate" style={{ color: 'var(--text-muted)' }} title={a.author || ''}>{a.author || '—'}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{a.outlet || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{formatDate(a.publish_date)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(a.cl_status)}`}>{a.cl_status}</span>
                  </td>
                  <td className="px-3 py-2">
                    {a.cl_sentiment_score && (
                      <span className={`font-semibold ${sentimentColor(a.cl_sentiment_score)}`}>
                        {a.cl_sentiment_score} — {a.cl_sentiment_label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {a.cl_topics?.map(t => (
                      <span key={t} className="inline-block px-1.5 py-0.5 rounded text-xs mr-1 mb-0.5" style={{ background: 'var(--bg-content)', color: 'var(--text-muted)' }}>{t}</span>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    {a.cl_relevance_tier && <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tierBadge(a.cl_relevance_tier)}`}>{a.cl_relevance_tier}</span>}
                  </td>
                  <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleDeleteOne(a.id)} className="text-slate-400 hover:text-red-500 text-xs">Delete</button>
                  </td>
                </tr>
                {expanded === a.id && (
                  <tr><td colSpan={10} className="px-6 py-4" style={{ background: 'var(--bg-content)' }}><ExpandedDetail article={a} onUpdate={loadArticles} /></td></tr>
                )}
              </React.Fragment>
            ))}
            {articles.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No articles found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({ label, col, sort, onSort }) {
  const active = sort.by === col;
  return (
    <th className="px-3 py-2 text-left font-medium cursor-pointer select-none" style={{ color: 'var(--text-muted)' }} onClick={() => onSort(col)}>
      {label} {active && (sort.dir === 'ASC' ? '↑' : '↓')}
    </th>
  );
}

const PREDEFINED_FLAGS = ['Used in Client Briefing', 'Needs Follow-Up', 'Flagged for Client', 'Key Article', 'Rapid Response Required', 'Factually Disputed', 'Contains Useful Quote'];

function ExpandedDetail({ article: a, onUpdate }) {
  const [notes, setNotes] = useState(a.internal_notes || '');
  const [flags, setFlags] = useState(a.internal_flags || []);
  const [tags, setTags] = useState(a.internal_tags || []);
  const [tagInput, setTagInput] = useState('');
  const [annotBy, setAnnotBy] = useState(a.annotated_by || '');
  const [headline, setHeadline] = useState(a.headline || '');
  const [outlet, setOutlet] = useState(a.outlet || '');
  const [author, setAuthor] = useState(a.author || '');
  const [publishDate, setPublishDate] = useState(a.publish_date || '');

  async function saveAnnotation(updates) {
    await api.updateArticle(a.id, updates);
    onUpdate?.();
  }

  async function saveField(field, value) {
    await api.updateArticle(a.id, { [field]: value });
    onUpdate?.();
  }

  function toggleFlag(flag) {
    const next = flags.includes(flag) ? flags.filter(f => f !== flag) : [...flags, flag];
    setFlags(next);
    saveAnnotation({ internal_flags: next });
  }

  function addTag(e) {
    if (e.key === 'Enter' && tagInput.trim()) {
      const next = [...tags, tagInput.trim()];
      setTags(next);
      setTagInput('');
      saveAnnotation({ internal_tags: next });
    }
  }

  function removeTag(t) {
    const next = tags.filter(x => x !== t);
    setTags(next);
    saveAnnotation({ internal_tags: next });
  }

  return (
    <div className="space-y-4 text-sm">
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <input className="w-full font-semibold text-sm border border-transparent hover:border-[#b8cce0] focus:border-[#0057b8] rounded px-1 py-0.5 -ml-1 bg-transparent focus:bg-white" style={{ color: 'var(--text-primary)' }} value={headline} onChange={e => setHeadline(e.target.value)} onBlur={() => { if (headline !== a.headline) saveField('headline', headline); }} />
          <div className="flex gap-2 items-center flex-wrap">
            <input className="text-xs border border-transparent hover:border-[#b8cce0] focus:border-[#0057b8] rounded px-1 py-0.5 bg-transparent focus:bg-white w-32" style={{ color: 'var(--text-muted)' }} placeholder="Outlet" value={outlet} onChange={e => setOutlet(e.target.value)} onBlur={() => { if (outlet !== (a.outlet || '')) saveField('outlet', outlet); }} />
            <input className="text-xs border border-transparent hover:border-[#b8cce0] focus:border-[#0057b8] rounded px-1 py-0.5 bg-transparent focus:bg-white w-32" style={{ color: 'var(--text-muted)' }} placeholder="Author" value={author} onChange={e => setAuthor(e.target.value)} onBlur={() => { if (author !== (a.author || '')) saveField('author', author); }} />
            <input type="date" className="text-xs border border-transparent hover:border-[#b8cce0] focus:border-[#0057b8] rounded px-1 py-0.5 bg-transparent focus:bg-white" style={{ color: 'var(--text-muted)' }} value={publishDate} onChange={e => { setPublishDate(e.target.value); saveField('publish_date', e.target.value); }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.word_count} words</span>
          </div>
          {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>{a.url}</a>}
        </div>

        {a.cl_key_takeaway && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Key Takeaway</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.cl_key_takeaway}</p>
          </div>
        )}

        {a.cl_rationale && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Rationale</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.cl_rationale}</p>
          </div>
        )}

        {a.cl_sentiment_rationale && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Sentiment Rationale</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.cl_sentiment_rationale}</p>
          </div>
        )}

        <div>
          <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Article Text</p>
          <p className="text-xs leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap" style={{ color: 'var(--text-muted)' }}>{a.full_text?.slice(0, 2000)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {a.cl_firm_sentiments && typeof a.cl_firm_sentiments === 'object' && Object.keys(a.cl_firm_sentiments).length > 0 && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Firm Sentiments</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(a.cl_firm_sentiments).map(([firm, score]) => (
                <span key={firm} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${sentimentColor(score)}`}>
                  {firm}: <strong>{score}</strong> ({sentimentLabel(score)})
                </span>
              ))}
            </div>
          </div>
        )}

        {a.cl_firms_mentioned?.length > 0 && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Firms Mentioned</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.cl_firms_mentioned.join(', ')}</p>
          </div>
        )}

        {a.cl_geographic_tags?.length > 0 && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Geographic</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.cl_geographic_tags.join(', ')}</p>
          </div>
        )}
        {a.cl_policy_dimensions?.length > 0 && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Policy Dimensions</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.cl_policy_dimensions.join(', ')}</p>
          </div>
        )}
        {a.cl_stakeholder_focus?.length > 0 && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Stakeholder Focus</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.cl_stakeholder_focus.join(', ')}</p>
          </div>
        )}
        {a.cl_key_entities?.length > 0 && (
          <div>
            <p className="font-medium text-xs mb-1" style={{ color: 'var(--text-primary)' }}>Key Entities</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{a.cl_key_entities.join(', ')}</p>
          </div>
        )}
      </div>
    </div>

    {/* Annotations */}
    <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
      <p className="text-xs mb-2 italic" style={{ color: 'var(--text-muted)' }}>Internal — not exported to client deliverables</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Internal Notes</label>
          <textarea className="w-full border rounded px-2 py-1.5 text-xs h-16" style={{ borderColor: 'var(--border)' }} value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => saveAnnotation({ internal_notes: notes })} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Annotated by</label>
          <input className="w-full border rounded px-2 py-1.5 text-xs mb-2" style={{ borderColor: 'var(--border)' }} placeholder="Initials/name" value={annotBy} onChange={e => setAnnotBy(e.target.value)} onBlur={() => saveAnnotation({ annotated_by: annotBy })} />
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Custom Tags</label>
          <div className="flex flex-wrap gap-1 mb-1">
            {tags.map(t => <span key={t} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--bg-content)', color: 'var(--text-muted)' }}>{t} <button onClick={() => removeTag(t)} className="hover:text-red-500">x</button></span>)}
          </div>
          <input className="w-full border rounded px-2 py-1 text-xs" style={{ borderColor: 'var(--border)' }} placeholder="Type + Enter" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={addTag} />
        </div>
      </div>
      <div className="mt-2">
        <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-primary)' }}>Flags</label>
        <div className="flex flex-wrap gap-1">
          {PREDEFINED_FLAGS.map(f => (
            <button key={f} onClick={() => toggleFlag(f)} className={`px-2 py-0.5 rounded text-xs transition-colors ${flags.includes(f) ? 'bg-[#0057b8] text-white' : ''}`} style={!flags.includes(f) ? { background: 'var(--bg-content)', color: 'var(--text-muted)' } : {}}>{f}</button>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
