import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { cleanOutletName } from '../outletNorm.js';

// Lazy-load jsdom and readability to avoid ESM issues on startup
let JSDOM, Readability;
async function loadParsers() {
  if (!JSDOM) {
    const jsdom = await import('jsdom');
    JSDOM = jsdom.JSDOM;
    const readability = await import('@mozilla/readability');
    Readability = readability.Readability;
  }
}

const router = Router();

function fingerprint(headline, outlet, date) {
  const raw = `${(headline || '').toLowerCase().trim()}|${(outlet || '').toLowerCase().trim()}|${(date || '').trim()}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Try to extract article from HTML using Readability
function parseHtml(html, pageUrl) {
  const dom = new JSDOM(html, { url: pageUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent || article.textContent.trim().length < 100) return null;

  let publishDate = article.publishedTime || null;
  if (!publishDate) {
    const doc = dom.window.document;
    const dateMeta = doc.querySelector('meta[property="article:published_time"]')
      || doc.querySelector('meta[name="date"]')
      || doc.querySelector('meta[property="og:article:published_time"]')
      || doc.querySelector('time[datetime]');
    if (dateMeta) publishDate = dateMeta.getAttribute('content') || dateMeta.getAttribute('datetime');
  }
  if (publishDate) {
    try { publishDate = new Date(publishDate).toISOString().split('T')[0]; } catch {}
  }

  let outlet = article.siteName || null;
  if (!outlet) {
    try { outlet = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch {}
  }
  outlet = cleanOutletName(outlet) || outlet;

  return {
    headline: article.title || 'Untitled',
    author: article.byline || null,
    outlet,
    publish_date: publishDate,
    full_text: article.textContent.trim(),
    word_count: article.textContent.trim().split(/\s+/).length,
  };
}

// Check archive.ph for a cached version of the URL
async function tryArchive(url) {
  const archiveUrl = `https://archive.ph/newest/${url}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(archiveUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });

    if (!res.ok) return null;

    // archive.ph redirects to the cached page
    const html = await res.text();
    if (!html || html.length < 500) return null;

    // Check we actually got an archived page (not a "not found" page)
    if (html.includes('No results') || html.includes('Webpage not found')) return null;

    const result = parseHtml(html, url);
    if (result) {
      result.source = 'archive.ph';
      console.log(`Archive hit for: ${url}`);
    }
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAndExtract(url) {
  await loadParsers();

  // Step 1: Try the original URL directly
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (res.ok) {
      const html = await res.text();

      // Check for paywall
      const lower = html.toLowerCase();
      const paywallPatterns = ['subscribe to continue', 'sign in to read', 'premium content', 'subscribe for full access', 'create a free account', 'you\'ve reached your limit', 'register for free', 'become a member'];
      const hasPaywall = paywallPatterns.some(p => lower.includes(p)) && lower.indexOf('</article>') === -1;

      if (!hasPaywall) {
        const result = parseHtml(html, url);
        if (result) {
          return { ...result, url, source: 'direct' };
        }
      }
      // If paywall or extraction failed, fall through to archive
      console.log(`Direct extraction failed for ${url}, trying archive.ph...`);
    }
  } catch (e) {
    console.log(`Direct fetch failed for ${url} (${e.message}), trying archive.ph...`);
  }

  // Step 2: Try archive.ph
  const archived = await tryArchive(url);
  if (archived) {
    return { ...archived, url };
  }

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

  // Group by domain for rate limiting
  const byDomain = {};
  for (const url of urls) {
    try {
      const domain = new URL(url).hostname;
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(url);
    } catch {
      failed.push({ url, error: 'Invalid URL' });
    }
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
      // 1s delay between same-domain fetches
      if (i < domainUrls.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
  }

  res.json({ ingested, duplicates, failed });
});

export default router;
