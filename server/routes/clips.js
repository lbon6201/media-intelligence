import { Router } from 'express';
import db from '../db.js';
import { Document, Packer, Paragraph, TextRun, AlignmentType, Footer, PageNumber, convertInchesToTwip, ExternalHyperlink, TabStopPosition, TabStopType } from 'docx';

const router = Router();

function safeParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

// Clean web noise from article text and ensure proper paragraph breaks
function cleanArticleText(text) {
  if (!text) return '';
  const noisePatterns = [
    /^(home|menu|search|sign\s*in|log\s*in|subscribe|register|newsletter)\s*$/gim,
    /^(share|tweet|email|print|save|bookmark|comment|follow\s+us)\s*$/gim,
    /^(facebook|twitter|linkedin|instagram|youtube|tiktok|whatsapp|reddit)\s*$/gim,
    /^(previous|next|related|more\s+from|recommended|trending|popular|most\s+read)\s*.*$/gim,
    /^(advertisement|sponsored|promoted|ad)\s*$/gim,
    /^(skip\s+to|jump\s+to|go\s+to|back\s+to)\s+.*$/gim,
    /^(accept|reject|manage|customize)\s*(all\s*)?(cookies?)?\s*$/gim,
    /^(continue\s+reading|read\s+more|show\s+more|load\s+more|see\s+all)\s*$/gim,
    /^(sign\s+up|subscribe|get\s+access|unlock|premium|member).*$/gim,
    /^(close|dismiss|got\s+it|no\s+thanks|maybe\s+later|not\s+now)\s*$/gim,
    /^(photo|image|video|audio|graphic|chart|illustration|source)\s*:.*$/gim,
    /^(getty|reuters|ap|afp|bloomberg)\s*(images?|photos?)?\s*$/gim,
    /^\d+\s*(min|minute|hour|sec|second)s?\s*(read|ago|left)\s*$/gim,
    /^(updated?|modified|edited)\s*:?\s*$/gim,
    /^(tags?|topics?|categories?|section|filed\s+under)\s*:?\s*$/gim,
    /^copyright\s.*$/gim,
    /©.*$/gim,
    /all\s+rights\s+reserved.*$/gim,
    /terms\s+(of\s+)?(use|service).*$/gim,
    /privacy\s+policy.*$/gim,
    /cookie\s+(policy|preferences|settings).*$/gim,
    /^\s*\|+\s*$/gm,
    /^\s*-{3,}\s*$/gm,
    /^\s*={3,}\s*$/gm,
    /^\s*_{3,}\s*$/gm,
    /^page\s+\d+\s+of\s+\d+\s*$/gim,
    /^factiva\s*$/gim,
    /^dow\s*jones.*$/gim,
    /^document\s+[a-z0-9]{10,}\s*$/gim,
    /^(se|hd|by|cr|pd|sn|sc|la|cy|lp|td|rf|co|in|ns|re|ipc)\s*$/gim,
  ];

  let cleaned = text;
  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove very short lines (nav items)
  cleaned = cleaned.split('\n').filter(line => {
    const t = line.trim();
    if (!t) return true;
    if (t.length <= 3) return false;
    return true;
  }).join('\n');

  // Collapse excessive blank lines
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');

  return cleaned.trim();
}

// Call Claude Sonnet to generate summary + key narratives
async function generateClipsSummary(articles, workstream, headerConfig) {
  const articleSummaries = articles.map((a, i) => {
    const topics = safeParseJson(a.cl_topics) || [];
    return [
      `${i + 1}. "${a.headline}" (${a.outlet || 'Unknown'}, ${a.publish_date || 'Unknown'})`,
      `   Author: ${a.author || 'Unknown'}`,
      `   Topics: ${topics.join(', ') || 'N/A'}`,
      `   Sentiment: ${a.cl_sentiment_score || '?'}/7 — ${a.cl_sentiment_label || ''}`,
      `   Key Takeaway: ${a.cl_key_takeaway || 'N/A'}`,
      a.full_text ? `   First 500 chars: ${a.full_text.slice(0, 500)}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const outletList = [...new Set(articles.map(a => a.outlet).filter(Boolean))].join(', ');
  const dateRange = articles.map(a => a.publish_date).filter(Boolean).sort();
  const dateStr = dateRange.length > 0 ? `${dateRange[0]} to ${dateRange[dateRange.length - 1]}` : 'various dates';

  const systemPrompt = [
    'You are a media intelligence analyst at a strategic communications firm.',
    'You are writing an internal media coverage report for a client.',
    'Write in a professional, concise, third-person tone.',
    'Do NOT use markdown formatting — output plain text only.',
    'Return a JSON object with two fields:',
    '  "summary": A 2-4 paragraph narrative summary of the media coverage. Mention which outlets covered the story, key themes, notable quotes or positions, and what the client should know. Reference the client by name where appropriate.',
    '  "key_narratives": An array of 3-6 strings, each a brief (1-2 sentence) description of a critical narrative or theme emerging from the coverage.',
    'Return ONLY valid JSON. No markdown backticks, no preamble.',
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
      max_tokens: 2000,
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

function buildClipsDoc(articles, workstream, headerConfig, aiResult) {
  const children = [];
  const now = new Date();
  const dateStr = headerConfig.date || now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  // --- Header: TO / DATE / RE ---
  const headerFields = [
    { label: 'TO:', value: headerConfig.to || workstream.client || '' },
    { label: 'DATE:', value: dateStr },
    { label: 'RE:', value: headerConfig.re || `${workstream.name} – Media Coverage Report` },
  ];

  for (const { label, value } of headerFields) {
    children.push(new Paragraph({
      spacing: { after: 60 },
      tabStops: [{ type: TabStopType.LEFT, position: TabStopPosition.MAX * 0.08 }],
      children: [
        new TextRun({ text: label, font: 'Arial', size: 22, bold: true, color: '333333' }),
        new TextRun({ text: '\t', font: 'Arial' }),
        new TextRun({ text: value, font: 'Arial', size: 22, color: '333333' }),
      ],
    }));
  }

  // Horizontal rule
  children.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [
    new TextRun({ text: '─'.repeat(80), font: 'Arial', size: 16, color: 'CCCCCC' }),
  ]}));

  // --- Summary section ---
  children.push(new Paragraph({ spacing: { before: 100, after: 200 }, children: [
    new TextRun({ text: 'Summary', font: 'Arial', size: 26, bold: true, color: '1a1a1a' }),
  ]}));

  if (aiResult?.summary) {
    const summaryParagraphs = aiResult.summary.split(/\n\s*\n/).filter(p => p.trim());
    for (const para of summaryParagraphs) {
      children.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: [
        new TextRun({ text: para.trim(), font: 'Arial', size: 21, color: '333333' }),
      ]}));
    }
  }

  // --- Key Narratives ---
  if (aiResult?.key_narratives?.length > 0) {
    children.push(new Paragraph({ spacing: { before: 300, after: 100 }, children: [
      new TextRun({ text: 'Key Narratives', font: 'Arial', size: 26, bold: true, color: '1a1a1a' }),
    ]}));

    for (const narrative of aiResult.key_narratives) {
      children.push(new Paragraph({
        spacing: { before: 60, after: 60 },
        bullet: { level: 0 },
        children: [
          new TextRun({ text: narrative, font: 'Arial', size: 21, color: '333333' }),
        ],
      }));
    }
  }

  // Horizontal rule
  children.push(new Paragraph({ spacing: { before: 300, after: 200 }, children: [
    new TextRun({ text: '─'.repeat(80), font: 'Arial', size: 16, color: 'CCCCCC' }),
  ]}));

  // --- Media Coverage: Article Index ---
  children.push(new Paragraph({ spacing: { before: 100, after: 200 }, children: [
    new TextRun({ text: 'Media Coverage', font: 'Arial', size: 26, bold: true, color: '1a1a1a' }),
  ]}));

  for (const a of articles) {
    const datePart = a.publish_date ? formatClipsDate(a.publish_date) : '';
    const parts = [
      new TextRun({ text: 'ARTICLE: ', font: 'Arial', size: 21, bold: true, color: '333333' }),
      new TextRun({ text: `"${a.headline}"`, font: 'Arial', size: 21, color: '333333' }),
      new TextRun({ text: ` (${a.outlet || 'Unknown'}${datePart ? ', ' + datePart : ''})`, font: 'Arial', size: 21, color: '666666' }),
    ];

    children.push(new Paragraph({ spacing: { before: 40, after: 40 }, children: parts }));

    // Add URL as hyperlink if available
    if (a.url) {
      children.push(new Paragraph({ spacing: { after: 20 }, children: [
        new TextRun({ text: '\t' }),
        new ExternalHyperlink({
          link: a.url,
          children: [new TextRun({ text: a.url, font: 'Arial', size: 18, color: '0563C1', underline: {} })],
        }),
      ]}));
    }
  }

  // Horizontal rule
  children.push(new Paragraph({ spacing: { before: 300, after: 200 }, children: [
    new TextRun({ text: '─'.repeat(80), font: 'Arial', size: 16, color: 'CCCCCC' }),
  ]}));

  // --- Full Articles ---
  children.push(new Paragraph({ spacing: { before: 100, after: 200 }, children: [
    new TextRun({ text: 'Media Coverage: Full Articles', font: 'Arial', size: 26, bold: true, color: '1a1a1a' }),
  ]}));

  for (const a of articles) {
    // Article headline
    children.push(new Paragraph({ spacing: { before: 300, after: 40 }, children: [
      new TextRun({ text: a.headline, font: 'Arial', size: 24, bold: true, color: '1a1a1a' }),
    ]}));

    // Outlet, Author, Date on separate lines for clean formatting
    if (a.outlet) {
      children.push(new Paragraph({ spacing: { after: 20 }, children: [
        new TextRun({ text: a.outlet, font: 'Arial', size: 21, color: '666666' }),
      ]}));
    }
    if (a.author) {
      children.push(new Paragraph({ spacing: { after: 20 }, children: [
        new TextRun({ text: `By ${a.author}`, font: 'Arial', size: 21, color: '666666' }),
      ]}));
    }
    if (a.publish_date) {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [
        new TextRun({ text: formatClipsDate(a.publish_date), font: 'Arial', size: 21, color: '666666' }),
      ]}));
    }

    // URL
    if (a.url) {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [
        new ExternalHyperlink({
          link: a.url,
          children: [new TextRun({ text: a.url, font: 'Arial', size: 18, color: '0563C1', underline: {} })],
        }),
      ]}));
    }

    // Full text — cleaned and split into proper paragraphs
    const cleanedText = cleanArticleText(a.full_text || '');
    const textParagraphs = cleanedText.split(/\n\s*\n/).filter(p => p.trim());
    for (const para of textParagraphs) {
      // Replace single newlines within a paragraph with spaces for proper flow
      const flowedText = para.trim().replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
      children.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: [
        new TextRun({ text: flowedText, font: 'Arial', size: 21, color: '333333' }),
      ]}));
    }

    // Separator between articles
    children.push(new Paragraph({ spacing: { before: 200, after: 100 }, children: [] }));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 21 } } } },
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
                new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: '999999' }),
                new TextRun({ text: ' of ', font: 'Arial', size: 16, color: '999999' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 16, color: '999999' }),
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

// Generate clips for a date range
router.post('/:workstream_id/generate', async (req, res) => {
  const wsId = req.params.workstream_id;
  const { date_from, date_to, article_ids, header_to, header_re, header_date } = req.body;

  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', wsId);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });

  let articles;
  if (article_ids && Array.isArray(article_ids) && article_ids.length > 0) {
    // Specific articles selected
    const placeholders = article_ids.map(() => '?').join(',');
    articles = await db.all(
      `SELECT * FROM articles WHERE id IN (${placeholders}) AND workstream_id = ? ORDER BY publish_date DESC`,
      ...article_ids, wsId
    );
  } else if (date_from) {
    // Date range
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

  // Parse JSON fields for articles
  for (const a of articles) {
    a.cl_topics = safeParseJson(a.cl_topics);
    a.cl_firms_mentioned = safeParseJson(a.cl_firms_mentioned);
    a.cl_firm_sentiments = safeParseJson(a.cl_firm_sentiments);
    a.cl_key_entities = safeParseJson(a.cl_key_entities);
    a.cl_geographic_tags = safeParseJson(a.cl_geographic_tags);
    a.cl_policy_dimensions = safeParseJson(a.cl_policy_dimensions);
    a.cl_stakeholder_focus = safeParseJson(a.cl_stakeholder_focus);
  }

  const headerConfig = {
    to: header_to || '',
    re: header_re || '',
    date: header_date || '',
  };

  // Generate AI summary
  let aiResult;
  try {
    aiResult = await generateClipsSummary(articles, { ...ws, client: ws.client }, headerConfig);
  } catch (e) {
    console.error('Clips AI summary failed:', e.message);
    aiResult = { summary: `Media coverage report covering ${articles.length} articles.`, key_narratives: [] };
  }

  // Build Word document
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
