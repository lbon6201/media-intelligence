import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { CLASS_SYS, buildClassSys, buildUserMessage, classifyArticle } from '../classify.js';

const router = Router();

const progress = {};

router.post('/:workstream_id', async (req, res) => {
  const { workstream_id } = req.params;

  if (progress[workstream_id]?.running) {
    return res.status(409).json({ error: 'Classification already running for this workstream' });
  }

  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', workstream_id);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });

  const taxonomy = JSON.parse(ws.taxonomy);
  taxonomy.name = ws.name;

  const pending = await db.all('SELECT * FROM articles WHERE workstream_id = ? AND cl_status = ?', workstream_id, 'pending');

  if (pending.length === 0) return res.json({ total: 0, classified: 0, failed: 0 });

  progress[workstream_id] = { total: pending.length, done: 0, failed: 0, running: true };
  res.json({ total: pending.length, message: 'Classification started' });

  (async () => {
    for (const article of pending) {
      try {
        const userMsg = buildUserMessage(taxonomy, article);
        const raw = await classifyArticle(buildClassSys(ws), userMsg);
        const result = JSON.parse(raw);

        await db.run(`UPDATE articles SET
      cl_status = 'classified',
      cl_topics = ?,
      cl_sentiment_score = ?,
      cl_sentiment_label = ?,
      cl_sentiment_rationale = ?,
      cl_relevance_tier = ?,
      cl_geographic_tags = ?,
      cl_policy_dimensions = ?,
      cl_stakeholder_focus = ?,
      cl_key_entities = ?,
      cl_firms_mentioned = ?,
      cl_firm_sentiments = ?,
      cl_institutional_investors = ?,
      cl_institutional_investor_quotes = ?,
      cl_external_quotes = ?,
      cl_key_takeaway = ?,
      cl_rationale = ?,
      classified_at = datetime('now')
      WHERE id = ?`,
          JSON.stringify(result.topics || []),
          result.sentiment?.score || 4,
          result.sentiment?.label || 'Neutral',
          result.sentiment_rationale || '',
          result.relevance_tier || 'Medium',
          JSON.stringify(result.geographic_tags || []),
          JSON.stringify(result.policy_dimensions || []),
          JSON.stringify(result.stakeholder_focus || []),
          JSON.stringify(result.key_entities || []),
          JSON.stringify(result.firms_mentioned || []),
          JSON.stringify(result.firm_sentiments || {}),
          result.institutional_investors || '',
          JSON.stringify(result.institutional_investor_quotes || []),
          JSON.stringify(result.external_quotes || []),
          result.key_takeaway || '',
          result.rationale || '',
          article.id
        );

        // Extract quotes into quotes table
        for (const q of (result.institutional_investor_quotes || [])) {
          if (q.quote && q.source) {
            await db.run(`INSERT INTO quotes (id, article_id, workstream_id, text, type, speaker, speaker_org, speaker_type, sentiment, stance, role, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              uuid(), article.id, article.workstream_id, q.quote, 'institutional_investor', q.source, null, 'institutional_investor', null, q.stance || 'neutral', null, null);
          }
        }
        for (const q of (result.external_quotes || [])) {
          if (q.quote && q.source) {
            await db.run(`INSERT INTO quotes (id, article_id, workstream_id, text, type, speaker, speaker_org, speaker_type, sentiment, stance, role, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              uuid(), article.id, article.workstream_id, q.quote, 'external', q.source, null, q.role || 'other', null, q.stance || 'neutral', q.role || 'other', null);
          }
        }

        progress[workstream_id].done++;
      } catch (err) {
        console.error(`Classification failed for ${article.id}:`, err.message);
        await db.run('UPDATE articles SET cl_status = ? WHERE id = ?', 'pending', article.id);
        progress[workstream_id].failed++;
      }

      await new Promise(r => setTimeout(r, 500));
    }
    progress[workstream_id].running = false;
  })().catch(err => {
    console.error('Classification loop crashed:', err);
    progress[workstream_id].running = false;
  });
});

router.get('/:workstream_id/progress', (req, res) => {
  const p = progress[req.params.workstream_id];
  if (!p) return res.json({ total: 0, done: 0, failed: 0, running: false });
  res.json(p);
});

export default router;
