import { Router } from 'express';
import db from '../db.js';

const router = Router();

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

// POST /api/brief-me/:workstream_id
// Body: { article_ids: [...] } or { date_from, date_to }
// Returns: { summary: "..." }
router.post('/:workstream_id', async (req, res) => {
  const wsId = req.params.workstream_id;
  const { article_ids, date_from, date_to } = req.body;

  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', wsId);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });

  let articles;
  if (article_ids?.length > 0) {
    const ph = article_ids.map(() => '?').join(',');
    articles = await db.all(`SELECT * FROM articles WHERE id IN (${ph}) AND workstream_id = ?`, ...article_ids, wsId);
  } else if (date_from) {
    let sql = `SELECT * FROM articles WHERE workstream_id = ? AND cl_status = 'classified'`;
    const params = [wsId];
    sql += ' AND publish_date >= ?'; params.push(date_from);
    if (date_to) { sql += ' AND publish_date <= ?'; params.push(date_to); }
    sql += ' ORDER BY publish_date DESC LIMIT 50';
    articles = await db.all(sql, ...params);
  } else {
    articles = await db.all(`SELECT * FROM articles WHERE workstream_id = ? AND cl_status = 'classified' ORDER BY publish_date DESC LIMIT 30`, wsId);
  }

  if (articles.length === 0) return res.status(400).json({ error: 'No articles found' });

  const summaries = articles.map((a, i) => {
    const topics = safeJson(a.cl_topics) || [];
    const extQ = safeJson(a.cl_external_quotes) || [];
    const intQ = safeJson(a.cl_internal_quotes) || [];
    const quotes = [...extQ, ...intQ].slice(0, 2).map(q => `"${q.quote}" — ${q.source}`).join('; ');
    return [
      `${i + 1}. "${a.headline}" (${a.outlet || '?'}, ${a.publish_date || '?'})`,
      `   Sentiment: ${a.cl_sentiment_score || '?'}/7. Topics: ${topics.join(', ') || 'N/A'}`,
      a.cl_key_takeaway ? `   Takeaway: ${a.cl_key_takeaway}` : '',
      quotes ? `   Quotes: ${quotes}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const outletList = [...new Set(articles.map(a => a.outlet).filter(Boolean))].join(', ');

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: [
          'You are a media intelligence analyst. Write a concise briefing summary.',
          'Cover: what happened, which outlets covered it, overall sentiment direction, any notable quotes or positions, and anything that needs immediate attention.',
          'Keep it to 2-3 short paragraphs. Professional tone. Plain text, no markdown.',
          'Do not start with "Here is" or "This is" — just start with the content.',
        ].join('\n'),
        messages: [{ role: 'user', content: `Workstream: ${ws.name} (Client: ${ws.client || 'N/A'})\nOutlets: ${outletList}\n${articles.length} articles:\n\n${summaries}` }],
      }),
    });
    const d = await apiRes.json();
    if (d.error) throw new Error(d.error.message);
    res.json({ summary: d.content?.[0]?.text || 'No summary generated.' });
  } catch (e) {
    console.error('Brief Me failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
