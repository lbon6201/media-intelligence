import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function authenticate(req, res, next) {
  // Skip auth in dev if no JWT_SECRET is set (local SQLite mode)
  if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'production') {
    req.user = { userId: 'local', email: 'local@dev', name: 'Local User', role: 'admin' };
    return next();
  }

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

export function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  if (!req.user) req.user = { userId: 'anonymous', role: 'viewer' };
  next();
}
