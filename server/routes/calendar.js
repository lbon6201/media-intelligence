import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

// Get articles grouped by date for calendar
router.get('/:workstream_id', async (req, res) => {
  const articles = await db.all(`SELECT id, headline, outlet, author, publish_date, cl_sentiment_score, cl_sentiment_label, cl_topics FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved') ORDER BY publish_date DESC`, req.params.workstream_id);

  const byDate = {};
  for (const a of articles) {
    const date = a.publish_date || 'unknown';
    if (!byDate[date]) byDate[date] = { date, articles: [], count: 0, sentSum: 0, sentCount: 0 };
    byDate[date].articles.push(a);
    byDate[date].count++;
    if (a.cl_sentiment_score) { byDate[date].sentSum += a.cl_sentiment_score; byDate[date].sentCount++; }
  }

  const days = Object.values(byDate).map(d => ({
    date: d.date,
    count: d.count,
    avg_sentiment: d.sentCount > 0 ? +(d.sentSum / d.sentCount).toFixed(1) : null,
    articles: d.articles,
  }));

  res.json(days);
});

// Events CRUD
router.get('/:workstream_id/events', async (req, res) => {
  res.json(await db.all('SELECT * FROM events WHERE workstream_id = ? ORDER BY date DESC', req.params.workstream_id));
});

router.post('/:workstream_id/events', async (req, res) => {
  const { date, title, type, notes } = req.body;
  if (!date || !title) return res.status(400).json({ error: 'date and title required' });
  const id = uuid();
  await db.run('INSERT INTO events (id, workstream_id, date, title, type, notes) VALUES (?, ?, ?, ?, ?, ?)', id, req.params.workstream_id, date, title, type || null, notes || null);
  res.json({ id });
});

router.delete('/:workstream_id/events/:id', async (req, res) => {
  await db.run('DELETE FROM events WHERE id = ? AND workstream_id = ?', req.params.id, req.params.workstream_id);
  res.json({ success: true });
});

export default router;
