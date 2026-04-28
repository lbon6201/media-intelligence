import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api';
import { sentimentColor, sentimentDot, formatDate, sentimentLabel, reporterStatusColor, REPORTER_STATUSES } from '../lib/helpers';

const SUBTABS = ['Dashboard', 'Narratives', 'Comparison', 'Reporters', 'Outlets', 'Firms', 'Themes', 'Outlet × Firm', 'Engagement'];

export default function AnalyticsTab({ workstream }) {
  const [sub, setSub] = useState('Dashboard');
  const [articles, setArticles] = useState([]);
  const [reporters, setReporters] = useState([]);
  const [reporterSort, setReporterSort] = useState('count');
  const [outletSort, setOutletSort] = useState({ by: 'count', dir: 'desc' });
  const [firmSort, setFirmSort] = useState({ by: 'count', dir: 'desc' });
  const [themeSort, setThemeSort] = useState({ by: 'count', dir: 'desc' });
  // Phase 2: Dashboard controls
  const [timeGranularity, setTimeGranularity] = useState('day'); // day | week | month
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sentimentDrilldown, setSentimentDrilldown] = useState(null); // 1-7 or null

  const load = useCallback(async () => {
    const [arts, reps] = await Promise.all([
      api.getArticles({ workstream_id: workstream.id, status: '' }),
      api.getReporters(workstream.id),
    ]);
    setArticles(arts.filter(a => a.cl_status === 'classified'));
    setReporters(reps);
  }, [workstream.id]);

  useEffect(() => { load(); }, [load]);

  // Date-filtered articles
  const filteredArticles = useMemo(() => {
    return articles.filter(a => {
      if (dateFrom && a.publish_date && a.publish_date < dateFrom) return false;
      if (dateTo && a.publish_date && a.publish_date > dateTo) return false;
      return true;
    });
  }, [articles, dateFrom, dateTo]);

  // Aggregations (use filteredArticles for dashboard)
  const totalArticles = filteredArticles.length;
  const avgSentiment = totalArticles > 0 ? +(filteredArticles.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / totalArticles).toFixed(1) : 0;
  const negShare = totalArticles > 0 ? +((filteredArticles.filter(a => a.cl_sentiment_score && a.cl_sentiment_score <= 3).length / totalArticles) * 100).toFixed(0) : 0;

  // Top reporter/theme
  const reporterCounts = {};
  filteredArticles.forEach(a => { if (a.author) { reporterCounts[a.author] = (reporterCounts[a.author] || 0) + 1; } });
  const topReporter = Object.entries(reporterCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const themeCounts = {};
  filteredArticles.forEach(a => { (a.cl_topics || []).forEach(t => { themeCounts[t] = (themeCounts[t] || 0) + 1; }); });
  const topTheme = Object.entries(themeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  // Sentiment distribution
  const sentDist = [0, 0, 0, 0, 0, 0, 0];
  const sentArticles = [[], [], [], [], [], [], []]; // articles per bucket for drilldown
  filteredArticles.forEach(a => {
    if (a.cl_sentiment_score >= 1 && a.cl_sentiment_score <= 7) {
      sentDist[a.cl_sentiment_score - 1]++;
      sentArticles[a.cl_sentiment_score - 1].push(a);
    }
  });
  const maxSentDist = Math.max(...sentDist, 1);
  const SENT_LABELS = ['Very Negative', 'Negative', 'Slightly Negative', 'Neutral', 'Slightly Positive', 'Positive', 'Very Positive'];

  // Group by time granularity
  function getTimeKey(dateStr) {
    if (!dateStr) return null;
    if (timeGranularity === 'day') return dateStr;
    if (timeGranularity === 'week') {
      const d = new Date(dateStr + 'T12:00:00');
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      return monday.toISOString().split('T')[0];
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

  // Theme breakdown
  const themeEntries = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]);

  // Alert items: negative tier-1 articles, big sentiment shifts
  const alertItems = useMemo(() => {
    const alerts = [];
    const tier1Outlets = ['The Wall Street Journal', 'Financial Times', 'Bloomberg', 'Reuters', 'The New York Times', 'The Washington Post', 'CNBC', 'Associated Press'];
    const recentNegTier1 = filteredArticles.filter(a =>
      a.cl_sentiment_score && a.cl_sentiment_score <= 2 && tier1Outlets.includes(a.outlet)
    ).sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).slice(0, 3);
    recentNegTier1.forEach(a => alerts.push({ type: 'negative_tier1', text: `Negative coverage in ${a.outlet}: "${a.headline}"`, article: a }));

    // Volume spike: any day with 3x average volume
    if (trendDays.length > 3) {
      const avgVol = trendDays.reduce((s, d) => s + d.count, 0) / trendDays.length;
      trendDays.slice(-5).forEach(d => {
        if (d.count >= avgVol * 3 && d.count >= 3) {
          alerts.push({ type: 'volume_spike', text: `Volume spike on ${formatDate(d.key)}: ${d.count} articles (avg: ${avgVol.toFixed(0)})` });
        }
      });
    }
    return alerts;
  }, [filteredArticles, trendDays]);

  // Key quotes from recent articles
  const keyQuotes = useMemo(() => {
    const quotes = [];
    [...filteredArticles].sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).slice(0, 20).forEach(a => {
      const ext = a.cl_external_quotes || [];
      const int = a.cl_internal_quotes || [];
      [...ext, ...int].forEach(q => {
        if (q.quote && q.quote.length > 30 && q.source) {
          quotes.push({ ...q, headline: a.headline, outlet: a.outlet, date: a.publish_date });
        }
      });
    });
    return quotes.slice(0, 5);
  }, [filteredArticles]);
  const maxThemeCount = Math.max(...themeEntries.map(e => e[1]), 1);

  // Outlet aggregation
  const outletMap = {};
  articles.forEach(a => {
    const o = a.outlet || 'Unknown';
    if (!outletMap[o]) outletMap[o] = { name: o, reporters: new Set(), count: 0, sentiments: [], themes: {} };
    outletMap[o].count++;
    if (a.author) outletMap[o].reporters.add(a.author);
    if (a.cl_sentiment_score) outletMap[o].sentiments.push(a.cl_sentiment_score);
    (a.cl_topics || []).forEach(t => { outletMap[o].themes[t] = (outletMap[o].themes[t] || 0) + 1; });
  });
  const outlets = Object.values(outletMap).sort((a, b) => b.count - a.count);

  // Firm aggregation (with client-side normalization for display)
  const firmMap = {};
  articles.forEach(a => {
    const rawFirms = a.cl_firms_mentioned || [];
    const rawSents = a.cl_firm_sentiments || {};
    rawFirms.forEach(f => {
      if (!firmMap[f]) firmMap[f] = { name: f, count: 0, overallSents: [], firmSents: [] };
      firmMap[f].count++;
      if (a.cl_sentiment_score) firmMap[f].overallSents.push(a.cl_sentiment_score);
      if (rawSents[f]) firmMap[f].firmSents.push(rawSents[f]);
    });
  });
  const firms = Object.values(firmMap).sort((a, b) => b.count - a.count);

  // Outlet × Firm matrix
  const matrixOutlets = outlets.slice(0, 15);
  const matrixFirms = firms.slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-[#b8cce0]">
        {SUBTABS.map(s => (
          <button key={s} onClick={() => setSub(s)}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${sub === s ? 'border-[#0057b8] text-[#0057b8]' : 'border-transparent text-[#4a6080] hover:text-[#002855]'}`}>
            {s}
          </button>
        ))}
      </div>

      {sub === 'Dashboard' && (
        <div className="space-y-4">
          {/* Controls: date range + granularity */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
              <input type="date" className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span>to</span>
              <input type="date" className="border rounded px-2 py-1.5 text-sm" style={{ borderColor: 'var(--border)' }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
              {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>Clear</button>}
            </div>
            <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([val, label]) => (
                <button key={val} onClick={() => setTimeGranularity(val)} className="px-3 py-1.5 text-xs" style={{ background: timeGranularity === val ? 'var(--accent-subtle)' : 'var(--bg-card)', color: timeGranularity === val ? 'var(--accent)' : 'var(--text-muted)' }}>{label}</button>
              ))}
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{totalArticles} articles</span>
          </div>

          {/* Alert Banner */}
          {alertItems.length > 0 && (
            <div className="border rounded-lg p-3 space-y-1.5" style={{ background: '#FEF2F2', borderColor: '#FECACA' }}>
              <h3 className="text-xs font-semibold" style={{ color: '#991B1B' }}>Attention Required</h3>
              {alertItems.map((a, i) => (
                <p key={i} className="text-xs" style={{ color: '#991B1B' }}>
                  {a.type === 'negative_tier1' ? '⚠ ' : '📈 '}{a.text}
                </p>
              ))}
            </div>
          )}

          {/* KPI Row */}
          <div className="grid grid-cols-5 gap-3">
            <KPI label="Total Articles" value={totalArticles} />
            <KPI label="Avg Sentiment" value={avgSentiment} extra={sentimentLabel(Math.round(avgSentiment))} />
            <KPI label="Negative Share" value={`${negShare}%`} />
            <KPI label="Top Reporter" value={topReporter} small />
            <KPI label="Top Theme" value={topTheme} small />
          </div>

          {/* Sentiment Distribution — clickable bars for drilldown */}
          <div className="card p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Sentiment Distribution</h3>
            <div className="flex items-end gap-3" style={{ height: 200 }}>
              {sentDist.map((count, i) => {
                const barHeight = maxSentDist > 0 ? Math.max((count / maxSentDist) * 180, count > 0 ? 6 : 0) : 0;
                return (
                  <div key={i} className="flex-1 group relative cursor-pointer" onClick={() => setSentimentDrilldown(sentimentDrilldown === i + 1 ? null : i + 1)} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%' }}>
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10" style={{ width: 200, left: '50%', transform: 'translateX(-50%)' }}>
                      <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-inverse)' }}>
                        <p className="font-semibold">{i + 1} — {SENT_LABELS[i]}</p>
                        <p className="mt-1">{count} article{count !== 1 ? 's' : ''} ({totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0}%)</p>
                        <p className="mt-0.5 opacity-70">Click to view articles</p>
                      </div>
                    </div>
                    <div className={`w-full rounded-t transition-all ${sentimentDrilldown === i + 1 ? 'ring-2 ring-offset-1 ring-[#0057b8]' : 'hover:opacity-80'}`} style={{ height: barHeight, backgroundColor: sentimentDot(i + 1) }} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 mt-2">
              {sentDist.map((count, i) => (
                <div key={i} className="flex-1 text-center">
                  <span className="text-xs font-bold font-mono" style={{ color: sentimentDot(i + 1) }}>{i + 1}</span>
                  <span className="block text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{count}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <span>← Negative</span><span>Neutral</span><span>Positive →</span>
            </div>
          </div>

          {/* Sentiment Drilldown Panel */}
          {sentimentDrilldown && (
            <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: sentimentDot(sentimentDrilldown) }} />
                  {sentimentDrilldown} — {SENT_LABELS[sentimentDrilldown - 1]} ({sentArticles[sentimentDrilldown - 1].length} articles)
                </h3>
                <button onClick={() => setSentimentDrilldown(null)} className="text-xs hover:underline" style={{ color: 'var(--text-muted)' }}>Close</button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {sentArticles[sentimentDrilldown - 1].sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).map(a => (
                  <div key={a.id} className="flex items-center gap-3 text-xs py-1 border-b" style={{ borderColor: 'var(--border)' }}>
                    <span className={`font-bold w-6 text-center ${sentimentColor(a.cl_sentiment_score)}`}>{a.cl_sentiment_score}</span>
                    <span className="font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{a.headline}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{a.outlet}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatDate(a.publish_date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coverage Trend */}
          {trendDays.length > 1 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Coverage Trend</h3>
              </div>
              <div className="flex items-end gap-px" style={{ height: 160 }}>
                {trendDays.map((d, i) => {
                  const barHeight = Math.max((d.count / maxDayCount) * 140, 4);
                  const barColor = d.avgSent ? sentimentDot(Math.round(d.avgSent)) : '#94A3B8';
                  return (
                    <div key={i} className="flex-1 group relative cursor-pointer" onClick={() => { setDateFrom(d.key); setDateTo(d.key); }} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', minWidth: 2 }}>
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10" style={{ width: 180, left: '50%', transform: 'translateX(-50%)' }}>
                        <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-inverse)' }}>
                          <p className="font-semibold">{formatDate(d.key)}</p>
                          <p>{d.count} article{d.count !== 1 ? 's' : ''}</p>
                          {d.avgSent && <p>Avg sentiment: {d.avgSent}/7 — {sentimentLabel(Math.round(d.avgSent))}</p>}
                        </div>
                      </div>
                      <div className="w-full rounded-t transition-all hover:opacity-70" style={{ height: barHeight, backgroundColor: barColor }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-2 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                <span>{formatDate(trendDays[0]?.key)}</span>
                <span>{trendDays.length} {timeGranularity === 'day' ? 'days' : timeGranularity === 'week' ? 'weeks' : 'months'} · bars colored by avg sentiment · click bar to filter</span>
                <span>{formatDate(trendDays[trendDays.length - 1]?.key)}</span>
              </div>
            </div>
          )}

          {/* Key Quotes */}
          {keyQuotes.length > 0 && (
            <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Key Quotes</h3>
              <div className="space-y-3">
                {keyQuotes.map((q, i) => (
                  <div key={i} className="text-xs">
                    <p className="italic" style={{ color: 'var(--text-primary)' }}>"{q.quote}"</p>
                    <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      — {q.source}{q.role ? ` (${q.role})` : ''} · {q.outlet} · {formatDate(q.date)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Firm Sentiment Over Time */}
          {(() => {
            const topFirms = firms.slice(0, 5);
            if (topFirms.length === 0 || trendDays.length < 2) return null;
            const firmTrends = topFirms.map(f => {
              const points = trendDays.map(d => {
                const dayArts = filteredArticles.filter(a => getTimeKey(a.publish_date) === d.key && (a.cl_firms_mentioned || []).includes(f.name));
                const sents = dayArts.map(a => (a.cl_firm_sentiments || {})[f.name] || a.cl_sentiment_score).filter(Boolean);
                return { key: d.key, avg: sents.length > 0 ? +(sents.reduce((x, y) => x + y, 0) / sents.length).toFixed(1) : null, count: dayArts.length };
              }).filter(p => p.avg !== null);
              return { name: f.name, points };
            }).filter(ft => ft.points.length > 1);
            if (firmTrends.length === 0) return null;
            const allPoints = firmTrends.flatMap(ft => ft.points);
            const minSent = Math.min(...allPoints.map(p => p.avg));
            const maxSent = Math.max(...allPoints.map(p => p.avg));
            const range = maxSent - minSent || 1;
            const colors = ['#0057b8', '#dc2626', '#16a34a', '#d97706', '#7c3aed'];
            return (
              <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Firm Sentiment Over Time</h3>
                <div className="relative" style={{ height: 160 }}>
                  {firmTrends.map((ft, fi) => {
                    const pathPoints = ft.points.map((p, pi) => {
                      const x = ft.points.length > 1 ? (pi / (ft.points.length - 1)) * 100 : 50;
                      const y = 100 - ((p.avg - minSent) / range) * 80 - 10;
                      return `${x},${y}`;
                    });
                    return (
                      <svg key={fi} className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <polyline points={pathPoints.join(' ')} fill="none" stroke={colors[fi % colors.length]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                      </svg>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-2">
                  {firmTrends.map((ft, fi) => (
                    <span key={fi} className="text-xs flex items-center gap-1">
                      <span className="inline-block w-3 h-0.5" style={{ background: colors[fi % colors.length] }} />
                      {ft.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Theme Sentiment Over Time */}
          {(() => {
            const topThemes2 = themeEntries.slice(0, 5).map(([t]) => t);
            if (topThemes2.length === 0 || trendDays.length < 2) return null;
            const themeTrends = topThemes2.map(theme => {
              const points = trendDays.map(d => {
                const dayArts = filteredArticles.filter(a => getTimeKey(a.publish_date) === d.key && (a.cl_topics || []).includes(theme));
                const sents = dayArts.map(a => a.cl_sentiment_score).filter(Boolean);
                return { key: d.key, avg: sents.length > 0 ? +(sents.reduce((x, y) => x + y, 0) / sents.length).toFixed(1) : null, count: dayArts.length };
              }).filter(p => p.avg !== null);
              return { name: theme, points };
            }).filter(tt => tt.points.length > 1);
            if (themeTrends.length === 0) return null;
            const allPts = themeTrends.flatMap(tt => tt.points);
            const mn = Math.min(...allPts.map(p => p.avg));
            const mx = Math.max(...allPts.map(p => p.avg));
            const rng = mx - mn || 1;
            const colors = ['#0057b8', '#dc2626', '#16a34a', '#d97706', '#7c3aed'];
            return (
              <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Theme Sentiment Over Time</h3>
                <div className="relative" style={{ height: 160 }}>
                  {themeTrends.map((tt, ti) => {
                    const pathPoints = tt.points.map((p, pi) => {
                      const x = tt.points.length > 1 ? (pi / (tt.points.length - 1)) * 100 : 50;
                      const y = 100 - ((p.avg - mn) / rng) * 80 - 10;
                      return `${x},${y}`;
                    });
                    return (
                      <svg key={ti} className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <polyline points={pathPoints.join(' ')} fill="none" stroke={colors[ti % colors.length]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                      </svg>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-2 flex-wrap">
                  {themeTrends.map((tt, ti) => (
                    <span key={ti} className="text-xs flex items-center gap-1">
                      <span className="inline-block w-3 h-0.5" style={{ background: colors[ti % colors.length] }} />
                      {tt.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Outlet Tone Matrix */}
          {(() => {
            const topOutlets = outlets.slice(0, 8);
            const topThemes3 = themeEntries.slice(0, 6).map(([t]) => t);
            if (topOutlets.length === 0 || topThemes3.length === 0) return null;
            return (
              <div className="border rounded-lg p-4 overflow-x-auto" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Outlet × Theme Sentiment</h3>
                <table className="text-xs w-full">
                  <thead>
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Outlet</th>
                      {topThemes3.map(t => <th key={t} className="px-2 py-1.5 text-center font-medium min-w-[70px]" style={{ color: 'var(--text-muted)' }}>{t}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {topOutlets.map(o => (
                      <tr key={o.name} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-2 py-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>{o.name}</td>
                        {topThemes3.map(t => {
                          const cellArts = filteredArticles.filter(a => (a.outlet || '') === o.name && (a.cl_topics || []).includes(t));
                          if (cellArts.length === 0) return <td key={t} className="px-2 py-1.5 text-center" style={{ color: 'var(--text-muted)' }}>—</td>;
                          const avg = +(cellArts.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / cellArts.length).toFixed(1);
                          return (
                            <td key={t} className="px-2 py-1.5 text-center" style={{ backgroundColor: `${sentimentDot(Math.round(avg))}20` }}>
                              <span className={`font-bold ${sentimentColor(Math.round(avg))}`}>{avg}</span>
                              <span className="ml-0.5" style={{ color: 'var(--text-muted)' }}>({cellArts.length})</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Emerging Narratives */}
          {(() => {
            // Detect themes that are new or spiking in the most recent period
            if (trendDays.length < 3) return null;
            const recentKeys = trendDays.slice(-Math.ceil(trendDays.length * 0.3)).map(d => d.key);
            const olderKeys = trendDays.slice(0, -Math.ceil(trendDays.length * 0.3)).map(d => d.key);
            const recentThemes = {};
            const olderThemes = {};
            filteredArticles.forEach(a => {
              const key = getTimeKey(a.publish_date);
              if (!key) return;
              (a.cl_topics || []).forEach(t => {
                if (recentKeys.includes(key)) recentThemes[t] = (recentThemes[t] || 0) + 1;
                if (olderKeys.includes(key)) olderThemes[t] = (olderThemes[t] || 0) + 1;
              });
            });
            const emerging = Object.entries(recentThemes)
              .filter(([t, count]) => count >= 2 && (!olderThemes[t] || count / (olderThemes[t] / Math.max(olderKeys.length, 1) * recentKeys.length) > 1.5))
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);
            if (emerging.length === 0) return null;
            return (
              <div className="border rounded-lg p-4" style={{ borderColor: '#FDE68A', background: '#FFFBEB' }}>
                <h3 className="text-sm font-semibold mb-2" style={{ color: '#92400E' }}>Emerging Narratives</h3>
                <div className="space-y-1">
                  {emerging.map(([theme, count]) => {
                    const isNew = !olderThemes[theme];
                    return (
                      <div key={theme} className="flex items-center gap-2 text-xs">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: isNew ? '#DC2626' : '#D97706', color: 'white' }}>{isNew ? 'NEW' : 'TRENDING'}</span>
                        <span style={{ color: '#78350F' }}>{theme}</span>
                        <span style={{ color: '#92400E' }}>({count} recent articles)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Theme Breakdown */}
          <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#002855] mb-3">Theme Breakdown</h3>
            <div className="space-y-2">
              {themeEntries.slice(0, 15).map(([theme, count]) => {
                const maxThemeCount = Math.max(...themeEntries.map(e => e[1]), 1);
                return (
                  <div key={theme} className="flex items-center gap-3">
                    <span className="text-xs text-[#4a6080] w-48 truncate">{theme}</span>
                    <div className="flex-1 bg-[#f0f5fb] rounded-full h-4">
                      <div className="bg-[#0057b8] rounded-full h-4" style={{ width: `${(count / maxThemeCount) * 100}%` }} />
                    </div>
                    <span className="text-xs text-[#4a6080] w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Articles */}
          <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#002855] mb-3">Recent Articles</h3>
            <div className="space-y-2">
              {[...filteredArticles].sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).slice(0, 10).map(a => (
                <div key={a.id} className="flex items-center gap-3 text-xs">
                  {a.cl_sentiment_score && <span className={`font-bold w-6 text-center ${sentimentColor(a.cl_sentiment_score)}`}>{a.cl_sentiment_score}</span>}
                  <span className="text-[#002855] font-medium flex-1 truncate">{a.headline}</span>
                  <span className="text-[#4a6080]">{a.outlet}</span>
                  <span className="text-[#4a6080]">{formatDate(a.publish_date)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {sub === 'Reporters' && (
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <span className="text-sm text-[#4a6080]">Sort:</span>
            {[['count', 'Article Count'], ['sentiment_asc', 'Sentiment ↑'], ['sentiment_desc', 'Sentiment ↓'], ['name', 'Name']].map(([val, label]) => (
              <button key={val} onClick={() => { setReporterSort(val); api.getReporters(workstream.id, val).then(setReporters); }}
                className={`text-xs px-2 py-1 rounded ${reporterSort === val ? 'bg-[#0057b8] text-white' : 'bg-[#f0f5fb] text-[#4a6080]'}`}>{label}</button>
            ))}
          </div>
          {reporters.map(r => (
            <ReporterCard key={r.name} reporter={r} workstreamId={workstream.id} onUpdate={load} />
          ))}
        </div>
      )}

      {sub === 'Outlets' && (() => {
        const sortedOutlets = [...outlets].sort((a, b) => {
          const avgA = a.sentiments.length > 0 ? a.sentiments.reduce((x, y) => x + y, 0) / a.sentiments.length : 0;
          const avgB = b.sentiments.length > 0 ? b.sentiments.reduce((x, y) => x + y, 0) / b.sentiments.length : 0;
          const vals = { name: [a.name.localeCompare(b.name), b.name.localeCompare(a.name)], count: [a.count - b.count, b.count - a.count], sentiment: [avgA - avgB, avgB - avgA], reporters: [a.reporters.size - b.reporters.size, b.reporters.size - a.reporters.size] };
          const [asc, desc] = vals[outletSort.by] || vals.count;
          return outletSort.dir === 'asc' ? asc : desc;
        });
        const toggleOutletSort = col => setOutletSort(prev => ({ by: col, dir: prev.by === col && prev.dir === 'desc' ? 'asc' : 'desc' }));
        return (
        <div className="bg-white border border-[#b8cce0] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f5fb] border-b border-[#b8cce0]">
              <tr>
                <SortTh label="Outlet" col="name" sort={outletSort} onSort={toggleOutletSort} />
                <SortTh label="Articles" col="count" sort={outletSort} onSort={toggleOutletSort} />
                <SortTh label="Avg Sentiment" col="sentiment" sort={outletSort} onSort={toggleOutletSort} />
                <SortTh label="Reporters" col="reporters" sort={outletSort} onSort={toggleOutletSort} />
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Top Themes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#b8cce0]/30">
              {sortedOutlets.map(o => {
                const avg = o.sentiments.length > 0 ? +(o.sentiments.reduce((a, b) => a + b, 0) / o.sentiments.length).toFixed(1) : null;
                return (
                  <tr key={o.name}>
                    <td className="px-3 py-2 font-medium text-[#002855]">{o.name}</td>
                    <td className="px-3 py-2 text-[#4a6080]">{o.count}</td>
                    <td className="px-3 py-2"><span className={sentimentColor(Math.round(avg))}>{avg} — {sentimentLabel(Math.round(avg))}</span></td>
                    <td className="px-3 py-2 text-[#4a6080]">{o.reporters.size}</td>
                    <td className="px-3 py-2 text-xs text-[#4a6080]">{Object.entries(o.themes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        );
      })()}

      {sub === 'Firms' && (() => {
        const firmsWithAvg = firms.map(f => ({
          ...f,
          oAvg: f.overallSents.length > 0 ? +(f.overallSents.reduce((a, b) => a + b, 0) / f.overallSents.length).toFixed(1) : null,
          fAvg: f.firmSents.length > 0 ? +(f.firmSents.reduce((a, b) => a + b, 0) / f.firmSents.length).toFixed(1) : null,
        }));
        const sortedFirms = [...firmsWithAvg].sort((a, b) => {
          const vals = { name: [a.name.localeCompare(b.name), b.name.localeCompare(a.name)], count: [a.count - b.count, b.count - a.count], overall: [(a.oAvg || 0) - (b.oAvg || 0), (b.oAvg || 0) - (a.oAvg || 0)], firm: [(a.fAvg || 0) - (b.fAvg || 0), (b.fAvg || 0) - (a.fAvg || 0)] };
          const [asc, desc] = vals[firmSort.by] || vals.count;
          return firmSort.dir === 'asc' ? asc : desc;
        });
        const toggleFirmSort = col => setFirmSort(prev => ({ by: col, dir: prev.by === col && prev.dir === 'desc' ? 'asc' : 'desc' }));
        return (
        <div className="bg-white border border-[#b8cce0] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f5fb] border-b border-[#b8cce0]">
              <tr>
                <SortTh label="Firm" col="name" sort={firmSort} onSort={toggleFirmSort} />
                <SortTh label="Articles" col="count" sort={firmSort} onSort={toggleFirmSort} />
                <SortTh label="Overall Avg" col="overall" sort={firmSort} onSort={toggleFirmSort} />
                <SortTh label="Firm-Specific Avg" col="firm" sort={firmSort} onSort={toggleFirmSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#b8cce0]/30">
              {sortedFirms.map(f => (
                <tr key={f.name}>
                  <td className="px-3 py-2 font-medium text-[#002855]">{f.name}</td>
                  <td className="px-3 py-2 text-[#4a6080]">{f.count}</td>
                  <td className="px-3 py-2"><span className={sentimentColor(Math.round(f.oAvg))}>{f.oAvg}</span></td>
                  <td className="px-3 py-2"><span className={sentimentColor(Math.round(f.fAvg))}>{f.fAvg || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}

      {sub === 'Themes' && (() => {
        const themesWithAvg = themeEntries.map(([theme, count]) => {
          const arts = articles.filter(a => (a.cl_topics || []).includes(theme));
          const avg = arts.length > 0 ? +(arts.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / arts.length).toFixed(1) : null;
          return { theme, count, avg };
        });
        const sortedThemes = [...themesWithAvg].sort((a, b) => {
          const vals = { name: [a.theme.localeCompare(b.theme), b.theme.localeCompare(a.theme)], count: [a.count - b.count, b.count - a.count], sentiment: [(a.avg || 0) - (b.avg || 0), (b.avg || 0) - (a.avg || 0)] };
          const [asc, desc] = vals[themeSort.by] || vals.count;
          return themeSort.dir === 'asc' ? asc : desc;
        });
        const toggleThemeSort = col => setThemeSort(prev => ({ by: col, dir: prev.by === col && prev.dir === 'desc' ? 'asc' : 'desc' }));
        return (
        <div className="bg-white border border-[#b8cce0] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f5fb] border-b border-[#b8cce0]">
              <tr>
                <SortTh label="Theme" col="name" sort={themeSort} onSort={toggleThemeSort} />
                <SortTh label="Articles" col="count" sort={themeSort} onSort={toggleThemeSort} />
                <SortTh label="Avg Sentiment" col="sentiment" sort={themeSort} onSort={toggleThemeSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#b8cce0]/30">
              {sortedThemes.map(t => (
                <tr key={t.theme}>
                  <td className="px-3 py-2 font-medium text-[#002855]">{t.theme}</td>
                  <td className="px-3 py-2 text-[#4a6080]">{t.count}</td>
                  <td className="px-3 py-2"><span className={sentimentColor(Math.round(t.avg))}>{t.avg} — {sentimentLabel(Math.round(t.avg))}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}

      {sub === 'Outlet × Firm' && (
        <div className="bg-white border border-[#b8cce0] rounded-lg overflow-x-auto">
          <table className="text-xs">
            <thead className="bg-[#f0f5fb]">
              <tr>
                <th className="px-2 py-2 text-left font-medium text-[#4a6080] sticky left-0 bg-[#f0f5fb] min-w-[120px]">Outlet</th>
                {matrixFirms.map(f => <th key={f.name} className="px-2 py-2 text-center font-medium text-[#4a6080] min-w-[80px]">{f.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#b8cce0]/30">
              {matrixOutlets.map(o => {
                const outletArts = articles.filter(a => (a.outlet || 'Unknown') === o.name);
                return (
                  <tr key={o.name}>
                    <td className="px-2 py-1.5 font-medium text-[#002855] sticky left-0 bg-white">{o.name}</td>
                    {matrixFirms.map(f => {
                      const cellArts = outletArts.filter(a => (a.cl_firms_mentioned || []).includes(f.name));
                      if (cellArts.length === 0) return <td key={f.name} className="px-2 py-1.5 text-center text-slate-300">—</td>;
                      const firmSents = cellArts.map(a => (a.cl_firm_sentiments || {})[f.name]).filter(Boolean);
                      const avg = firmSents.length > 0 ? +(firmSents.reduce((a, b) => a + b, 0) / firmSents.length).toFixed(1) : cellArts.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / cellArts.length;
                      return (
                        <td key={f.name} className="px-2 py-1.5 text-center" style={{ backgroundColor: `${sentimentDot(Math.round(avg))}20` }}>
                          <span className={`font-bold ${sentimentColor(Math.round(avg))}`}>{avg.toFixed?.(1) || avg}</span>
                          <span className="text-[#4a6080] ml-1">({cellArts.length})</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'Engagement' && (
        <EngagementView reporters={reporters} />
      )}

      {sub === 'Narratives' && (
        <NarrativesView workstream={workstream} />
      )}

      {sub === 'Comparison' && (
        <ComparisonView workstream={workstream} />
      )}
    </div>
  );
}

function KPI({ label, value, extra, small }) {
  return (
    <div className="bg-white border border-[#b8cce0] rounded-lg p-3">
      <p className="text-xs text-[#4a6080] mb-1">{label}</p>
      <p className={`font-bold text-[#002855] ${small ? 'text-sm truncate' : 'text-xl'}`}>{value}</p>
      {extra && <p className="text-xs text-[#4a6080]">{extra}</p>}
    </div>
  );
}

function ReporterCard({ reporter: r, workstreamId, onUpdate }) {
  const [status, setStatus] = useState(r.status);
  const [notes, setNotes] = useState(r.notes);
  const [editing, setEditing] = useState(false);

  async function saveStatus(newStatus) {
    setStatus(newStatus);
    await api.updateReporterStatus({ reporter_name: r.name, workstream_id: workstreamId, status: newStatus, notes });
  }

  async function saveNotes() {
    await api.updateReporterStatus({ reporter_name: r.name, workstream_id: workstreamId, status, notes });
    setEditing(false);
  }

  return (
    <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-[#002855]">{r.name}</h3>
          <p className="text-xs text-[#4a6080]">{r.outlets.join(', ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${sentimentColor(Math.round(r.avg_sentiment))}`}>
            {r.avg_sentiment} avg
          </span>
          <span className="text-xs text-[#4a6080]">{r.article_count} articles</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${r.trend === 'Improving' ? 'bg-emerald-100 text-emerald-700' : r.trend === 'Declining' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{r.trend}</span>
          <select value={status} onChange={e => saveStatus(e.target.value)}
            className={`text-xs px-2 py-1 rounded-full border-0 ${reporterStatusColor(status)}`}>
            {REPORTER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
        <div>
          <p className="font-medium text-[#002855] mb-1">Top Firms</p>
          {r.top_firms.map(f => <span key={f.name} className="inline-block bg-[#f0f5fb] text-[#4a6080] px-1.5 py-0.5 rounded mr-1 mb-1">{f.name} ({f.count})</span>)}
        </div>
        <div>
          <p className="font-medium text-[#002855] mb-1">Top Themes</p>
          {r.top_themes.map(t => <span key={t.name} className="inline-block bg-[#f0f5fb] text-[#4a6080] px-1.5 py-0.5 rounded mr-1 mb-1">{t.name}</span>)}
        </div>
        <div>
          <p className="font-medium text-[#002855] mb-1">Representative Pieces</p>
          {r.representative_pieces.map((a, i) => (
            <p key={i} className="text-[#4a6080] truncate">{a.headline}</p>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="mt-2">
        {editing ? (
          <div className="flex gap-2">
            <input className="flex-1 border border-[#b8cce0] rounded px-2 py-1 text-xs" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes..." />
            <button onClick={saveNotes} className="text-xs text-[#0057b8] hover:underline">Save</button>
            <button onClick={() => setEditing(false)} className="text-xs text-[#4a6080] hover:underline">Cancel</button>
          </div>
        ) : (
          <p className="text-xs text-[#4a6080] cursor-pointer hover:text-[#002855]" onClick={() => setEditing(true)}>
            {notes || 'Click to add notes...'}
          </p>
        )}
      </div>
    </div>
  );
}

function EngagementView({ reporters }) {
  const [minArticles, setMinArticles] = useState(2);

  const filtered = reporters.filter(r => r.article_count >= minArticles);
  const scored = filtered.map(r => {
    const score = (7 - (r.avg_sentiment || 4)) * 3 + r.article_count * 0.5 + (r.trend === 'Declining' ? 2 : r.trend === 'Improving' ? -1 : 0);
    return { ...r, _score: score };
  }).sort((a, b) => b._score - a._score);

  const tierSize = Math.max(Math.ceil(scored.length / 3), 1);
  const tiers = [
    { label: 'High Priority', reporters: scored.slice(0, tierSize), color: 'border-red-300 bg-red-50' },
    { label: 'Medium Priority', reporters: scored.slice(tierSize, tierSize * 2), color: 'border-amber-300 bg-amber-50' },
    { label: 'Low Priority', reporters: scored.slice(tierSize * 2), color: 'border-emerald-300 bg-emerald-50' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm" style={{ color: 'var(--text-muted)' }}>Min articles:</label>
        <input type="number" min="1" max="50" value={minArticles} onChange={e => setMinArticles(Math.max(1, parseInt(e.target.value) || 1))}
          className="border rounded px-2 py-1 text-sm w-16" style={{ borderColor: 'var(--border)' }} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{scored.length} reporters shown (of {reporters.length})</span>
      </div>

      {/* Reporter Leaderboard */}
      <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--bg-content)' }}>
            <tr>
              <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Reporter</th>
              <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Outlets</th>
              <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Articles</th>
              <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Avg Sentiment</th>
              <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Trend</th>
              <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Top Themes</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {scored.slice(0, 30).map(r => (
              <tr key={r.name}>
                <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</td>
                <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{r.outlets.join(', ')}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{r.article_count}</td>
                <td className="px-3 py-2"><span className={`font-bold ${sentimentColor(Math.round(r.avg_sentiment))}`}>{r.avg_sentiment}</span></td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${r.trend === 'Declining' ? 'bg-red-100 text-red-700' : r.trend === 'Improving' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{r.trend}</span>
                </td>
                <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{r.top_themes.slice(0, 3).map(t => t.name).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Priority Tiers */}
      {tiers.map(tier => tier.reporters.length > 0 && (
        <div key={tier.label}>
          <h3 className="text-sm font-semibold text-[#002855] mb-2">{tier.label}</h3>
          <div className="space-y-2">
            {tier.reporters.map(r => (
              <div key={r.name} className={`border rounded-lg p-3 ${tier.color}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-[#002855]">{r.name}</span>
                    <span className="text-xs text-[#4a6080] ml-2">{r.outlets.join(', ')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={`font-bold ${sentimentColor(Math.round(r.avg_sentiment))}`}>{r.avg_sentiment} avg</span>
                    <span className="text-[#4a6080]">{r.article_count} articles</span>
                    <span className={r.trend === 'Declining' ? 'text-red-600' : r.trend === 'Improving' ? 'text-emerald-600' : 'text-[#4a6080]'}>{r.trend}</span>
                  </div>
                </div>
                <p className="text-xs text-[#4a6080] mt-1">
                  Themes: {r.top_themes.map(t => t.name).join(', ') || '—'} · Firms: {r.top_firms.map(f => f.name).join(', ') || '—'}
                </p>
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
    try {
      const res = await api.generateNarrative(workstream.id, { from, to, comparison_window: 'week', force });
      setNarrative(res);
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input type="date" className="border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={from} onChange={e => setFrom(e.target.value)} />
        <span className="text-[#4a6080]">to</span>
        <input type="date" className="border border-[#b8cce0] rounded px-2 py-1.5 text-sm" value={to} onChange={e => setTo(e.target.value)} />
        <button onClick={() => generate(false)} disabled={loading} className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855] disabled:opacity-50">{loading ? 'Generating...' : 'Generate Narrative Analysis'}</button>
        {narrative && <button onClick={() => generate(true)} disabled={loading} className="text-sm text-[#4a6080] hover:underline">Regenerate</button>}
      </div>

      {narrative && !narrative.error && (
        <div className="space-y-4">
          {narrative.cached && <p className="text-xs text-[#4a6080] italic">Cached result — click Regenerate for fresh analysis</p>}
          <div className="bg-white border border-[#b8cce0] rounded-lg p-5">
            <h3 className="text-sm font-semibold text-[#002855] mb-2">Dominant Narrative</h3>
            <p className="text-sm text-[#4a6080]">{narrative.dominant_narrative}</p>
          </div>
          <div className="bg-white border border-[#b8cce0] rounded-lg p-5">
            <h3 className="text-sm font-semibold text-[#002855] mb-2">Narrative Shift</h3>
            <p className="text-sm text-[#4a6080]">{narrative.narrative_shift}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[#002855] mb-2">Emerging Storylines</h3>
              <ul className="list-disc list-inside space-y-1">{(narrative.emerging_storylines || []).map((s, i) => <li key={i} className="text-xs text-[#4a6080]">{s}</li>)}</ul>
            </div>
            <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[#002855] mb-2">Fading Storylines</h3>
              <ul className="list-disc list-inside space-y-1">{(narrative.fading_storylines || []).map((s, i) => <li key={i} className="text-xs text-[#4a6080]">{s}</li>)}</ul>
            </div>
          </div>
          {narrative.inflection_points?.length > 0 && (
            <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[#002855] mb-2">Inflection Points</h3>
              {narrative.inflection_points.map((p, i) => (
                <div key={i} className="flex gap-3 items-start py-1 border-b border-[#b8cce0]/30 last:border-0">
                  <span className="text-xs text-[#4a6080] whitespace-nowrap">{formatDate(p.date)}</span>
                  <div><p className="text-xs font-medium text-[#002855]">{p.headline} <span className="font-normal text-[#4a6080]">({p.outlet})</span></p><p className="text-xs text-[#4a6080]">{p.significance}</p></div>
                </div>
              ))}
            </div>
          )}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-[#002855] mb-2">Outlook (Next 2-4 Weeks)</h3>
            <p className="text-sm text-[#4a6080]">{narrative.outlook}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonView({ workstream }) {
  const [entities, setEntities] = useState([]);
  const [selectedEntities, setSelectedEntities] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getEntities(workstream.id).then(setEntities);
    // Pre-select stakeholder tags
    const tags = workstream.taxonomy?.stakeholder_tags || [];
    if (tags.length > 0) setSelectedEntities(tags.slice(0, 5));
  }, [workstream.id]);

  async function compare() {
    if (selectedEntities.length === 0) return;
    setLoading(true);
    try {
      const res = await api.getComparison(workstream.id, { entities: selectedEntities.join(',') });
      setData(res);
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  function toggleEntity(name) {
    setSelectedEntities(prev => prev.includes(name) ? prev.filter(e => e !== name) : [...prev, name]);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
        <label className="text-sm font-medium text-[#002855] block mb-2">Select entities to compare</label>
        <div className="flex flex-wrap gap-1 mb-3 max-h-32 overflow-y-auto">
          {entities.slice(0, 50).map(e => (
            <button key={e.name} onClick={() => toggleEntity(e.name)} className={`px-2 py-0.5 rounded text-xs ${selectedEntities.includes(e.name) ? 'bg-[#0057b8] text-white' : 'bg-[#f0f5fb] text-[#4a6080]'}`}>{e.name} ({e.count})</button>
          ))}
        </div>
        <button onClick={compare} disabled={loading || selectedEntities.length === 0} className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855] disabled:opacity-50">{loading ? 'Comparing...' : `Compare ${selectedEntities.length} Entities`}</button>
      </div>

      {data?.entities && (
        <>
          {/* Cards */}
          <div className="grid grid-cols-2 gap-3">
            {data.entities.map(e => (
              <div key={e.name} className="bg-white border border-[#b8cce0] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-[#002855]">{e.name}</h4>
                  <span className="text-xs text-[#4a6080]">{e.total_articles} articles</span>
                </div>
                <div className="flex gap-4 mb-2">
                  <div><span className="text-xs text-[#4a6080]">Overall</span><br /><span className={`text-lg font-bold ${sentimentColor(Math.round(e.avg_sentiment))}`}>{e.avg_sentiment}</span></div>
                  {e.avg_firm_sentiment && <div><span className="text-xs text-[#4a6080]">Firm-specific</span><br /><span className={`text-lg font-bold ${sentimentColor(Math.round(e.avg_firm_sentiment))}`}>{e.avg_firm_sentiment}</span></div>}
                  <div><span className="text-xs text-[#4a6080]">Negative</span><br /><span className="text-lg font-bold text-red-600">{e.negative_share_pct}%</span></div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {e.top_themes.slice(0, 3).map(t => <span key={t.theme} className="bg-[#f0f5fb] text-[#4a6080] px-1.5 py-0.5 rounded text-xs">{t.theme}</span>)}
                </div>
                {e.top_reporters.length > 0 && (
                  <div className="mt-2 text-xs text-[#4a6080]">
                    Top reporters: {e.top_reporters.slice(0, 3).map(r => `${r.name} (${r.count})`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Comparison table */}
          <div className="bg-white border border-[#b8cce0] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#f0f5fb] border-b border-[#b8cce0]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Entity</th>
                  <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Articles</th>
                  <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Avg Sentiment</th>
                  <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Firm Sentiment</th>
                  <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Negative %</th>
                  <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Top Theme</th>
                  <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Top Reporter</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#b8cce0]/30">
                {data.entities.map(e => (
                  <tr key={e.name}>
                    <td className="px-3 py-2 font-medium text-[#002855]">{e.name}</td>
                    <td className="px-3 py-2 text-[#4a6080]">{e.total_articles}</td>
                    <td className="px-3 py-2"><span className={sentimentColor(Math.round(e.avg_sentiment))}>{e.avg_sentiment}</span></td>
                    <td className="px-3 py-2"><span className={sentimentColor(Math.round(e.avg_firm_sentiment))}>{e.avg_firm_sentiment || '—'}</span></td>
                    <td className="px-3 py-2 text-[#4a6080]">{e.negative_share_pct}%</td>
                    <td className="px-3 py-2 text-xs text-[#4a6080]">{e.top_themes[0]?.theme || '—'}</td>
                    <td className="px-3 py-2 text-xs text-[#4a6080]">{e.top_reporters[0]?.name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SortTh({ label, col, sort, onSort }) {
  const active = sort.by === col;
  return (
    <th className="px-3 py-2 text-left font-medium text-[#4a6080] cursor-pointer select-none hover:text-[#002855]" onClick={() => onSort(col)}>
      {label} {active && (sort.dir === 'asc' ? '↑' : '↓')}
    </th>
  );
}
