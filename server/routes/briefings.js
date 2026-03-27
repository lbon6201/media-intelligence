import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

router.post('/:workstream_id/generate', async (req, res) => {
  const { workstream_id } = req.params;
  const { from, to, include_sections, max_articles_referenced, tone } = req.body;

  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', workstream_id);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });

  const articles = await db.all(`SELECT * FROM articles WHERE workstream_id = ? AND cl_status = 'approved' AND publish_date >= ? AND publish_date <= ? ORDER BY publish_date DESC`,
    workstream_id, from || '2000-01-01', to || '2099-12-31');

  if (articles.length === 0) return res.status(400).json({ error: 'No approved articles in date range' });

  const maxRef = max_articles_referenced || 20;
  const selected = articles.slice(0, maxRef);

  const sections = include_sections || ['summary', 'top_stories', 'sentiment_shift', 'key_quotes', 'emerging_risks', 'recommended_actions'];
  const toneVal = tone || 'executive';

  const articleData = selected.map(a => {
    const topics = safeJson(a.cl_topics);
    const extQuotes = safeJson(a.cl_external_quotes);
    return `Headline: ${a.headline}\nOutlet: ${a.outlet}\nDate: ${a.publish_date}\nSentiment: ${a.cl_sentiment_score}/7 (${a.cl_sentiment_label})\nTopics: ${topics?.join(', ')}\nKey Takeaway: ${a.cl_key_takeaway || ''}\nQuotes: ${extQuotes?.map(q => `${q.source}: "${q.quote}" (${q.stance})`).join('; ') || 'none'}`;
  }).join('\n\n---\n\n');

  const strategicCtx = (ws.strategic_context || '').trim();
  const systemPrompt = `You are a senior strategic communications advisor preparing a media intelligence briefing. Write a professional, actionable briefing.
${strategicCtx ? `\nCLIENT CONTEXT:\n${strategicCtx}\n\nFrame the briefing with awareness of the client's strategic position. Recommended actions should align with their communications goals.\n` : ''}
Sections to include: ${sections.join(', ')}

EXECUTIVE SUMMARY: 3-4 sentences. Lead with the most important development. State sentiment trajectory. Flag urgent items.
TOP STORIES: 3-5 most significant articles. One-sentence summary + strategic significance + outlet/date.
SENTIMENT SHIFT: Tone change vs prior period. Which entities moved most. What's driving it. Use numbers.
KEY QUOTES: 3-5 most strategically significant external quotes. Speaker, affiliation, why it matters.
EMERGING RISKS: Coverage patterns that could become problems — new reporters, negative frames, regulatory signals.
RECOMMENDED ACTIONS: 2-4 specific, actionable recommendations. What to do this week, who to engage, what messaging to emphasize.

Tone: ${toneVal === 'executive' ? 'concise, bullet-heavy, action-oriented' : 'fuller paragraphs, more context'}

Return ONLY valid JSON with section keys: summary, top_stories, sentiment_shift, key_quotes, emerging_risks, recommended_actions. Each value is a string.`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, system: systemPrompt, messages: [{ role: 'user', content: `Workstream: ${ws.name}\nDate range: ${from} to ${to}\nTotal articles: ${articles.length}\n\n${articleData}` }] }),
    });
    const d = await apiRes.json();
    if (d.error) throw new Error(d.error.message);
    let text = d.content?.[0]?.text || '';
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(text);

    const id = uuid();
    await db.run('INSERT INTO briefings (id, workstream_id, from_date, to_date, sections, tone) VALUES (?, ?, ?, ?, ?, ?)',
      id, workstream_id, from, to, JSON.stringify(result), toneVal);

    res.json({ id, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:workstream_id', async (req, res) => {
  const rows = await db.all('SELECT * FROM briefings WHERE workstream_id = ? ORDER BY generated_at DESC LIMIT 10', req.params.workstream_id);
  res.json(rows.map(r => ({ ...r, sections: JSON.parse(r.sections) })));
});

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

export default router;
