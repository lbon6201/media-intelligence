import React, { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';

const ALL_STANCES = ['negative', 'neutral', 'positive'];
const ALL_TYPES = ['external', 'internal'];
const ALL_ROLES = ['regulator', 'legislator', 'academic', 'rating_agency', 'legal_expert', 'former_official', 'journalist', 'analyst', 'investor_advocate', 'institutional_investor', 'fund_executive', 'portfolio_manager', 'spokesperson', 'trade_association', 'other'];
const ROLE_LABELS = {
  regulator: 'Regulator', legislator: 'Legislator', academic: 'Academic', rating_agency: 'Rating Agency',
  legal_expert: 'Legal Expert', former_official: 'Former Official', journalist: 'Journalist',
  analyst: 'Analyst', investor_advocate: 'Investor Advocate', institutional_investor: 'Institutional Investor',
  fund_executive: 'Fund Executive', portfolio_manager: 'Portfolio Manager', spokesperson: 'Spokesperson',
  trade_association: 'Trade Association', other: 'Other',
};

export default function ExportTab({ workstream }) {
  const [importResult, setImportResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);
  const [docFrom, setDocFrom] = useState('');
  const [docTo, setDocTo] = useState('');

  // Quote export state — no default date range so all quotes included
  const [qStances, setQStances] = useState(new Set(ALL_STANCES));
  const [qTypes, setQTypes] = useState(new Set(ALL_TYPES));
  const [qRoles, setQRoles] = useState(new Set(ALL_ROLES));
  const [qFrom, setQFrom] = useState('');
  const [qTo, setQTo] = useState('');
  const [qCount, setQCount] = useState({ quotes: 0, speakers: 0, articles: 0 });

  const fetchCount = useCallback(async () => {
    if (qStances.size === 0) { setQCount({ quotes: 0, speakers: 0, articles: 0 }); return; }
    try {
      const c = await api.getQuoteExportCount(workstream.id, {
        stance: [...qStances].join(','),
        type: [...qTypes].join(','),
        roles: [...qRoles].join(','),
        from: qFrom,
        to: qTo,
      });
      setQCount(c);
    } catch { /* ignore */ }
  }, [workstream.id, qStances, qTypes, qRoles, qFrom, qTo]);

  useEffect(() => { fetchCount(); }, [fetchCount]);

  function toggleSet(set, setter, val) {
    const next = new Set(set);
    if (next.has(val)) { if (next.size > 1 || val === 'institutional_investor') next.delete(val); else return; }
    else next.add(val);
    setter(next);
  }

  function toggleStance(val) {
    const next = new Set(qStances);
    if (next.has(val)) { if (next.size > 1) next.delete(val); else return; }
    else next.add(val);
    setQStances(next);
  }

  async function handleQuoteExport(format) {
    setLoading(true);
    try {
      await api.downloadQuoteExport(workstream.id, {
        format,
        stance: [...qStances].join(','),
        type: [...qTypes].join(','),
        roles: [...qRoles].join(','),
        from: qFrom,
        to: qTo,
      });
    } catch (e) {
      alert('Export error: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExcelExport() {
    setLoading(true);
    try { await api.downloadExcel(workstream.id); }
    catch (e) { alert('Export error: ' + e.message); }
    finally { setLoading(false); }
  }

  async function handleJsonExport() {
    setLoading(true);
    try {
      const data = await api.exportJson(workstream.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workstream.name.replace(/\s+/g, '-').toLowerCase()}-backup.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export error: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJsonImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api.importJson(data);
      setImportResult(result);
    } catch (err) {
      alert('Import error: ' + err.message);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-semibold text-[#002855]">Export & Backup</h2>

      {/* Third-Party Quotes Export */}
      <div className="bg-white border border-[#b8cce0] rounded-lg p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-[#002855] text-base">Third-Party Quotes</h3>
          <p className="text-sm text-[#4a6080]">Export external and institutional investor quotes with filtering</p>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-[#4a6080]">Date range</label>
          <input type="date" className="border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={qFrom} onChange={e => setQFrom(e.target.value)} />
          <span className="text-[#4a6080]">—</span>
          <input type="date" className="border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={qTo} onChange={e => setQTo(e.target.value)} />
        </div>

        {/* Stance checkboxes */}
        <div>
          <label className="text-sm font-medium text-[#002855] block mb-1">Stance</label>
          <div className="flex gap-4">
            {ALL_STANCES.map(s => (
              <label key={s} className="flex items-center gap-1.5 text-sm text-[#4a6080] cursor-pointer">
                <input type="checkbox" checked={qStances.has(s)} onChange={() => toggleStance(s)} className="rounded border-[#b8cce0]" />
                <span className="capitalize">{s}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Type checkboxes */}
        <div>
          <label className="text-sm font-medium text-[#002855] block mb-1">Quote Category</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-sm text-[#4a6080] cursor-pointer">
              <input type="checkbox" checked={qTypes.has('external')} onChange={() => toggleSet(qTypes, setQTypes, 'external')} className="rounded border-[#b8cce0]" />
              External
            </label>
            <label className="flex items-center gap-1.5 text-sm text-[#4a6080] cursor-pointer">
              <input type="checkbox" checked={qTypes.has('internal')} onChange={() => toggleSet(qTypes, setQTypes, 'internal')} className="rounded border-[#b8cce0]" />
              Internal
            </label>
          </div>
        </div>

        {/* Role checkboxes */}
        <div>
          <label className="text-sm font-medium text-[#002855] block mb-1">Roles</label>
          <div className="flex flex-wrap gap-3">
            {ALL_ROLES.map(r => (
              <label key={r} className="flex items-center gap-1.5 text-sm text-[#4a6080] cursor-pointer">
                <input type="checkbox" checked={qRoles.has(r)} onChange={() => toggleSet(qRoles, setQRoles, r)} className="rounded border-[#b8cce0]" />
                {ROLE_LABELS[r]}
              </label>
            ))}
          </div>
        </div>

        {/* Live count */}
        <div className="bg-[#f0f5fb] rounded-lg px-4 py-2 text-sm text-[#002855]">
          <strong>{qCount.quotes}</strong> quotes from <strong>{qCount.speakers}</strong> speakers across <strong>{qCount.articles}</strong> articles
        </div>

        {/* Export buttons */}
        <div className="flex gap-3">
          <button onClick={() => handleQuoteExport('xlsx')} disabled={loading || qCount.quotes === 0}
            className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 disabled:opacity-50">
            Download Excel
          </button>
          <button onClick={() => handleQuoteExport('docx')} disabled={loading || qCount.quotes === 0}
            className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855] disabled:opacity-50">
            Download Word Doc
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {/* Full data Excel */}
        <div className="bg-white border border-[#b8cce0] rounded-lg p-5 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-[#002855]">Full Data Excel Export</h3>
            <p className="text-sm text-[#4a6080]">7-sheet workbook: Articles, Reporters, Outlets, Firms, Themes, Reporter-Firm Matrix, Engagement Priority</p>
          </div>
          <button onClick={handleExcelExport} disabled={loading} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap">
            Download Excel
          </button>
        </div>

        {/* Articles Word Doc */}
        <div className="bg-white border border-[#b8cce0] rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-[#002855]">Articles Word Document</h3>
              <p className="text-sm text-[#4a6080]">Full article text with classification data, sentiment, topics, key takeaways — formatted for print or sharing</p>
            </div>
            <button onClick={async () => { setLoading(true); try { await api.downloadArticlesDoc(workstream.id, { from: docFrom, to: docTo }); } catch (e) { alert(e.message); } finally { setLoading(false); } }} disabled={loading} className="bg-[#002855] text-white px-4 py-2 rounded text-sm hover:bg-[#0057b8] disabled:opacity-50 whitespace-nowrap">
              Download Word
            </button>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-[#4a6080]">Date range</label>
            <input type="date" className="border border-[#b8cce0] rounded px-2 py-1.5 text-xs" value={docFrom} onChange={e => setDocFrom(e.target.value)} />
            <span className="text-[#4a6080]">—</span>
            <input type="date" className="border border-[#b8cce0] rounded px-2 py-1.5 text-xs" value={docTo} onChange={e => setDocTo(e.target.value)} />
            {(docFrom || docTo) && <button onClick={() => { setDocFrom(''); setDocTo(''); }} className="text-xs" style={{ color: 'var(--accent)' }}>All dates</button>}
          </div>
        </div>

        {/* JSON Backup */}
        <div className="bg-white border border-[#b8cce0] rounded-lg p-5 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-[#002855]">JSON Backup</h3>
            <p className="text-sm text-[#4a6080]">Full workstream data including all articles, classifications, and quotes</p>
          </div>
          <button onClick={handleJsonExport} disabled={loading} className="bg-[#002855] text-white px-4 py-2 rounded text-sm hover:bg-[#0057b8] disabled:opacity-50 whitespace-nowrap">
            Download JSON
          </button>
        </div>

        {/* JSON Import */}
        <div className="bg-white border border-[#b8cce0] rounded-lg p-5 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-[#002855]">Restore from Backup</h3>
            <p className="text-sm text-[#4a6080]">Import a JSON backup file (compatible with prior tool exports)</p>
          </div>
          <label className="bg-white border border-[#b8cce0] text-[#4a6080] px-4 py-2 rounded text-sm hover:bg-[#f0f5fb] cursor-pointer whitespace-nowrap">
            Choose File
            <input ref={fileRef} type="file" accept=".json" onChange={handleJsonImport} className="hidden" />
          </label>
        </div>
      </div>

      {importResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-emerald-800">Import complete</p>
          <p className="text-emerald-700">{importResult.imported} articles imported</p>
        </div>
      )}
    </div>
  );
}
