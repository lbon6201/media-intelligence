import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Get aggregated reporter data for a workstream
router.get('/', async (req, res) => {
  const { workstream_id, sort_by } = req.query;
  if (!workstream_id) return res.status(400).json({ error: 'workstream_id required' });

  const articles = await db.all(`SELECT author, outlet, cl_sentiment_score, cl_topics, cl_firms_mentioned, cl_firm_sentiments, headline, publish_date, word_count, cl_key_takeaway
    FROM articles WHERE workstream_id = ? AND cl_status IN ('classified', 'approved') AND author IS NOT NULL`, workstream_id);

  // Load aliases for resolution
  const aliasRows = await db.all('SELECT alias, canonical_name FROM reporter_aliases');
  const aliasMap = {};
  for (const a of aliasRows) aliasMap[a.alias] = a.canonical_name;

  // Aggregate by reporter
  const reporters = {};
  for (const a of articles) {
    const names = splitReporters(a.author);
    for (const name of names) {
      const canonical = normName(resolveAliasSync(aliasMap, name));
      if (!canonical || canonical.length < 2) continue;
      if (!reporters[canonical]) {
        reporters[canonical] = { name: canonical, outlets: new Set(), articles: [], sentiment_sum: 0, count: 0, firms: {}, themes: {} };
      }
      const r = reporters[canonical];
      if (a.outlet) r.outlets.add(a.outlet);
      r.articles.push({ headline: a.headline, publish_date: a.publish_date, sentiment: a.cl_sentiment_score, word_count: a.word_count, key_takeaway: a.cl_key_takeaway });
      if (a.cl_sentiment_score) { r.sentiment_sum += a.cl_sentiment_score; r.count++; }
      // Firms
      try {
        const firms = typeof a.cl_firms_mentioned === 'string' ? JSON.parse(a.cl_firms_mentioned) : a.cl_firms_mentioned;
        if (Array.isArray(firms)) for (const f of firms) r.firms[f] = (r.firms[f] || 0) + 1;
      } catch {}
      // Topics
      try {
        const topics = typeof a.cl_topics === 'string' ? JSON.parse(a.cl_topics) : a.cl_topics;
        if (Array.isArray(topics)) for (const t of topics) r.themes[t] = (r.themes[t] || 0) + 1;
      } catch {}
    }
  }

  // Load statuses
  const statuses = {};
  const statusRows = await db.all('SELECT * FROM reporter_statuses WHERE workstream_id = ?', workstream_id);
  for (const s of statusRows) statuses[s.reporter_name] = { status: s.status, notes: s.notes, engagement_history: s.engagement_history, last_contacted: s.last_contacted };

  const result = Object.values(reporters).map(r => ({
    name: r.name,
    outlets: [...r.outlets],
    article_count: r.articles.length,
    avg_sentiment: r.count > 0 ? +(r.sentiment_sum / r.count).toFixed(1) : null,
    top_firms: Object.entries(r.firms).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    top_themes: Object.entries(r.themes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
    all_themes: r.themes,
    recent_articles: r.articles.sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || '')).slice(0, 3),
    representative_pieces: r.articles.filter(a => a.word_count > 500).sort((a, b) => (b.word_count || 0) - (a.word_count || 0)).slice(0, 3),
    status: statuses[r.name]?.status || 'no_action',
    notes: statuses[r.name]?.notes || '',
    engagement_history: (() => { try { return JSON.parse(statuses[r.name]?.engagement_history || '[]'); } catch { return []; } })(),
    last_contacted: statuses[r.name]?.last_contacted || null,
    trend: computeTrend(r),
  }));

  // Sort
  if (sort_by === 'sentiment_asc') result.sort((a, b) => (a.avg_sentiment || 4) - (b.avg_sentiment || 4));
  else if (sort_by === 'sentiment_desc') result.sort((a, b) => (b.avg_sentiment || 4) - (a.avg_sentiment || 4));
  else if (sort_by === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
  else result.sort((a, b) => b.article_count - a.article_count);

  res.json(result);
});

// Update reporter status
router.put('/status', async (req, res) => {
  const { reporter_name, workstream_id, status, notes, last_contacted } = req.body;
  if (!reporter_name || !workstream_id) return res.status(400).json({ error: 'reporter_name and workstream_id required' });

  await db.run(`INSERT INTO reporter_statuses (reporter_name, workstream_id, status, notes, last_contacted, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(reporter_name, workstream_id) DO UPDATE SET status = COALESCE(excluded.status, status), notes = COALESCE(excluded.notes, notes), last_contacted = COALESCE(excluded.last_contacted, last_contacted), updated_at = excluded.updated_at`,
    reporter_name, workstream_id, status || 'no_action', notes || '', last_contacted || null);

  res.json({ success: true });
});

// Add engagement history entry
router.post('/engagement', async (req, res) => {
  const { reporter_name, workstream_id, action, entry_notes } = req.body;
  if (!reporter_name || !workstream_id || !action) return res.status(400).json({ error: 'reporter_name, workstream_id, action required' });

  const row = await db.get('SELECT engagement_history FROM reporter_statuses WHERE reporter_name = ? AND workstream_id = ?', reporter_name, workstream_id);
  let history = [];
  try { history = JSON.parse(row?.engagement_history || '[]'); } catch {}
  history.push({ date: new Date().toISOString().split('T')[0], action, notes: entry_notes || '' });

  await db.run(`INSERT INTO reporter_statuses (reporter_name, workstream_id, engagement_history, last_contacted, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(reporter_name, workstream_id) DO UPDATE SET engagement_history = excluded.engagement_history, last_contacted = excluded.last_contacted, updated_at = excluded.updated_at`,
    reporter_name, workstream_id, JSON.stringify(history), new Date().toISOString().split('T')[0]);

  res.json({ success: true });
});

// Delete engagement history entry
router.post('/engagement/delete', async (req, res) => {
  const { reporter_name, workstream_id, index } = req.body;
  const row = await db.get('SELECT engagement_history FROM reporter_statuses WHERE reporter_name = ? AND workstream_id = ?', reporter_name, workstream_id);
  let history = [];
  try { history = JSON.parse(row?.engagement_history || '[]'); } catch {}
  history.splice(index, 1);
  await db.run('UPDATE reporter_statuses SET engagement_history = ? WHERE reporter_name = ? AND workstream_id = ?', JSON.stringify(history), reporter_name, workstream_id);
  res.json({ success: true });
});

// Aliases
router.get('/aliases', async (req, res) => {
  res.json(await db.all('SELECT * FROM reporter_aliases'));
});

router.post('/aliases', async (req, res) => {
  const { alias, canonical_name } = req.body;
  if (!alias || !canonical_name) return res.status(400).json({ error: 'alias and canonical_name required' });
  await db.run('INSERT OR REPLACE INTO reporter_aliases (alias, canonical_name) VALUES (?, ?)', normName(alias), normName(canonical_name));
  res.json({ success: true });
});

// Helpers
function normName(name) {
  return name.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function splitReporters(byline) {
  if (!byline) return [];
  return byline.split(/[;,]|\band\b/i).map(s => s.trim()).filter(s => s.length > 1);
}

function resolveAliasSync(aliasMap, name) {
  const norm = normName(name);
  return aliasMap[norm] || norm;
}

function computeTrend(reporter) {
  const sorted = reporter.articles.filter(a => a.sentiment).sort((a, b) => (b.publish_date || '').localeCompare(a.publish_date || ''));
  if (sorted.length < 3) return 'Stable';
  const recent = sorted.slice(0, 3).reduce((s, a) => s + a.sentiment, 0) / 3;
  const overall = reporter.sentiment_sum / reporter.count;
  if (recent - overall > 0.5) return 'Improving';
  if (overall - recent > 0.5) return 'Declining';
  return 'Stable';
}

export default router;
