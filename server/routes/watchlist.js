import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

function safeJson(str) { try { return JSON.parse(str); } catch { return []; } }
function normName(n) { return (n || '').trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }

function fuzzyMatch(speaker, watchName) {
  const s = speaker.toLowerCase();
  const w = watchName.toLowerCase();
  if (s === w) return true;
  if (s.includes(w) || w.includes(s)) return true;
  // Match last name
  const wParts = w.split(/\s+/);
  const lastName = wParts[wParts.length - 1];
  if (lastName.length > 2 && s.includes(lastName)) return true;
  return false;
}

router.get('/:workstream_id', async (req, res) => {
  const speakers = await db.all('SELECT * FROM watchlist_speakers WHERE workstream_id = ? ORDER BY added_at DESC', req.params.workstream_id);

  // Count quotes per speaker
  const articles = await db.all(`SELECT cl_external_quotes, cl_institutional_investor_quotes, publish_date FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);

  const result = speakers.map(sp => {
    let totalQuotes = 0, lastSeen = null;
    const stances = { positive: 0, neutral: 0, negative: 0 };
    for (const a of articles) {
      for (const q of [...safeJson(a.cl_external_quotes), ...safeJson(a.cl_institutional_investor_quotes)]) {
        if (q.source && fuzzyMatch(q.source, sp.name)) {
          totalQuotes++;
          const st = mapStance(q.stance);
          stances[st] = (stances[st] || 0) + 1;
          if (!lastSeen || (a.publish_date && a.publish_date > lastSeen)) lastSeen = a.publish_date;
        }
      }
    }
    return { ...sp, total_quotes: totalQuotes, last_seen: lastSeen, stances };
  });

  res.json(result);
});

router.post('/:workstream_id', async (req, res) => {
  const { name, affiliation, role, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuid();
  await db.run('INSERT INTO watchlist_speakers (id, workstream_id, name, affiliation, role, notes) VALUES (?, ?, ?, ?, ?, ?)',
    id, req.params.workstream_id, normName(name), affiliation || null, role || null, notes || null);
  res.json({ id, name: normName(name) });
});

router.put('/:workstream_id/:id', async (req, res) => {
  const { name, affiliation, role, notes } = req.body;
  await db.run('UPDATE watchlist_speakers SET name = COALESCE(?, name), affiliation = COALESCE(?, affiliation), role = COALESCE(?, role), notes = COALESCE(?, notes) WHERE id = ? AND workstream_id = ?',
    name || null, affiliation || null, role || null, notes || null, req.params.id, req.params.workstream_id);
  res.json({ success: true });
});

router.delete('/:workstream_id/:id', async (req, res) => {
  await db.run('DELETE FROM watchlist_speakers WHERE id = ? AND workstream_id = ?', req.params.id, req.params.workstream_id);
  res.json({ success: true });
});

// All quotes for a specific watchlisted speaker
router.get('/:workstream_id/:id/quotes', async (req, res) => {
  const sp = await db.get('SELECT * FROM watchlist_speakers WHERE id = ?', req.params.id);
  if (!sp) return res.status(404).json({ error: 'Speaker not found' });

  const articles = await db.all(`SELECT id, headline, outlet, publish_date, cl_external_quotes, cl_institutional_investor_quotes FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);

  const quotes = [];
  for (const a of articles) {
    for (const q of [...safeJson(a.cl_external_quotes), ...safeJson(a.cl_institutional_investor_quotes)]) {
      if (q.source && fuzzyMatch(q.source, sp.name)) {
        quotes.push({ ...q, stance: mapStance(q.stance), article_headline: a.headline, article_outlet: a.outlet, article_date: a.publish_date, article_id: a.id });
      }
    }
  }
  quotes.sort((a, b) => (b.article_date || '').localeCompare(a.article_date || ''));
  res.json(quotes);
});

// Auto-suggest: speakers with 3+ quotes not on watchlist
router.get('/:workstream_id/suggestions', async (req, res) => {
  const watchedRows = await db.all('SELECT name FROM watchlist_speakers WHERE workstream_id = ?', req.params.workstream_id);
  const watched = new Set(watchedRows.map(r => r.name.toLowerCase()));

  const articles = await db.all(`SELECT cl_external_quotes, cl_institutional_investor_quotes FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);

  const counts = {};
  for (const a of articles) {
    for (const q of [...safeJson(a.cl_external_quotes), ...safeJson(a.cl_institutional_investor_quotes)]) {
      if (!q.source) continue;
      const name = normName(q.source);
      if (watched.has(name.toLowerCase())) continue;
      if (!counts[name]) counts[name] = { name, role: q.role || null, count: 0 };
      counts[name].count++;
    }
  }

  const suggestions = Object.values(counts).filter(s => s.count >= 3).sort((a, b) => b.count - a.count);
  res.json(suggestions);
});

function mapStance(s) {
  if (s === 'bullish' || s === 'positive') return 'positive';
  if (s === 'bearish' || s === 'negative') return 'negative';
  return 'neutral';
}

export default router;
