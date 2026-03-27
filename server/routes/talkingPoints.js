import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

router.post('/:workstream_id/generate', async (req, res) => {
  const { workstream_id } = req.params;
  const { article_ids, topic, context, messaging_pillars } = req.body;

  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', workstream_id);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });
  const taxonomy = JSON.parse(ws.taxonomy);

  let articles = [];
  if (article_ids?.length > 0) {
    for (const id of article_ids) {
      const a = await db.get('SELECT * FROM articles WHERE id = ?', id);
      if (a) articles.push(a);
    }
  } else if (topic) {
    articles = await db.all(`SELECT * FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved') AND cl_topics LIKE ? ORDER BY publish_date DESC LIMIT 10`,
      workstream_id, `%${topic}%`);
  }

  if (articles.length === 0) return res.status(400).json({ error: 'No articles found' });

  const articleData = articles.map(a => `Headline: ${a.headline}\nOutlet: ${a.outlet}\nDate: ${a.publish_date}\nSentiment: ${a.cl_sentiment_score}/7\nKey Takeaway: ${a.cl_key_takeaway || ''}`).join('\n\n');

  const strategicCtx = (ws.strategic_context || '').trim();
  const systemPrompt = `You are a strategic communications advisor. Draft reactive talking points for a spokesperson.
${strategicCtx ? `\nCLIENT CONTEXT:\n${strategicCtx}\n\nAnchor talking points to the client's messaging pillars and strategic position as described above.\n` : ''}
Requirements:
- 4-6 talking points, each 2-3 sentences
- Lead with strongest positive framing
- Acknowledge legitimate concerns without amplifying them
- Bridge to messaging pillars where natural
- Include a specific data point or proof point where possible
- End with forward-looking statement

${messaging_pillars ? `Messaging pillars: ${taxonomy.topics.join(', ')}. Connect at least 2 talking points to specific pillars.` : ''}
${context ? `Context: ${context}` : ''}

Return ONLY valid JSON:
{
  "talking_points": [{ "point": "text", "pillar": "pillar or null", "bridges_from": "concern addressed" }],
  "do_not_say": ["phrases to avoid"],
  "anticipated_followups": [{ "question": "follow-up", "suggested_response": "guidance" }]
}`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 3000, system: systemPrompt, messages: [{ role: 'user', content: articleData }] }),
    });
    const d = await apiRes.json();
    if (d.error) throw new Error(d.error.message);
    let text = d.content?.[0]?.text || '';
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(text);

    const id = uuid();
    await db.run('INSERT INTO talking_points (id, workstream_id, topic, article_ids, result) VALUES (?, ?, ?, ?, ?)',
      id, workstream_id, topic || null, JSON.stringify(article_ids || []), JSON.stringify(result));

    res.json({ id, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
