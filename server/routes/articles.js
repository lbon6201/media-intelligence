import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { cleanOutletName } from '../outletNorm.js';

const router = Router();

const JSON_FIELDS = [
  'cl_topics', 'cl_geographic_tags', 'cl_policy_dimensions',
  'cl_stakeholder_focus', 'cl_key_entities', 'cl_firms_mentioned',
  'cl_firm_sentiments', 'cl_institutional_investor_quotes', 'cl_external_quotes',
  'internal_flags', 'internal_tags',
];

function parseJsonFields(row) {
  const r = { ...row };
  for (const f of JSON_FIELDS) {
    if (r[f]) {
      try { r[f] = JSON.parse(r[f]); } catch { /* keep as string */ }
    }
  }
  return r;
}

router.get('/', async (req, res) => {
  const { workstream_id, status, topic, search, sentiment_min, sentiment_max, date_from, date_to, sort_by, sort_dir, flag, has_notes } = req.query;
  if (!workstream_id) return res.status(400).json({ error: 'workstream_id required' });

  let sql = 'SELECT * FROM articles WHERE workstream_id = ?';
  const params = [workstream_id];

  if (status) {
    sql += ' AND cl_status = ?';
    params.push(status);
  }
  if (topic) {
    sql += ' AND cl_topics LIKE ?';
    params.push(`%${topic}%`);
  }
  if (search) {
    sql += ' AND (headline LIKE ? OR author LIKE ? OR cl_key_takeaway LIKE ? OR cl_rationale LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (sentiment_min) {
    sql += ' AND cl_sentiment_score >= ?';
    params.push(Number(sentiment_min));
  }
  if (sentiment_max) {
    sql += ' AND cl_sentiment_score <= ?';
    params.push(Number(sentiment_max));
  }
  if (date_from) {
    sql += ' AND publish_date >= ?';
    params.push(date_from);
  }
  if (date_to) {
    sql += ' AND publish_date <= ?';
    params.push(date_to);
  }
  if (flag) {
    sql += ' AND internal_flags LIKE ?';
    params.push(`%${flag}%`);
  }
  if (has_notes === '1') {
    sql += ' AND internal_notes IS NOT NULL AND internal_notes != ?';
    params.push('');
  }

  const validSorts = ['ingested_at', 'publish_date', 'cl_sentiment_score', 'headline', 'outlet', 'cl_status', 'cl_relevance_tier'];
  const col = validSorts.includes(sort_by) ? sort_by : 'ingested_at';
  const dir = sort_dir === 'ASC' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${col} ${dir}`;

  const rows = await db.all(sql, ...params);
  res.json(rows.map(parseJsonFields));
});

router.post('/ingest', async (req, res) => {
  const { articles } = req.body;
  if (!Array.isArray(articles) || articles.length === 0) return res.status(400).json({ error: 'articles array required' });

  let ingested = 0;
  let duplicates = 0;
  const errors = [];

  await db.transaction(async () => {
    for (const a of articles) {
      if (!a.headline || !a.full_text || !a.workstream_id || !a.fingerprint) {
        errors.push({ headline: a.headline, error: 'Missing required fields' });
        continue;
      }
      const dup = await db.get('SELECT id FROM articles WHERE fingerprint = ?', a.fingerprint);
      if (dup) { duplicates++; continue; }
      const normalizedOutlet = cleanOutletName(a.outlet) || a.outlet || null;
      await db.run(`INSERT INTO articles (id, workstream_id, source_type, headline, outlet, outlet_type, author, publish_date, url, full_text, word_count, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uuid(), a.workstream_id, a.source_type || 'paste',
        a.headline, normalizedOutlet, a.outlet_type || null,
        a.author || null, a.publish_date || null, a.url || null,
        a.full_text, a.word_count || a.full_text.split(/\s+/).length,
        a.fingerprint
      );
      ingested++;
    }
  });

  res.json({ ingested, duplicates, errors });
});

// Normalize all existing outlet names
router.post('/normalize-outlets', async (req, res) => {
  const rows = await db.all('SELECT id, outlet FROM articles WHERE outlet IS NOT NULL');
  let changed = 0;
  await db.transaction(async () => {
    for (const r of rows) {
      const normalized = cleanOutletName(r.outlet);
      if (normalized && normalized !== r.outlet) {
        await db.run('UPDATE articles SET outlet = ? WHERE id = ?', normalized, r.id);
        changed++;
      }
    }
  });
  res.json({ total: rows.length, changed });
});

router.put('/:id', async (req, res) => {
  const { cl_status, internal_notes, internal_flags, internal_tags, annotated_by } = req.body;
  if (cl_status) {
    const now = cl_status === 'approved' ? new Date().toISOString() : null;
    await db.run('UPDATE articles SET cl_status = ?, approved_at = COALESCE(?, approved_at) WHERE id = ?', cl_status, now, req.params.id);
  }
  if (internal_notes !== undefined || internal_flags !== undefined || internal_tags !== undefined || annotated_by !== undefined) {
    const sets = [];
    const vals = [];
    if (internal_notes !== undefined) { sets.push('internal_notes = ?'); vals.push(internal_notes); }
    if (internal_flags !== undefined) { sets.push('internal_flags = ?'); vals.push(JSON.stringify(internal_flags)); }
    if (internal_tags !== undefined) { sets.push('internal_tags = ?'); vals.push(JSON.stringify(internal_tags)); }
    if (annotated_by !== undefined) { sets.push('annotated_by = ?'); vals.push(annotated_by); }
    sets.push("annotated_at = datetime('now')");
    vals.push(req.params.id);
    await db.run(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  }
  res.json({ success: true });
});

router.put('/bulk-status', async (req, res) => {
  const { ids, cl_status } = req.body;
  if (!Array.isArray(ids) || !cl_status) return res.status(400).json({ error: 'ids array and cl_status required' });
  const now = cl_status === 'approved' ? new Date().toISOString() : null;
  await db.transaction(async () => {
    for (const id of ids) await db.run('UPDATE articles SET cl_status = ?, approved_at = COALESCE(?, approved_at) WHERE id = ?', cl_status, now, id);
  });
  res.json({ success: true, updated: ids.length });
});

router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  await db.transaction(async () => {
    for (const id of ids) {
      await db.run('DELETE FROM quotes WHERE article_id = ?', id);
      await db.run('DELETE FROM articles WHERE id = ?', id);
    }
  });
  res.json({ success: true, deleted: ids.length });
});

router.delete('/:id', async (req, res) => {
  await db.run('DELETE FROM quotes WHERE article_id = ?', req.params.id);
  await db.run('DELETE FROM articles WHERE id = ?', req.params.id);
  res.json({ success: true });
});

export default router;
