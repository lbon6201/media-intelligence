import { Router } from 'express';
import db from '../db.js';

const router = Router();
const parseProgress = {};

// Pre-clean: remove Factiva page headers/footers
function preClean(text) {
  return text
    .replace(/^Page\s+\d+\s+of\s+\d+\s*©.*$/gim, '')
    .replace(/^©\s*\d{4}\s*Factiva.*$/gim, '')
    .replace(/^Factiva,?\s*Inc\.?\s*All rights reserved\.?\s*$/gim, '')
    .replace(/\r\n/g, '\n');
}

// Split raw text into article blocks
function splitBlocks(rawText) {
  const text = preClean(rawText);
  const docIdMatches = text.match(/^Document\s+\S+/gim);
  console.log(`Found ${docIdMatches?.length || 0} Document ID lines`);

  if (docIdMatches && docIdMatches.length > 0) {
    const parts = text.split(/^Document\s+\S+.*$/gim);
    const filtered = parts.filter(p => p.trim().length > 20);
    if (filtered.length > 1) {
      console.log(`Split on Document IDs: ${filtered.length} blocks`);
      return filtered;
    }
  }
  if (/\*{3,}/.test(text)) {
    const parts = text.split(/\*{3,}/);
    const filtered = parts.filter(p => p.trim().length > 20);
    if (filtered.length > 1) {
      console.log(`Split on ***: ${filtered.length} blocks`);
      return filtered;
    }
  }
  console.log('No delimiter found, treating as single block');
  return [text];
}

// Extract metadata for a BATCH of articles in one Claude call
async function extractBatchWithClaude(blocks) {
  // Send first ~1200 chars of each block — enough for metadata, saves tokens
  const numbered = blocks.map((b, i) => `=== ARTICLE ${i + 1} ===\n${b.trim().slice(0, 1200)}`).join('\n\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: `You will receive ${blocks.length} article text blocks separated by "=== ARTICLE N ===" headers. For each one, extract the metadata.

The text may include Factiva field codes (HD=headline, BY=byline, WC=word count, PD=date, SN=source), website noise, or other metadata — ignore noise and find each article.

Return ONLY a valid JSON array with one object per article, in order:
[
  {
    "headline": "the article headline/title",
    "author": "author name(s) or null",
    "outlet": "publication name or null",
    "publish_date": "YYYY-MM-DD format or null",
    "body_start": "first 10 words of the article body"
  }
]

If a block doesn't contain an article, return {"headline": null} for that entry.
Return ONLY the JSON array. No markdown, no explanation.`,
      messages: [{ role: 'user', content: numbered }],
    }),
  });

  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  let text = d.content?.[0]?.text || '';
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(text);
}

// Extract body text from a block given metadata
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
  const lines = rawText.split('\n');
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const t = lines[i].trim();
    if (t.length > 80) { start = i; break; }
    start = i + 1;
  }
  return lines.slice(start).join('\n').trim() || rawText.trim();
}

// Process a batch of blocks: extract metadata then build articles
async function processBatch(blocks, workstreamId) {
  const articles = [];
  const errors = [];

  try {
    const metadataArray = await extractBatchWithClaude(blocks);

    for (let i = 0; i < blocks.length; i++) {
      const metadata = metadataArray[i];
      if (!metadata || !metadata.headline) {
        errors.push({ index: i, error: 'No article detected' });
        continue;
      }
      const body = extractBody(blocks[i], metadata);
      articles.push({
        headline: metadata.headline,
        author: metadata.author || null,
        outlet: metadata.outlet || null,
        publish_date: metadata.publish_date || null,
        full_text: body,
        word_count: body.split(/\s+/).length,
        workstream_id: workstreamId,
        source_type: 'paste',
      });
    }
  } catch (e) {
    // If batch fails, try individually as fallback
    console.error('Batch extraction failed, falling back to individual:', e.message);
    for (const block of blocks) {
      try {
        const result = await extractBatchWithClaude([block]);
        const metadata = result[0];
        if (!metadata?.headline) { errors.push({ error: 'No article detected' }); continue; }
        const body = extractBody(block, metadata);
        articles.push({ headline: metadata.headline, author: metadata.author, outlet: metadata.outlet, publish_date: metadata.publish_date, full_text: body, word_count: body.split(/\s+/).length, workstream_id: workstreamId, source_type: 'paste' });
      } catch (e2) { errors.push({ error: e2.message }); }
    }
  }

  return { articles, errors };
}

// POST /api/articles/parse/debug
router.post('/debug', async (req, res) => {
  const { raw_text } = req.body;
  if (!raw_text) return res.status(400).json({ error: 'raw_text required' });
  const blocks = splitBlocks(raw_text);
  res.json({
    input_length: raw_text.length,
    total_blocks: blocks.length,
    block_samples: blocks.slice(0, 5).map((b, i) => ({ index: i, length: b.trim().length, first_200: b.trim().slice(0, 200) })),
  });
});

// POST /api/articles/parse — batch + parallel processing
router.post('/', async (req, res) => {
  const { raw_text, workstream_id } = req.body;
  if (!raw_text || !workstream_id) return res.status(400).json({ error: 'raw_text and workstream_id required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const allBlocks = splitBlocks(raw_text).filter(b => b.trim().length > 20);
  console.log(`Parsing: ${allBlocks.length} blocks from ${raw_text.length} chars`);

  const BATCH_SIZE = 5;
  const PARALLEL = 3;
  const jobId = workstream_id;

  // Small number: process synchronously
  if (allBlocks.length <= BATCH_SIZE) {
    const result = await processBatch(allBlocks, workstream_id);
    return res.json({ articles: result.articles, errors: result.errors, total_blocks: allBlocks.length });
  }

  // Large number: process in background with batching + parallelism
  parseProgress[jobId] = { total: allBlocks.length, done: 0, articles: [], errors: [], running: true };
  res.json({ async: true, total_blocks: allBlocks.length, job_id: jobId });

  (async () => {
    // Split into batches
    const batches = [];
    for (let i = 0; i < allBlocks.length; i += BATCH_SIZE) {
      batches.push(allBlocks.slice(i, i + BATCH_SIZE));
    }

    // Process batches in parallel groups
    for (let i = 0; i < batches.length; i += PARALLEL) {
      const group = batches.slice(i, i + PARALLEL);
      const results = await Promise.all(group.map(batch => processBatch(batch, workstream_id)));

      for (const result of results) {
        parseProgress[jobId].articles.push(...result.articles);
        parseProgress[jobId].errors.push(...result.errors);
      }
      parseProgress[jobId].done += group.reduce((sum, batch) => sum + batch.length, 0);
    }

    parseProgress[jobId].running = false;
    console.log(`Parse complete: ${parseProgress[jobId].articles.length} articles from ${allBlocks.length} blocks`);
  })().catch(err => {
    console.error('Parse job crashed:', err);
    parseProgress[jobId].running = false;
  });
});

// GET /api/articles/parse/progress
router.get('/progress', (req, res) => {
  const { job_id } = req.query;
  const p = parseProgress[job_id];
  if (!p) return res.json({ running: false, total: 0, done: 0, articles: [], errors: [] });
  res.json(p);
});

export default router;
