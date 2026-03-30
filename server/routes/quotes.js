import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { workstream_id, type, stance, search, role } = req.query;
  if (!workstream_id) return res.status(400).json({ error: 'workstream_id required' });

  let sql = `SELECT q.*, a.headline as article_headline, a.outlet as article_outlet, a.publish_date as article_date
    FROM quotes q JOIN articles a ON q.article_id = a.id
    WHERE q.workstream_id = ?`;
  const params = [workstream_id];

  if (type) { sql += ' AND q.type = ?'; params.push(type); }
  if (role) { sql += ' AND q.role = ?'; params.push(role); }
  if (stance) { sql += ' AND q.stance = ?'; params.push(stance); }
  if (search) { sql += ' AND (q.text LIKE ? OR q.speaker LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  sql += ' ORDER BY a.publish_date DESC';
  res.json(await db.all(sql, ...params));
});

// Speaker tracker: aggregate quote counts per speaker
router.get('/speakers', async (req, res) => {
  const { workstream_id } = req.query;
  if (!workstream_id) return res.status(400).json({ error: 'workstream_id required' });

  const rows = await db.all(`
    SELECT speaker, type, stance, COUNT(*) as count
    FROM quotes WHERE workstream_id = ? AND speaker IS NOT NULL
    GROUP BY speaker, type, stance ORDER BY speaker
  `, workstream_id);

  // Aggregate into speaker objects
  const speakers = {};
  for (const r of rows) {
    if (!speakers[r.speaker]) {
      speakers[r.speaker] = { name: r.speaker, type: r.type, total: 0, stances: {} };
    }
    speakers[r.speaker].total += r.count;
    speakers[r.speaker].stances[r.stance] = (speakers[r.speaker].stances[r.stance] || 0) + r.count;
  }
  res.json(Object.values(speakers).sort((a, b) => b.total - a.total));
});

export default router;
