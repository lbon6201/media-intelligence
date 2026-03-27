import { fingerprint } from './helpers';

const KNOWN_OUTLETS = [
  /wall\s*street\s*journal/i, /wsj/i, /financial\s*times/i, /\bft\b/i,
  /bloomberg/i, /reuters/i, /new\s*york\s*times/i, /nyt/i, /washington\s*post/i,
  /associated\s*press/i, /\bap\b/i, /cnbc/i, /bbc/i, /guardian/i,
  /politico/i, /axios/i, /the\s*hill/i, /barron'?s/i, /fortune/i,
  /business\s*insider/i, /marketwatch/i, /institutional\s*investor/i,
  /private\s*debt\s*investor/i, /pensions\s*&?\s*investments/i,
  /law360/i, /american\s*banker/i, /s&p\s*global/i,
];

const NOISE_PATTERNS = [
  /^page\s+\d+\s+of\s+\d+$/i,
  /^factiva$/i,
  /^dow\s*jones/i,
  /^\d+$/,
  /^search\s+results$/i,
  /^display\s+options$/i,
  /^copyright\s/i,
  /©/,
  /all\s+rights\s+reserved/i,
  /^se$/i,
  /^hd$/i,
  /^by$/i,
  /^cr$/i,
  /^pD$/i,
  /^sn$/i,
  /^sc$/i,
  /^la\s+en$/i,
  /^cy$/i,
  /^lp$/i,
  /^td$/i,
  /^rf$/i,
  /^co$/i,
  /^in$/i,
  /^ns$/i,
  /^re$/i,
  /^ipc$/i,
  /^an\s+document/i,
];

function cleanText(text) {
  return text.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines for splitting
    return !NOISE_PATTERNS.some(p => p.test(trimmed));
  }).join('\n');
}

function splitArticles(text) {
  // Strategy 1: Factiva document IDs
  const docIdPattern = /Document\s+[A-Za-z0-9]{10,}/g;
  if (docIdPattern.test(text)) {
    const parts = text.split(/Document\s+[A-Za-z0-9]{10,}/);
    if (parts.length > 1) return parts.filter(p => p.trim().length > 50);
  }

  // Strategy 2: *** separators
  if (text.includes('***')) {
    const parts = text.split(/\*{3,}/);
    if (parts.length > 1) return parts.filter(p => p.trim().length > 50);
  }

  // Strategy 3: --- or 3+ blank lines
  const blankSplit = text.split(/(?:\n\s*){3,}\n|^-{3,}$/m);
  if (blankSplit.length > 1) return blankSplit.filter(p => p.trim().length > 50);

  // Fallback: single article
  return [text];
}

function scoreHeadline(line, index) {
  let score = 0;
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 10) return 0;
  if (trimmed.length >= 40 && trimmed.length <= 150) score += 3;
  else if (trimmed.length >= 20 && trimmed.length <= 200) score += 1;
  if (/^[A-Z]/.test(trimmed)) score += 2;
  if (index < 5) score += (5 - index);
  // Penalize lines that look like metadata
  if (/^\d/.test(trimmed)) score -= 2;
  if (/words$/i.test(trimmed)) score -= 3;
  if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(trimmed)) score -= 2;
  if (/^by\s/i.test(trimmed)) score -= 3;
  // Penalize very short sentences (likely metadata)
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 4) score -= 2;
  if (wordCount >= 5 && wordCount <= 20) score += 2;
  return score;
}

const OUTLET_NORM = [
  [/\bwsj\b|wall\s*street\s*journal|wsj\.com|wsj\s*pro/i, 'The Wall Street Journal'],
  [/\bft\.com\b|financial\s*times/i, 'Financial Times'],
  [/nytimes\.com|new\s*york\s*times|\bnyt\b/i, 'The New York Times'],
  [/bloomberg/i, 'Bloomberg'],
  [/reuters/i, 'Reuters'],
  [/washingtonpost\.com|washington\s*post/i, 'The Washington Post'],
  [/barrons\.com|barron'?s/i, "Barron's"],
  [/businessinsider\.com|business\s*insider/i, 'Business Insider'],
  [/\bcnbc\b/i, 'CNBC'],
  [/\bpolitico\b/i, 'Politico'],
  [/\baxios\b/i, 'Axios'],
  [/\bthe\s*hill\b/i, 'The Hill'],
  [/\bfortune\b/i, 'Fortune'],
  [/associated\s*press|\bap\s*news/i, 'Associated Press'],
  [/\bbbc\b/i, 'BBC'],
  [/\bguardian\b/i, 'The Guardian'],
  [/market\s*watch/i, 'MarketWatch'],
  [/s&p\s*global/i, 'S&P Global'],
  [/law\s*360/i, 'Law360'],
  [/american\s*banker/i, 'American Banker'],
  [/institutional\s*investor/i, 'Institutional Investor'],
  [/private\s*debt\s*investor/i, 'Private Debt Investor'],
  [/pensions\s*&?\s*investments/i, 'Pensions & Investments'],
];

function normalizeOutlet(raw) {
  if (!raw) return null;
  // Strip trailing date/metadata
  let cleaned = raw.replace(/,\s*\d{1,2}\s+\w+\s+\d{4}\s*$/, '').replace(/,\s*\d+\s+words.*$/i, '').trim();
  if (/^by\s+/i.test(cleaned)) return null;
  for (const [rx, canonical] of OUTLET_NORM) {
    if (rx.test(cleaned)) return canonical;
  }
  return cleaned;
}

function extractOutlet(lines) {
  for (const line of lines.slice(0, 15)) {
    const trimmed = line.trim();
    for (const rx of KNOWN_OUTLETS) {
      if (rx.test(trimmed)) return normalizeOutlet(trimmed);
    }
  }
  return null;
}

function extractDate(lines) {
  for (const line of lines.slice(0, 15)) {
    // Various date formats
    const m = line.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i)
      || line.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i)
      || line.match(/(\d{4}-\d{2}-\d{2})/)
      || line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (m) return m[1];
  }
  return null;
}

function extractByline(lines) {
  for (const line of lines.slice(0, 15)) {
    const m = line.match(/^(?:by|BY)\s+(.+)/i);
    if (m) return m[1].trim();
  }
  return null;
}

function extractWordCount(lines) {
  for (const line of lines.slice(0, 15)) {
    const m = line.match(/(\d{2,5})\s*words/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

export function parseFactiva(rawText, workstreamId) {
  const cleaned = cleanText(rawText);
  const blocks = splitArticles(cleaned);

  return blocks.map(block => {
    const lines = block.split('\n');
    const headerLines = lines.slice(0, 15);

    // Score-based headline detection
    let bestScore = -Infinity;
    let headline = '';
    headerLines.forEach((line, i) => {
      const s = scoreHeadline(line, i);
      if (s > bestScore) {
        bestScore = s;
        headline = line.trim();
      }
    });

    if (!headline) headline = lines.find(l => l.trim().length > 20)?.trim() || 'Untitled';

    const outlet = extractOutlet(headerLines);
    const publishDate = extractDate(headerLines);
    const author = extractByline(headerLines);
    const wordCount = extractWordCount(headerLines);

    // Body: everything after headline (skip metadata zone)
    const headlineIdx = lines.findIndex(l => l.trim() === headline);
    const bodyStart = Math.max(headlineIdx + 1, Math.min(10, lines.length));
    const fullText = lines.slice(bodyStart).join('\n').trim() || block.trim();

    return {
      workstream_id: workstreamId,
      source_type: 'factiva',
      headline,
      outlet,
      author,
      publish_date: publishDate,
      full_text: fullText,
      word_count: wordCount || fullText.split(/\s+/).length,
      fingerprint: fingerprint(headline, outlet, publishDate),
    };
  }).filter(a => a.full_text.length > 30);
}
