import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const rows = await db.all('SELECT * FROM workstreams WHERE status = ? ORDER BY created_at DESC', 'active');
  res.json(rows.map(r => ({ ...r, taxonomy: JSON.parse(r.taxonomy), alert_config: JSON.parse(r.alert_config), strategic_context: r.strategic_context || '' })));
});

router.post('/', async (req, res) => {
  const { name, client, taxonomy, alert_config, strategic_context } = req.body;
  if (!name || !client || !taxonomy) return res.status(400).json({ error: 'name, client, taxonomy required' });
  const id = uuid();
  await db.run('INSERT INTO workstreams (id, name, client, taxonomy, alert_config, strategic_context) VALUES (?, ?, ?, ?, ?, ?)',
    id, name, client, JSON.stringify(taxonomy), JSON.stringify(alert_config || {}), strategic_context || '');
  res.json({ id, name, client, taxonomy, alert_config: alert_config || {}, strategic_context: strategic_context || '' });
});

router.put('/:id', async (req, res) => {
  const { name, client, taxonomy, alert_config, strategic_context } = req.body;
  const existing = await db.get('SELECT * FROM workstreams WHERE id = ?', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const sets = [];
  const vals = [];
  if (name !== undefined) { sets.push('name = ?'); vals.push(name); }
  if (client !== undefined) { sets.push('client = ?'); vals.push(client); }
  if (taxonomy !== undefined) { sets.push('taxonomy = ?'); vals.push(JSON.stringify(taxonomy)); }
  if (alert_config !== undefined) { sets.push('alert_config = ?'); vals.push(JSON.stringify(alert_config)); }
  if (strategic_context !== undefined) { sets.push('strategic_context = ?'); vals.push(strategic_context); }

  if (sets.length > 0) {
    vals.push(req.params.id);
    await db.run(`UPDATE workstreams SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  }
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  await db.run('UPDATE workstreams SET status = ? WHERE id = ?', 'archived', req.params.id);
  res.json({ success: true });
});

export default router;
