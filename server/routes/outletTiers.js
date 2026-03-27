import { Router } from 'express';
import db from '../db.js';

const router = Router();

// List all outlet tiers
router.get('/', async (req, res) => {
  res.json(await db.all('SELECT * FROM outlet_tiers ORDER BY reach_score DESC'));
});

// Upsert outlet tier
router.put('/:outlet_name', async (req, res) => {
  const { tier, reach_score, notes } = req.body;
  await db.run('INSERT INTO outlet_tiers (outlet_name, tier, reach_score, notes) VALUES (?, ?, ?, ?) ON CONFLICT(outlet_name) DO UPDATE SET tier = excluded.tier, reach_score = excluded.reach_score, notes = excluded.notes',
    req.params.outlet_name, tier, reach_score || null, notes || null);
  res.json({ success: true });
});

// Get unassigned outlets (appear in articles but not in tiers)
router.get('/unassigned', async (req, res) => {
  const rows = await db.all(`SELECT DISTINCT a.outlet, COUNT(*) as article_count FROM articles a LEFT JOIN outlet_tiers ot ON a.outlet = ot.outlet_name WHERE a.outlet IS NOT NULL AND ot.outlet_name IS NULL GROUP BY a.outlet ORDER BY article_count DESC`);
  res.json(rows);
});

// Get tier for a specific outlet
router.get('/lookup/:outlet', async (req, res) => {
  const row = await db.get('SELECT * FROM outlet_tiers WHERE outlet_name = ?', req.params.outlet);
  res.json(row || { tier: 'unassigned', reach_score: null });
});

export default router;
