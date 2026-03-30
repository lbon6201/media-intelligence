import React, { useState, useEffect, useCallback, useContext } from 'react';
import { api } from '../api';
import { sentimentColor, tierBadge, statusBadge, formatDate, sentimentLabel } from '../lib/helpers';
import { AppContext } from '../App';

export default function QueueTab({ workstream }) {
  const { classifyingWs, setClassifyingWs, classifyProgress, setClassifyProgress } = useContext(AppContext);
  const [articles, setArticles] = useState([]);
  const [filters, setFilters] = useState({ status: '', topic: '', search: '', sentiment_min: '', sentiment_max: '', date_from: '', date_to: '' });
  const [sort, setSort] = useState({ by: 'ingested_at', dir: 'DESC' });
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(null);

  const classifying = classifyingWs === workstream.id;
  const progress = classifying ? classifyProgress : null;

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

  // Reload articles when classification finishes
  useEffect(() => {
    if (classifyProgress && !classifyProgress.running && !classifyingWs) {
      loadArticles();
    }
  }, [classifyingWs, classifyProgress, loadArticles]);

  async function handleClassify() {
    setClassifyingWs(workstream.id);
    setClassifyProgress(null);
    try { await api.startClassification(workstream.id); }
    catch (e) { alert(e.message); setClassifyingWs(null); }
  }

  async function handleBulkAction(status) {
    if (selected.size === 0) return;
    await api.bulkStatus([...selected], status);
    setSelected(new Set());
    loadArticles();
  }

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

  async function handleStatusChange(id, status) {
    await api.updateArticle(id, { cl_status: status });
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
  const pendingCount = articles.filter(a => a.cl_status === 'pending').length;
  const topics = workstream.taxonomy?.topics || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold text-[#002855]">Classification Queue</h2>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <button onClick={handleClassify} disabled={classifying} className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855] disabled:opacity-50">
              {classifying ? (progress ? `Classifying... (${progress.done}/${progress.total})` : 'Classifying...') : `Classify ${pendingCount} Pending`}
            </button>
          )}
          {selected.size > 0 && (
            <>
              <span className="text-sm text-[#4a6080]">{selected.size} selected</span>
              <button onClick={() => handleBulkAction('approved')} className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm hover:bg-emerald-700">Approve</button>
              <button onClick={() => handleBulkAction('rejected')} className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700">Reject</button>
              <button onClick={handleBulkDelete} className="bg-slate-600 text-white px-3 py-1.5 rounded text-sm hover:bg-slate-700">Delete</button>
            </>
          )}
        </div>
      </div>

      {/* Progress */}
      {classifying && progress && (
        <div className="bg-blue-50 border border-[#b8cce0] rounded-lg p-3">
          <div className="flex justify-between text-sm text-[#0057b8] mb-1">
            <span>Classifying articles...</span>
            <span>{progress.done} / {progress.total}{progress.failed > 0 && ` (${progress.failed} failed)`}</span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2">
            <div className="bg-[#0057b8] rounded-full h-2 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-[#b8cce0] rounded-lg p-3 flex flex-wrap gap-3 items-center">
        <input className="border border-[#b8cce0] rounded px-3 py-1.5 text-sm w-48" placeholder="Search headline, author..." value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
        <select className="border border-[#b8cce0] rounded px-3 py-1.5 text-sm" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="classified">Classified</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className="border border-[#b8cce0] rounded px-3 py-1.5 text-sm" value={filters.topic} onChange={e => setFilters({ ...filters, topic: e.target.value })}>
          <option value="">All Topics</option>
          {topics.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex items-center gap-1 text-sm text-[#4a6080]">
          <span>Sentiment</span>
          <input type="number" min="1" max="7" className="border border-[#b8cce0] rounded px-2 py-1.5 w-14 text-sm" placeholder="1" value={filters.sentiment_min} onChange={e => setFilters({ ...filters, sentiment_min: e.target.value })} />
          <span>—</span>
          <input type="number" min="1" max="7" className="border border-[#b8cce0] rounded px-2 py-1.5 w-14 text-sm" placeholder="7" value={filters.sentiment_max} onChange={e => setFilters({ ...filters, sentiment_max: e.target.value })} />
        </div>
        <div className="flex items-center gap-1 text-sm text-[#4a6080]">
          <span>Date</span>
          <input type="date" className="border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={filters.date_from} onChange={e => setFilters({ ...filters, date_from: e.target.value })} />
          <span>—</span>
          <input type="date" className="border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={filters.date_to} onChange={e => setFilters({ ...filters, date_to: e.target.value })} />
        </div>
        <span className="text-sm text-[#4a6080]">{articles.length} articles</span>
        {hasFilters && <button onClick={clearFilters} className="text-sm text-[#0057b8] hover:underline">Clear all</button>}
      </div>

      {/* Table */}
      <div className="bg-white border border-[#b8cce0] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#f0f5fb] border-b border-[#b8cce0]">
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
              <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Topics</th>
              <SortHeader label="Tier" col="cl_relevance_tier" sort={sort} onSort={toggleSort} />
              <th className="w-28 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#b8cce0]/30">
            {articles.map(a => (
              <React.Fragment key={a.id}>
                <tr className={`hover:bg-[#f0f5fb]/50 cursor-pointer ${expanded === a.id ? 'bg-[#f0f5fb]' : ''}`} onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} />
                  </td>
                  <td className="px-3 py-2 font-medium max-w-xs truncate text-[#002855]">{a.headline}</td>
                  <td className="px-3 py-2 text-[#4a6080] max-w-[120px] truncate" title={a.author || ''}>{a.author || '—'}</td>
                  <td className="px-3 py-2 text-[#4a6080]">{a.outlet || '—'}</td>
                  <td className="px-3 py-2 text-[#4a6080] whitespace-nowrap">{formatDate(a.publish_date)}</td>
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
                      <span key={t} className="inline-block bg-[#f0f5fb] text-[#4a6080] px-1.5 py-0.5 rounded text-xs mr-1 mb-0.5">{t}</span>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    {a.cl_relevance_tier && <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tierBadge(a.cl_relevance_tier)}`}>{a.cl_relevance_tier}</span>}
                  </td>
                  <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      {a.cl_status === 'classified' && (
                        <>
                          <button onClick={() => handleStatusChange(a.id, 'approved')} className="text-emerald-600 hover:underline text-xs">Approve</button>
                          <button onClick={() => handleStatusChange(a.id, 'rejected')} className="text-red-500 hover:underline text-xs">Reject</button>
                        </>
                      )}
                      <button onClick={() => handleDeleteOne(a.id)} className="text-slate-400 hover:text-red-500 text-xs">Delete</button>
                    </div>
                  </td>
                </tr>
                {expanded === a.id && (
                  <tr><td colSpan={10} className="bg-[#f0f5fb] px-6 py-4"><ExpandedDetail article={a} onUpdate={loadArticles} /></td></tr>
                )}
              </React.Fragment>
            ))}
            {articles.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8 text-[#4a6080]">No articles found</td></tr>
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
    <th className="px-3 py-2 text-left font-medium text-[#4a6080] cursor-pointer select-none hover:text-[#002855]" onClick={() => onSort(col)}>
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
          <input className="w-full font-semibold text-[#002855] text-sm border border-transparent hover:border-[#b8cce0] focus:border-[#0057b8] rounded px-1 py-0.5 -ml-1 bg-transparent focus:bg-white" value={headline} onChange={e => setHeadline(e.target.value)} onBlur={() => { if (headline !== a.headline) saveField('headline', headline); }} />
          <div className="flex gap-2 items-center flex-wrap">
            <input className="text-xs text-[#4a6080] border border-transparent hover:border-[#b8cce0] focus:border-[#0057b8] rounded px-1 py-0.5 bg-transparent focus:bg-white w-32" placeholder="Outlet" value={outlet} onChange={e => setOutlet(e.target.value)} onBlur={() => { if (outlet !== (a.outlet || '')) saveField('outlet', outlet); }} />
            <input className="text-xs text-[#4a6080] border border-transparent hover:border-[#b8cce0] focus:border-[#0057b8] rounded px-1 py-0.5 bg-transparent focus:bg-white w-32" placeholder="Author" value={author} onChange={e => setAuthor(e.target.value)} onBlur={() => { if (author !== (a.author || '')) saveField('author', author); }} />
            <input type="date" className="text-xs text-[#4a6080] border border-transparent hover:border-[#b8cce0] focus:border-[#0057b8] rounded px-1 py-0.5 bg-transparent focus:bg-white" value={publishDate} onChange={e => { setPublishDate(e.target.value); saveField('publish_date', e.target.value); }} />
            <span className="text-xs text-[#4a6080]">{a.word_count} words</span>
          </div>
          {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-[#0057b8] text-xs hover:underline">{a.url}</a>}
        </div>

        {a.cl_key_takeaway && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Key Takeaway</p>
            <p className="text-[#4a6080] text-xs">{a.cl_key_takeaway}</p>
          </div>
        )}

        {a.cl_rationale && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Rationale</p>
            <p className="text-[#4a6080] text-xs">{a.cl_rationale}</p>
          </div>
        )}

        {a.cl_sentiment_rationale && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Sentiment Rationale</p>
            <p className="text-[#4a6080] text-xs">{a.cl_sentiment_rationale}</p>
          </div>
        )}

        <div>
          <p className="font-medium text-[#002855] text-xs mb-1">Article Text</p>
          <p className="text-[#4a6080] text-xs leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">{a.full_text?.slice(0, 2000)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Firm Sentiments */}
        {a.cl_firm_sentiments && typeof a.cl_firm_sentiments === 'object' && Object.keys(a.cl_firm_sentiments).length > 0 && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Firm Sentiments</p>
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
            <p className="font-medium text-[#002855] text-xs mb-1">Firms Mentioned</p>
            <p className="text-xs text-[#4a6080]">{a.cl_firms_mentioned.join(', ')}</p>
          </div>
        )}

        {a.cl_institutional_investors && a.cl_institutional_investors !== 'None mentioned' && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Institutional Investors</p>
            <p className="text-xs text-[#4a6080]">{a.cl_institutional_investors}</p>
          </div>
        )}

        {a.cl_institutional_investor_quotes?.length > 0 && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Institutional Investor Quotes</p>
            {a.cl_institutional_investor_quotes.map((q, i) => (
              <div key={i} className="bg-white rounded p-2 mb-1 text-xs border border-[#b8cce0]">
                <span className="font-medium">{q.source}</span>
                <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${q.stance === 'bullish' ? 'bg-emerald-100 text-emerald-700' : q.stance === 'bearish' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{q.stance}</span>
                <p className="text-[#4a6080] mt-1 italic">"{q.quote}"</p>
              </div>
            ))}
          </div>
        )}

        {a.cl_external_quotes?.length > 0 && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">External Quotes</p>
            {a.cl_external_quotes.map((q, i) => (
              <div key={i} className="bg-white rounded p-2 mb-1 text-xs border border-[#b8cce0]">
                <span className="font-medium">{q.source}</span>
                {q.role && <span className="ml-1 text-[#4a6080]">({q.role})</span>}
                <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${q.stance === 'positive' ? 'bg-emerald-100 text-emerald-700' : q.stance === 'negative' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{q.stance}</span>
                <p className="text-[#4a6080] mt-1 italic">"{q.quote}"</p>
              </div>
            ))}
          </div>
        )}

        {a.cl_geographic_tags?.length > 0 && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Geographic</p>
            <p className="text-xs text-[#4a6080]">{a.cl_geographic_tags.join(', ')}</p>
          </div>
        )}
        {a.cl_policy_dimensions?.length > 0 && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Policy Dimensions</p>
            <p className="text-xs text-[#4a6080]">{a.cl_policy_dimensions.join(', ')}</p>
          </div>
        )}
        {a.cl_stakeholder_focus?.length > 0 && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Stakeholder Focus</p>
            <p className="text-xs text-[#4a6080]">{a.cl_stakeholder_focus.join(', ')}</p>
          </div>
        )}
        {a.cl_key_entities?.length > 0 && (
          <div>
            <p className="font-medium text-[#002855] text-xs mb-1">Key Entities</p>
            <p className="text-xs text-[#4a6080]">{a.cl_key_entities.join(', ')}</p>
          </div>
        )}
      </div>
    </div>

    {/* Annotations */}
    <div className="border-t border-[#b8cce0] pt-3">
      <p className="text-xs text-[#4a6080] mb-2 italic">Internal — not exported to client deliverables</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-[#002855] block mb-1">Internal Notes</label>
          <textarea className="w-full border border-[#b8cce0] rounded px-2 py-1.5 text-xs h-16" value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => saveAnnotation({ internal_notes: notes })} />
        </div>
        <div>
          <label className="text-xs font-medium text-[#002855] block mb-1">Annotated by</label>
          <input className="w-full border border-[#b8cce0] rounded px-2 py-1.5 text-xs mb-2" placeholder="Initials/name" value={annotBy} onChange={e => setAnnotBy(e.target.value)} onBlur={() => saveAnnotation({ annotated_by: annotBy })} />
          <label className="text-xs font-medium text-[#002855] block mb-1">Custom Tags</label>
          <div className="flex flex-wrap gap-1 mb-1">
            {tags.map(t => <span key={t} className="inline-flex items-center gap-1 bg-[#f0f5fb] text-[#4a6080] px-1.5 py-0.5 rounded text-xs">{t} <button onClick={() => removeTag(t)} className="hover:text-red-500">x</button></span>)}
          </div>
          <input className="w-full border border-[#b8cce0] rounded px-2 py-1 text-xs" placeholder="Type + Enter" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={addTag} />
        </div>
      </div>
      <div className="mt-2">
        <label className="text-xs font-medium text-[#002855] block mb-1">Flags</label>
        <div className="flex flex-wrap gap-1">
          {PREDEFINED_FLAGS.map(f => (
            <button key={f} onClick={() => toggleFlag(f)} className={`px-2 py-0.5 rounded text-xs transition-colors ${flags.includes(f) ? 'bg-[#0057b8] text-white' : 'bg-[#f0f5fb] text-[#4a6080] hover:bg-[#b8cce0]'}`}>{f}</button>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
