import { Router } from 'express';
import db from '../db.js';
import XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, Header, Footer, PageNumber, HeadingLevel, ShadingType, convertInchesToTwip } from 'docx';

const router = Router();

// Normalize stance: map institutional investor stances to unified
function unifyStance(stance, type) {
  if (type === 'institutional_investor') {
    if (stance === 'bullish') return 'positive';
    if (stance === 'bearish') return 'negative';
    if (stance === 'cautious') return 'neutral';
  }
  return stance || 'neutral';
}

function normName(name) {
  if (!name) return 'Unknown';
  return name.trim().replace(/\b\w/g, c => c.toUpperCase());
}

function stanceNumeric(s) {
  if (s === 'positive') return 1;
  if (s === 'negative') return -1;
  return 0;
}

function formatDateStr(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return d; }
}

function safeParseJson(str) {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
}

async function gatherQuotes(wsId, { stances, types, roles, from, to }) {
  // Use the quotes table directly — it has normalized types and stances
  let sql = `SELECT q.*, a.headline as article_headline, a.outlet as article_outlet, a.author as article_author, a.publish_date as article_date, a.url as article_url
    FROM quotes q JOIN articles a ON q.article_id = a.id
    WHERE q.workstream_id = ? AND (q.sentiment IS NULL OR q.sentiment != ?)`;
  const params = [wsId, 'flagged_irrelevant'];

  const rows = await db.all(sql, ...params);

  const stanceSet = new Set(stances);
  const typeSet = new Set(types);
  const roleSet = new Set(roles);

  const quotes = [];
  for (const q of rows) {
    // Date filter
    if (from && q.article_date && q.article_date < from) continue;
    if (to && q.article_date && q.article_date > to) continue;
    // Type filter
    if (!typeSet.has(q.type)) continue;
    // Stance filter
    if (!stanceSet.has(q.stance || 'neutral')) continue;
    // Role filter
    const qRole = (q.role || 'other').toLowerCase();
    if (!roleSet.has(qRole)) continue;

    quotes.push({
      date: q.article_date,
      headline: q.article_headline,
      outlet: q.article_outlet,
      reporter: q.article_author,
      speaker: normName(q.speaker || 'Unknown'),
      affiliation: q.speaker_org || '',
      role: q.role || 'other',
      quote_type: q.type === 'internal' ? 'Internal' : 'External',
      quote: q.text,
      stance: q.stance || 'neutral',
      url: q.article_url || '',
      article_id: q.article_id,
    });
  }

  quotes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return quotes;
}

function buildSpeakerSummary(quotes) {
  const speakers = {};
  for (const q of quotes) {
    const key = q.speaker;
    if (!speakers[key]) {
      speakers[key] = { speaker: q.speaker, affiliation: q.affiliation, role: q.role, total: 0, positive: 0, neutral: 0, negative: 0, dates: [], outlets: new Set() };
    }
    const s = speakers[key];
    s.total++;
    if (q.stance === 'positive') s.positive++;
    else if (q.stance === 'negative') s.negative++;
    else s.neutral++;
    if (q.date) s.dates.push(q.date);
    if (q.outlet) s.outlets.add(q.outlet);
    // Keep most specific affiliation/role
    if (!s.affiliation && q.affiliation) s.affiliation = q.affiliation;
    if (s.role === 'other' && q.role !== 'other') s.role = q.role;
  }
  return Object.values(speakers)
    .map(s => ({
      ...s,
      avg_stance: s.total > 0 ? +((s.positive - s.negative) / s.total).toFixed(2) : 0,
      most_recent: s.dates.sort().reverse()[0] || '',
      outlets_list: [...s.outlets].join(', '),
    }))
    .sort((a, b) => b.total - a.total);
}

function parseFilterParam(val, defaults) {
  if (!val) return defaults;
  return val.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

router.get('/:workstream_id/quotes', async (req, res) => {
  const { workstream_id } = req.params;
  const { format, stance, type, roles, from, to } = req.query;

  const ws = await db.get('SELECT * FROM workstreams WHERE id = ?', workstream_id);
  if (!ws) return res.status(404).json({ error: 'Workstream not found' });

  const stances = parseFilterParam(stance, ['positive', 'neutral', 'negative']);
  const types = parseFilterParam(type, ['external', 'internal']);
  const roleList = parseFilterParam(roles, ['regulator', 'legislator', 'academic', 'rating_agency', 'legal_expert', 'former_official', 'journalist', 'analyst', 'investor_advocate', 'institutional_investor', 'fund_executive', 'portfolio_manager', 'spokesperson', 'trade_association', 'other']);

  const quotes = await gatherQuotes(workstream_id, { stances, types, roles: roleList, from, to });
  const speakerSummary = buildSpeakerSummary(quotes);

  const wsName = ws.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const dateStr = new Date().toISOString().split('T')[0];
  const uniqueArticles = new Set(quotes.map(q => q.article_id)).size;

  if (format === 'docx') {
    const doc = buildWordDoc(ws, quotes, speakerSummary, stances, from, to, uniqueArticles);
    const buf = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=${wsName}_third_party_quotes_${dateStr}.docx`);
    return res.send(buf);
  }

  // Default: xlsx
  const wb = buildExcelWorkbook(quotes, speakerSummary, stances);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${wsName}_third_party_quotes_${dateStr}.xlsx`);
  res.send(buf);
});

// Also expose a count endpoint for live preview
router.get('/:workstream_id/quotes/count', async (req, res) => {
  const { workstream_id } = req.params;
  const { stance, type, roles, from, to } = req.query;

  const stances = parseFilterParam(stance, ['positive', 'neutral', 'negative']);
  const types = parseFilterParam(type, ['external', 'internal']);
  const roleList = parseFilterParam(roles, ['regulator', 'legislator', 'academic', 'rating_agency', 'legal_expert', 'former_official', 'journalist', 'analyst', 'investor_advocate', 'institutional_investor', 'fund_executive', 'portfolio_manager', 'spokesperson', 'trade_association', 'other']);

  const quotes = await gatherQuotes(workstream_id, { stances, types, roles: roleList, from, to });
  const speakers = new Set(quotes.map(q => q.speaker)).size;
  const articles = new Set(quotes.map(q => q.article_id)).size;

  res.json({ quotes: quotes.length, speakers, articles });
});

// ── Excel builder ──

function buildExcelWorkbook(quotes, speakerSummary, stances) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: All Quotes
  const allRows = quotes.map(q => ({
    Date: formatDateStr(q.date),
    Headline: q.headline,
    Outlet: q.outlet,
    Reporter: q.reporter,
    Speaker: q.speaker,
    Affiliation: q.affiliation,
    Role: q.role,
    'Quote Type': q.quote_type,
    Quote: q.quote,
    Stance: q.stance,
    'Article URL': q.url,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows.length > 0 ? allRows : [{ Note: 'No quotes found' }]), 'All Quotes');

  // Sheet 2: Speaker Summary
  const speakerRows = speakerSummary.map(s => ({
    Speaker: s.speaker,
    Affiliation: s.affiliation,
    Role: s.role,
    'Total Quotes': s.total,
    Positive: s.positive,
    Neutral: s.neutral,
    Negative: s.negative,
    'Avg Stance': s.avg_stance,
    'Most Recent Date': formatDateStr(s.most_recent),
    'Outlets Appeared In': s.outlets_list,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(speakerRows.length > 0 ? speakerRows : [{ Note: 'No speakers found' }]), 'Speaker Summary');

  // Sheet 3: By Stance
  const byStanceRows = [];
  const stanceOrder = ['negative', 'neutral', 'positive'];
  for (const s of stanceOrder) {
    if (!stances.includes(s)) continue;
    const filtered = quotes.filter(q => q.stance === s);
    if (filtered.length === 0) continue;
    byStanceRows.push({ Date: `── ${s.toUpperCase()} QUOTES (${filtered.length}) ──`, Headline: '', Outlet: '', Reporter: '', Speaker: '', Affiliation: '', Role: '', 'Quote Type': '', Quote: '', Stance: '', 'Article URL': '' });
    for (const q of filtered) {
      byStanceRows.push({
        Date: formatDateStr(q.date), Headline: q.headline, Outlet: q.outlet, Reporter: q.reporter,
        Speaker: q.speaker, Affiliation: q.affiliation, Role: q.role, 'Quote Type': q.quote_type,
        Quote: q.quote, Stance: q.stance, 'Article URL': q.url,
      });
    }
    byStanceRows.push({}); // blank separator
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byStanceRows.length > 0 ? byStanceRows : [{ Note: 'No quotes found' }]), 'By Stance');

  return wb;
}

// ── Word doc builder ──

function buildWordDoc(ws, quotes, speakerSummary, stances, from, to, uniqueArticles) {
  const totalQ = quotes.length;
  const totalSpeakers = speakerSummary.length;
  const negCount = quotes.filter(q => q.stance === 'negative').length;
  const neuCount = quotes.filter(q => q.stance === 'neutral').length;
  const posCount = quotes.filter(q => q.stance === 'positive').length;
  const negPct = totalQ > 0 ? Math.round((negCount / totalQ) * 100) : 0;
  const neuPct = totalQ > 0 ? Math.round((neuCount / totalQ) * 100) : 0;
  const posPct = totalQ > 0 ? Math.round((posCount / totalQ) * 100) : 0;

  const top3 = speakerSummary.slice(0, 3).map(s => `${s.speaker}${s.affiliation ? ` (${s.affiliation})` : ''}`).join(', ') || 'N/A';

  const dateRange = `${from ? formatDateStr(from) : 'earliest'} to ${to ? formatDateStr(to) : 'present'}`;
  const genDate = formatDateStr(new Date().toISOString());

  const children = [];

  // Title page
  children.push(
    new Paragraph({ spacing: { before: 3000 }, alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: 'Third-Party Stakeholder Quotes Report', font: 'Arial', size: 36, bold: true, color: '002855' }),
    ]}),
    new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: ws.name, font: 'Arial', size: 28, color: '0057b8' }),
    ]}),
    new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: `Date Range: ${dateRange}`, font: 'Arial', size: 22, color: '4a6080' }),
    ]}),
    new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: `Generated: ${genDate}`, font: 'Arial', size: 22, color: '4a6080' }),
    ]}),
    new Paragraph({ spacing: { before: 600 }, children: [] }), // spacer
  );

  // Executive Summary
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 600, after: 200 }, children: [
      new TextRun({ text: 'Executive Summary', font: 'Arial', size: 28, bold: true, color: '002855' }),
    ]}),
    new Paragraph({ spacing: { after: 300 }, children: [
      new TextRun({ text: `This report compiles ${totalQ} quotes from ${totalSpeakers} external stakeholders across ${uniqueArticles} articles in the ${ws.name} workstream from ${dateRange}. ${negPct}% of quotes were negative, ${neuPct}% neutral, and ${posPct}% positive. The most frequently quoted stakeholders were ${top3}.`, font: 'Arial', size: 22 }),
    ]}),
  );

  // Quote sections by stance
  const stanceSections = [
    { key: 'negative', heading: 'Critical / Negative Stakeholder Commentary' },
    { key: 'neutral', heading: 'Neutral / Balanced Stakeholder Commentary' },
    { key: 'positive', heading: 'Supportive / Positive Stakeholder Commentary' },
  ];

  for (const sec of stanceSections) {
    if (!stances.includes(sec.key)) continue;
    const filtered = quotes.filter(q => q.stance === sec.key);
    if (filtered.length === 0) continue;

    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 500, after: 200 }, children: [
        new TextRun({ text: sec.heading, font: 'Arial', size: 28, bold: true, color: '002855' }),
      ]}),
    );

    const display = filtered.slice(0, 25);
    for (const q of display) {
      // Quote text - italics, indented
      children.push(
        new Paragraph({ indent: { left: convertInchesToTwip(0.5) }, spacing: { before: 200, after: 60 }, children: [
          new TextRun({ text: `"${q.quote}"`, font: 'Arial', size: 22, italics: true, color: '333333' }),
        ]}),
        // Attribution
        new Paragraph({ indent: { left: convertInchesToTwip(0.5) }, spacing: { after: 40 }, children: [
          new TextRun({ text: `— ${q.speaker}`, font: 'Arial', size: 20, bold: true, color: '002855' }),
          new TextRun({ text: q.affiliation ? `, ${q.affiliation}` : '', font: 'Arial', size: 20, color: '4a6080' }),
          new TextRun({ text: ` (${q.role})`, font: 'Arial', size: 20, color: '4a6080' }),
        ]}),
        // Source
        new Paragraph({ indent: { left: convertInchesToTwip(0.5) }, spacing: { after: 200 }, children: [
          new TextRun({ text: `${q.headline}, ${q.outlet || 'Unknown'}, ${formatDateStr(q.date)}`, font: 'Arial', size: 18, color: '999999' }),
        ]}),
      );
    }

    if (filtered.length > 25) {
      children.push(
        new Paragraph({ spacing: { before: 100, after: 200 }, children: [
          new TextRun({ text: `${filtered.length - 25} additional ${sec.key} quotes in spreadsheet export`, font: 'Arial', size: 20, italics: true, color: '4a6080' }),
        ]}),
      );
    }
  }

  // Speaker Index Table
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 500, after: 200 }, children: [
      new TextRun({ text: 'Speaker Index', font: 'Arial', size: 28, bold: true, color: '002855' }),
    ]}),
  );

  const headerShading = { type: ShadingType.SOLID, color: 'D6E4F0', fill: 'D6E4F0' };
  const lightBorder = { style: BorderStyle.SINGLE, size: 1, color: 'B8CCE0' };
  const cellBorders = { top: lightBorder, bottom: lightBorder, left: lightBorder, right: lightBorder };

  function makeCell(text, opts = {}) {
    return new TableCell({
      borders: cellBorders,
      shading: opts.shading,
      width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      children: [new Paragraph({ spacing: { before: 40, after: 40 }, children: [
        new TextRun({ text: text || '', font: 'Arial', size: opts.size || 18, bold: opts.bold, color: opts.color || '333333' }),
      ]})],
    });
  }

  const tableRows = [
    new TableRow({ children: [
      makeCell('Speaker', { bold: true, shading: headerShading, width: 20, color: '002855' }),
      makeCell('Affiliation', { bold: true, shading: headerShading, width: 20, color: '002855' }),
      makeCell('Role', { bold: true, shading: headerShading, width: 12, color: '002855' }),
      makeCell('Quotes', { bold: true, shading: headerShading, width: 10, color: '002855' }),
      makeCell('Stance Breakdown', { bold: true, shading: headerShading, width: 38, color: '002855' }),
    ]}),
  ];

  for (const s of speakerSummary) {
    const parts = [];
    if (s.negative > 0) parts.push(`${s.negative} negative`);
    if (s.neutral > 0) parts.push(`${s.neutral} neutral`);
    if (s.positive > 0) parts.push(`${s.positive} positive`);
    tableRows.push(new TableRow({ children: [
      makeCell(s.speaker),
      makeCell(s.affiliation),
      makeCell(s.role),
      makeCell(String(s.total)),
      makeCell(parts.join(', ')),
    ]}));
  }

  if (speakerSummary.length > 0) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows,
    }));
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: 'No speakers found.', font: 'Arial', size: 22, color: '4a6080' })] }));
  }

  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 22 } },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
            new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: '999999' }),
            new TextRun({ text: ' of ', font: 'Arial', size: 18, color: '999999' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 18, color: '999999' }),
          ]})],
        }),
      },
      children,
    }],
  });
}

export default router;
