import { Router } from 'express';
import db from '../db.js';

const router = Router();
const parseProgress = {};

// Split raw text into article blocks — simple and reliable
function splitBlocks(text) {
  // Strategy 1: Lines starting with "Document" (Factiva doc IDs)
  if (/^Document\s/im.test(text)) {
    const parts = text.split(/^Document\s.*$/im);
    const filtered = parts.filter(p => p.trim().length > 20);
    if (filtered.length > 1) {
      console.log(`Split on Document IDs: ${filtered.length} blocks`);
      return filtered;
    }
  }
  // Strategy 2: *** separators
  if (/\*{3,}/.test(text)) {
    const parts = text.split(/\*{3,}/);
    const filtered = parts.filter(p => p.trim().length > 20);
    if (filtered.length > 1) {
      console.log(`Split on ***: ${filtered.length} blocks`);
      return filtered;
    }
  }
  // Strategy 3: --- separators on own line
  if (/^\s*-{3,}\s*$/m.test(text)) {
    const parts = text.split(/^\s*-{3,}\s*$/m);
    const filtered = parts.filter(p => p.trim().length > 20);
    if (filtered.length > 1) {
      console.log(`Split on ---: ${filtered.length} blocks`);
      return filtered;
    }
  }
  // Single block
  console.log('No delimiter found, treating as single block');
  return [text];
}

// Use Claude Haiku to extract metadata from a raw article block
async function extractWithClaude(rawText) {
  const trimmed = rawText.slice(0, 8000);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: `Extract article metadata from the raw text. The text may include Factiva field codes, website noise, or other metadata — ignore all of that and find the actual article.

Return ONLY valid JSON:
{
  "headline": "the article headline/title",
  "author": "author name(s) or null if not found",
  "outlet": "publication name or null",
  "publish_date": "YYYY-MM-DD format. Convert any date to this format. If no date found, return null.",
  "body_start": "first 10 words of the actual article body (not headline, not metadata)"
}

If the text doesn't contain an article, return {"headline": null}.
No markdown, no explanation, just JSON.`,
      messages: [{ role: 'user', content: trimmed }],
    }),
  });

  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  let text = d.content?.[0]?.text || '';
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(text);
}

function extractBody(rawText, metadata) {
  if (metadata.body_start) {
    const bodyHint = metadata.body_start.toLowerCase().slice(0, 40);
    const lines = rawText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(bodyHint)) {
        return lines.slice(i).join('\n').trim();
      }
    }
  }
  // Fallback: return most of the text, skipping first few metadata-like lines
  const lines = rawText.split('\n');
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const t = lines[i].trim();
    if (t.length > 80) { start = i; break; }
    start = i + 1;
  }
  return lines.slice(start).join('\n').trim() || rawText.trim();
}

// POST /api/articles/parse — start parsing, return immediately with job ID
router.post('/', async (req, res) => {
  const { raw_text, workstream_id } = req.body;
  if (!raw_text || !workstream_id) return res.status(400).json({ error: 'raw_text and workstream_id required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const blocks = splitBlocks(raw_text);
  const jobId = workstream_id;

  // If only a few blocks, process synchronously (fast enough)
  if (blocks.length <= 5) {
    const articles = [];
    const errors = [];
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].trim().length < 20) continue;
      try {
        const metadata = await extractWithClaude(blocks[i]);
        if (!metadata.headline) { errors.push({ index: i, error: 'No article detected' }); continue; }
        const body = extractBody(blocks[i], metadata);
        articles.push({ headline: metadata.headline, author: metadata.author, outlet: metadata.outlet, publish_date: metadata.publish_date, full_text: body, word_count: body.split(/\s+/).length, workstream_id, source_type: 'paste' });
        if (i < blocks.length - 1) await new Promise(r => setTimeout(r, 300));
      } catch (e) { errors.push({ index: i, error: e.message }); }
    }
    return res.json({ articles, errors, total_blocks: blocks.length });
  }

  // Many blocks: process in background with progress polling
  parseProgress[jobId] = { total: blocks.length, done: 0, articles: [], errors: [], running: true };
  res.json({ async: true, total_blocks: blocks.length, job_id: jobId });

  (async () => {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].trim().length < 20) { parseProgress[jobId].done++; continue; }
      try {
        const metadata = await extractWithClaude(blocks[i]);
        if (!metadata.headline) {
          parseProgress[jobId].errors.push({ index: i, error: 'No article detected' });
        } else {
          const body = extractBody(blocks[i], metadata);
          parseProgress[jobId].articles.push({ headline: metadata.headline, author: metadata.author, outlet: metadata.outlet, publish_date: metadata.publish_date, full_text: body, word_count: body.split(/\s+/).length, workstream_id, source_type: 'paste' });
        }
      } catch (e) {
        parseProgress[jobId].errors.push({ index: i, error: e.message });
      }
      parseProgress[jobId].done++;
      await new Promise(r => setTimeout(r, 300));
    }
    parseProgress[jobId].running = false;
  })().catch(err => {
    console.error('Parse job crashed:', err);
    parseProgress[jobId].running = false;
  });
});

// GET /api/articles/parse/progress — poll for results
router.get('/progress', (req, res) => {
  const { job_id } = req.query;
  const p = parseProgress[job_id];
  if (!p) return res.json({ running: false, total: 0, done: 0, articles: [], errors: [] });
  res.json(p);
});

export default router;
