import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Log an activity (called internally by other routes)
export async function logActivity(userId, userName, action, entityType, entityId, details) {
  try {
    await db.run('INSERT INTO activity_log (id, user_id, user_name, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
      uuid(), userId || null, userName || null, action, entityType || null, entityId || null, details ? JSON.stringify(details) : null);
  } catch {} // Don't let logging errors break the main flow
}

// GET /api/activity — admin only
router.get('/', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

  const { user_id, action, workstream_id, limit: lim } = req.query;
  let sql = 'SELECT * FROM activity_log';
  const conditions = [];
  const params = [];

  if (user_id) { conditions.push('user_id = ?'); params.push(user_id); }
  if (action) { conditions.push('action = ?'); params.push(action); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(lim) || 100);

  const rows = await db.all(sql, ...params);
  res.json(rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null })));
});

export default router;
