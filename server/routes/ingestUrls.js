import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { cleanOutletName } from '../outletNorm.js';

const router = Router();

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fingerprint(headline, outlet, date) {
  const raw = `${(headline || '').toLowerCase().trim()}|${(outlet || '').toLowerCase().trim()}|${(date || '').trim()}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

// Extract text content from HTML without jsdom — regex-based
function extractFromHtml(html, pageUrl) {
  // Extract meta tags
  const meta = (name) => {
    const m = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
      || html.match(new RegExp(`content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
    return m?.[1] || null;
  };

  const headline = meta('og:title') || meta('title') || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || null;
  const author = meta('author') || meta('article:author') || null;
  const outlet = meta('og:site_name') || null;
  let publishDate = meta('article:published_time') || meta('date') || meta('og:article:published_time') || null;
  if (publishDate) {
    try { publishDate = new Date(publishDate).toISOString().split('T')[0]; } catch {}
  }

  // Extract body text: strip HTML tags, get text content
  // First try to find article/main content
  let bodyHtml = html;
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || html.match(/<div[^>]*class="[^"]*(?:article|story|post|content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer|<aside|<nav)/i);
  if (articleMatch) bodyHtml = articleMatch[1];

  // Strip tags
  let text = bodyHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Filter out short lines (nav items, etc.)
  const lines = text.split('\n').filter(l => l.trim().length > 20);
  text = lines.join('\n').trim();

  if (text.length < 100) return null;

  return { headline, author, outlet, publish_date: publishDate, full_text: text, word_count: text.split(/\s+/).length };
}

// Check archive.ph for a cached version
async function tryArchive(url) {
  const archiveUrl = `https://archive.ph/newest/${url}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(archiveUrl, { signal: controller.signal, headers: { 'User-Agent': UA }, redirect: 'follow' });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    if (!html || html.length < 500 || html.includes('No results') || html.includes('Webpage not found')) return null;
    const result = extractFromHtml(html, url);
    if (result) console.log(`Archive hit for: ${url}`);
    return result;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

async function fetchAndExtract(url) {
  // Step 1: Try the original URL directly
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA }, redirect: 'follow' });
    clearTimeout(timeout);

    if (res.ok) {
      const html = await res.text();
      const lower = html.toLowerCase();
      const paywallPatterns = ['subscribe to continue', 'sign in to read', 'premium content', 'subscribe for full access', 'create a free account', 'you\'ve reached your limit', 'register for free', 'become a member'];
      const hasPaywall = paywallPatterns.some(p => lower.includes(p)) && !lower.includes('</article>');

      if (!hasPaywall) {
        const result = extractFromHtml(html, url);
        if (result) return { ...result, url, source: 'direct' };
      }
      console.log(`Direct extraction failed for ${url}, trying archive.ph...`);
    }
  } catch (e) {
    console.log(`Direct fetch failed for ${url} (${e.message}), trying archive.ph...`);
  }

  // Step 2: Try archive.ph
  const archived = await tryArchive(url);
  if (archived) return { ...archived, url, source: 'archive.ph' };

  // Step 3: If we got HTML but couldn't extract cleanly, try Claude
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA }, redirect: 'follow' });
    clearTimeout(timeout);
    if (res.ok) {
      const html = await res.text();
      // Strip HTML roughly and send to Claude for extraction
      let rawText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (rawText.length > 12000) rawText = rawText.slice(0, 12000);

      if (rawText.length > 200 && process.env.ANTHROPIC_API_KEY) {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 500,
            system: 'Extract article metadata from this web page text. Return JSON: {"headline":"...","author":"...or null","outlet":"...or null","publish_date":"YYYY-MM-DD or null","body_start":"first 10 words of article body"}. If no article found, return {"headline":null}.',
            messages: [{ role: 'user', content: rawText }],
          }),
        });
        const d = await apiRes.json();
        if (!d.error) {
          let text = d.content?.[0]?.text || '';
          text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          const metadata = JSON.parse(text);
          if (metadata.headline) {
            // Find body in raw text
            let body = rawText;
            if (metadata.body_start) {
              const hint = metadata.body_start.toLowerCase().slice(0, 40);
              const idx = rawText.toLowerCase().indexOf(hint);
              if (idx > -1) body = rawText.slice(idx);
            }
            return { headline: metadata.headline, author: metadata.author, outlet: metadata.outlet || cleanOutletName(new URL(url).hostname) || null, publish_date: metadata.publish_date, full_text: body.trim(), word_count: body.trim().split(/\s+/).length, url, source: 'claude' };
          }
        }
      }
    }
  } catch {}

  throw new Error('Could not extract content from URL or archive.ph');
}

router.post('/', async (req, res) => {
  const { workstream_id, urls } = req.body;
  if (!workstream_id || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'workstream_id and urls array required' });
  }

  let ingested = 0;
  let duplicates = 0;
  const failed = [];

  const byDomain = {};
  for (const url of urls) {
    try {
      const domain = new URL(url).hostname;
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(url);
    } catch { failed.push({ url, error: 'Invalid URL' }); }
  }

  for (const [domain, domainUrls] of Object.entries(byDomain)) {
    for (let i = 0; i < domainUrls.length; i++) {
      const url = domainUrls[i];
      try {
        const article = await fetchAndExtract(url);
        const fp = fingerprint(article.headline, article.outlet, article.publish_date);
        const dup = await db.get('SELECT id FROM articles WHERE fingerprint = ?', fp);
        if (dup) { duplicates++; continue; }
        await db.run(`INSERT INTO articles (id, workstream_id, source_type, headline, outlet, outlet_type, author, publish_date, url, full_text, word_count, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          uuid(), workstream_id, 'url', article.headline, article.outlet, null, article.author, article.publish_date, article.url, article.full_text, article.word_count, fp);
        ingested++;
      } catch (e) {
        failed.push({ url, error: e.name === 'AbortError' ? 'Request timed out' : e.message });
      }
      if (i < domainUrls.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }

  res.json({ ingested, duplicates, failed });
});

export default router;
