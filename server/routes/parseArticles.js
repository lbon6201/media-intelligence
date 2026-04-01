import { Router } from 'express';
import db from '../db.js';

const router = Router();

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
      system: `Extract article metadata from the raw text. The text may include Factiva field codes (HD, BY, WC, PD, SN, etc.), website navigation, ads, menus, and other noise — ignore all of that and find the actual article.

Factiva field codes mean:
- HD = headline
- BY = byline (author)
- WC = word count
- PD = publication date
- SN = source name (outlet)
- LP = lead paragraph
- TD = text/body

Return ONLY valid JSON with these fields:
{
  "headline": "the article headline/title",
  "author": "author name(s) or null if not found",
  "outlet": "publication name or null",
  "publish_date": "YYYY-MM-DD format. Convert any date you find to this format. If only month and year, use the 1st (e.g. 2026-03-01). If no date found, return null.",
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

// Find body text
function extractBody(rawText, metadata) {
  if (!metadata.body_start) return cleanFactivaText(rawText);

  const bodyHint = metadata.body_start.toLowerCase().slice(0, 40);
  const lines = rawText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(bodyHint)) {
      return cleanFactivaText(lines.slice(i).join('\n'));
    }
  }

  // Fallback: skip metadata lines
  const skip = new Set();
  if (metadata.headline) skip.add(metadata.headline.toLowerCase().trim());
  if (metadata.author) skip.add(metadata.author.toLowerCase().trim());

  let bodyStart = 0;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const t = lines[i].trim().toLowerCase();
    if (!t || skip.has(t) || t.length < 5 || isFactivaFieldCode(t)) {
      bodyStart = i + 1;
      continue;
    }
    if (t.length > 80) { bodyStart = i; break; }
  }
  return cleanFactivaText(lines.slice(bodyStart).join('\n'));
}

// Check if a line is a Factiva field code
function isFactivaFieldCode(line) {
  const t = line.trim();
  return /^(hd|by|wc|pd|sn|sc|la|cy|lp|td|rf|co|in|ns|re|ipc|se|cr|an)$/i.test(t)
    || /^la\s+en$/i.test(t)
    || /^\d+\s*words?$/i.test(t)
    || /^document\s+/i.test(t);
}

// Clean Factiva noise from article text
function cleanFactivaText(text) {
  return text.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return true;
    if (isFactivaFieldCode(t)) return false;
    if (/^copyright\s/i.test(t) || /©/.test(t)) return false;
    if (/all\s+rights\s+reserved/i.test(t)) return false;
    if (/^page\s+\d+\s+of\s+\d+$/i.test(t)) return false;
    if (/^factiva$/i.test(t) || /^dow\s*jones/i.test(t)) return false;
    return true;
  }).join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

// POST /api/articles/parse
router.post('/', async (req, res) => {
  const { raw_text, workstream_id } = req.body;
  if (!raw_text || !workstream_id) return res.status(400).json({ error: 'raw_text and workstream_id required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const blocks = splitBlocks(raw_text);
  console.log(`Parsing: ${blocks.length} blocks from ${raw_text.length} chars`);

  const articles = [];
  const errors = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();

    // Only skip truly empty blocks
    if (block.length < 20) continue;

    try {
      const metadata = await extractWithClaude(block);

      if (!metadata.headline) {
        errors.push({ index: i, error: 'No article detected' });
        continue;
      }

      const body = extractBody(block, metadata);

      articles.push({
        headline: metadata.headline,
        author: metadata.author || null,
        outlet: metadata.outlet || null,
        publish_date: metadata.publish_date || null,
        full_text: body,
        word_count: body.split(/\s+/).length,
        workstream_id,
        source_type: 'factiva',
      });

      if (i < blocks.length - 1) await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      errors.push({ index: i, error: e.message });
    }
  }

  res.json({ articles, errors, total_blocks: blocks.length });
});

export default router;
