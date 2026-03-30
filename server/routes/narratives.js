import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

router.post('/:workstream_id/generate', async (req, res) => {
  try {
    const { workstream_id } = req.params;
    const { from, to, comparison_window } = req.body;

    const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', workstream_id);
    if (!ws) return res.status(404).json({ error: 'Workstream not found' });

    // Check cache
    let cached;
    try {
      cached = await db.get('SELECT * FROM narratives WHERE workstream_id = ? AND from_date = ? AND to_date = ? AND "window" = ? ORDER BY generated_at DESC LIMIT 1',
        workstream_id, from, to, comparison_window || 'week');
    } catch (dbErr) {
      console.error('Narratives cache query failed (table may need recreation):', dbErr.message);
      // Table might not exist or have schema issues — continue without cache
      cached = null;
    }
    if (cached && !req.body.force) {
      return res.json({ ...JSON.parse(cached.result), id: cached.id, cached: true });
    }

    const articles = await db.all(`SELECT headline, outlet, author, publish_date, cl_sentiment_score, cl_topics, cl_key_entities, cl_key_takeaway, cl_firms_mentioned
      FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved') AND publish_date >= ? AND publish_date <= ? ORDER BY publish_date ASC`,
      workstream_id, from || '2000-01-01', to || '2099-12-31');

    if (articles.length === 0) return res.json({ error: 'No articles in date range' });

    // Bucket into windows
    const window = comparison_window || 'week';
    const buckets = {};
    for (const a of articles) {
      const key = window === 'month' ? (a.publish_date || '').slice(0, 7) : getISOWeek(a.publish_date);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(a);
    }

    // Build summary per bucket
    const periodSummaries = Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([period, arts]) => {
      const avgSent = arts.reduce((s, a) => s + (a.cl_sentiment_score || 4), 0) / arts.length;
      const topics = {};
      const entities = {};
      arts.forEach(a => {
        try { JSON.parse(a.cl_topics || '[]').forEach(t => topics[t] = (topics[t] || 0) + 1); } catch {}
        try { JSON.parse(a.cl_key_entities || '[]').forEach(e => entities[e] = (entities[e] || 0) + 1); } catch {}
      });
      return `Period: ${period} (${arts.length} articles, avg sentiment: ${avgSent.toFixed(1)})\nHeadlines: ${arts.map(a => `"${a.headline}" (${a.outlet})`).join('; ')}\nTop themes: ${Object.entries(topics).sort((a,b) => b[1]-a[1]).slice(0,5).map(([t,c]) => `${t}(${c})`).join(', ')}\nTop entities: ${Object.entries(entities).sort((a,b) => b[1]-a[1]).slice(0,5).map(([e,c]) => `${e}(${c})`).join(', ')}`;
    });

    const strategicCtx = (ws.strategic_context || '').trim();
    const systemPrompt = `You are a strategic communications analyst tracking media narrative evolution.
${strategicCtx ? `\nCLIENT CONTEXT:\n${strategicCtx}\n\nAssess narrative shifts relative to the client's desired positioning. Flag when coverage is moving toward or away from the client's preferred framing.\n` : ''}
Given the following media coverage data organized by time period, identify:

1. DOMINANT NARRATIVE: What is the primary story the media is telling right now? One paragraph.
2. NARRATIVE SHIFT: How has the framing changed between periods? What was the story before, and what is it now? Be specific about which outlets or reporters drove the shift.
3. EMERGING STORYLINES: What new angles, topics, or framings are appearing that weren't present in earlier periods? These may become dominant if they gain traction.
4. FADING STORYLINES: What was prominent before but is losing coverage or emphasis?
5. KEY INFLECTION POINTS: Specific articles or events that appear to have triggered a narrative change.
6. OUTLOOK: Based on current trajectory, what is the likely media narrative over the next 2-4 weeks?

Return as JSON:
{
  "dominant_narrative": "paragraph",
  "narrative_shift": "paragraph",
  "emerging_storylines": ["storyline 1", "storyline 2"],
  "fading_storylines": ["storyline 1", "storyline 2"],
  "inflection_points": [{ "date": "YYYY-MM-DD", "headline": "...", "outlet": "...", "significance": "one sentence" }],
  "outlook": "paragraph",
  "generated_at": "ISO datetime"
}
Return ONLY valid JSON. No markdown.`;

    const userMsg = `Workstream: "${ws.name}"\nDate range: ${from} to ${to}\n\n${periodSummaries.join('\n\n')}`;

    let apiRes;
    try {
      apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 3000, system: systemPrompt, messages: [{ role: 'user', content: userMsg }] }),
      });
    } catch (fetchErr) {
      console.error('Claude API fetch failed:', fetchErr.message);
      return res.status(502).json({ error: 'Failed to reach Claude API: ' + fetchErr.message });
    }

    const d = await apiRes.json();
    if (d.error) {
      console.error('Claude API error:', d.error);
      return res.status(502).json({ error: 'Claude API error: ' + (d.error.message || JSON.stringify(d.error)) });
    }

    let text = d.content?.[0]?.text || '';
    if (!text) {
      console.error('Claude API returned empty content:', JSON.stringify(d));
      return res.status(502).json({ error: 'Claude API returned empty response' });
    }

    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      console.error('Failed to parse Claude response as JSON:', text.slice(0, 500));
      return res.status(500).json({ error: 'Failed to parse narrative response as JSON' });
    }
    result.generated_at = new Date().toISOString();

    const id = uuid();
    try {
      await db.run('INSERT INTO narratives (id, workstream_id, from_date, to_date, "window", result, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, workstream_id, from, to, window, JSON.stringify(result), result.generated_at);
    } catch (insertErr) {
      console.error('Failed to save narrative to DB:', insertErr.message);
      // Still return the result even if caching fails
    }

    res.json({ ...result, id });
  } catch (e) {
    console.error('Narrative generation failed:', e);
    res.status(500).json({ error: e.message || 'Unknown error during narrative generation' });
  }
});

router.get('/:workstream_id', async (req, res) => {
  const rows = await db.all('SELECT * FROM narratives WHERE workstream_id = ? ORDER BY generated_at DESC LIMIT 10', req.params.workstream_id);
  res.json(rows.map(r => ({ ...r, result: JSON.parse(r.result) })));
});

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
  } catch { return dateStr?.slice(0, 7) || 'unknown'; }
}

export default router;
