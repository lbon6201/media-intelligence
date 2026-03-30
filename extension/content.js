// Content script: extracts article data from the current page
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'extract') return;

  try {
    const data = extractArticle();
    sendResponse({ success: true, data });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
  return true;
});

function extractArticle() {
  const meta = (name) => {
    const el = document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
    return el?.getAttribute('content') || null;
  };

  // Headline
  const headline = document.querySelector('h1')?.textContent?.trim()
    || meta('og:title')
    || document.title;

  // Author — try clean sources first, then parse from byline
  let author = meta('author')
    || meta('article:author');

  if (!author) {
    // Try dedicated author elements (not byline containers which mix author+date)
    const authorEl = document.querySelector('[class*="author-name"]')
      || document.querySelector('[class*="authorName"]')
      || document.querySelector('[itemprop="author"] [itemprop="name"]')
      || document.querySelector('[itemprop="author"]')
      || document.querySelector('[rel="author"]')
      || document.querySelector('.author-name')
      || document.querySelector('.author');
    if (authorEl) author = authorEl.textContent?.trim();
  }

  if (!author) {
    // Parse from byline — extract just the name part
    const bylineEl = document.querySelector('[class*="byline"]')
      || document.querySelector('[class*="Byline"]');
    if (bylineEl) {
      author = parseAuthorFromByline(bylineEl.textContent);
    }
  }

  // Date — try structured sources first
  let publishDate = meta('article:published_time')
    || meta('og:article:published_time')
    || meta('date')
    || meta('sailthru.date')
    || meta('DC.date.issued');

  if (!publishDate) {
    const timeEl = document.querySelector('time[datetime]');
    if (timeEl) publishDate = timeEl.getAttribute('datetime');
  }

  if (!publishDate) {
    // Try to find date in byline or date-specific elements
    const dateEl = document.querySelector('[class*="date"]')
      || document.querySelector('[class*="Date"]')
      || document.querySelector('[class*="timestamp"]')
      || document.querySelector('[class*="Timestamp"]')
      || document.querySelector('[class*="time"]');
    if (dateEl) {
      const dateText = dateEl.textContent?.trim();
      publishDate = parseDateFromText(dateText);
    }
  }

  // Outlet
  const outlet = meta('og:site_name') || document.domain.replace(/^www\./, '');

  // URL
  const url = window.location.href;

  // Full text
  const fullText = extractContent();

  return {
    headline: headline || 'Untitled',
    author: cleanAuthor(author),
    publish_date: publishDate ? normalizeDate(publishDate) : null,
    outlet,
    url,
    full_text: fullText,
    word_count: fullText.split(/\s+/).filter(Boolean).length,
    source_type: 'extension',
  };
}

// Parse author name from a byline string that may contain date, outlet, etc.
// e.g. "By John Smith | March 26, 2026" → "John Smith"
// e.g. "John Smith, Reuters" → "John Smith"
// e.g. "By John Smith and Jane Doe, Staff Reporters | Updated March 26" → "John Smith and Jane Doe"
function parseAuthorFromByline(text) {
  if (!text) return null;
  let s = text.trim();

  // Remove "By " prefix
  s = s.replace(/^by\s+/i, '');

  // Remove everything after common separators that introduce non-author info
  s = s.replace(/\s*\|.*$/, '');           // "Name | Date"
  s = s.replace(/\s*·.*$/, '');            // "Name · Date"
  s = s.replace(/\s*—.*$/, '');            // "Name — Date"
  s = s.replace(/\s*–.*$/, '');            // "Name – Date"

  // Remove date patterns
  s = s.replace(/\s*,?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s\d,.]+$/i, '');
  s = s.replace(/\s*,?\s*\d{1,2}\/\d{1,2}\/\d{2,4}.*$/, '');
  s = s.replace(/\s*,?\s*\d{4}-\d{2}-\d{2}.*$/, '');

  // Remove job titles after comma
  s = s.replace(/\s*,\s*(staff|reporter|correspondent|editor|columnist|senior|special|contributing|bureau|chief|deputy|managing|news|business|finance|economics|writer).*/i, '');

  // Remove "for [outlet]"
  s = s.replace(/\s+for\s+.+$/i, '');

  // Remove outlet names after comma
  s = s.replace(/\s*,\s*(Reuters|Bloomberg|AP|CNBC|BBC|Financial Times|WSJ|NYT).*$/i, '');

  // Remove "Updated" / "Published" timestamps
  s = s.replace(/\s*(Updated|Published|Posted|Modified).*$/i, '');

  s = s.trim();
  if (s.length < 2 || s.length > 80) return null;
  if (s.split(/\s+/).length > 6) return null; // Too many words, probably not just a name
  return s;
}

// Extract a date from a text string
function parseDateFromText(text) {
  if (!text) return null;
  // Try to find date patterns
  const m = text.match(/(\d{4}-\d{2}-\d{2})/)
    || text.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i)
    || text.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i)
    || text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[.\s]+\d{1,2},?\s+\d{4})/i)
    || text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  return m ? m[1] : null;
}

function extractContent() {
  const noise = ['nav', 'aside', 'footer', 'header', '[class*="related"]', '[class*="social"]',
    '[class*="share"]', '[class*="newsletter"]', '[class*="ad-"]', '[class*="sidebar"]',
    '[class*="comment"]', '[class*="promo"]', '[role="navigation"]', '[role="banner"]'];

  const containers = ['article', '[role="main"]', '.article-body', '.story-body',
    '#article-content', '.article-content', '.post-content', '.entry-content',
    '.article__body', '.story-content', 'main'];

  for (const sel of containers) {
    const el = document.querySelector(sel);
    if (el) {
      const clone = el.cloneNode(true);
      noise.forEach(n => clone.querySelectorAll(n).forEach(e => e.remove()));
      const text = cleanText(clone.textContent);
      if (text.length > 200) return text;
    }
  }

  const paragraphs = [...document.querySelectorAll('p')];
  const text = paragraphs.map(p => p.textContent.trim()).filter(t => t.length > 40).join('\n\n');
  if (text.length > 200) return cleanText(text);

  return cleanText(document.body.textContent);
}

function cleanText(text) {
  return text
    .replace(/Advertisement/gi, '')
    .replace(/Continue reading.*$/gim, '')
    .replace(/Sign up for.*$/gim, '')
    .replace(/\s{3,}/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanAuthor(author) {
  if (!author) return null;
  let s = author.replace(/^by\s+/i, '').replace(/\s+/g, ' ').trim();
  if (!s || s.length < 2) return null;
  return s;
}

function normalizeDate(d) {
  try {
    const date = new Date(d);
    if (isNaN(date)) return d;
    return date.toISOString().split('T')[0];
  } catch { return d; }
}
