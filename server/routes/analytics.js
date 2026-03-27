import { Router } from 'express';
import db from '../db.js';

const router = Router();

function safeJson(str) { try { return JSON.parse(str); } catch { return null; } }

function getISOWeek(dateStr) {
  if (!dateStr) return 'unknown';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr.slice(0, 7);
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  } catch { return 'unknown'; }
}

router.get('/:workstream_id/comparison', async (req, res) => {
  const { entities: entitiesParam, from, to } = req.query;
  if (!entitiesParam) return res.status(400).json({ error: 'entities param required' });

  const entityNames = entitiesParam.split(',').map(s => s.trim()).filter(Boolean);
  let articles = await db.all(`SELECT * FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);

  if (from) articles = articles.filter(a => a.publish_date >= from);
  if (to) articles = articles.filter(a => a.publish_date <= to);

  const result = entityNames.map(entityName => {
    const lowerName = entityName.toLowerCase();
    const matching = articles.filter(a => {
      const entities = safeJson(a.cl_key_entities) || [];
      const firms = safeJson(a.cl_firms_mentioned) || [];
      return [...entities, ...firms].some(e => e.toLowerCase().includes(lowerName) || lowerName.includes(e.toLowerCase()));
    });

    const sentiments = matching.map(a => a.cl_sentiment_score).filter(Boolean);
    const firmSentiments = matching.map(a => { const fs = safeJson(a.cl_firm_sentiments) || {}; return Object.entries(fs).find(([k]) => k.toLowerCase().includes(lowerName))?.[1]; }).filter(Boolean);

    // Weekly trend
    const weekBuckets = {};
    matching.forEach(a => {
      const w = getISOWeek(a.publish_date);
      if (!weekBuckets[w]) weekBuckets[w] = { scores: [], count: 0 };
      weekBuckets[w].count++;
      if (a.cl_sentiment_score) weekBuckets[w].scores.push(a.cl_sentiment_score);
    });
    const sentimentTrend = Object.entries(weekBuckets).sort(([a], [b]) => a.localeCompare(b)).map(([period, d]) => ({
      period, count: d.count, avg: d.scores.length > 0 ? +(d.scores.reduce((a, b) => a + b, 0) / d.scores.length).toFixed(1) : null
    }));

    // Top themes
    const themes = {};
    matching.forEach(a => { (safeJson(a.cl_topics) || []).forEach(t => themes[t] = (themes[t] || 0) + 1); });

    // Top reporters
    const reporters = {};
    matching.forEach(a => {
      if (a.author) {
        if (!reporters[a.author]) reporters[a.author] = { count: 0, sentiments: [] };
        reporters[a.author].count++;
        if (a.cl_sentiment_score) reporters[a.author].sentiments.push(a.cl_sentiment_score);
      }
    });

    // Top outlets
    const outlets = {};
    matching.forEach(a => {
      const o = a.outlet || 'Unknown';
      if (!outlets[o]) outlets[o] = { count: 0, sentiments: [] };
      outlets[o].count++;
      if (a.cl_sentiment_score) outlets[o].sentiments.push(a.cl_sentiment_score);
    });

    const negCount = sentiments.filter(s => s <= 3).length;
    const sortedByScore = [...matching].sort((a, b) => (a.cl_sentiment_score || 4) - (b.cl_sentiment_score || 4));

    return {
      name: entityName,
      total_articles: matching.length,
      avg_sentiment: sentiments.length > 0 ? +(sentiments.reduce((a, b) => a + b, 0) / sentiments.length).toFixed(1) : null,
      avg_firm_sentiment: firmSentiments.length > 0 ? +(firmSentiments.reduce((a, b) => a + b, 0) / firmSentiments.length).toFixed(1) : null,
      sentiment_trend: sentimentTrend,
      top_themes: Object.entries(themes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([theme, count]) => ({ theme, count })),
      top_reporters: Object.entries(reporters).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([name, d]) => ({ name, count: d.count, avg_sentiment: d.sentiments.length > 0 ? +(d.sentiments.reduce((a, b) => a + b, 0) / d.sentiments.length).toFixed(1) : null })),
      top_outlets: Object.entries(outlets).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([name, d]) => ({ name, count: d.count, avg_sentiment: d.sentiments.length > 0 ? +(d.sentiments.reduce((a, b) => a + b, 0) / d.sentiments.length).toFixed(1) : null })),
      negative_share_pct: sentiments.length > 0 ? Math.round((negCount / sentiments.length) * 100) : 0,
      most_negative_article: sortedByScore[0] ? { headline: sortedByScore[0].headline, sentiment: sortedByScore[0].cl_sentiment_score, date: sortedByScore[0].publish_date } : null,
      most_positive_article: sortedByScore.length > 0 ? { headline: sortedByScore[sortedByScore.length - 1].headline, sentiment: sortedByScore[sortedByScore.length - 1].cl_sentiment_score, date: sortedByScore[sortedByScore.length - 1].publish_date } : null,
    };
  });

  res.json({ entities: result, period: { from, to } });
});

// Get all unique entities for the selector
router.get('/:workstream_id/entities', async (req, res) => {
  const articles = await db.all(`SELECT cl_key_entities, cl_firms_mentioned FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);
  const entities = {};
  articles.forEach(a => {
    (safeJson(a.cl_key_entities) || []).forEach(e => entities[e] = (entities[e] || 0) + 1);
    (safeJson(a.cl_firms_mentioned) || []).forEach(e => entities[e] = (entities[e] || 0) + 1);
  });
  res.json(Object.entries(entities).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })));
});

// Coverage Gap Detection
router.get('/:workstream_id/gaps', async (req, res) => {
  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', req.params.workstream_id);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });
  const taxonomy = JSON.parse(ws.taxonomy);
  const topics = taxonomy.topics || [];

  const now = new Date();
  const d7 = new Date(now - 7 * 86400000).toISOString().split('T')[0];
  const d14 = new Date(now - 14 * 86400000).toISOString().split('T')[0];
  const d30 = new Date(now - 30 * 86400000).toISOString().split('T')[0];

  const articles = await db.all(`SELECT cl_topics, publish_date FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);

  const gaps = [];
  const overRepresented = [];

  for (const topic of topics) {
    let last7 = 0, last14 = 0, last30 = 0, total = 0;
    for (const a of articles) {
      const ts = safeJson(a.cl_topics) || [];
      if (!ts.includes(topic)) continue;
      total++;
      if (a.publish_date >= d30) last30++;
      if (a.publish_date >= d14) last14++;
      if (a.publish_date >= d7) last7++;
    }
    const avgWeekly = last30 > 0 ? +(last30 / 4.3).toFixed(1) : 0;

    if (last14 === 0 && total > 0) {
      gaps.push({ topic, last_7d: last7, last_14d: last14, last_30d: last30, avg_weekly: avgWeekly, status: 'silent', implication: `No recent coverage — this topic has gone quiet` });
    } else if (avgWeekly > 0 && last7 < avgWeekly * 0.5) {
      gaps.push({ topic, last_7d: last7, last_14d: last14, last_30d: last30, avg_weekly: avgWeekly, status: 'declining', implication: `Below average volume — declining media interest` });
    }

    if (avgWeekly > 0 && last7 > avgWeekly * 2.5) {
      overRepresented.push({ topic, last_7d: last7, avg_weekly: avgWeekly, status: 'spiking', implication: `${(last7 / avgWeekly).toFixed(1)}x normal volume` });
    }
  }

  res.json({ gaps, over_represented: overRepresented });
});

// Sentiment Velocity
router.get('/:workstream_id/velocity', async (req, res) => {
  const articles = await db.all(`SELECT cl_topics, cl_key_entities, cl_firms_mentioned, cl_sentiment_score, publish_date FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved') AND cl_sentiment_score IS NOT NULL`, req.params.workstream_id);

  const now = new Date();
  const d7 = new Date(now - 7 * 86400000).toISOString().split('T')[0];
  const d30 = new Date(now - 30 * 86400000).toISOString().split('T')[0];

  // Compute velocity per entity/topic
  const subjects = {};
  for (const a of articles) {
    const keys = [...(safeJson(a.cl_topics) || []), ...(safeJson(a.cl_key_entities) || []), ...(safeJson(a.cl_firms_mentioned) || [])];
    for (const key of keys) {
      if (!subjects[key]) subjects[key] = { recent: [], older: [] };
      if (a.publish_date >= d7) subjects[key].recent.push(a.cl_sentiment_score);
      else if (a.publish_date >= d30) subjects[key].older.push(a.cl_sentiment_score);
    }
  }

  const movers = [];
  for (const [name, data] of Object.entries(subjects)) {
    const allScores = [...data.recent, ...data.older];
    if (allScores.length < 3) continue;
    const avg7 = data.recent.length > 0 ? data.recent.reduce((a, b) => a + b, 0) / data.recent.length : null;
    const avg30 = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    if (avg7 === null || avg30 === 0) continue;
    const velocity = (avg7 - avg30) / avg30;
    if (Math.abs(velocity) > 0.1) {
      movers.push({ name, avg_7d: +avg7.toFixed(1), avg_30d: +avg30.toFixed(1), velocity: +(velocity * 100).toFixed(0), articles_7d: data.recent.length, articles_30d: allScores.length });
    }
  }

  movers.sort((a, b) => Math.abs(b.velocity) - Math.abs(a.velocity));
  res.json({ movers: movers.slice(0, 20) });
});

export default router;
