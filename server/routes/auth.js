import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { signToken, authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, name, password, invite_code } = req.body;

  if (!email || !name || !password) return res.status(400).json({ error: 'Email, name, and password required' });

  // Check invite code
  const requiredCode = process.env.ADMIN_INVITE_CODE;
  if (requiredCode && invite_code !== requiredCode) {
    return res.status(403).json({ error: 'Invalid invite code' });
  }

  // Check if email exists
  const existing = await db.get('SELECT id FROM users WHERE email = ?', email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 10);
  const id = uuid();

  // First user is auto-admin
  const userCount = await db.get('SELECT COUNT(*) as c FROM users');
  const role = userCount.c === 0 ? 'admin' : 'viewer';

  await db.run('INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)', id, email, name, passwordHash, role);

  const token = signToken({ userId: id, email, name, role });
  res.json({ token, user: { id, email, name, role } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await db.get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  await db.run('UPDATE users SET last_login = datetime(?) WHERE id = ?', new Date().toISOString(), user.id);

  const token = signToken({ userId: user.id, email: user.email, name: user.name, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.get('/me', authenticate, async (req, res) => {
  if (req.user.userId === 'local') {
    return res.json({ id: 'local', email: 'local@dev', name: 'Local User', role: 'admin' });
  }
  const user = await db.get('SELECT id, email, name, role, created_at, last_login FROM users WHERE id = ?', req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.post('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });

  const user = await db.get('SELECT password_hash FROM users WHERE id = ?', req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

  const hash = await bcrypt.hash(new_password, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, req.user.userId);
  res.json({ success: true });
});

// Admin: list users
router.get('/users', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  const users = await db.all('SELECT id, email, name, role, created_at, last_login, active FROM users ORDER BY created_at DESC');
  res.json(users);
});

// Admin: update user role or deactivate
router.put('/users/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
  const { role, active } = req.body;
  if (role !== undefined) await db.run('UPDATE users SET role = ? WHERE id = ?', role, req.params.id);
  if (active !== undefined) await db.run('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, req.params.id);
  res.json({ success: true });
});

export default router;
