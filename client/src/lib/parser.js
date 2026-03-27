import { fingerprint } from './helpers';

// ── Known outlets for detection ──
const OUTLET_NORM = [
  [/\bwsj\b|wall\s*street\s*journal|wsj\.com|wsj\s*pro/i, 'The Wall Street Journal'],
  [/\bft\.com\b|financial\s*times/i, 'Financial Times'],
  [/nytimes\.com|new\s*york\s*times|\bnyt\b/i, 'The New York Times'],
  [/bloomberg/i, 'Bloomberg'],
  [/reuters/i, 'Reuters'],
  [/washingtonpost\.com|washington\s*post/i, 'The Washington Post'],
  [/barrons\.com|barron'?s/i, "Barron's"],
  [/businessinsider\.com|business\s*insider/i, 'Business Insider'],
  [/\bcnbc\b/i, 'CNBC'], [/\bpolitico\b/i, 'Politico'], [/\baxios\b/i, 'Axios'],
  [/\bthe\s*hill\b/i, 'The Hill'], [/\bfortune\b/i, 'Fortune'],
  [/associated\s*press|\bap\s*news/i, 'Associated Press'],
  [/\bbbc\b/i, 'BBC'], [/\bguardian\b/i, 'The Guardian'],
  [/market\s*watch/i, 'MarketWatch'], [/s&p\s*global/i, 'S&P Global'],
  [/law\s*360/i, 'Law360'], [/american\s*banker/i, 'American Banker'],
  [/institutional\s*investor/i, 'Institutional Investor'],
  [/private\s*debt\s*investor/i, 'Private Debt Investor'],
  [/pensions\s*&?\s*investments/i, 'Pensions & Investments'],
  [/dealbook/i, 'DealBook'], [/breakingviews/i, 'Reuters Breakingviews'],
];

function normalizeOutlet(raw) {
  if (!raw) return null;
  let cleaned = raw.replace(/,\s*\d{1,2}\s+\w+\s+\d{4}\s*$/, '').replace(/,\s*\d+\s+words.*$/i, '').trim();
  if (/^by\s+/i.test(cleaned)) return null;
  for (const [rx, canonical] of OUTLET_NORM) {
    if (rx.test(cleaned)) return canonical;
  }
  return cleaned;
}

// ── Noise patterns to strip ──
const NOISE = [
  /^page\s+\d+\s+of\s+\d+$/i, /^factiva$/i, /^dow\s*jones/i, /^\d+$/,
  /^search\s+results$/i, /^display\s+options$/i, /^copyright\s/i, /©/,
  /all\s+rights\s+reserved/i, /^an\s+document/i,
  // Factiva field codes (2-letter codes on their own line)
  /^(se|hd|by|cr|pd|sn|sc|la|cy|lp|td|rf|co|in|ns|re|ipc)$/i,
  /^la\s+en$/i,
];

function cleanText(text) {
  return text.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return true;
    return !NOISE.some(p => p.test(t));
  }).join('\n');
}

// ── Split into article blocks ──
function splitArticles(text) {
  // Strategy 1: Factiva document IDs at end of each article
  if (/Document\s+[A-Za-z0-9]{10,}/g.test(text)) {
    const parts = text.split(/Document\s+[A-Za-z0-9]{10,}/);
    if (parts.length > 1) return parts.filter(p => p.trim().length > 50);
  }
  // Strategy 2: *** separators
  if (text.includes('***')) {
    const parts = text.split(/\*{3,}/);
    if (parts.length > 1) return parts.filter(p => p.trim().length > 50);
  }
  // Strategy 3: 3+ blank lines
  const blankSplit = text.split(/(?:\n\s*){3,}\n|^-{3,}$/m);
  if (blankSplit.length > 1) return blankSplit.filter(p => p.trim().length > 50);
  return [text];
}

// ── Line classification ──
// Tag each line in the header zone as a specific type

const DATE_RX = [
  /^\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i,
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}$/i,
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i,
];

const BYLINE_RX = [
  /^by\s+[A-Z]/i,                                  // "By John Smith"
  /^by\s+\w+\s+\w+/i,                              // "by firstname lastname"
  /^[A-Z][a-z]+\s+[A-Z][a-z]+\s+(?:and|,)\s+[A-Z]/,  // "John Smith and Jane Doe"
  /^[A-Z][a-z]+\s+[A-Z][a-z]+\s*$/,               // "John Smith" alone on a line (2 capitalized words)
];

const WORDCOUNT_RX = /^\d{2,5}\s*words$/i;

function classifyLine(line) {
  const t = line.trim();
  if (!t) return 'blank';
  if (WORDCOUNT_RX.test(t)) return 'wordcount';
  if (DATE_RX.some(rx => rx.test(t))) return 'date';
  if (BYLINE_RX.some(rx => rx.test(t))) return 'byline';
  // Outlet detection
  for (const [rx] of OUTLET_NORM) {
    if (rx.test(t)) return 'outlet';
  }
  // Short metadata-like lines
  if (t.length < 5) return 'junk';
  return 'content';
}

// ── Headline scoring — much more sophisticated ──
function scoreHeadline(line, index, lineTypes) {
  const t = line.trim();
  if (!t) return -100;

  let score = 0;
  const words = t.split(/\s+/);
  const wordCount = words.length;

  // Must be classified as content
  const type = lineTypes[index];
  if (type !== 'content') return -100;

  // Sweet spot: 5-20 words, 30-160 chars
  if (wordCount >= 5 && wordCount <= 20) score += 4;
  else if (wordCount >= 3 && wordCount <= 25) score += 2;
  else if (wordCount < 3) return -50;  // Too short to be a headline
  else if (wordCount > 30) score -= 3;  // Probably body text

  if (t.length >= 30 && t.length <= 160) score += 3;
  else if (t.length >= 20 && t.length <= 200) score += 1;

  // Starts with capital letter (strong signal)
  if (/^[A-Z]/.test(t)) score += 2;

  // Position: earlier lines more likely to be headlines
  if (index === 0) score += 5;
  else if (index === 1) score += 4;
  else if (index <= 3) score += 3;
  else if (index <= 5) score += 1;
  else score -= 1;

  // Headlines rarely end with periods (they're titles, not sentences)
  if (/\.\s*$/.test(t)) score -= 2;

  // Headlines often use --- or : for structure
  if (/\s+---\s+/.test(t)) score += 2;
  if (/:\s+/.test(t) && wordCount <= 15) score += 1;

  // Penalize lines that look like metadata
  if (/^\d/.test(t)) score -= 3;
  if (/words$/i.test(t)) score -= 10;
  if (/^by\s/i.test(t)) score -= 10;
  if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(t)) score -= 5;
  if (/copyright/i.test(t)) score -= 10;
  if (/\.com|\.org|\.net/i.test(t) && wordCount <= 3) score -= 5;

  // Bonus: if the next line is a byline or outlet, this is likely the headline
  if (index + 1 < lineTypes.length) {
    const nextType = lineTypes[index + 1];
    if (nextType === 'byline') score += 4;
    if (nextType === 'outlet') score += 3;
    if (nextType === 'date') score += 2;
  }

  // Bonus: if the previous line is blank or first line, more likely headline
  if (index === 0 || lineTypes[index - 1] === 'blank') score += 2;

  return score;
}

// ── Author extraction — much smarter ──
function extractAuthor(lines, lineTypes) {
  // Strategy 1: Look for lines classified as byline
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lineTypes[i] === 'byline') {
      return cleanAuthorName(lines[i].trim());
    }
  }

  // Strategy 2: Look for "By ..." pattern anywhere in first 20 lines
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const m = lines[i].match(/^(?:by|BY|By)\s+(.+)/);
    if (m) return cleanAuthorName(m[1]);
  }

  // Strategy 3: Look for a line that's just 2-3 capitalized names (common in Factiva)
  for (let i = 1; i < Math.min(lines.length, 10); i++) {
    const t = lines[i].trim();
    // Must be short, have 2-4 words, all starting with capitals
    const words = t.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && t.length < 50) {
      const allCapped = words.every(w => /^[A-Z]/.test(w));
      const notOutlet = !OUTLET_NORM.some(([rx]) => rx.test(t));
      const notDate = !DATE_RX.some(rx => rx.test(t));
      const notGeneric = !/reuters|associated|press|news|online|staff/i.test(t);
      // Check it looks like a name (not a phrase)
      const looksLikeName = words.every(w => w.length >= 2 && w.length <= 15);
      if (allCapped && notOutlet && notDate && notGeneric && looksLikeName) {
        // Extra check: is the next or previous line a headline, date, or outlet?
        const prevType = i > 0 ? lineTypes[i - 1] : 'blank';
        const nextType = i + 1 < lineTypes.length ? lineTypes[i + 1] : 'blank';
        if (prevType === 'content' || nextType === 'date' || nextType === 'outlet' || nextType === 'blank') {
          return cleanAuthorName(t);
        }
      }
    }
  }

  return null;
}

function cleanAuthorName(raw) {
  if (!raw) return null;
  let name = raw
    .replace(/^(?:by|BY|By)\s+/i, '')
    .replace(/\s+and\s+Reuters.*$/i, '')  // "John Smith and Reuters"
    .replace(/\s*\|.*$/, '')              // "John Smith | Bloomberg"
    .replace(/\s*,\s*(staff|reporter|correspondent|editor|columnist|senior|special|contributing).*/i, '')
    .replace(/\s+in\s+\w+.*$/i, '')       // "John Smith in London"
    .replace(/\s*\(.*?\)\s*$/, '')        // "John Smith (London)"
    .trim();

  // Don't return names that are too short or too long
  if (name.length < 3 || name.length > 80) return null;
  // Don't return if it looks like a title/headline
  if (name.split(/\s+/).length > 5) return null;

  return name;
}

// ── Date extraction ──
function extractDate(lines, lineTypes) {
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lineTypes[i] === 'date') return lines[i].trim();
  }
  // Fallback: search for date patterns in any line
  for (const line of lines.slice(0, 20)) {
    const m = line.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i)
      || line.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i)
      || line.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return null;
}

// ── Outlet extraction ──
function extractOutlet(lines, lineTypes) {
  // First look for classified outlet lines
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lineTypes[i] === 'outlet') return normalizeOutlet(lines[i].trim());
  }
  // Then scan for known outlet names in any line
  for (const line of lines.slice(0, 15)) {
    const n = normalizeOutlet(line.trim());
    if (n) return n;
  }
  return null;
}

// ── Word count extraction ──
function extractWordCount(lines, lineTypes) {
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lineTypes[i] === 'wordcount') {
      const m = lines[i].match(/(\d{2,5})\s*words/i);
      if (m) return parseInt(m[1], 10);
    }
  }
  return null;
}

// ── Find where the body text starts ──
function findBodyStart(lines, lineTypes, headlineIdx) {
  // Body starts after the last metadata line in the header zone
  let lastMetaIdx = headlineIdx;
  for (let i = headlineIdx + 1; i < Math.min(lines.length, 20); i++) {
    const type = lineTypes[i];
    if (type === 'byline' || type === 'outlet' || type === 'date' || type === 'wordcount') {
      lastMetaIdx = i;
    } else if (type === 'content' && lines[i].trim().length > 80) {
      // Long content line — this is probably the start of body
      break;
    }
  }
  return lastMetaIdx + 1;
}

// ── Main parse function ──
export function parseFactiva(rawText, workstreamId) {
  const cleaned = cleanText(rawText);
  const blocks = splitArticles(cleaned);

  return blocks.map(block => {
    const lines = block.split('\n');
    const headerLines = lines.slice(0, 25);

    // Classify each header line
    const lineTypes = headerLines.map(l => classifyLine(l));

    // Find headline using scoring
    let bestScore = -Infinity;
    let headlineIdx = 0;
    let headline = '';
    headerLines.forEach((line, i) => {
      const s = scoreHeadline(line, i, lineTypes);
      if (s > bestScore) {
        bestScore = s;
        headlineIdx = i;
        headline = line.trim();
      }
    });

    if (!headline || bestScore < 0) {
      headline = lines.find(l => l.trim().length > 20)?.trim() || 'Untitled';
    }

    const outlet = extractOutlet(lines, lineTypes);
    const publishDate = extractDate(lines, lineTypes);
    const author = extractAuthor(lines, lineTypes);
    const wordCount = extractWordCount(lines, lineTypes);

    // Body text
    const bodyStart = findBodyStart(lines, lineTypes, headlineIdx);
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
