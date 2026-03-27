import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { api } from './api';
import { NAV_ICONS } from './lib/helpers';
import { LoginPage } from './components/AuthPages';
import WorkstreamSetup from './components/WorkstreamSetup';
import IngestTab from './components/IngestTab';
import QueueTab from './components/QueueTab';
import AnalyticsTab from './components/AnalyticsTab';
import QuotesTab from './components/QuotesTab';
import WatchlistTab from './components/WatchlistTab';
import ExportTab from './components/ExportTab';
import StrategyTab from './components/StrategyTab';
import CalendarTab from './components/CalendarTab';
import NetworkTab from './components/NetworkTab';

export const AppContext = createContext();

const NAV_SECTIONS = [
  { label: 'MONITOR', items: [
    { key: 'Ingest', icon: 'Ingest', label: 'Ingest' },
    { key: 'Queue', icon: 'Queue', label: 'Queue' },
    { key: 'Calendar', icon: 'Calendar', label: 'Calendar' },
  ]},
  { label: 'ANALYZE', items: [
    { key: 'Analytics', icon: 'Analytics', label: 'Analytics' },
    { key: 'Network', icon: 'Network', label: 'Network' },
    { key: 'Strategy', icon: 'Strategy', label: 'Strategy' },
  ]},
  { label: 'INTELLIGENCE', items: [
    { key: 'Quotes', icon: 'Quotes', label: 'Quotes' },
    { key: 'Watchlist', icon: 'Watchlist', label: 'Watchlist' },
  ]},
  { label: 'OUTPUT', items: [
    { key: 'Export', icon: 'Export', label: 'Export' },
  ]},
];

const ALL_NAV_KEYS = NAV_SECTIONS.flatMap(s => s.items.map(i => i.key));

// Extended nav icons
const EXTRA_ICONS = {
  Calendar: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>',
  Network: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>',
  Strategy: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>',
};
const ALL_ICONS = { ...NAV_ICONS, ...EXTRA_ICONS };

function NavIcon({ name }) {
  const path = ALL_ICONS[name] || ALL_ICONS['Queue'];
  return <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" dangerouslySetInnerHTML={{ __html: path }} />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [workstreams, setWorkstreams] = useState([]);
  const [activeWs, setActiveWs] = useState(null);
  const [tab, setTab] = useState('Queue');
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [density, setDensity] = useState(() => localStorage.getItem('mip-density') || 'comfortable');
  const [classifyingWs, setClassifyingWs] = useState(null);
  const [classifyProgress, setClassifyProgress] = useState(null);
  const classifyPollRef = useRef(null);

  // Check existing auth on mount
  useEffect(() => {
    const token = localStorage.getItem('mip-token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch('/api/auth/me', { headers })
      .then(r => {
        if (r.ok) return r.json();
        if (token) localStorage.removeItem('mip-token');
        return null;
      })
      .then(u => { if (u) setUser(u); })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  function handleAuth(userData, token) {
    setUser(userData);
  }

  function handleLogout() {
    localStorage.removeItem('mip-token');
    setUser(null);
    setWorkstreams([]);
    setActiveWs(null);
  }

  const loadWorkstreams = useCallback(async () => {
    try {
      const ws = await api.getWorkstreams();
      setWorkstreams(ws);
      if (ws.length > 0 && !activeWs) setActiveWs(ws[0]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadWorkstreams(); }, [loadWorkstreams]);
  useEffect(() => { localStorage.setItem('mip-density', density); }, [density]);

  // Global classification progress polling
  useEffect(() => {
    if (!classifyingWs) return;
    classifyPollRef.current = setInterval(async () => {
      try {
        const p = await api.getProgress(classifyingWs);
        setClassifyProgress(p);
        if (!p.running) {
          setClassifyingWs(null);
          clearInterval(classifyPollRef.current);
        }
      } catch (e) { console.error(e); }
    }, 1000);
    return () => clearInterval(classifyPollRef.current);
  }, [classifyingWs]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setCmdOpen(v => !v); }
      if (e.key === 'Escape') setCmdOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (ALL_NAV_KEYS[idx]) setTab(ALL_NAV_KEYS[idx]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function addToast(type, message) {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }

  const ctx = { workstream: activeWs, setTab, addToast, density, classifyingWs, setClassifyingWs, classifyProgress, setClassifyProgress, user, isAdmin: user?.role === 'admin' };

  // Early returns AFTER all hooks
  if (!authChecked) return <div className="flex items-center justify-center h-screen" style={{ color: 'var(--text-muted)' }}>Loading...</div>;
  if (!user) return <LoginPage onAuth={handleAuth} />;

  if (loading) return <div className="flex items-center justify-center h-screen" style={{ color: 'var(--text-muted)' }}>Loading...</div>;

  return (
    <AppContext.Provider value={ctx}>
      <div className={`flex h-screen overflow-hidden density-${density}`}>
        {/* Sidebar */}
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="p-4 flex items-center gap-3 border-b border-white/10">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs flex-shrink-0" style={{ background: 'var(--accent)' }}>M</div>
            {!sidebarCollapsed && <span className="text-sm font-semibold text-white truncate">MIP</span>}
          </div>

          {!sidebarCollapsed && workstreams.length > 0 && (
            <div className="px-3 py-2 border-b border-white/10">
              <select className="w-full text-xs rounded px-2 py-1.5 border-0" style={{ background: 'var(--bg-secondary)', color: 'var(--text-inverse)' }}
                value={activeWs?.id || ''} onChange={(e) => setActiveWs(workstreams.find(w => w.id === e.target.value))}>
                {workstreams.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}

          <nav className="flex-1 py-1 overflow-y-auto">
            {NAV_SECTIONS.map(section => (
              <div key={section.label}>
                {!sidebarCollapsed && <div className="px-4 pt-4 pb-1 text-[10px] font-semibold tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>{section.label}</div>}
                {section.items.map(item => (
                  <div key={item.key} className={`sidebar-item ${tab === item.key ? 'active' : ''}`} onClick={() => setTab(item.key)} title={sidebarCollapsed ? item.label : undefined}>
                    <NavIcon name={item.icon} />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </div>
                ))}
              </div>
            ))}
            {/* Settings at bottom */}
            {!sidebarCollapsed && <div className="px-4 pt-4 pb-1 text-[10px] font-semibold tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>SYSTEM</div>}
            <div className={`sidebar-item ${tab === 'Setup' ? 'active' : ''}`} onClick={() => setTab('Setup')} title={sidebarCollapsed ? 'Settings' : undefined}>
              <NavIcon name="Setup" />
              {!sidebarCollapsed && <span>Settings</span>}
            </div>
          </nav>

          {/* User info */}
          {!sidebarCollapsed && user && (
            <div className="px-3 py-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <div className="truncate">
                  <p className="text-xs font-medium text-white truncate">{user.name || user.email}</p>
                  <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{user.role}</p>
                </div>
                <button onClick={handleLogout} title="Sign out" className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-white/10 p-2 flex items-center justify-between">
            <button onClick={() => setCmdOpen(true)} className="sidebar-item !p-2 !border-0" title="Search (⌘K)">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </button>
            <button onClick={() => setSidebarCollapsed(v => !v)} className="sidebar-item !p-2 !border-0">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={sidebarCollapsed ? "M13 5l7 7-7 7M5 5l7 7-7 7" : "M11 19l-7-7 7-7M19 19l-7-7 7-7"}/></svg>
            </button>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-content)' }}>
          <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-3 border-b" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{tab === 'Setup' ? 'Settings' : tab}</h1>
            <div className="flex items-center gap-3">
              <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {[['compact', '≡'], ['comfortable', '☰'], ['card', '⊞']].map(([d, icon]) => (
                  <button key={d} onClick={() => setDensity(d)} className="px-2 py-1 text-xs" style={{ background: density === d ? 'var(--accent-subtle)' : 'var(--bg-card)', color: density === d ? 'var(--accent)' : 'var(--text-muted)' }} title={d}>{icon}</button>
                ))}
              </div>
              <button onClick={() => setCmdOpen(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs" style={{ background: 'var(--bg-content)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                <span>Search</span><kbd className="font-mono text-[10px] px-1 rounded" style={{ background: 'var(--bg-hover)' }}>⌘K</kbd>
              </button>
            </div>
          </header>

          {classifyingWs && classifyProgress && (
            <div className="sticky top-[49px] z-10 border-b px-6 py-2" style={{ background: '#eff6ff', borderColor: '#b8cce0' }}>
              <div className="flex justify-between text-sm mb-1" style={{ color: '#0057b8' }}>
                <span>Classifying articles...</span>
                <span>{classifyProgress.done} / {classifyProgress.total} done{classifyProgress.failed > 0 ? ` (${classifyProgress.failed} failed)` : ''}</span>
              </div>
              <div className="w-full rounded-full h-1.5" style={{ background: '#bfdbfe' }}>
                <div className="rounded-full h-1.5 transition-all" style={{ background: '#0057b8', width: `${classifyProgress.total > 0 ? (classifyProgress.done / classifyProgress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          <main className="p-6 max-w-[1400px] mx-auto">
            {!activeWs && tab !== 'Setup' ? (
              <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
                <p className="text-base mb-3">No workstream selected</p>
                <button onClick={() => setTab('Setup')} className="btn-primary px-4 py-2 text-sm">Set up a workstream</button>
              </div>
            ) : (
              <>
                {tab === 'Queue' && <QueueTab workstream={activeWs} />}
                {tab === 'Ingest' && <IngestTab workstream={activeWs} />}
                {tab === 'Calendar' && <CalendarTab workstream={activeWs} />}
                {tab === 'Analytics' && <AnalyticsTab workstream={activeWs} />}
                {tab === 'Network' && <NetworkTab workstream={activeWs} />}
                {tab === 'Strategy' && <StrategyTab workstream={activeWs} />}
                {tab === 'Quotes' && <QuotesTab workstream={activeWs} />}
                {tab === 'Watchlist' && <WatchlistTab workstream={activeWs} />}
                {tab === 'Export' && <ExportTab workstream={activeWs} />}
                {tab === 'Setup' && <WorkstreamSetup workstreams={workstreams} activeWs={activeWs} onRefresh={loadWorkstreams} onSelect={setActiveWs} />}
              </>
            )}
          </main>
        </div>

        {cmdOpen && <CommandPalette onClose={() => setCmdOpen(false)} setTab={setTab} />}

        <div className="toast-container">
          {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
        </div>
      </div>
    </AppContext.Provider>
  );
}

function CommandPalette({ onClose, setTab }) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const allItems = ALL_NAV_KEYS.map(k => ({ type: 'nav', label: `Go to ${k}`, action: () => { setTab(k); onClose(); } }));
  const actions = [
    { type: 'action', label: 'Classify Pending Articles', action: () => { setTab('Queue'); onClose(); } },
    { type: 'action', label: 'Generate Briefing', action: () => { setTab('Export'); onClose(); } },
    { type: 'action', label: 'Export Excel', action: () => { setTab('Export'); onClose(); } },
    { type: 'action', label: 'Open Strategy Room', action: () => { setTab('Strategy'); onClose(); } },
    { type: 'action', label: 'View Network Map', action: () => { setTab('Network'); onClose(); } },
    { type: 'action', label: 'View Calendar', action: () => { setTab('Calendar'); onClose(); } },
  ];

  const all = [...allItems, ...actions];
  const q = query.toLowerCase();
  const results = q ? all.filter(i => i.label.toLowerCase().includes(q)).slice(0, 10) : all.slice(0, 10);

  function handleKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) results[selectedIdx].action();
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="cmd-palette-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <input ref={inputRef} placeholder="Search or jump to..." value={query} onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }} onKeyDown={handleKey} />
        <div className="cmd-palette-results">
          {results.map((r, i) => (
            <div key={i} className={`cmd-palette-item ${i === selectedIdx ? 'selected' : ''}`} onClick={r.action} onMouseEnter={() => setSelectedIdx(i)}>
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)', width: 48 }}>{r.type}</span>
              <span style={{ color: 'var(--text-primary)' }}>{r.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
