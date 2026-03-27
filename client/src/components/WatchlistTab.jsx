import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { sentimentColor, formatDate } from '../lib/helpers';

export default function WatchlistTab({ workstream }) {
  const [speakers, setSpeakers] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', affiliation: '', role: '', notes: '' });

  const load = useCallback(async () => {
    const [sp, sg] = await Promise.all([
      api.getWatchlist(workstream.id),
      api.getWatchlistSuggestions(workstream.id),
    ]);
    setSpeakers(sp);
    setSuggestions(sg);
  }, [workstream.id]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!form.name) return;
    await api.addToWatchlist(workstream.id, form);
    setForm({ name: '', affiliation: '', role: '', notes: '' });
    setAdding(false);
    load();
  }

  async function handleQuickAdd(s) {
    await api.addToWatchlist(workstream.id, { name: s.name, role: s.role });
    load();
  }

  async function handleDelete(id) {
    if (!confirm('Remove from watchlist?')) return;
    await api.deleteWatchlistSpeaker(workstream.id, id);
    if (selected?.id === id) { setSelected(null); setQuotes([]); }
    load();
  }

  async function selectSpeaker(sp) {
    setSelected(sp);
    const q = await api.getWatchlistQuotes(workstream.id, sp.id);
    setQuotes(q);
  }

  async function updateNotes(id, notes) {
    await api.updateWatchlistSpeaker(workstream.id, id, { notes });
  }

  const stanceBar = (st) => {
    const total = (st.positive || 0) + (st.neutral || 0) + (st.negative || 0);
    if (total === 0) return null;
    return (
      <div className="flex h-2 w-20 rounded-full overflow-hidden">
        {st.positive > 0 && <div className="bg-emerald-500" style={{ width: `${(st.positive / total) * 100}%` }} />}
        {st.neutral > 0 && <div className="bg-slate-300" style={{ width: `${(st.neutral / total) * 100}%` }} />}
        {st.negative > 0 && <div className="bg-red-500" style={{ width: `${(st.negative / total) * 100}%` }} />}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#002855]">Speaker Watchlist</h2>
        <button onClick={() => setAdding(!adding)} className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855]">Add Speaker</button>
      </div>

      {adding && (
        <div className="bg-white border border-[#b8cce0] rounded-lg p-4 grid grid-cols-5 gap-3 items-end">
          <div><label className="text-xs font-medium text-[#002855]">Name *</label><input className="w-full border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="text-xs font-medium text-[#002855]">Affiliation</label><input className="w-full border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={form.affiliation} onChange={e => setForm({ ...form, affiliation: e.target.value })} /></div>
          <div><label className="text-xs font-medium text-[#002855]">Role</label>
            <select className="w-full border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="">Select...</option>
              {['regulator', 'academic', 'politician', 'rating_agency', 'trade_group', 'journalist', 'other'].map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div><label className="text-xs font-medium text-[#002855]">Notes</label><input className="w-full border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <button onClick={handleAdd} className="bg-[#0057b8] text-white px-3 py-1.5 rounded text-sm">Add</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* Speaker list */}
        <div className="col-span-1 space-y-2">
          {speakers.map(sp => (
            <div key={sp.id} onClick={() => selectSpeaker(sp)} className={`bg-white border rounded-lg p-3 cursor-pointer ${selected?.id === sp.id ? 'border-[#0057b8] ring-1 ring-[#0096d6]/30' : 'border-[#b8cce0] hover:border-[#0057b8]'}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-[#002855]">{sp.name}</h4>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(sp.id); }} className="text-xs text-slate-400 hover:text-red-500">x</button>
              </div>
              <p className="text-xs text-[#4a6080]">{[sp.affiliation, sp.role].filter(Boolean).join(' · ')}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-[#4a6080]">{sp.total_quotes} quotes</span>
                {stanceBar(sp.stances)}
                {sp.last_seen && <span className="text-xs text-[#4a6080]">Last: {formatDate(sp.last_seen)}</span>}
              </div>
            </div>
          ))}
          {speakers.length === 0 && <p className="text-sm text-[#4a6080] text-center py-4">No speakers on watchlist</p>}
        </div>

        {/* Detail panel */}
        <div className="col-span-2">
          {selected ? (
            <div className="bg-white border border-[#b8cce0] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-[#002855]">{selected.name}</h3>
                  <p className="text-sm text-[#4a6080]">{[selected.affiliation, selected.role].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="text-sm text-[#4a6080]">{quotes.length} quotes</span>
              </div>
              <div>
                <label className="text-xs font-medium text-[#002855]">Notes</label>
                <textarea className="w-full border border-[#b8cce0] rounded px-2 py-1.5 text-sm h-16" defaultValue={selected.notes || ''} onBlur={e => updateNotes(selected.id, e.target.value)} />
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {quotes.map((q, i) => (
                  <div key={i} className="border border-[#b8cce0] rounded p-3">
                    <p className="text-sm italic text-[#4a6080]">"{q.quote}"</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${q.stance === 'positive' ? 'bg-emerald-100 text-emerald-700' : q.stance === 'negative' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{q.stance}</span>
                      <span className="text-xs text-[#4a6080]">{q.article_headline} — {q.article_outlet}, {formatDate(q.article_date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-[#4a6080]">Select a speaker to view details</div>
          )}
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-[#002855] mb-2">Suggested Speakers (3+ quotes, not on watchlist)</h3>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <button key={s.name} onClick={() => handleQuickAdd(s)} className="flex items-center gap-1 bg-[#f0f5fb] hover:bg-[#0057b8] hover:text-white text-[#4a6080] px-3 py-1.5 rounded text-xs transition-colors">
                <span className="font-medium">{s.name}</span>
                <span>({s.count} quotes)</span>
                <span className="ml-1">+</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
