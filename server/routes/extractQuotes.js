import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { buildContextBlock } from '../strategicContext.js';

const router = Router();

const progress = {};

// Normalize stance
function normStance(s) {
  const l = (s || '').toLowerCase();
  if (l === 'bullish' || l === 'supportive' || l === 'positive') return 'positive';
  if (l === 'bearish' || l === 'negative') return 'negative';
  return 'neutral';
}

// Dedicated quote extraction prompt — focused solely on finding relevant quotes
function buildQuotePrompt(ws) {
  const ctx = buildContextBlock(ws, 'WORKSTREAM CONTEXT');
  return `You are a media intelligence analyst extracting third-party quotes from articles.
${ctx}
Your ONLY job is to find quotes that are DIRECTLY and SPECIFICALLY about the workstream topic described above. Apply extreme selectivity — it is far better to return zero quotes than to include an irrelevant one.

For each quote found, classify the speaker into one of these categories:
EXTERNAL roles: regulator | legislator | academic | rating_agency | legal_expert | former_official | journalist | analyst | investor_advocate | institutional_investor | other
INTERNAL roles: fund_executive | portfolio_manager | spokesperson | trade_association

RELEVANCE TEST — ask yourself for each potential quote:
1. Is this person specifically talking about the workstream topic (e.g. private credit, direct lending, private debt)?
2. Would removing this quote change the reader's understanding of the workstream topic?
3. Is this a substantive view/opinion/analysis, not just a passing mention?
If ANY answer is NO, exclude the quote.

EXCLUDE:
- General economic or market commentary
- Quotes about other industries/topics that happen to appear in the same article
- Boilerplate, disclaimers, forward-looking statements
- Quotes where the workstream topic is mentioned only in passing
- Article author's own analysis (that's not a quote)

Return ONLY valid JSON:
{
  "quotes": [
    {
      "text": "exact or closely paraphrased quote text",
      "source": "Speaker full name",
      "role": "one of the roles listed above",
      "type": "external or internal",
      "stance": "positive or neutral or negative",
      "relevance_reason": "one sentence explaining why this quote is relevant to the workstream topic"
    }
  ]
}

If no relevant quotes exist, return: {"quotes": []}
No markdown, no preamble, just JSON.`;
}

// POST /api/extract-quotes/:workstream_id — run dedicated quote extraction on classified articles
router.post('/:workstream_id', async (req, res) => {
  const { workstream_id } = req.params;

  if (progress[workstream_id]?.running) {
    return res.status(409).json({ error: 'Quote extraction already running' });
  }

  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', workstream_id);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });

  // Get classified articles that haven't had dedicated quote extraction
  const articles = await db.all(
    `SELECT id, headline, outlet, author, publish_date, full_text FROM articles WHERE workstream_id = ? AND cl_status IN ('classified', 'approved')`,
    workstream_id
  );

  if (articles.length === 0) return res.json({ total: 0, extracted: 0 });

  progress[workstream_id] = { total: articles.length, done: 0, quotes_found: 0, running: true };
  res.json({ total: articles.length, message: 'Quote extraction started' });

  const systemPrompt = buildQuotePrompt(ws);

  (async () => {
    for (const article of articles) {
      try {
        const userMsg = [
          `Headline: ${article.headline}`,
          `Outlet: ${article.outlet || 'Unknown'}`,
          `Date: ${article.publish_date || 'Unknown'}`,
          `Author: ${article.author || 'Unknown'}`,
          '',
          article.full_text.slice(0, 6000),
        ].join('\n');

        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, system: systemPrompt, messages: [{ role: 'user', content: userMsg }] }),
        });

        const d = await apiRes.json();
        if (d.error) throw new Error(d.error.message);
        let text = d.content?.[0]?.text || '';
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const result = JSON.parse(text);

        // Delete old quotes for this article and insert new ones
        await db.run('DELETE FROM quotes WHERE article_id = ?', article.id);

        for (const q of (result.quotes || [])) {
          if (!q.text || !q.source) continue;
          await db.run(
            `INSERT INTO quotes (id, article_id, workstream_id, text, type, speaker, speaker_org, speaker_type, sentiment, stance, role, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            uuid(), article.id, workstream_id, q.text, q.type || 'external', q.source, null, q.role || 'other', null, normStance(q.stance), q.role || 'other', q.relevance_reason || null
          );
          progress[workstream_id].quotes_found++;
        }

        // Update the article's quote JSON fields too
        await db.run(
          'UPDATE articles SET cl_external_quotes = ?, cl_internal_quotes = ?, cl_institutional_investor_quotes = ? WHERE id = ?',
          JSON.stringify(result.quotes?.filter(q => q.type === 'external') || []),
          JSON.stringify(result.quotes?.filter(q => q.type === 'internal') || []),
          JSON.stringify(result.quotes?.filter(q => q.role === 'institutional_investor') || []),
          article.id
        );

        progress[workstream_id].done++;
      } catch (err) {
        console.error(`Quote extraction failed for ${article.id}:`, err.message);
        progress[workstream_id].done++;
      }

      await new Promise(r => setTimeout(r, 500));
    }
    progress[workstream_id].running = false;
  })().catch(err => {
    console.error('Quote extraction loop crashed:', err);
    progress[workstream_id].running = false;
  });
});

// Progress polling
router.get('/:workstream_id/progress', (req, res) => {
  const p = progress[req.params.workstream_id];
  if (!p) return res.json({ total: 0, done: 0, quotes_found: 0, running: false });
  res.json(p);
});

export default router;
