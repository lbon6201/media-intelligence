import { Router } from 'express';
import db from '../db.js';
import { Document, Packer, Paragraph, TextRun, AlignmentType, Footer, PageNumber, convertInchesToTwip, ExternalHyperlink, TabStopPosition, TabStopType } from 'docx';

const router = Router();

function safeParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

// Aggressive cleaning for article full text in clips export
function cleanArticleText(text) {
  if (!text) return '';

  let cleaned = text;

  // --- Pre-processing: strip HTML/markup ---
  cleaned = cleaned
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')   // script blocks
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')     // style blocks
    .replace(/<[^>]+>/g, ' ')                            // all HTML tags → space
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '')     // HTML entities
    .replace(/\u00A0/g, ' ')                             // non-breaking space
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, '')  // zero-width chars
    .replace(/[\u2018\u2019]/g, "'")                     // smart quotes → straight
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, ' — ').replace(/\u2013/g, ' – ') // em/en dashes
    .replace(/\u2026/g, '...')                           // ellipsis
    .replace(/\[([^\]]{0,40})\]/g, (m, inner) => {      // strip short brackets [Photo] [1] etc
      if (/^[\d,\s]+$/.test(inner)) return '';           // footnote refs [1] [2,3]
      if (/photo|image|video|chart|figure|caption|source|related|read more|sign up|subscribe/i.test(inner)) return '';
      return m; // keep meaningful brackets like [SEC] or quoted text
    })
    .replace(/\{[^}]{0,30}\}/g, '')                     // curly brace artifacts
    .replace(/\t/g, ' ');                                // tabs → spaces

  // --- Line-level noise removal ---
  const lineNoisePatterns = [
    // Web UI chrome / navigation
    /^(home|menu|search|sign\s*in|log\s*in|subscribe|register|newsletter)\s*$/i,
    /^(share|tweet|email|print|save|bookmark|comment|follow\s+us)\s*$/i,
    /^(facebook|twitter|linkedin|instagram|youtube|tiktok|whatsapp|reddit|x\.com)\s*$/i,
    /^(previous|next|related|more\s+from|recommended|trending|popular|most\s+read)\b.*$/i,
    /^(advertisement|sponsored|promoted|ad|advert)\s*$/i,
    /^(skip\s+to|jump\s+to|go\s+to|back\s+to)\s+/i,
    /^(accept|reject|manage|customize)\s*(all\s*)?(cookies?)?\s*$/i,
    /^(continue\s+reading|read\s+more|show\s+more|load\s+more|see\s+all)\s*$/i,
    /^(sign\s+up|subscribe|get\s+access|unlock|premium|member)/i,
    /^(close|dismiss|got\s+it|no\s+thanks|maybe\s+later|not\s+now)\s*$/i,
    /^(listen|watch|download)\s*(to|the)?\s*(podcast|video|app|episode)/i,
    /^(click|tap|swipe)\s+(here|to|for)/i,
    /^(up\s+next|now\s+playing|watch\s+next)\s*$/i,
    /^(most\s+popular|top\s+stories|editors?\s*picks?)\s*$/i,
    /^(free|limited)\s+(article|access|trial)/i,
    /^already\s+(a\s+)?(subscriber|member)/i,
    /^(morning|evening|daily)\s+(brief|briefing|digest|newsletter)/i,
    // Media / image credits
    /^(photo|image|video|audio|graphic|chart|illustration|source)\s*:/i,
    /^(getty|reuters|ap|afp|bloomberg|associated press)\s*(images?|photos?)?\s*$/i,
    /^(photo|credit|caption)\s*:?\s*.{0,40}$/i,
    /^(file\s+photo|stock\s+image|handout|courtesy)/i,
    /^\d+\s*(min|minute|hour|sec|second)s?\s*(read|ago|left)\s*$/i,
    /^(updated?|modified|edited|published)\s*:?\s*$/i,
    /^(tags?|topics?|categories?|section|filed\s+under)\s*:?\s*$/i,
    // Legal / copyright / footer
    /^copyright\s/i, /©/, /all\s+rights\s+reserved/i,
    /^terms\s+(of\s+)?(use|service)/i, /^privacy\s+policy/i,
    /^cookie\s+(policy|preferences|settings)/i,
    /^our\s+standards?\s*:/i,
    /^this\s+(article|story|content)\s+(is|was)\s+(published|produced|provided|updated)/i,
    /^(reporting|reported)\s+by\s+.+;\s*(editing|writing)\s+by/i,
    /^(additional\s+reporting|editing)\s+by\s+/i,
    /^compiled\s+by\s+/i,
    // Separators and junk
    /^\s*\|+\s*$/, /^\s*-{3,}\s*$/, /^\s*={3,}\s*$/, /^\s*_{3,}\s*$/,
    /^\s*\*{3,}\s*$/,
    /^\s*\d+\s*\/\s*\d+\s*$/, // "1/5" slide indicators
    /^\s*https?:\/\/\S+\s*$/, // bare URLs on their own line
    // Factiva artifacts
    /^page\s+\d+\s+of\s+\d+\s*$/i, /^factiva\s*$/i, /^dow\s*jones/i,
    /^document\s+[a-z0-9]{10,}\s*$/i,
    /^(se|hd|by|cr|pd|sn|sc|la|cy|lp|td|rf|co|in|ns|re|ipc)\s*$/i,
    /^\d+\s*words?\s*$/i,
    // Social/sharing prompts
    /^share\s+this\s+(article|story|post)/i,
    /^(follow|like|retweet|repost)\s+(us|me|this)/i,
    /^get\s+(the\s+)?(latest|our|free)/i,
    /^(enter|type)\s+your\s+email/i,
    /^you\s+(may|might)\s+also\s+(like|enjoy|be\s+interested)/i,
    /^don.t\s+miss/i,
  ];

  cleaned = cleaned.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return true; // keep blank lines for paragraph structure
    if (t.length <= 2) return false; // single chars, bullets, stray punctuation
    // ALL CAPS short lines are usually nav/headers (e.g., "MARKETS", "OPINION")
    if (/^[A-Z\s]{1,25}$/.test(t) && t.length < 20) return false;
    return !lineNoisePatterns.some(p => p.test(t));
  }).join('\n');

  // --- Post-processing ---
  cleaned = cleaned
    .replace(/ {2,}/g, ' ')            // collapse multiple spaces
    .replace(/\n{4,}/g, '\n\n\n')      // collapse excessive blank lines
    .replace(/^\s+|\s+$/gm, line => line.replace(/[^\n]/g, '')); // trim each line

  return cleaned.trim();
}

// Use Claude Haiku to extract only the article body text, stripping all non-article content.
// This handles Bloomberg market data, related articles, author bios, nav chrome, etc.
async function cleanWithClaude(rawText, headline) {
  try {
    // Truncate to keep costs low
    const input = rawText.slice(0, 16000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        system: [
          'Extract ONLY the article body text from the input. Remove everything that is not part of the actual article:',
          '- Navigation menus, headers, footers, sidebars',
          '- "Read more", "Related articles", "More from..." sections',
          '- Author bios, social media links, share buttons',
          '- Subscription prompts, paywall text, cookie notices',
          '- Stock tickers, market data tables, Bloomberg Terminal references',
          '- Image captions, photo credits, video embeds',
          '- Legal disclaimers, copyright notices',
          '- "Sign up for...", "Get the newsletter" prompts',
          '- Any repeated boilerplate text',
          '',
          'Return ONLY the clean article body text. Preserve the original wording exactly — do not summarize, paraphrase, or add anything.',
          'Output each sentence as its own paragraph (separated by a blank line).',
          'Do NOT include any preamble or explanation — just the cleaned text.',
        ].join('\n'),
        messages: [{ role: 'user', content: `Article headline: "${headline}"\n\nRaw text:\n${input}` }],
      }),
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message);
    const cleaned = d.content?.[0]?.text || '';
    if (cleaned.length > 50) return cleaned;
  } catch (e) {
    console.log(`Claude clean failed for "${headline}": ${e.message}`);
  }
  return null;
}

// Split text into paragraphs — one sentence per paragraph.
function splitIntoParagraphs(text) {
  if (!text) return [];

  // If Claude already returned blank-line-separated paragraphs, respect those
  // but still split each into individual sentences
  const blocks = text.includes('\n\n')
    ? text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0)
    : [text];

  const sentences = [];
  for (const block of blocks) {
    // Flatten any remaining newlines within a block
    const flat = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!flat) continue;

    // Split on sentence boundaries: sentence-ending punctuation followed by space + capital letter
    const parts = flat
      .split(/(?<=[.!?]["'\u201D\u2019)]*)\s+(?=[A-Z\u201C\u2018"'(])/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    sentences.push(...parts);
  }

  return sentences;
}

// Call Claude Sonnet to generate summary + key narratives
async function generateClipsSummary(articles, workstream, headerConfig) {
  const articleSummaries = articles.map((a, i) => {
    const topics = safeParseJson(a.cl_topics) || [];
    const intQuotes = safeParseJson(a.cl_internal_quotes) || [];
    const extQuotes = safeParseJson(a.cl_external_quotes) || [];
    const allQuotes = [...intQuotes, ...extQuotes];
    const quoteSample = allQuotes.slice(0, 3).map(q =>
      `"${q.quote}" — ${q.source}${q.role ? ` (${q.role})` : ''}`
    ).join('\n      ');

    return [
      `${i + 1}. "${a.headline}" (${a.outlet || 'Unknown'}, ${a.publish_date || 'Unknown'})`,
      `   Author: ${a.author || 'Unknown'}`,
      `   Topics: ${topics.join(', ') || 'N/A'}`,
      `   Sentiment: ${a.cl_sentiment_score || '?'}/7 — ${a.cl_sentiment_label || ''}`,
      `   Key Takeaway: ${a.cl_key_takeaway || 'N/A'}`,
      quoteSample ? `   Notable Quotes:\n      ${quoteSample}` : '',
      a.full_text ? `   Excerpt: ${a.full_text.slice(0, 400)}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const outletList = [...new Set(articles.map(a => a.outlet).filter(Boolean))].join(', ');
  const dateRange = articles.map(a => a.publish_date).filter(Boolean).sort();
  const dateStr = dateRange.length > 0 ? `${dateRange[0]} to ${dateRange[dateRange.length - 1]}` : 'various dates';

  const systemPrompt = [
    'You are a media intelligence analyst at a strategic communications firm.',
    'Write an internal media coverage report for a client.',
    'Professional, concise, third-person tone. Plain text only — no markdown.',
    '',
    'Return a JSON object with two fields:',
    '',
    '"summary": A concise report of the key coverage and commentary from the articles provided. Highlight key moments — significant statements, policy shifts, notable quotes from influential figures (include inline with attribution when genuinely revealing, but do not force them). Track emerging themes across the coverage. Include a brief sentiment read — whether coverage is trending positive, negative, or mixed, and note any shifts. Flag any items that warrant immediate attention from the client (e.g., negative tier-1 coverage, inaccurate reporting, emerging crises, or unexpected angles). Keep to 2-3 short paragraphs. Mention the client by name where relevant. Reference specific outlets when noting key developments.',
    '',
    '"key_narratives": An array of 3-5 strings. Each is one sentence identifying a critical theme or narrative thread emerging from the coverage.',
    '',
    'Return ONLY valid JSON. No backticks, no preamble.',
  ].join('\n');

  const userMsg = [
    `Client/Workstream: "${workstream.name}" (Client: ${workstream.client || 'N/A'})`,
    headerConfig.to ? `Report recipient: ${headerConfig.to}` : '',
    headerConfig.re ? `Report subject: ${headerConfig.re}` : '',
    `Coverage period: ${dateStr}`,
    `Outlets represented: ${outletList}`,
    `Total articles: ${articles.length}`,
    '',
    'Articles:',
    articleSummaries,
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  const raw = d.content?.[0]?.text || '';
  try {
    return JSON.parse(raw.replace(/```json\s*/g, '').replace(/```\s*/g, ''));
  } catch {
    return { summary: raw, key_narratives: [] };
  }
}

function formatClipsDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// Search for an article URL using Brave Search
async function searchArticleUrl(headline, outlet) {
  try {
    const query = `${headline} ${outlet || ''}`.trim();
    const encoded = encodeURIComponent(query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      `https://search.brave.com/search?q=${encoded}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
      }
    );
    clearTimeout(timeout);
    const html = await res.text();

    // Extract external links — skip Brave's own domains and image CDNs
    const skipDomains = /search\.brave\.com|brave\.com|imgs\.search\.brave|tiles\.search\.brave|cdn\.search\.brave/;
    const linkMatches = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)];
    for (const m of linkMatches) {
      const url = m[1];
      if (skipDomains.test(url)) continue;
      if (/\.(png|jpg|jpeg|gif|svg|ico|css|js)(\?|$)/i.test(url)) continue;
      // Return the first real result URL
      return url;
    }
  } catch (e) {
    console.log(`URL search failed for "${headline}": ${e.message}`);
  }
  return null;
}

// Font/size constants matching the example doc (11pt Calibri, black text)
const FONT = 'Calibri';
const SZ_BODY = 22;       // 11pt
const SZ_HEADING = 22;    // 11pt bold for section headings
const SZ_ARTICLE_HEAD = 22; // 11pt bold for article headlines
const SZ_SMALL = 20;      // 10pt for metadata/URLs
const CLR = '000000';     // black — used everywhere

function buildClipsDoc(articles, workstream, headerConfig, aiResult) {
  const children = [];
  const now = new Date();
  const dateStr = headerConfig.date || now.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  // --- Header: TO / DATE / RE ---
  const headerFields = [
    { label: 'TO: ', value: headerConfig.to || workstream.client || '' },
    { label: 'DATE: ', value: dateStr },
    { label: 'RE: ', value: headerConfig.re || `${workstream.name} – Media Coverage Report` },
  ];

  for (const { label, value } of headerFields) {
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: label, font: FONT, size: SZ_BODY, bold: true, color: CLR }),
        new TextRun({ text: '\t' }),
        new TextRun({ text: value, font: FONT, size: SZ_BODY, color: CLR }),
      ],
    }));
  }

  children.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [] }));

  // --- Summary ---
  children.push(new Paragraph({ spacing: { after: 120 }, children: [
    new TextRun({ text: 'Summary', font: FONT, size: SZ_HEADING, bold: true, color: CLR }),
  ]}));

  if (aiResult?.summary) {
    const summaryParagraphs = aiResult.summary.split(/\n\s*\n/).filter(p => p.trim());
    for (const para of summaryParagraphs) {
      children.push(new Paragraph({ spacing: { before: 60, after: 60 }, children: [
        new TextRun({ text: para.trim(), font: FONT, size: SZ_BODY, color: CLR }),
      ]}));
    }
  }

  // --- Key Narratives ---
  if (aiResult?.key_narratives?.length > 0) {
    children.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [] }));

    for (const narrative of aiResult.key_narratives) {
      children.push(new Paragraph({
        spacing: { before: 40, after: 40 },
        bullet: { level: 0 },
        children: [
          new TextRun({ text: narrative, font: FONT, size: SZ_BODY, color: CLR }),
        ],
      }));
    }
  }

  children.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [] }));

  // --- Media Coverage: Article Index ---
  children.push(new Paragraph({ spacing: { after: 120 }, children: [
    new TextRun({ text: 'Media Coverage', font: FONT, size: SZ_HEADING, bold: true, color: CLR }),
  ]}));

  for (const a of articles) {
    const datePart = a.publish_date ? formatShortDate(a.publish_date) : '';
    const indexChildren = [
      new TextRun({ text: 'ARTICLE: ', font: FONT, size: SZ_BODY, color: CLR }),
      new TextRun({ text: `"${a.headline}" `, font: FONT, size: SZ_BODY, color: CLR }),
      new TextRun({ text: '(', font: FONT, size: SZ_BODY, color: CLR }),
    ];

    // Outlet name as hyperlink to article URL
    if (a.url) {
      indexChildren.push(new ExternalHyperlink({
        link: a.url,
        children: [new TextRun({ text: a.outlet || 'Link', font: FONT, size: SZ_BODY, color: '0563C1', underline: {} })],
      }));
    } else {
      indexChildren.push(new TextRun({ text: a.outlet || 'Unknown', font: FONT, size: SZ_BODY, color: CLR }));
    }

    indexChildren.push(
      new TextRun({ text: `${datePart ? ', ' + datePart : ''})`, font: FONT, size: SZ_BODY, color: CLR }),
    );

    children.push(new Paragraph({ spacing: { before: 30, after: 30 }, children: indexChildren }));
  }

  children.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [] }));

  // --- Full Articles ---
  children.push(new Paragraph({ spacing: { after: 120 }, children: [
    new TextRun({ text: 'Media Coverage: Full Articles ', font: FONT, size: SZ_HEADING, bold: true, color: CLR }),
  ]}));

  for (let idx = 0; idx < articles.length; idx++) {
    const a = articles[idx];

    // *** separator between articles (not before the first one)
    if (idx > 0) {
      children.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [] }));
      children.push(new Paragraph({
        spacing: { before: 40, after: 40 },
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '***', font: FONT, size: SZ_BODY, bold: true, color: CLR })],
      }));
      children.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [] }));
    }

    // Headline — bold, hyperlinked if URL available
    if (a.url) {
      children.push(new Paragraph({ spacing: { before: 120, after: 20 }, children: [
        new ExternalHyperlink({
          link: a.url,
          children: [new TextRun({ text: a.headline, font: FONT, size: SZ_ARTICLE_HEAD, bold: true, color: '0563C1', underline: {} })],
        }),
      ]}));
    } else {
      children.push(new Paragraph({ spacing: { before: 120, after: 20 }, children: [
        new TextRun({ text: a.headline, font: FONT, size: SZ_ARTICLE_HEAD, bold: true, color: CLR }),
      ]}));
    }

    // Metadata: Outlet, By Author, Date — each on its own line, all black
    if (a.outlet) {
      children.push(new Paragraph({ spacing: { after: 10 }, children: [
        new TextRun({ text: a.outlet, font: FONT, size: SZ_BODY, color: CLR }),
      ]}));
    }
    if (a.author) {
      children.push(new Paragraph({ spacing: { after: 10 }, children: [
        new TextRun({ text: `By ${a.author}`, font: FONT, size: SZ_BODY, color: CLR }),
      ]}));
    }
    if (a.publish_date) {
      children.push(new Paragraph({ spacing: { after: 60 }, children: [
        new TextRun({ text: formatClipsDate(a.publish_date), font: FONT, size: SZ_BODY, color: CLR }),
      ]}));
    }

    // Full article text — use Claude-cleaned version if available, fall back to regex
    const articleText = a._cleanedText || cleanArticleText(a.full_text || '');
    const paragraphs = splitIntoParagraphs(articleText);
    for (const para of paragraphs) {
      if (!para || para.length < 3) continue;
      children.push(new Paragraph({
        spacing: { before: 80, after: 80 },
        children: [new TextRun({ text: para, font: FONT, size: SZ_BODY, color: CLR })],
      }));
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ_BODY } } } },
    sections: [{
      properties: {
        page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) } },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '888888' }),
                new TextRun({ text: ' of ', font: FONT, size: 18, color: '888888' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: '888888' }),
              ],
            }),
          ],
        }),
      },
      children,
    }],
  });

  return doc;
}

// Generate clips for a date range or selected articles
router.post('/:workstream_id/generate', async (req, res) => {
  const wsId = req.params.workstream_id;
  const { date_from, date_to, article_ids, header_to, header_re, header_date } = req.body;

  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', wsId);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });

  let articles;
  if (article_ids && Array.isArray(article_ids) && article_ids.length > 0) {
    const placeholders = article_ids.map(() => '?').join(',');
    articles = await db.all(
      `SELECT * FROM articles WHERE id IN (${placeholders}) AND workstream_id = ? ORDER BY publish_date DESC`,
      ...article_ids, wsId
    );
  } else if (date_from) {
    let sql = `SELECT * FROM articles WHERE workstream_id = ? AND cl_status = 'classified'`;
    const params = [wsId];
    sql += ' AND publish_date >= ?';
    params.push(date_from);
    if (date_to) {
      sql += ' AND publish_date <= ?';
      params.push(date_to);
    }
    sql += ' ORDER BY publish_date DESC';
    articles = await db.all(sql, ...params);
  } else {
    return res.status(400).json({ error: 'Provide date_from or article_ids' });
  }

  if (articles.length === 0) {
    return res.status(400).json({ error: 'No articles found for the given criteria' });
  }

  // Parse JSON fields
  for (const a of articles) {
    a.cl_topics = safeParseJson(a.cl_topics);
    a.cl_firms_mentioned = safeParseJson(a.cl_firms_mentioned);
    a.cl_firm_sentiments = safeParseJson(a.cl_firm_sentiments);
    a.cl_key_entities = safeParseJson(a.cl_key_entities);
    a.cl_geographic_tags = safeParseJson(a.cl_geographic_tags);
    a.cl_policy_dimensions = safeParseJson(a.cl_policy_dimensions);
    a.cl_stakeholder_focus = safeParseJson(a.cl_stakeholder_focus);
    a.cl_internal_quotes = safeParseJson(a.cl_internal_quotes);
    a.cl_external_quotes = safeParseJson(a.cl_external_quotes);
  }

  // Search for missing URLs
  const urlSearchPromises = articles
    .filter(a => !a.url && a.headline)
    .map(async (a) => {
      const found = await searchArticleUrl(a.headline, a.outlet);
      if (found) {
        a.url = found;
        // Persist back to DB so we don't search again
        await db.run('UPDATE articles SET url = ? WHERE id = ?', found, a.id).catch(() => {});
      }
    });
  if (urlSearchPromises.length > 0) {
    console.log(`Searching for ${urlSearchPromises.length} missing article URLs...`);
    await Promise.allSettled(urlSearchPromises);
  }

  // Clean article text with Claude Haiku (parallel, ~$0.001 each)
  console.log(`Cleaning ${articles.length} article texts with Claude...`);
  const cleanPromises = articles.map(async (a) => {
    if (a.full_text && a.full_text.length > 100) {
      const cleaned = await cleanWithClaude(a.full_text, a.headline);
      if (cleaned) a._cleanedText = cleaned;
    }
  });
  await Promise.allSettled(cleanPromises);

  const headerConfig = {
    to: header_to || '',
    re: header_re || '',
    date: header_date || '',
  };

  let aiResult;
  try {
    aiResult = await generateClipsSummary(articles, { ...ws, client: ws.client }, headerConfig);
  } catch (e) {
    console.error('Clips AI summary failed:', e.message);
    aiResult = { summary: `Media coverage report covering ${articles.length} articles.`, key_narratives: [] };
  }

  const doc = buildClipsDoc(articles, ws, headerConfig, aiResult);
  const buf = await Packer.toBuffer(doc);

  const wsName = ws.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const dateLabel = date_from || new Date().toISOString().split('T')[0];
  const filename = `${wsName}_Clips_${dateLabel}.docx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(buf);
});

export default router;
