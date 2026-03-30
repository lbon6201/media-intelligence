import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Split raw text into article blocks using delimiters
function splitBlocks(text) {
  // Strategy 1: Factiva document IDs
  if (/Document\s+[A-Za-z0-9]{10,}/g.test(text)) {
    const parts = text.split(/Document\s+[A-Za-z0-9]{10,}/);
    if (parts.length > 1) return parts.filter(p => p.trim().length > 100);
  }
  // Strategy 2: *** separators
  if (/\*{3,}/.test(text)) {
    const parts = text.split(/\*{3,}/);
    if (parts.length > 1) return parts.filter(p => p.trim().length > 100);
  }
  // Strategy 3: --- separators
  if (/^-{3,}$/m.test(text)) {
    const parts = text.split(/^-{3,}$/m);
    if (parts.length > 1) return parts.filter(p => p.trim().length > 100);
  }
  // Strategy 4: 3+ blank lines
  const blankSplit = text.split(/(?:\n\s*){3,}\n/);
  if (blankSplit.length > 1) return blankSplit.filter(p => p.trim().length > 100);
  // Single block
  return [text];
}

// Use Claude Haiku to extract metadata from a raw article block
async function extractWithClaude(rawText) {
  const trimmed = rawText.slice(0, 8000); // Keep context manageable

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
      system: `Extract article metadata from the raw text. The text may include website navigation, ads, menus, and other noise — ignore all of that and find the actual article.

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

// Find body text by locating where the extracted body_start appears
function extractBody(rawText, metadata) {
  if (!metadata.body_start) return rawText.trim();
  const bodyHint = metadata.body_start.toLowerCase();
  const lines = rawText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(bodyHint.slice(0, 30))) {
      return lines.slice(i).join('\n').trim();
    }
  }
  // Fallback: skip lines that match headline/author/outlet/date, take the rest
  const skip = new Set();
  if (metadata.headline) skip.add(metadata.headline.toLowerCase().trim());
  if (metadata.author) skip.add(metadata.author.toLowerCase().trim());
  let bodyStart = 0;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const t = lines[i].trim().toLowerCase();
    if (!t || skip.has(t) || t.length < 5) {
      bodyStart = i + 1;
      continue;
    }
    if (t.length > 60) { bodyStart = i; break; }
  }
  return lines.slice(bodyStart).join('\n').trim();
}

// POST /api/articles/parse — parse raw text into article previews using Claude
router.post('/', async (req, res) => {
  const { raw_text, workstream_id } = req.body;
  if (!raw_text || !workstream_id) return res.status(400).json({ error: 'raw_text and workstream_id required' });

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const blocks = splitBlocks(raw_text);
  const articles = [];
  const errors = [];

  for (let i = 0; i < blocks.length; i++) {
    try {
      const metadata = await extractWithClaude(blocks[i]);

      if (!metadata.headline) {
        errors.push({ index: i, error: 'No article detected' });
        continue;
      }

      const body = extractBody(blocks[i], metadata);
      if (body.length < 50) {
        errors.push({ index: i, error: 'Article body too short' });
        continue;
      }

      articles.push({
        headline: metadata.headline,
        author: metadata.author || null,
        outlet: metadata.outlet || null,
        publish_date: metadata.publish_date || null,
        full_text: body,
        word_count: body.split(/\s+/).length,
        workstream_id,
        source_type: 'paste',
      });

      // Small delay between Claude calls
      if (i < blocks.length - 1) await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      errors.push({ index: i, error: e.message });
    }
  }

  res.json({ articles, errors, total_blocks: blocks.length });
});

export default router;
