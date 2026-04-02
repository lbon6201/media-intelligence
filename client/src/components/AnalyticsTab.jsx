import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { sentimentColor, sentimentDot, formatDate, sentimentLabel, reporterStatusColor, REPORTER_STATUSES } from '../lib/helpers';

const SUBTABS = ['Dashboard', 'Narratives', 'Comparison', 'Reporters', 'Outlets', 'Firms', 'Themes', 'Outlet × Firm', 'Engagement'];

export default function AnalyticsTab({ workstream }) {
  const [sub, setSub] = useState('Dashboard');
  const [articles, setArticles] = useState([]);
  const [reporters, setReporters] = useState([]);
  const [reporterSort, setReporterSort] = useState('count');

  const load = useCallback(async () => {
    const [arts, reps] = await Promise.all([
      api.getArticles({ workstream_id: workstream.id, status: '' }),
      api.getReporters(workstream.id),
    ]);
    setArticles(arts.filter(a => a.cl_status === 'classified' || a.cl_status === 'approved'));
    setReporters(reps);
  }, [workstream.id]);

  useEffect(() => { load(); }, [load]);

  // Aggregations
  const totalArticles = articles.length;
  const avgSentiment = totalArticles > 0 ? +(articles.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / totalArticles).toFixed(1) : 0;
  const negShare = totalArticles > 0 ? +((articles.filter(a => a.cl_sentiment_score && a.cl_sentiment_score <= 3).length / totalArticles) * 100).toFixed(0) : 0;

  // Top reporter/theme
  const reporterCounts = {};
  articles.forEach(a => { if (a.author) { reporterCounts[a.author] = (reporterCounts[a.author] || 0) + 1; } });
  const topReporter = Object.entries(reporterCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const themeCounts = {};
  articles.forEach(a => { (a.cl_topics || []).forEach(t => { themeCounts[t] = (themeCounts[t] || 0) + 1; }); });
  const topTheme = Object.entries(themeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  // Sentiment distribution
  const sentDist = [0, 0, 0, 0, 0, 0, 0];
  articles.forEach(a => { if (a.cl_sentiment_score >= 1 && a.cl_sentiment_score <= 7) sentDist[a.cl_sentiment_score - 1]++; });
  const maxSentDist = Math.max(...sentDist, 1);
  const SENT_DESCRIPTIONS = [
    '1 — Very Negative: Strongly critical, accusatory, fraud/systemic risk framing',
    '2 — Negative: Clearly skeptical or damaging framing',
    '3 — Slightly Negative: Cautionary, mildly critical, raises concerns',
    '4 — Neutral: Balanced or purely factual',
    '5 — Slightly Positive: Constructive, mildly favorable',
    '6 — Positive: Favorable coverage, highlights strengths',
    '7 — Very Positive: Strongly supportive or promotional',
  ];

  // Trend over time: group by date, compute daily avg sentiment + volume
  const dailyData = {};
  articles.forEach(a => {
    const date = a.publish_date || 'unknown';
    if (date === 'unknown') return;
    if (!dailyData[date]) dailyData[date] = { date, count: 0, sentSum: 0, sentCount: 0 };
    dailyData[date].count++;
    if (a.cl_sentiment_score) { dailyData[date].sentSum += a.cl_sentiment_score; dailyData[date].sentCount++; }
  });
  const trendDays = Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
    ...d, avgSent: d.sentCount > 0 ? +(d.sentSum / d.sentCount).toFixed(1) : null,
  }));
  const maxDayCount = Math.max(...trendDays.map(d => d.count), 1);

  // Theme breakdown
  const themeEntries = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]);
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

  // Firm aggregation
  const firmMap = {};
  articles.forEach(a => {
    const firms = a.cl_firms_mentioned || [];
    const firmSents = a.cl_firm_sentiments || {};
    firms.forEach(f => {
      if (!firmMap[f]) firmMap[f] = { name: f, count: 0, overallSents: [], firmSents: [] };
      firmMap[f].count++;
      if (a.cl_sentiment_score) firmMap[f].overallSents.push(a.cl_sentiment_score);
      if (firmSents[f]) firmMap[f].firmSents.push(firmSents[f]);
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
          {/* KPI Row */}
          <div className="grid grid-cols-5 gap-3">
            <KPI label="Total Articles" value={totalArticles} />
            <KPI label="Avg Sentiment" value={avgSentiment} extra={sentimentLabel(Math.round(avgSentiment))} />
            <KPI label="Negative Share" value={`${negShare}%`} />
            <KPI label="Top Reporter" value={topReporter} small />
            <KPI label="Top Theme" value={topTheme} small />
          </div>

          {/* Sentiment Distribution — larger, with hover tooltips */}
          <div className="card p-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Sentiment Distribution</h3>
            <div className="flex items-end gap-3" style={{ height: 200 }}>
              {sentDist.map((count, i) => {
                const barHeight = maxSentDist > 0 ? Math.max((count / maxSentDist) * 180, count > 0 ? 6 : 0) : 0;
                return (
                  <div key={i} className="flex-1 group relative" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%' }}>
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-10" style={{ width: 240, left: '50%', transform: 'translateX(-50%)' }}>
                      <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-inverse)' }}>
                        <p className="font-semibold">{SENT_DESCRIPTIONS[i]}</p>
                        <p className="mt-1 font-mono">{count} article{count !== 1 ? 's' : ''} ({totalArticles > 0 ? Math.round((count / totalArticles) * 100) : 0}%)</p>
                      </div>
                    </div>
                    {/* Bar — using pixel height */}
                    <div className="w-full rounded-t cursor-pointer transition-all hover:opacity-80" style={{ height: barHeight, backgroundColor: sentimentDot(i + 1) }} />
                  </div>
                );
              })}
            </div>
            {/* Labels row */}
            <div className="flex gap-3 mt-2">
              {sentDist.map((count, i) => (
                <div key={i} className="flex-1 text-center">
                  <span className="text-xs font-bold font-mono" style={{ color: sentimentDot(i + 1) }}>{i + 1}</span>
                  <span className="block text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{count}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <span>← Negative</span>
              <span>Neutral</span>
              <span>Positive →</span>
            </div>
          </div>

          {/* Trend Over Time — volume bars + sentiment line */}
          {trendDays.length > 1 && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Coverage Trend</h3>
              <div className="flex items-end gap-px" style={{ height: 160 }}>
                {trendDays.map((d, i) => {
                  const barHeight = Math.max((d.count / maxDayCount) * 140, 4);
                  const barColor = d.avgSent ? sentimentDot(Math.round(d.avgSent)) : '#94A3B8';
                  return (
                    <div key={i} className="flex-1 group relative" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%', minWidth: 2 }}>
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10" style={{ width: 180, left: '50%', transform: 'translateX(-50%)' }}>
                        <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-inverse)' }}>
                          <p className="font-semibold">{formatDate(d.date)}</p>
                          <p>{d.count} article{d.count !== 1 ? 's' : ''}</p>
                          {d.avgSent && <p>Avg sentiment: {d.avgSent}/7 — {sentimentLabel(Math.round(d.avgSent))}</p>}
                        </div>
                      </div>
                      {/* Bar colored by sentiment */}
                      <div className="w-full rounded-t cursor-pointer transition-all hover:opacity-70" style={{ height: barHeight, backgroundColor: barColor }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-2 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                <span>{formatDate(trendDays[0]?.date)}</span>
                <span>{trendDays.length} days · bars colored by avg sentiment</span>
                <span>{formatDate(trendDays[trendDays.length - 1]?.date)}</span>
              </div>
            </div>
          )}

          {/* Theme Breakdown */}
          <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#002855] mb-3">Theme Breakdown</h3>
            <div className="space-y-2">
              {themeEntries.slice(0, 15).map(([theme, count]) => (
                <div key={theme} className="flex items-center gap-3">
                  <span className="text-xs text-[#4a6080] w-48 truncate">{theme}</span>
                  <div className="flex-1 bg-[#f0f5fb] rounded-full h-4">
                    <div className="bg-[#0057b8] rounded-full h-4" style={{ width: `${(count / maxThemeCount) * 100}%` }} />
                  </div>
                  <span className="text-xs text-[#4a6080] w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Articles */}
          <div className="bg-white border border-[#b8cce0] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#002855] mb-3">Recent Articles</h3>
            <div className="space-y-2">
              {articles.slice(0, 10).map(a => (
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

      {sub === 'Outlets' && (
        <div className="bg-white border border-[#b8cce0] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f5fb] border-b border-[#b8cce0]">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Outlet</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Articles</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Avg Sentiment</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Reporters</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Top Themes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#b8cce0]/30">
              {outlets.map(o => {
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
      )}

      {sub === 'Firms' && (
        <div className="bg-white border border-[#b8cce0] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f5fb] border-b border-[#b8cce0]">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Firm</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Articles</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Overall Avg</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Firm-Specific Avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#b8cce0]/30">
              {firms.map(f => {
                const oAvg = f.overallSents.length > 0 ? +(f.overallSents.reduce((a, b) => a + b, 0) / f.overallSents.length).toFixed(1) : null;
                const fAvg = f.firmSents.length > 0 ? +(f.firmSents.reduce((a, b) => a + b, 0) / f.firmSents.length).toFixed(1) : null;
                return (
                  <tr key={f.name}>
                    <td className="px-3 py-2 font-medium text-[#002855]">{f.name}</td>
                    <td className="px-3 py-2 text-[#4a6080]">{f.count}</td>
                    <td className="px-3 py-2"><span className={sentimentColor(Math.round(oAvg))}>{oAvg}</span></td>
                    <td className="px-3 py-2"><span className={sentimentColor(Math.round(fAvg))}>{fAvg || '—'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'Themes' && (
        <div className="bg-white border border-[#b8cce0] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f0f5fb] border-b border-[#b8cce0]">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Theme</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Articles</th>
                <th className="px-3 py-2 text-left font-medium text-[#4a6080]">Avg Sentiment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#b8cce0]/30">
              {themeEntries.map(([theme, count]) => {
                const arts = articles.filter(a => (a.cl_topics || []).includes(theme));
                const avg = arts.length > 0 ? +(arts.reduce((s, a) => s + (a.cl_sentiment_score || 0), 0) / arts.length).toFixed(1) : null;
                return (
                  <tr key={theme}>
                    <td className="px-3 py-2 font-medium text-[#002855]">{theme}</td>
                    <td className="px-3 py-2 text-[#4a6080]">{count}</td>
                    <td className="px-3 py-2"><span className={sentimentColor(Math.round(avg))}>{avg} — {sentimentLabel(Math.round(avg))}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
  const scored = reporters.map(r => {
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
      {tiers.map(tier => (
        <div key={tier.label}>
          <h3 className="text-sm font-semibold text-[#002855] mb-2">{tier.label}</h3>
          <div className="space-y-2">
            {tier.reporters.map((r, i) => (
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
