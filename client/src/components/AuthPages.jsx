import React, { useState } from 'react';

export function LoginPage({ onAuth }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('login'); // login | register
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, name, password, invite_code: inviteCode };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      localStorage.setItem('mip-token', data.token);
      onAuth(data.user, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-content)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-4" style={{ background: 'var(--accent)' }}>M</div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Media Intelligence Platform</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{mode === 'login' ? 'Sign in to your account' : 'Create your account'}</p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Name</label>
                <input className="w-full rounded-md px-3 py-2 text-sm outline-none" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}
                  value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Invite Code</label>
                <input className="w-full rounded-md px-3 py-2 text-sm outline-none" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}
                  value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Enter invite code" />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Email</label>
            <input type="email" className="w-full rounded-md px-3 py-2 text-sm outline-none" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}
              value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Password</label>
            <input type="password" className="w-full rounded-md px-3 py-2 text-sm outline-none" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}
              value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 text-sm">
            {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>

          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            {mode === 'login' ? (
              <>Don't have an account? <button type="button" onClick={() => setMode('register')} style={{ color: 'var(--accent)' }}>Register</button></>
            ) : (
              <>Already have an account? <button type="button" onClick={() => setMode('login')} style={{ color: 'var(--accent)' }}>Sign In</button></>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
