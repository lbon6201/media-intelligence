import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import db from '../db.js';
import { cleanOutletName } from '../outletNorm.js';

const router = Router();

function fingerprint(headline, outlet, date) {
  const raw = `${(headline || '').toLowerCase().trim()}|${(outlet || '').toLowerCase().trim()}|${(date || '').trim()}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

async function fetchAndExtract(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      redirect: 'follow',
    });

    if (res.status === 402 || res.status === 403) throw new Error('Paywall or access denied');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();

    // Detect paywall patterns
    const lower = html.toLowerCase();
    const paywallPatterns = ['subscribe to continue', 'sign in to read', 'premium content', 'subscribe for full access', 'create a free account'];
    if (paywallPatterns.some(p => lower.includes(p)) && lower.indexOf('</article>') === -1) {
      throw new Error('Paywall detected');
    }

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 100) {
      throw new Error('Could not extract content');
    }

    // Extract publish date from meta tags if Readability didn't get it
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

    // Extract outlet
    let outlet = article.siteName || null;
    if (!outlet) {
      try { outlet = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    }
    outlet = cleanOutletName(outlet) || outlet;

    return {
      headline: article.title || 'Untitled',
      author: article.byline || null,
      outlet,
      publish_date: publishDate,
      full_text: article.textContent.trim(),
      word_count: article.textContent.trim().split(/\s+/).length,
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
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
