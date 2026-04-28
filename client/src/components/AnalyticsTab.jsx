import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api';
import { sentimentColor, sentimentDot, formatDate, sentimentLabel, reporterStatusColor, REPORTER_STATUSES } from '../lib/helpers';

const SUBTABS = ['Dashboard', 'Outlets', 'Firms', 'Themes', 'Outlet × Firm', 'Reporters', 'Engagement', 'Comparison', 'Narratives'];
const SENT_LABELS = ['Very Negative', 'Negative', 'Slightly Negative', 'Neutral', 'Slightly Positive', 'Positive', 'Very Positive'];
const CHART_COLORS = ['#0057b8', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d'];

export default function AnalyticsTab({ workstream }) {
  const [sub, setSub] = useState('Dashboard');
  const [articles, setArticles] = useState([]);
  const [reporters, setReporters] = useState([]);
  const [reporterSort, setReporterSort] = useState('count');
  const [outletSort, setOutletSort] = useState({ by: 'count', dir: 'desc' });
  const [firmSort, setFirmSort] = useState({ by: 'count', dir: 'desc' });
  const [themeSort, setThemeSort] = useState({ by: 'count', dir: 'desc' });
  const [timeGranularity, setTimeGranularity] = useState('day');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sentimentDrilldown, setSentimentDrilldown] = useState(null);
  const [datePreset, setDatePreset] = useState('all');

  function applyPreset(preset) {
    setDatePreset(preset);
    if (preset === 'all') { setDateFrom(''); setDateTo(''); return; }
    const now = new Date();
    const to = now.toISOString().split('T')[0];
    setDateTo(to);
    if (preset === '7d') { now.setDate(now.getDate() - 7); }
    else if (preset === '30d') { now.setDate(now.getDate() - 30); }
    else if (preset === '90d') { now.setDate(now.getDate() - 90); }
    else if (preset === 'ytd') { now.setMonth(0); now.setDate(1); }
    setDateFrom(now.toISOString().split('T')[0]);
  }

  const load = useCallback(async () => {
    const [arts, reps] = await Promise.all([
      api.getArticles({ workstream_id: workstream.id, status: '' }),
      api.getReporters(workstream.id),
    ]);
    setArticles(arts.filter(a => a.cl_status === 'classified'));
    setReporters(reps);
  }, [workstream.id]);

  useEffect(() => { load(); }, [load]);

  // --- Derived data ---
  const filteredArticles = useMemo(() => articles.filter(a => {
    if (dateFrom && a.publish_date && a.publish_date < dateFrom) return false;
    if (dateTo && a.publish_date && a.publish_date > dateTo) return false;
    return true;
  }), [articles, dateFrom, dateTo]);

  const totalArticles = filteredArticles.length;
  const avgSentiment = totalArticles > 0 ? +(filteredArticles.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / totalArticles).toFixed(1) : 0;
  const negShare = totalArticles > 0 ? +((filteredArticles.filter(a => a.cl_sentiment_score && a.cl_sentiment_score <= 3).length / totalArticles) * 100).toFixed(0) : 0;

  const reporterCounts = {};
  filteredArticles.forEach(a => { if (a.author) reporterCounts[a.author] = (reporterCounts[a.author] || 0) + 1; });
  const topReporter = Object.entries(reporterCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const themeCounts = {};
  filteredArticles.forEach(a => { (a.cl_topics || []).forEach(t => { themeCounts[t] = (themeCounts[t] || 0) + 1; }); });
  const topTheme = Object.entries(themeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  const themeEntries = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]);
  const maxThemeCount = Math.max(...themeEntries.map(e => e[1]), 1);

  // Sentiment distribution
  const sentDist = [0, 0, 0, 0, 0, 0, 0];
  const sentBucketArticles = [[], [], [], [], [], [], []];
  filteredArticles.forEach(a => {
    if (a.cl_sentiment_score >= 1 && a.cl_sentiment_score <= 7) {
      sentDist[a.cl_sentiment_score - 1]++;
      sentBucketArticles[a.cl_sentiment_score - 1].push(a);
    }
  });
  const maxSentDist = Math.max(...sentDist, 1);

  // Time grouping
  function getTimeKey(dateStr) {
    if (!dateStr) return null;
    if (timeGranularity === 'day') return dateStr;
    if (timeGranularity === 'week') {
      const d = new Date(dateStr + 'T12:00:00');
      const day = d.getDay();
      d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
      return d.toISOString().split('T')[0];
    }
    if (timeGranularity === 'month') return dateStr.slice(0, 7);
    return dateStr;
  }

  const trendData = {};
  filteredArticles.forEach(a => {
    const key = getTimeKey(a.publish_date);
    if (!key) return;
    if (!trendData[key]) trendData[key] = { key, count: 0, sentSum: 0, sentCount: 0 };
    trendData[key].count++;
    if (a.cl_sentiment_score) { trendData[key].sentSum += a.cl_sentiment_score; trendData[key].sentCount++; }
  });
  const trendDays = Object.values(trendData).sort((a, b) => a.key.localeCompare(b.key)).map(d => ({
    ...d, avgSent: d.sentCount > 0 ? +(d.sentSum / d.sentCount).toFixed(1) : null,
  }));
  const maxDayCount = Math.max(...trendDays.map(d => d.count), 1);

  // Alerts
  const alertItems = useMemo(() => {
    const alerts = [];
    const tier1 = ['The Wall Street Journal', 'Financial Times', 'Bloomberg', 'Reuters', 'The New York Times', 'The Washington Post', 'CNBC', 'Associated Press'];
    filteredArticles.filter(a => a.cl_sentiment_score && a.cl_sentiment_score <= 2 && tier1.includes(a.outlet))
      .sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).slice(0, 3)
      .forEach(a => alerts.push({ type: 'neg', text: `Negative coverage in ${a.outlet}: "${a.headline}"` }));
    if (trendDays.length > 3) {
      const avgVol = trendDays.reduce((s, d) => s + d.count, 0) / trendDays.length;
      trendDays.slice(-5).forEach(d => {
        if (d.count >= avgVol * 3 && d.count >= 3)
          alerts.push({ type: 'vol', text: `Volume spike on ${formatDate(d.key)}: ${d.count} articles (avg: ${avgVol.toFixed(0)})` });
      });
    }
    return alerts;
  }, [filteredArticles, trendDays]);

  // Key quotes
  const keyQuotes = useMemo(() => {
    const quotes = [];
    [...filteredArticles].sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).slice(0, 20).forEach(a => {
      [...(a.cl_external_quotes || []), ...(a.cl_internal_quotes || [])].forEach(q => {
        if (q.quote && q.quote.length > 30 && q.source)
          quotes.push({ ...q, headline: a.headline, outlet: a.outlet, date: a.publish_date });
      });
    });
    return quotes.slice(0, 5);
  }, [filteredArticles]);

  // Coverage velocity
  const velocity = useMemo(() => {
    if (trendDays.length < 5) return null;
    const recent = trendDays.slice(-7), older = trendDays.slice(-14, -7);
    if (older.length === 0) return null;
    const rVol = recent.reduce((s, d) => s + d.count, 0) / recent.length;
    const oVol = older.reduce((s, d) => s + d.count, 0) / older.length;
    const rSent = recent.filter(d => d.avgSent);
    const oSent = older.filter(d => d.avgSent);
    const rAvg = rSent.length > 0 ? +(rSent.reduce((s, d) => s + d.avgSent, 0) / rSent.length).toFixed(1) : null;
    const oAvg = oSent.length > 0 ? +(oSent.reduce((s, d) => s + d.avgSent, 0) / oSent.length).toFixed(1) : null;
    return { volChange: oVol > 0 ? Math.round(((rVol - oVol) / oVol) * 100) : 0, rVol, oVol, sentChange: rAvg && oAvg ? +(rAvg - oAvg).toFixed(1) : null, rAvg, oAvg };
  }, [trendDays]);

  // Comparative period for KPIs
  const prevPeriod = useMemo(() => {
    if (!dateFrom) return null;
    const from = new Date(dateFrom + 'T12:00:00');
    const to = dateTo ? new Date(dateTo + 'T12:00:00') : new Date();
    const days = Math.round((to - from) / 86400000) || 30;
    const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days);
    const prevArts = articles.filter(a => a.publish_date && a.publish_date >= prevFrom.toISOString().split('T')[0] && a.publish_date <= prevTo.toISOString().split('T')[0]);
    const prevTotal = prevArts.length;
    const prevAvg = prevTotal > 0 ? +(prevArts.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / prevTotal).toFixed(1) : 0;
    const prevNeg = prevTotal > 0 ? +((prevArts.filter(a => a.cl_sentiment_score && a.cl_sentiment_score <= 3).length / prevTotal) * 100).toFixed(0) : 0;
    return { total: prevTotal, avg: prevAvg, neg: prevNeg };
  }, [articles, dateFrom, dateTo]);

  // Outlet / Firm aggregation (uses filtered articles)
  const outletMap = {};
  filteredArticles.forEach(a => {
    const o = a.outlet || 'Unknown';
    if (!outletMap[o]) outletMap[o] = { name: o, reporters: new Set(), count: 0, sentiments: [], themes: {} };
    outletMap[o].count++;
    if (a.author) outletMap[o].reporters.add(a.author);
    if (a.cl_sentiment_score) outletMap[o].sentiments.push(a.cl_sentiment_score);
    (a.cl_topics || []).forEach(t => { outletMap[o].themes[t] = (outletMap[o].themes[t] || 0) + 1; });
  });
  const outlets = Object.values(outletMap).sort((a, b) => b.count - a.count);

  const firmMap = {};
  filteredArticles.forEach(a => {
    (a.cl_firms_mentioned || []).forEach(f => {
      if (!firmMap[f]) firmMap[f] = { name: f, count: 0, overallSents: [], firmSents: [] };
      firmMap[f].count++;
      if (a.cl_sentiment_score) firmMap[f].overallSents.push(a.cl_sentiment_score);
      if ((a.cl_firm_sentiments || {})[f]) firmMap[f].firmSents.push(a.cl_firm_sentiments[f]);
    });
  });
  const firms = Object.values(firmMap).sort((a, b) => b.count - a.count);

  // Tab badge counts (use filteredArticles)
  const tabBadges = useMemo(() => ({
    Dashboard: totalArticles,
    Outlets: outlets.length,
    Firms: firms.length,
    Themes: themeEntries.length,
    Reporters: reporters.length,
  }), [totalArticles, outlets.length, firms.length, themeEntries.length, reporters.length]);

  // Click-through: navigate to a tab, optionally with a search hint
  function goTo(tab) { setSub(tab); }

  return (
    <div className="space-y-4">
      {/* ─── GLOBAL FILTER BAR ─── */}
      <div className="flex items-center gap-2 flex-wrap rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        {/* Quick presets */}
        <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {[['7d', '7D'], ['30d', '30D'], ['90d', '90D'], ['ytd', 'YTD'], ['all', 'All']].map(([val, label]) => (
            <button key={val} onClick={() => applyPreset(val)} className="px-2.5 py-1 text-xs font-medium transition-colors"
              style={{ background: datePreset === val ? 'var(--accent)' : 'transparent', color: datePreset === val ? 'white' : 'var(--text-muted)' }}>{label}</button>
          ))}
        </div>
        {/* Custom date range */}
        <input type="date" className="border rounded px-2 py-1 text-xs" style={{ borderColor: 'var(--border)' }} value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset(''); }} />
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>–</span>
        <input type="date" className="border rounded px-2 py-1 text-xs" style={{ borderColor: 'var(--border)' }} value={dateTo} onChange={e => { setDateTo(e.target.value); setDatePreset(''); }} />
        {/* Granularity */}
        <div className="ml-auto flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          {['day', 'week', 'month'].map(v => (
            <button key={v} onClick={() => setTimeGranularity(v)} className="px-2.5 py-1 text-xs capitalize transition-colors"
              style={{ background: timeGranularity === v ? 'var(--accent)' : 'transparent', color: timeGranularity === v ? 'white' : 'var(--text-muted)' }}>{v}</button>
          ))}
        </div>
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{totalArticles} articles</span>
      </div>

      {/* ─── SUB-TAB BAR with badges ─── */}
      <div className="flex gap-0.5 overflow-x-auto border-b" style={{ borderColor: 'var(--border)' }}>
        {SUBTABS.map(s => (
          <button key={s} onClick={() => setSub(s)}
            className="px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5"
            style={{ borderColor: sub === s ? 'var(--accent)' : 'transparent', color: sub === s ? 'var(--accent)' : 'var(--text-muted)' }}>
            {s}
            {tabBadges[s] != null && <span className="text-[9px] font-mono px-1 py-px rounded" style={{ background: sub === s ? 'var(--accent)' : 'var(--bg-content)', color: sub === s ? 'white' : 'var(--text-muted)' }}>{tabBadges[s]}</span>}
          </button>
        ))}
      </div>

      {/* ─── DASHBOARD ─── */}
      {sub === 'Dashboard' && (
        <div className="space-y-4">

          {/* Alert banner */}
          {alertItems.length > 0 && (
            <div className="rounded-lg p-3 space-y-1" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
              <p className="text-xs font-semibold" style={{ color: '#991B1B' }}>Attention Required</p>
              {alertItems.map((a, i) => <p key={i} className="text-xs" style={{ color: '#7F1D1D' }}>{a.text}</p>)}
            </div>
          )}

          {/* KPI row with comparative deltas */}
          <div className="grid grid-cols-5 gap-3">
            <Card label="Articles" value={totalArticles} delta={prevPeriod ? totalArticles - prevPeriod.total : null} deltaLabel="vs prev" />
            <Card label="Avg Sentiment" value={avgSentiment} sub={sentimentLabel(Math.round(avgSentiment))} delta={prevPeriod ? +(avgSentiment - prevPeriod.avg).toFixed(1) : null} deltaLabel="vs prev" invertDelta />
            <Card label="Negative Share" value={`${negShare}%`} delta={prevPeriod ? negShare - prevPeriod.neg : null} deltaLabel="pp" />
            <Card label="Top Reporter" value={topReporter} small clickable onClick={() => goTo('Reporters')} />
            <Card label="Top Theme" value={topTheme} small clickable onClick={() => goTo('Themes')} />
          </div>

          {/* Two-column: Sentiment Distribution + Coverage Trend */}
          <div className="grid grid-cols-2 gap-4">
            {/* Sentiment Distribution */}
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Sentiment Distribution</h3>
              <div className="flex items-end gap-2" style={{ height: 140 }}>
                {sentDist.map((count, i) => {
                  const h = maxSentDist > 0 ? Math.max((count / maxSentDist) * 120, count > 0 ? 4 : 0) : 0;
                  const active = sentimentDrilldown === i + 1;
                  return (
                    <div key={i} className="flex-1 flex flex-col justify-end items-center h-full group cursor-pointer" onClick={() => setSentimentDrilldown(active ? null : i + 1)}>
                      <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 pointer-events-none" style={{ width: 160 }}>
                        <div className="rounded px-2 py-1 text-[10px] shadow-lg text-center" style={{ background: '#1e293b', color: 'white' }}>
                          {SENT_LABELS[i]}: {count} ({totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0}%)
                        </div>
                      </div>
                      <div className={`w-full rounded-sm transition-all ${active ? 'ring-2 ring-offset-1' : 'hover:opacity-80'}`}
                        style={{ height: h, backgroundColor: sentimentDot(i + 1), ...(active ? { ringColor: 'var(--accent)' } : {}) }} />
                      <span className="text-[10px] font-mono mt-1 font-semibold" style={{ color: sentimentDot(i + 1) }}>{i + 1}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-[9px]" style={{ color: 'var(--text-muted)' }}>
                <span>Negative</span><span>Neutral</span><span>Positive</span>
              </div>
            </div>

            {/* Coverage Trend */}
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Coverage Trend</h3>
              {trendDays.length > 1 ? (
                <>
                  <div className="flex items-end gap-px" style={{ height: 140 }}>
                    {trendDays.map((d, i) => {
                      const h = Math.max((d.count / maxDayCount) * 120, 3);
                      const color = d.avgSent ? sentimentDot(Math.round(d.avgSent)) : '#CBD5E1';
                      return (
                        <div key={i} className="flex-1 group relative cursor-pointer" onClick={() => { setDateFrom(d.key); setDateTo(d.key); }}
                          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', minWidth: 1 }}>
                          <div className="absolute bottom-full mb-1 hidden group-hover:block z-10" style={{ width: 160, left: '50%', transform: 'translateX(-50%)' }}>
                            <div className="rounded px-2 py-1 text-[10px] shadow-lg" style={{ background: '#1e293b', color: 'white' }}>
                              <p className="font-semibold">{formatDate(d.key)}</p>
                              <p>{d.count} articles{d.avgSent ? ` · ${d.avgSent}/7` : ''}</p>
                            </div>
                          </div>
                          <div className="w-full rounded-sm transition-all hover:opacity-70" style={{ height: h, backgroundColor: color }} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between mt-1 text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    <span>{formatDate(trendDays[0]?.key)}</span>
                    <span>{formatDate(trendDays[trendDays.length - 1]?.key)}</span>
                  </div>
                </>
              ) : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Not enough data</p>}
            </div>
          </div>

          {/* Sentiment Drilldown */}
          {sentimentDrilldown && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sentimentDot(sentimentDrilldown) }} />
                  {sentimentDrilldown} — {SENT_LABELS[sentimentDrilldown - 1]} ({sentBucketArticles[sentimentDrilldown - 1].length})
                </h3>
                <button onClick={() => setSentimentDrilldown(null)} className="text-xs" style={{ color: 'var(--text-muted)' }}>Close</button>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sentBucketArticles[sentimentDrilldown - 1].sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).map(a => (
                  <div key={a.id} className="flex items-center gap-3 text-xs py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <span className={`font-bold w-5 text-center ${sentimentColor(a.cl_sentiment_score)}`}>{a.cl_sentiment_score}</span>
                    <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{a.headline}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{a.outlet}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatDate(a.publish_date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two-column: Firm Sentiment + Theme Sentiment */}
          <div className="grid grid-cols-2 gap-4">
            <TrendChart title="Firm Sentiment" items={firms.slice(0, 5)} articles={filteredArticles} trendDays={trendDays}
              getKey={getTimeKey} getSent={(a, name) => (a.cl_firm_sentiments || {})[name] || a.cl_sentiment_score}
              matchFn={(a, name) => (a.cl_firms_mentioned || []).includes(name)} onLabelClick={() => goTo('Firms')} />
            <TrendChart title="Theme Sentiment" items={themeEntries.slice(0, 5).map(([t]) => ({ name: t }))} articles={filteredArticles} trendDays={trendDays}
              getKey={getTimeKey} getSent={(a) => a.cl_sentiment_score}
              matchFn={(a, name) => (a.cl_topics || []).includes(name)} onLabelClick={() => goTo('Themes')} />
          </div>

          {/* Key Quotes */}
          {keyQuotes.length > 0 && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Key Quotes</h3>
              <div className="space-y-3">
                {keyQuotes.map((q, i) => (
                  <div key={i}>
                    <p className="text-sm italic" style={{ color: 'var(--text-primary)' }}>"{q.quote}"</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>— {q.source}{q.role ? ` (${q.role})` : ''} · {q.outlet} · {formatDate(q.date)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two-column: Outlet Tone Matrix + Emerging Narratives */}
          <div className="grid grid-cols-2 gap-4">
            {/* Outlet × Theme */}
            {outlets.length > 0 && themeEntries.length > 0 && (
              <div className="rounded-lg border p-4 overflow-x-auto" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Outlet × Theme Tone</h3>
                <table className="text-[11px] w-full">
                  <thead>
                    <tr>
                      <th className="px-1.5 py-1 text-left font-medium" style={{ color: 'var(--text-muted)' }}></th>
                      {themeEntries.slice(0, 5).map(([t]) => <th key={t} className="px-1.5 py-1 text-center font-medium" style={{ color: 'var(--text-muted)' }}>{t.length > 12 ? t.slice(0, 11) + '…' : t}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {outlets.slice(0, 7).map(o => (
                      <tr key={o.name} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-1.5 py-1 font-medium" style={{ color: 'var(--text-primary)' }}>{o.name}</td>
                        {themeEntries.slice(0, 5).map(([t]) => {
                          const c = filteredArticles.filter(a => a.outlet === o.name && (a.cl_topics || []).includes(t));
                          if (!c.length) return <td key={t} className="px-1.5 py-1 text-center" style={{ color: 'var(--text-muted)' }}>—</td>;
                          const avg = +(c.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / c.length).toFixed(1);
                          return <td key={t} className="px-1.5 py-1 text-center" style={{ backgroundColor: `${sentimentDot(Math.round(avg))}18` }}>
                            <span className={`font-bold ${sentimentColor(Math.round(avg))}`}>{avg}</span>
                          </td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Emerging Narratives */}
            {(() => {
              if (trendDays.length < 3) return null;
              const split = Math.ceil(trendDays.length * 0.3);
              const recentKeys = new Set(trendDays.slice(-split).map(d => d.key));
              const olderKeys = new Set(trendDays.slice(0, -split).map(d => d.key));
              const recent = {}, older = {};
              filteredArticles.forEach(a => {
                const k = getTimeKey(a.publish_date);
                if (!k) return;
                (a.cl_topics || []).forEach(t => {
                  if (recentKeys.has(k)) recent[t] = (recent[t] || 0) + 1;
                  if (olderKeys.has(k)) older[t] = (older[t] || 0) + 1;
                });
              });
              const emerging = Object.entries(recent).filter(([t, c]) => c >= 2 && (!older[t] || c / (older[t] / Math.max(olderKeys.size, 1) * recentKeys.size) > 1.5)).sort((a, b) => b[1] - a[1]).slice(0, 5);
              if (!emerging.length) return null;
              return (
                <div className="rounded-lg border p-4" style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#92400E' }}>Emerging Narratives</h3>
                  <div className="space-y-2">
                    {emerging.map(([theme, count]) => (
                      <div key={theme} className="flex items-center gap-2 text-xs">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: !older[theme] ? '#DC2626' : '#D97706' }}>{!older[theme] ? 'NEW' : 'TRENDING'}</span>
                        <span style={{ color: '#78350F' }}>{theme}</span>
                        <span className="ml-auto" style={{ color: '#92400E' }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Theme breakdown + Recent articles side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Theme Breakdown</h3>
              <div className="space-y-1.5">
                {themeEntries.slice(0, 12).map(([theme, count]) => (
                  <div key={theme} className="flex items-center gap-2">
                    <span className="text-[11px] w-40 truncate" style={{ color: 'var(--text-muted)' }}>{theme}</span>
                    <div className="flex-1 rounded-full h-3" style={{ background: 'var(--bg-content)' }}>
                      <div className="rounded-full h-3" style={{ width: `${(count / maxThemeCount) * 100}%`, background: 'var(--accent)' }} />
                    </div>
                    <span className="text-[11px] w-6 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Recent Articles</h3>
              <div className="space-y-1.5">
                {[...filteredArticles].sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).slice(0, 10).map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-[11px]">
                    {a.cl_sentiment_score && <span className={`font-bold w-4 text-center ${sentimentColor(a.cl_sentiment_score)}`}>{a.cl_sentiment_score}</span>}
                    <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{a.headline}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatDate(a.publish_date)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── OUTLETS ─── */}
      {sub === 'Outlets' && <SortableTable
        data={outlets.map(o => ({ ...o, avg: o.sentiments.length > 0 ? +(o.sentiments.reduce((a, b) => a + b, 0) / o.sentiments.length).toFixed(1) : null, reporterCount: o.reporters.size, topThemes: Object.entries(o.themes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(', ') }))}
        columns={[
          { key: 'name', label: 'Outlet', render: v => <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{v}</span> },
          { key: 'count', label: 'Articles', numeric: true },
          { key: 'avg', label: 'Avg Sentiment', render: v => v ? <span className={sentimentColor(Math.round(v))}>{v} — {sentimentLabel(Math.round(v))}</span> : '—', numeric: true },
          { key: 'reporterCount', label: 'Reporters', numeric: true },
          { key: 'topThemes', label: 'Top Themes' },
        ]}
        sort={outletSort} setSort={setOutletSort} defaultSort="count"
      />}

      {/* ─── FIRMS ─── */}
      {sub === 'Firms' && <SortableTable
        data={firms.map(f => ({ ...f, oAvg: f.overallSents.length > 0 ? +(f.overallSents.reduce((a, b) => a + b, 0) / f.overallSents.length).toFixed(1) : null, fAvg: f.firmSents.length > 0 ? +(f.firmSents.reduce((a, b) => a + b, 0) / f.firmSents.length).toFixed(1) : null }))}
        columns={[
          { key: 'name', label: 'Firm', render: v => <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{v}</span> },
          { key: 'count', label: 'Articles', numeric: true },
          { key: 'oAvg', label: 'Overall Avg', render: v => v ? <span className={sentimentColor(Math.round(v))}>{v}</span> : '—', numeric: true },
          { key: 'fAvg', label: 'Firm-Specific', render: v => v ? <span className={sentimentColor(Math.round(v))}>{v}</span> : '—', numeric: true },
        ]}
        sort={firmSort} setSort={setFirmSort} defaultSort="count"
      />}

      {/* ─── THEMES ─── */}
      {sub === 'Themes' && <SortableTable
        data={themeEntries.map(([theme, count]) => {
          const arts = filteredArticles.filter(a => (a.cl_topics || []).includes(theme));
          const avg = arts.length > 0 ? +(arts.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / arts.length).toFixed(1) : null;
          return { name: theme, count, avg };
        })}
        columns={[
          { key: 'name', label: 'Theme', render: v => <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{v}</span> },
          { key: 'count', label: 'Articles', numeric: true },
          { key: 'avg', label: 'Avg Sentiment', render: v => v ? <span className={sentimentColor(Math.round(v))}>{v} — {sentimentLabel(Math.round(v))}</span> : '—', numeric: true },
        ]}
        sort={themeSort} setSort={setThemeSort} defaultSort="count"
      />}

      {/* ─── OUTLET × FIRM ─── */}
      {sub === 'Outlet × Firm' && (
        <div className="rounded-lg border overflow-x-auto" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <table className="text-xs">
            <thead>
              <tr style={{ background: 'var(--bg-content)' }}>
                <th className="px-2 py-2 text-left font-medium sticky left-0" style={{ color: 'var(--text-muted)', background: 'var(--bg-content)', minWidth: 120 }}>Outlet</th>
                {firms.slice(0, 10).map(f => <th key={f.name} className="px-2 py-2 text-center font-medium" style={{ color: 'var(--text-muted)', minWidth: 80 }}>{f.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {outlets.slice(0, 15).map(o => {
                const oa = filteredArticles.filter(a => (a.outlet || 'Unknown') === o.name);
                return (
                  <tr key={o.name} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-2 py-1.5 font-medium sticky left-0" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)' }}>{o.name}</td>
                    {firms.slice(0, 10).map(f => {
                      const ca = oa.filter(a => (a.cl_firms_mentioned || []).includes(f.name));
                      if (!ca.length) return <td key={f.name} className="px-2 py-1.5 text-center" style={{ color: 'var(--text-muted)' }}>—</td>;
                      const fs = ca.map(a => (a.cl_firm_sentiments || {})[f.name]).filter(Boolean);
                      const avg = fs.length > 0 ? +(fs.reduce((a, b) => a + b, 0) / fs.length).toFixed(1) : +(ca.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / ca.length).toFixed(1);
                      return <td key={f.name} className="px-2 py-1.5 text-center" style={{ backgroundColor: `${sentimentDot(Math.round(avg))}18` }}>
                        <span className={`font-bold ${sentimentColor(Math.round(avg))}`}>{avg}</span>
                        <span className="ml-0.5" style={{ color: 'var(--text-muted)' }}>({ca.length})</span>
                      </td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'Reporters' && (
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Sort:</span>
            {[['count', 'Articles'], ['sentiment_asc', 'Sentiment ↑'], ['sentiment_desc', 'Sentiment ↓'], ['name', 'Name']].map(([val, label]) => (
              <button key={val} onClick={() => { setReporterSort(val); api.getReporters(workstream.id, val).then(setReporters); }}
                className="text-xs px-2.5 py-1 rounded transition-colors"
                style={{ background: reporterSort === val ? 'var(--accent)' : 'var(--bg-content)', color: reporterSort === val ? 'white' : 'var(--text-muted)' }}>{label}</button>
            ))}
          </div>
          {reporters.map(r => <ReporterCard key={r.name} reporter={r} workstreamId={workstream.id} onUpdate={load} />)}
        </div>
      )}

      {sub === 'Engagement' && <EngagementView reporters={reporters} />}
      {sub === 'Narratives' && <NarrativesView workstream={workstream} />}
      {sub === 'Comparison' && <ComparisonView workstream={workstream} />}
    </div>
  );
}

// ─── Shared components ───

function Card({ label, value, sub, small, valueColor, delta, deltaLabel, invertDelta, clickable, onClick }) {
  const deltaColor = delta == null ? null : (invertDelta ? (delta > 0 ? '#16A34A' : delta < 0 ? '#DC2626' : null) : (delta > 0 ? '#DC2626' : delta < 0 ? '#16A34A' : null));
  return (
    <div className={`rounded-lg border p-3 ${clickable ? 'cursor-pointer hover:shadow-sm transition-shadow' : ''}`} style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }} onClick={onClick}>
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="flex items-baseline gap-1.5">
        <p className={`font-bold ${small ? 'text-sm truncate' : 'text-lg'}`} style={{ color: valueColor || 'var(--text-primary)' }}>{value}</p>
        {delta != null && delta !== 0 && <span className="text-[10px] font-semibold" style={{ color: deltaColor }}>{delta > 0 ? '+' : ''}{delta}{deltaLabel ? ` ${deltaLabel}` : ''}</span>}
      </div>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

function TrendChart({ title, items, articles, trendDays, getKey, getSent, matchFn, onLabelClick }) {
  const trends = items.map(item => {
    const name = item.name;
    const points = trendDays.map(d => {
      const dayArts = articles.filter(a => getKey(a.publish_date) === d.key && matchFn(a, name));
      const sents = dayArts.map(a => getSent(a, name)).filter(Boolean);
      return sents.length > 0 ? +(sents.reduce((x, y) => x + y, 0) / sents.length).toFixed(1) : null;
    }).map((avg, i) => avg !== null ? { x: i, avg } : null).filter(Boolean);
    return { name, points };
  }).filter(t => t.points.length > 1);

  if (!trends.length || trendDays.length < 2) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>{title}</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Not enough data</p>
      </div>
    );
  }

  const allAvgs = trends.flatMap(t => t.points.map(p => p.avg));
  const min = Math.min(...allAvgs), max = Math.max(...allAvgs), range = max - min || 1;
  const totalX = trendDays.length - 1;

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>{title}</h3>
      <div className="relative" style={{ height: 120 }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {trends.map((t, ti) => (
            <polyline key={ti} fill="none" stroke={CHART_COLORS[ti % CHART_COLORS.length]} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
              points={t.points.map(p => `${totalX > 0 ? (p.x / totalX) * 100 : 50},${100 - ((p.avg - min) / range) * 80 - 10}`).join(' ')} />
          ))}
        </svg>
      </div>
      <div className="flex gap-3 mt-2 flex-wrap">
        {trends.map((t, ti) => (
          <span key={ti} className={`text-[10px] flex items-center gap-1 ${onLabelClick ? 'cursor-pointer hover:underline' : ''}`} style={{ color: 'var(--text-muted)' }} onClick={onLabelClick}>
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: CHART_COLORS[ti % CHART_COLORS.length] }} />{t.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function SortableTable({ data, columns, sort, setSort, defaultSort }) {
  const sorted = [...data].sort((a, b) => {
    const col = columns.find(c => c.key === sort.by) || columns.find(c => c.key === defaultSort);
    if (!col) return 0;
    const av = a[col.key], bv = b[col.key];
    if (col.numeric) return sort.dir === 'desc' ? (bv || 0) - (av || 0) : (av || 0) - (bv || 0);
    return sort.dir === 'desc' ? String(bv || '').localeCompare(String(av || '')) : String(av || '').localeCompare(String(bv || ''));
  });

  const toggle = key => setSort(prev => ({ by: key, dir: prev.by === key && prev.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: 'var(--bg-content)' }}>
            {columns.map(c => (
              <th key={c.key} className="px-3 py-2.5 text-left font-medium cursor-pointer select-none transition-colors hover:text-[#002855]" style={{ color: 'var(--text-muted)' }} onClick={() => toggle(c.key)}>
                {c.label} {sort.by === c.key && (sort.dir === 'asc' ? '↑' : '↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.name || i} className="border-t" style={{ borderColor: 'var(--border)' }}>
              {columns.map(c => (
                <td key={c.key} className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                  {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReporterCard({ reporter: r, workstreamId, onUpdate }) {
  const [status, setStatus] = useState(r.status);
  const [notes, setNotes] = useState(r.notes);
  const [editing, setEditing] = useState(false);

  async function saveStatus(v) { setStatus(v); await api.updateReporterStatus({ reporter_name: r.name, workstream_id: workstreamId, status: v, notes }); }
  async function saveNotes() { await api.updateReporterStatus({ reporter_name: r.name, workstream_id: workstreamId, status, notes }); setEditing(false); }

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{r.name}</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.outlets.join(', ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${sentimentColor(Math.round(r.avg_sentiment))}`}>{r.avg_sentiment} avg</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.article_count} articles</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${r.trend === 'Improving' ? 'bg-emerald-100 text-emerald-700' : r.trend === 'Declining' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{r.trend}</span>
          <select value={status} onChange={e => saveStatus(e.target.value)} className={`text-xs px-2 py-1 rounded-full border-0 ${reporterStatusColor(status)}`}>
            {REPORTER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
        <div>
          <p className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Top Firms</p>
          {r.top_firms.map(f => <span key={f.name} className="inline-block px-1.5 py-0.5 rounded mr-1 mb-1" style={{ background: 'var(--bg-content)', color: 'var(--text-muted)' }}>{f.name} ({f.count})</span>)}
        </div>
        <div>
          <p className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Top Themes</p>
          {r.top_themes.map(t => <span key={t.name} className="inline-block px-1.5 py-0.5 rounded mr-1 mb-1" style={{ background: 'var(--bg-content)', color: 'var(--text-muted)' }}>{t.name}</span>)}
        </div>
        <div>
          <p className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Recent Pieces</p>
          {r.representative_pieces.map((a, i) => <p key={i} className="truncate" style={{ color: 'var(--text-muted)' }}>{a.headline}</p>)}
        </div>
      </div>
      <div className="mt-2">
        {editing ? (
          <div className="flex gap-2">
            <input className="flex-1 border rounded px-2 py-1 text-xs" style={{ borderColor: 'var(--border)' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes..." />
            <button onClick={saveNotes} className="text-xs" style={{ color: 'var(--accent)' }}>Save</button>
            <button onClick={() => setEditing(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        ) : (
          <p className="text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }} onClick={() => setEditing(true)}>{notes || 'Click to add notes...'}</p>
        )}
      </div>
    </div>
  );
}

function EngagementView({ reporters }) {
  const [minArticles, setMinArticles] = useState(2);
  const filtered = reporters.filter(r => r.article_count >= minArticles);
  const scored = filtered.map(r => ({
    ...r, _score: (7 - (r.avg_sentiment || 4)) * 3 + r.article_count * 0.5 + (r.trend === 'Declining' ? 2 : r.trend === 'Improving' ? -1 : 0),
  })).sort((a, b) => b._score - a._score);
  const tierSize = Math.max(Math.ceil(scored.length / 3), 1);
  const tiers = [
    { label: 'High Priority', items: scored.slice(0, tierSize), cls: 'border-red-200 bg-red-50/50' },
    { label: 'Medium Priority', items: scored.slice(tierSize, tierSize * 2), cls: 'border-amber-200 bg-amber-50/50' },
    { label: 'Low Priority', items: scored.slice(tierSize * 2), cls: 'border-emerald-200 bg-emerald-50/50' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Min articles:</label>
        <input type="number" min="1" max="50" value={minArticles} onChange={e => setMinArticles(Math.max(1, parseInt(e.target.value) || 1))} className="border rounded px-2 py-1 text-sm w-14" style={{ borderColor: 'var(--border)' }} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{scored.length} of {reporters.length} reporters</span>
      </div>
      {tiers.map(tier => tier.items.length > 0 && (
        <div key={tier.label}>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>{tier.label}</h3>
          <div className="space-y-1.5">
            {tier.items.map(r => (
              <div key={r.name} className={`border rounded-lg px-3 py-2 flex items-center justify-between ${tier.cls}`}>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.outlets.join(', ')}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className={`font-bold ${sentimentColor(Math.round(r.avg_sentiment))}`}>{r.avg_sentiment}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{r.article_count} art.</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.trend === 'Declining' ? 'bg-red-100 text-red-700' : r.trend === 'Improving' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{r.trend}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NarrativesView({ workstream }) {
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 28); return d.toISOString().split('T')[0]; });
  const [to, setTo] = useState(() => new Date().toISOString().split('T')[0]);

  async function generate(force = false) {
    setLoading(true);
    try { setNarrative(await api.generateNarrative(workstream.id, { from, to, comparison_window: 'week', force })); }
    catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input type="date" className="border rounded px-2.5 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: 'var(--text-muted)' }}>to</span>
        <input type="date" className="border rounded px-2.5 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} value={to} onChange={e => setTo(e.target.value)} />
        <button onClick={() => generate(false)} disabled={loading} className="px-4 py-2 rounded text-sm text-white" style={{ background: 'var(--accent)', opacity: loading ? 0.5 : 1 }}>{loading ? 'Generating...' : 'Generate'}</button>
        {narrative && <button onClick={() => generate(true)} disabled={loading} className="text-xs" style={{ color: 'var(--text-muted)' }}>Regenerate</button>}
      </div>
      {narrative && !narrative.error && (
        <div className="space-y-3">
          {narrative.cached && <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>Cached — click Regenerate for fresh analysis</p>}
          {[['Dominant Narrative', narrative.dominant_narrative], ['Narrative Shift', narrative.narrative_shift]].map(([title, text]) => text && (
            <div key={title} className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>{title}</h3>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{text}</p>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            {[['Emerging', narrative.emerging_storylines], ['Fading', narrative.fading_storylines]].map(([label, items]) => items?.length > 0 && (
              <div key={label} className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>{label} Storylines</h3>
                <ul className="list-disc list-inside space-y-1">{items.map((s, i) => <li key={i} className="text-xs" style={{ color: 'var(--text-muted)' }}>{s}</li>)}</ul>
              </div>
            ))}
          </div>
          {narrative.inflection_points?.length > 0 && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Inflection Points</h3>
              {narrative.inflection_points.map((p, i) => (
                <div key={i} className="flex gap-3 py-1.5 border-b last:border-0 text-xs" style={{ borderColor: 'var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{formatDate(p.date)}</span>
                  <div><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.headline}</span> <span style={{ color: 'var(--text-muted)' }}>({p.outlet})</span><p style={{ color: 'var(--text-muted)' }}>{p.significance}</p></div>
                </div>
              ))}
            </div>
          )}
          {narrative.outlook && (
            <div className="rounded-lg p-4" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#92400E' }}>Outlook (2-4 Weeks)</h3>
              <p className="text-sm" style={{ color: '#78350F' }}>{narrative.outlook}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonView({ workstream }) {
  const [entities, setEntities] = useState([]);
  const [selected, setSelected] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getEntities(workstream.id).then(setEntities);
    const tags = workstream.taxonomy?.stakeholder_tags || [];
    if (tags.length > 0) setSelected(tags.slice(0, 5));
  }, [workstream.id]);

  async function compare() {
    if (selected.length === 0) return;
    setLoading(true);
    try { setData(await api.getComparison(workstream.id, { entities: selected.join(',') })); }
    catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Select entities</p>
        <div className="flex flex-wrap gap-1 mb-3 max-h-32 overflow-y-auto">
          {entities.slice(0, 50).map(e => (
            <button key={e.name} onClick={() => setSelected(p => p.includes(e.name) ? p.filter(x => x !== e.name) : [...p, e.name])}
              className="px-2 py-0.5 rounded text-xs transition-colors"
              style={{ background: selected.includes(e.name) ? 'var(--accent)' : 'var(--bg-content)', color: selected.includes(e.name) ? 'white' : 'var(--text-muted)' }}>{e.name} ({e.count})</button>
          ))}
        </div>
        <button onClick={compare} disabled={loading || !selected.length} className="px-4 py-2 rounded text-sm text-white" style={{ background: 'var(--accent)', opacity: loading || !selected.length ? 0.5 : 1 }}>{loading ? 'Comparing...' : `Compare ${selected.length}`}</button>
      </div>

      {data?.entities && (
        <>
          {/* Visual bars */}
          {data.entities.length > 1 && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Sentiment Comparison</h3>
              <div className="space-y-2">
                {data.entities.map((e, i) => {
                  const sent = e.avg_firm_sentiment || e.avg_sentiment || 4;
                  return (
                    <div key={e.name} className="flex items-center gap-3">
                      <span className="text-xs font-medium w-28 truncate" style={{ color: 'var(--text-primary)' }}>{e.name}</span>
                      <div className="flex-1 rounded-full h-4" style={{ background: 'var(--bg-content)' }}>
                        <div className="rounded-full h-4 flex items-center justify-end pr-1.5" style={{ width: `${Math.max(((sent - 1) / 6) * 100, 8)}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}>
                          <span className="text-[9px] font-bold text-white">{sent}</span>
                        </div>
                      </div>
                      <span className="text-[10px] w-10 text-right" style={{ color: 'var(--text-muted)' }}>{e.total_articles}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Cards */}
          <div className="grid grid-cols-2 gap-3">
            {data.entities.map(e => (
              <div key={e.name} className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{e.name}</h4>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.total_articles} articles</span>
                </div>
                <div className="flex gap-4 mb-2">
                  <div><span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Overall</span><br /><span className={`text-lg font-bold ${sentimentColor(Math.round(e.avg_sentiment))}`}>{e.avg_sentiment}</span></div>
                  {e.avg_firm_sentiment && <div><span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Firm</span><br /><span className={`text-lg font-bold ${sentimentColor(Math.round(e.avg_firm_sentiment))}`}>{e.avg_firm_sentiment}</span></div>}
                  <div><span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Neg %</span><br /><span className="text-lg font-bold text-red-600">{e.negative_share_pct}%</span></div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {e.top_themes.slice(0, 3).map(t => <span key={t.theme} className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-content)', color: 'var(--text-muted)' }}>{t.theme}</span>)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
