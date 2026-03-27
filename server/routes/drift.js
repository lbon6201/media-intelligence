import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Get current drift analysis
router.get('/:workstream_id', async (req, res) => {
  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', req.params.workstream_id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const taxonomy = JSON.parse(ws.taxonomy);

  // Check for target_mix in taxonomy
  const targetMix = taxonomy.target_mix || null;
  if (!targetMix) return res.json({ configured: false, message: 'Set target narrative mix in Settings' });

  // Compute actual mix from last 14 days
  const d14 = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const articles = await db.all(`SELECT cl_topics FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved') AND publish_date >= ?`, req.params.workstream_id, d14);

  const actual = {};
  let totalTags = 0;
  for (const a of articles) {
    const topics = safeJson(a.cl_topics) || [];
    for (const t of topics) { actual[t] = (actual[t] || 0) + 1; totalTags++; }
  }

  // Normalize to percentages
  const actualMix = {};
  for (const [k, v] of Object.entries(actual)) actualMix[k] = totalTags > 0 ? Math.round((v / totalTags) * 100) : 0;

  // Compute drift score (sum of absolute differences / 2)
  let driftScore = 0;
  const allTopics = new Set([...Object.keys(targetMix), ...Object.keys(actualMix)]);
  const details = [];
  for (const topic of allTopics) {
    const target = targetMix[topic] || 0;
    const actual_pct = actualMix[topic] || 0;
    const diff = actual_pct - target;
    driftScore += Math.abs(diff);
    details.push({ topic, target, actual: actual_pct, diff });
  }
  driftScore = Math.min(Math.round(driftScore / 2), 100);

  // Store snapshot
  const id = uuid();
  await db.run('INSERT INTO drift_snapshots (id, workstream_id, target_mix, actual_mix, drift_score) VALUES (?, ?, ?, ?, ?)', id, req.params.workstream_id, JSON.stringify(targetMix), JSON.stringify(actualMix), driftScore);

  // Historical drift scores
  const history = await db.all('SELECT drift_score, computed_at FROM drift_snapshots WHERE workstream_id = ? ORDER BY computed_at DESC LIMIT 30', req.params.workstream_id);

  res.json({ configured: true, drift_score: driftScore, details: details.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), history, total_articles: articles.length });
});

// Update target mix
router.put('/:workstream_id/target', async (req, res) => {
  const { target_mix } = req.body;
  if (!target_mix || typeof target_mix !== 'object') return res.status(400).json({ error: 'target_mix object required' });

  const ws = await db.get('SELECT taxonomy FROM workstreams WHERE id = ?', req.params.workstream_id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  const taxonomy = JSON.parse(ws.taxonomy);
  taxonomy.target_mix = target_mix;
  await db.run('UPDATE workstreams SET taxonomy = ? WHERE id = ?', JSON.stringify(taxonomy), req.params.workstream_id);
  res.json({ success: true });
});

// Snapshots
router.post('/:workstream_id/snapshots', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  // Capture current state
  const stats = await db.get(`SELECT COUNT(*) as total, AVG(cl_sentiment_score) as avg_sent FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);
  const topicCounts = {};
  const articles = await db.all(`SELECT cl_topics FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);
  articles.forEach(a => { (safeJson(a.cl_topics) || []).forEach(t => topicCounts[t] = (topicCounts[t] || 0) + 1); });

  const data = { total_articles: stats.total, avg_sentiment: stats.avg_sent ? +stats.avg_sent.toFixed(1) : null, topic_distribution: topicCounts };

  const id = uuid();
  await db.run('INSERT INTO snapshots (id, workstream_id, name, data) VALUES (?, ?, ?, ?)', id, req.params.workstream_id, name, JSON.stringify(data));
  res.json({ id });
});

router.get('/:workstream_id/snapshots', async (req, res) => {
  const rows = await db.all('SELECT * FROM snapshots WHERE workstream_id = ? ORDER BY created_at DESC', req.params.workstream_id);
  res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

router.delete('/:workstream_id/snapshots/:id', async (req, res) => {
  await db.run('DELETE FROM snapshots WHERE id = ?', req.params.id);
  res.json({ success: true });
});

export default router;
