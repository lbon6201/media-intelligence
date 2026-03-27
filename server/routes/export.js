import { Router } from 'express';
import db from '../db.js';
import XLSX from 'xlsx';

const router = Router();

function safeParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

function sentimentLabel(score) {
  const labels = { 1: 'Very Negative', 2: 'Negative', 3: 'Slightly Negative', 4: 'Neutral', 5: 'Slightly Positive', 6: 'Positive', 7: 'Very Positive' };
  return labels[score] || '';
}

router.get('/:workstream_id/excel', async (req, res) => {
  const wsId = req.params.workstream_id;
  const articles = await db.all('SELECT * FROM articles WHERE workstream_id = ? AND cl_status IN (?, ?) ORDER BY publish_date DESC',
    wsId, 'classified', 'approved');

  const wb = XLSX.utils.book_new();

  // Sheet 1: Articles
  const articleRows = articles.map(a => ({
    'Publish Date': a.publish_date,
    Reporter: a.author,
    Outlet: a.outlet,
    Headline: a.headline,
    'Sentiment Score': a.cl_sentiment_score,
    'Sentiment Label': a.cl_sentiment_label,
    'Sentiment Rationale': a.cl_sentiment_rationale,
    'Firms Mentioned': safeParseJson(a.cl_firms_mentioned)?.join?.(', ') || '',
    'Firm Sentiments': (() => {
      const fs = safeParseJson(a.cl_firm_sentiments);
      return fs && typeof fs === 'object' ? Object.entries(fs).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
    })(),
    Topics: safeParseJson(a.cl_topics)?.join?.(', ') || '',
    'Relevance Tier': a.cl_relevance_tier,
    'Institutional Investors': a.cl_institutional_investors,
    'Key Takeaway': a.cl_key_takeaway,
    Rationale: a.cl_rationale,
    'Geographic Tags': safeParseJson(a.cl_geographic_tags)?.join?.(', ') || '',
    'Policy Dimensions': safeParseJson(a.cl_policy_dimensions)?.join?.(', ') || '',
    'Stakeholder Focus': safeParseJson(a.cl_stakeholder_focus)?.join?.(', ') || '',
    'Key Entities': safeParseJson(a.cl_key_entities)?.join?.(', ') || '',
    URL: a.url,
    Status: a.cl_status,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(articleRows), 'Articles');

  // Aggregate reporter data
  const reporterMap = {};
  for (const a of articles) {
    if (!a.author) continue;
    const names = a.author.split(/[;,]|\band\b/i).map(s => s.trim()).filter(Boolean);
    for (const name of names) {
      if (!reporterMap[name]) reporterMap[name] = { name, outlets: new Set(), sentiments: [], firms: {}, themes: {} };
      const r = reporterMap[name];
      if (a.outlet) r.outlets.add(a.outlet);
      if (a.cl_sentiment_score) r.sentiments.push(a.cl_sentiment_score);
      const firms = safeParseJson(a.cl_firms_mentioned);
      if (Array.isArray(firms)) for (const f of firms) r.firms[f] = (r.firms[f] || 0) + 1;
      const topics = safeParseJson(a.cl_topics);
      if (Array.isArray(topics)) for (const t of topics) r.themes[t] = (r.themes[t] || 0) + 1;
    }
  }

  // Sheet 2: Reporters
  const reporterRows = Object.values(reporterMap).map(r => {
    const avg = r.sentiments.length > 0 ? +(r.sentiments.reduce((a, b) => a + b, 0) / r.sentiments.length).toFixed(1) : null;
    const topThemes = Object.entries(r.themes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    return {
      Reporter: r.name,
      'Avg Sentiment': avg,
      'Sentiment Label': sentimentLabel(Math.round(avg)),
      'Article Count': r.sentiments.length,
      Outlets: [...r.outlets].join(', '),
      'Top 3 Themes': topThemes.join(', '),
      'Firms Covered': Object.keys(r.firms).join(', '),
    };
  }).sort((a, b) => b['Article Count'] - a['Article Count']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reporterRows), 'Reporters');

  // Aggregate outlet data
  const outletMap = {};
  for (const a of articles) {
    const o = a.outlet || 'Unknown';
    if (!outletMap[o]) outletMap[o] = { name: o, reporters: new Set(), sentiments: [], themes: {} };
    const ol = outletMap[o];
    if (a.author) ol.reporters.add(a.author);
    if (a.cl_sentiment_score) ol.sentiments.push(a.cl_sentiment_score);
    const topics = safeParseJson(a.cl_topics);
    if (Array.isArray(topics)) for (const t of topics) ol.themes[t] = (ol.themes[t] || 0) + 1;
  }

  // Sheet 3: Outlets
  const outletRows = Object.values(outletMap).map(o => {
    const avg = o.sentiments.length > 0 ? +(o.sentiments.reduce((a, b) => a + b, 0) / o.sentiments.length).toFixed(1) : null;
    return {
      Outlet: o.name,
      'Avg Sentiment': avg,
      'Sentiment Label': sentimentLabel(Math.round(avg)),
      'Article Count': o.sentiments.length,
      'Reporter Count': o.reporters.size,
      'Top Themes': Object.entries(o.themes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(', '),
    };
  }).sort((a, b) => b['Article Count'] - a['Article Count']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(outletRows), 'Outlets');

  // Aggregate firm data
  const firmMap = {};
  for (const a of articles) {
    const firms = safeParseJson(a.cl_firms_mentioned);
    const firmSentiments = safeParseJson(a.cl_firm_sentiments) || {};
    if (!Array.isArray(firms)) continue;
    for (const f of firms) {
      if (!firmMap[f]) firmMap[f] = { name: f, count: 0, overall_sentiments: [], firm_sentiments: [] };
      firmMap[f].count++;
      if (a.cl_sentiment_score) firmMap[f].overall_sentiments.push(a.cl_sentiment_score);
      if (firmSentiments[f]) firmMap[f].firm_sentiments.push(firmSentiments[f]);
    }
  }

  // Sheet 4: Firms
  const firmRows = Object.values(firmMap).map(f => {
    const avgOverall = f.overall_sentiments.length > 0 ? +(f.overall_sentiments.reduce((a, b) => a + b, 0) / f.overall_sentiments.length).toFixed(1) : null;
    const avgFirm = f.firm_sentiments.length > 0 ? +(f.firm_sentiments.reduce((a, b) => a + b, 0) / f.firm_sentiments.length).toFixed(1) : null;
    return {
      Firm: f.name,
      'Article Count': f.count,
      'Overall Avg Sentiment': avgOverall,
      'Overall Sentiment Label': sentimentLabel(Math.round(avgOverall)),
      'Firm-Specific Avg Sentiment': avgFirm,
      'Firm-Specific Label': sentimentLabel(Math.round(avgFirm)),
    };
  }).sort((a, b) => b['Article Count'] - a['Article Count']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(firmRows), 'Firms');

  // Aggregate theme data
  const themeMap = {};
  for (const a of articles) {
    const topics = safeParseJson(a.cl_topics);
    if (!Array.isArray(topics)) continue;
    for (const t of topics) {
      if (!themeMap[t]) themeMap[t] = { name: t, count: 0, sentiments: [] };
      themeMap[t].count++;
      if (a.cl_sentiment_score) themeMap[t].sentiments.push(a.cl_sentiment_score);
    }
  }

  // Sheet 5: Themes
  const themeRows = Object.values(themeMap).map(t => {
    const avg = t.sentiments.length > 0 ? +(t.sentiments.reduce((a, b) => a + b, 0) / t.sentiments.length).toFixed(1) : null;
    return { Theme: t.name, 'Article Count': t.count, 'Avg Sentiment': avg, 'Sentiment Label': sentimentLabel(Math.round(avg)) };
  }).sort((a, b) => b['Article Count'] - a['Article Count']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(themeRows), 'Themes');

  // Sheet 6: Reporter x Firm Matrix
  const matrixRows = [];
  for (const [rName, rData] of Object.entries(reporterMap)) {
    for (const [fName, fCount] of Object.entries(rData.firms)) {
      matrixRows.push({ Reporter: rName, Firm: fName, 'Article Count': fCount });
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matrixRows.length > 0 ? matrixRows : [{ Note: 'No data' }]), 'Reporter-Firm');

  // Sheet 7: Engagement Priority (by sentiment score, article volume, trend)
  const engagementRows = Object.values(reporterMap).map(r => {
    const avg = r.sentiments.length > 0 ? +(r.sentiments.reduce((a, b) => a + b, 0) / r.sentiments.length).toFixed(1) : 4;
    const sorted = r.sentiments;
    const recentAvg = sorted.length >= 3 ? +((sorted[sorted.length - 1] + sorted[sorted.length - 2] + sorted[sorted.length - 3]) / 3).toFixed(1) : avg;
    const trend = recentAvg - avg > 0.5 ? 'Improving' : avg - recentAvg > 0.5 ? 'Declining' : 'Stable';
    const score = (7 - avg) * 3 + r.sentiments.length * 0.5 + (trend === 'Declining' ? 2 : trend === 'Improving' ? -1 : 0);
    return {
      Reporter: r.name, Outlets: [...r.outlets].join(', '),
      'Avg Sentiment': avg, 'Article Count': r.sentiments.length,
      Trend: trend, 'Recent Avg': recentAvg,
      'Top Themes': Object.entries(r.themes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(', '),
      Firms: Object.keys(r.firms).join(', '),
      _score: score,
    };
  }).sort((a, b) => b._score - a._score);

  const tierSize = Math.max(Math.ceil(engagementRows.length / 3), 1);
  engagementRows.forEach((r, i) => {
    r['Priority Tier'] = i < tierSize ? 'High' : i < tierSize * 2 ? 'Medium' : 'Low';
    delete r._score;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(engagementRows), 'Engagement');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=media-intelligence-export.xlsx');
  res.send(buf);
});

router.get('/:workstream_id/json', async (req, res) => {
  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', req.params.workstream_id);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });
  const articles = await db.all('SELECT * FROM articles WHERE workstream_id = ?', req.params.workstream_id);
  const quotes = await db.all('SELECT * FROM quotes WHERE workstream_id = ?', req.params.workstream_id);
  res.json({
    workstream: { ...ws, taxonomy: JSON.parse(ws.taxonomy), alert_config: JSON.parse(ws.alert_config) },
    articles, quotes, exported_at: new Date().toISOString(),
  });
});

router.post('/import/json', async (req, res) => {
  const { workstream, articles } = req.body;
  if (!workstream || !articles) return res.status(400).json({ error: 'workstream and articles required' });

  let imported = 0;
  await db.transaction(async () => {
    const existing = await db.get('SELECT id FROM workstreams WHERE id = ?', workstream.id);
    if (existing) {
      await db.run('UPDATE workstreams SET name = ?, client = ?, taxonomy = ?, alert_config = ?, status = ? WHERE id = ?',
        workstream.name, workstream.client, JSON.stringify(workstream.taxonomy), JSON.stringify(workstream.alert_config), 'active', workstream.id);
    } else {
      await db.run('INSERT INTO workstreams (id, name, client, taxonomy, alert_config) VALUES (?, ?, ?, ?, ?)',
        workstream.id, workstream.name, workstream.client, JSON.stringify(workstream.taxonomy), JSON.stringify(workstream.alert_config));
    }

    for (const a of articles) {
      const result = await db.run(`INSERT OR IGNORE INTO articles (id, workstream_id, source_type, headline, outlet, outlet_type, author, publish_date, url, full_text, word_count, fingerprint, cl_status, cl_topics, cl_sentiment_score, cl_sentiment_label, cl_relevance_tier, cl_geographic_tags, cl_policy_dimensions, cl_stakeholder_focus, cl_key_entities, cl_rationale, classified_at, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        a.id, a.workstream_id, a.source_type, a.headline, a.outlet, a.outlet_type,
        a.author, a.publish_date, a.url, a.full_text, a.word_count, a.fingerprint,
        a.cl_status, a.cl_topics, a.cl_sentiment_score, a.cl_sentiment_label,
        a.cl_relevance_tier, a.cl_geographic_tags, a.cl_policy_dimensions,
        a.cl_stakeholder_focus, a.cl_key_entities, a.cl_rationale,
        a.classified_at, a.approved_at
      );
      if (result.changes > 0) imported++;
    }
  });

  res.json({ success: true, imported });
});

export default router;
