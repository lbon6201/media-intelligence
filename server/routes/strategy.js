import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

async function assembleContext(wsId) {
  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', wsId);
  if (!ws) return null;
  const taxonomy = JSON.parse(ws.taxonomy);

  // Summary stats
  const stats = await db.get(`SELECT COUNT(*) as total, AVG(cl_sentiment_score) as avg_sent FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, wsId);

  // Recent articles (metadata only, no full_text)
  const recent = await db.all(`SELECT id, headline, outlet, author, publish_date, cl_sentiment_score, cl_sentiment_label, cl_topics, cl_key_entities, cl_firms_mentioned, cl_key_takeaway, cl_rationale FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved') ORDER BY publish_date DESC LIMIT 30`, wsId);

  // Top reporters
  const reporterMap = {};
  const articles = await db.all(`SELECT author, outlet, cl_sentiment_score, cl_topics FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved') AND author IS NOT NULL`, wsId);
  for (const a of articles) {
    const name = a.author;
    if (!reporterMap[name]) reporterMap[name] = { name, outlets: new Set(), count: 0, sentSum: 0, topics: {} };
    reporterMap[name].count++;
    if (a.outlet) reporterMap[name].outlets.add(a.outlet);
    if (a.cl_sentiment_score) reporterMap[name].sentSum += a.cl_sentiment_score;
    (safeJson(a.cl_topics) || []).forEach(t => reporterMap[name].topics[t] = (reporterMap[name].topics[t] || 0) + 1);
  }
  const topReporters = Object.values(reporterMap).sort((a, b) => b.count - a.count).slice(0, 15).map(r => ({
    name: r.name, outlets: [...r.outlets], articles: r.count,
    avg_sentiment: r.count > 0 ? +(r.sentSum / r.count).toFixed(1) : null,
    top_topics: Object.entries(r.topics).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t),
  }));

  // Coverage gaps
  const gapData = computeGaps(wsId, taxonomy.topics, articles);

  // Last narrative
  const narrative = await db.get('SELECT result FROM narratives WHERE workstream_id = ? ORDER BY generated_at DESC LIMIT 1', wsId);

  // Watchlist
  const watchlist = await db.all('SELECT name, affiliation, role FROM watchlist_speakers WHERE workstream_id = ?', wsId);

  const strategicCtx = (ws.strategic_context || '').trim();
  const lines = [
    `Workstream: "${ws.name}" (Client: ${ws.client})`,
    ...(strategicCtx ? ['', 'STRATEGIC CONTEXT:', strategicCtx, ''] : []),
    `Total articles: ${stats.total}, Avg sentiment: ${stats.avg_sent ? stats.avg_sent.toFixed(1) : 'N/A'}/7`,
    `Taxonomy topics: ${taxonomy.topics.join(', ')}`,
    `Stakeholders: ${(taxonomy.stakeholder_tags || []).join(', ')}`,
    '',
    'RECENT ARTICLES (most recent first, metadata shown — full article text is available on request by referencing headline or outlet):',
    ...recent.map(a => `- [${a.publish_date || '?'}] "${a.headline}" (${a.outlet || '?'}) Sentiment: ${a.cl_sentiment_score || '?'}/7 Topics: ${safeJson(a.cl_topics)?.join(', ') || '?'} Entities: ${safeJson(a.cl_key_entities)?.join(', ') || '?'} Takeaway: ${a.cl_key_takeaway || ''}`),
    '',
    'TOP REPORTERS:',
    ...topReporters.map(r => `- ${r.name} (${r.outlets.join(', ')}) — ${r.articles} articles, avg sentiment ${r.avg_sentiment}, beats: ${r.top_topics.join(', ')}`),
  ];

  if (gapData.length > 0) {
    lines.push('', 'COVERAGE GAPS:', ...gapData.map(g => `- ${g.topic}: ${g.status} (${g.last_7d} in 7d, ${g.last_30d} in 30d)`));
  }

  if (narrative) {
    const n = safeJson(narrative.result);
    if (n) lines.push('', 'LATEST NARRATIVE ANALYSIS:', `Dominant: ${n.dominant_narrative}`, `Shift: ${n.narrative_shift}`, `Outlook: ${n.outlook}`);
  }

  if (watchlist.length > 0) {
    lines.push('', 'SPEAKER WATCHLIST:', ...watchlist.map(w => `- ${w.name} (${w.affiliation || '?'}, ${w.role || '?'})`));
  }

  return { ws, taxonomy, context: lines.join('\n') };
}

function computeGaps(wsId, topics, articles) {
  const now = new Date();
  const d7 = new Date(now - 7 * 86400000).toISOString().split('T')[0];
  const d30 = new Date(now - 30 * 86400000).toISOString().split('T')[0];
  const gaps = [];
  for (const topic of (topics || [])) {
    let last7 = 0, last30 = 0;
    for (const a of articles) {
      const ts = safeJson(a.cl_topics) || [];
      if (!ts.includes(topic)) continue;
      if (a.publish_date >= d30) last30++;
      if (a.publish_date >= d7) last7++;
    }
    if (last30 === 0 && articles.length > 10) continue; // never covered
    const avg = last30 / 4.3;
    if (last7 === 0 && last30 > 2) gaps.push({ topic, last_7d: last7, last_30d: last30, status: 'silent' });
    else if (avg > 0 && last7 < avg * 0.5) gaps.push({ topic, last_7d: last7, last_30d: last30, status: 'declining' });
  }
  return gaps;
}

// Detect if user query references specific articles and pull full text
async function detectSpecificArticles(wsId, userMsg) {
  const fullTextArticles = [];
  const lower = userMsg.toLowerCase();

  // Trigger words that indicate user wants full text or specific article details
  const wantsFullText = /full\s*text|full\s*article|read\s*(the|this)?\s*article|show\s*me\s*(the|this)?\s*article|entire\s*article|original\s*text|what\s*(does|did)\s*(the|this)|give\s*me\s*(the|this)/i.test(userMsg);

  // Quoted headline fragments
  const quoteMatches = userMsg.match(/"([^"]+)"/g);
  if (quoteMatches) {
    for (const q of quoteMatches) {
      const fragment = q.replace(/"/g, '');
      const matches = await db.all(`SELECT id, headline, full_text FROM articles WHERE workstream_id = ? AND headline LIKE ? LIMIT 3`, wsId, `%${fragment}%`);
      fullTextArticles.push(...matches);
    }
  }

  // "the [outlet] article" or "[outlet] article" patterns
  const outletMatch = userMsg.match(/(?:the\s+)?(\w[\w\s]*?)\s+article/i);
  if (outletMatch) {
    const matches = await db.all(`SELECT id, headline, full_text FROM articles WHERE workstream_id = ? AND outlet LIKE ? ORDER BY publish_date DESC LIMIT 3`, wsId, `%${outletMatch[1].trim()}%`);
    fullTextArticles.push(...matches);
  }

  // "what did [reporter] write/say/report" patterns
  const reporterMatch = userMsg.match(/what\s+(?:did|does|has)\s+(\w[\w\s]*?)\s+(?:write|wrote|say|said|report|cover)/i);
  if (reporterMatch) {
    const matches = await db.all(`SELECT id, headline, full_text FROM articles WHERE workstream_id = ? AND author LIKE ? ORDER BY publish_date DESC LIMIT 5`, wsId, `%${reporterMatch[1].trim()}%`);
    fullTextArticles.push(...matches);
  }

  // Keyword search: extract significant words from the query and match against headlines
  if (fullTextArticles.length === 0) {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by', 'from', 'about', 'into', 'through', 'and', 'or', 'but', 'not', 'no', 'this', 'that', 'these', 'those', 'it', 'its', 'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very', 'just', 'also', 'me', 'my', 'full', 'text', 'article', 'show', 'give', 'read', 'tell', 'find', 'get', 'see', 'look']);
    const keywords = lower.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    // Try matching keywords against headlines
    for (const kw of keywords) {
      if (fullTextArticles.length >= 5) break;
      const matches = await db.all(`SELECT id, headline, full_text FROM articles WHERE workstream_id = ? AND headline LIKE ? ORDER BY publish_date DESC LIMIT 2`, wsId, `%${kw}%`);
      fullTextArticles.push(...matches);
    }
  }

  // If user explicitly wants full text and we still have nothing, grab most recent articles
  if (wantsFullText && fullTextArticles.length === 0) {
    const recent = await db.all(`SELECT id, headline, full_text FROM articles WHERE workstream_id = ? ORDER BY publish_date DESC LIMIT 3`, wsId);
    fullTextArticles.push(...recent);
  }

  // Deduplicate by id
  const seen = new Set();
  return fullTextArticles.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; }).slice(0, 5);
}

// Chat endpoint with streaming
router.post('/:workstream_id/chat', async (req, res) => {
  const { workstream_id } = req.params;
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const ctx = await assembleContext(workstream_id);
  if (!ctx) return res.status(404).json({ error: 'Workstream not found' });

  // Save user message
  const userMsgId = uuid();
  await db.run('INSERT INTO strategy_messages (id, workstream_id, role, content) VALUES (?, ?, ?, ?)', userMsgId, workstream_id, 'user', message);

  // Check for specific article references → pull full text
  const specificArticles = await detectSpecificArticles(workstream_id, message);
  let extraContext = '';
  if (specificArticles.length > 0) {
    extraContext = '\n\nFULL TEXT OF REFERENCED ARTICLES:\n' + specificArticles.map(a => `--- ${a.headline} ---\n${(a.full_text || '').slice(0, 6000)}`).join('\n\n');
  }

  const systemPrompt = `You are a senior strategic communications advisor with deep expertise in media intelligence. You have access to the full media monitoring dataset for the "${ctx.ws.name}" workstream (${ctx.ws.client}).

CURRENT DATA SNAPSHOT:
${ctx.context}${extraContext}

Use this data to answer the user's questions with specificity. Reference actual articles, reporters, dates, and sentiment scores. Do not speculate beyond what the data shows — if the data doesn't support a conclusion, say so.

IMPORTANT: Full article text is stored and available for any article. When the user references a specific article by headline, outlet, or reporter name, the full text will be automatically retrieved and included. You can ask the user to specify which article they want to read in full if needed.

When recommending actions, anchor them to the workstream's messaging taxonomy: ${ctx.taxonomy.topics.join(', ')}.

You can:
- Analyze coverage patterns and explain what's driving them
- Identify strategic opportunities and risks
- Draft messaging, talking points, pitch angles, and narrative frames
- Compare entities, reporters, and outlets
- Predict likely coverage trajectories based on current patterns
- Recommend specific reporters to engage and why
- Draft responses to specific articles
- Identify gaps in coverage or messaging

Be direct, analytical, and actionable. No filler. Lead with the insight.`;

  // Get recent conversation history
  const history = (await db.all('SELECT role, content FROM strategy_messages WHERE workstream_id = ? ORDER BY created_at DESC LIMIT 20', workstream_id)).reverse();

  // Stream response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        stream: true,
        system: systemPrompt,
        messages: history.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    let fullResponse = '';

    for await (const chunk of apiRes.body) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullResponse += parsed.delta.text;
              res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
            }
          } catch {}
        }
      }
    }

    // Save assistant response
    const assistMsgId = uuid();
    await db.run('INSERT INTO strategy_messages (id, workstream_id, role, content) VALUES (?, ?, ?, ?)', assistMsgId, workstream_id, 'assistant', fullResponse);

    res.write(`data: ${JSON.stringify({ done: true, message_id: assistMsgId })}\n\n`);
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// Get message history
router.get('/:workstream_id/messages', async (req, res) => {
  const messages = await db.all('SELECT * FROM strategy_messages WHERE workstream_id = ? ORDER BY created_at ASC', req.params.workstream_id);
  res.json(messages);
});

// Clear history
router.delete('/:workstream_id/messages', async (req, res) => {
  await db.run('DELETE FROM strategy_messages WHERE workstream_id = ?', req.params.workstream_id);
  res.json({ success: true });
});

// Save insight
router.post('/:workstream_id/insights', async (req, res) => {
  const { content, source_message_id } = req.body;
  const id = uuid();
  await db.run('INSERT INTO insights (id, workstream_id, content, source_message_id) VALUES (?, ?, ?, ?)', id, req.params.workstream_id, content, source_message_id || null);
  res.json({ id });
});

// List insights
router.get('/:workstream_id/insights', async (req, res) => {
  res.json(await db.all('SELECT * FROM insights WHERE workstream_id = ? ORDER BY created_at DESC', req.params.workstream_id));
});

// Delete insight
router.delete('/:workstream_id/insights/:id', async (req, res) => {
  await db.run('DELETE FROM insights WHERE id = ? AND workstream_id = ?', req.params.id, req.params.workstream_id);
  res.json({ success: true });
});

export default router;
