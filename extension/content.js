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

  // Author
  const author = meta('author')
    || meta('article:author')
    || document.querySelector('[class*="byline"]')?.textContent?.trim()
    || document.querySelector('[class*="author"]')?.textContent?.trim()
    || document.querySelector('[rel="author"]')?.textContent?.trim()
    || null;

  // Date
  const publishDate = meta('article:published_time')
    || meta('og:article:published_time')
    || meta('date')
    || document.querySelector('time[datetime]')?.getAttribute('datetime')
    || null;

  // Outlet
  const outlet = meta('og:site_name') || document.domain.replace(/^www\./, '');

  // URL
  const url = window.location.href;

  // Full text - find main content
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

function extractContent() {
  // Remove noise elements
  const noise = ['nav', 'aside', 'footer', 'header', '[class*="related"]', '[class*="social"]',
    '[class*="share"]', '[class*="newsletter"]', '[class*="ad-"]', '[class*="sidebar"]',
    '[class*="comment"]', '[class*="promo"]', '[role="navigation"]', '[role="banner"]'];

  // Try semantic containers first
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

  // Fallback: find largest text block
  const paragraphs = [...document.querySelectorAll('p')];
  const text = paragraphs.map(p => p.textContent.trim()).filter(t => t.length > 40).join('\n\n');
  if (text.length > 200) return cleanText(text);

  // Last resort
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
  return author.replace(/^by\s+/i, '').replace(/\s+/g, ' ').trim() || null;
}

function normalizeDate(d) {
  try { return new Date(d).toISOString().split('T')[0]; }
  catch { return d; }
}
