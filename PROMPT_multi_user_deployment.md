# PROMPT — Multi-User Deployment

Make the Media Intelligence Platform accessible to 5-10 distributed users with role-based access. Deploy to Railway with a persistent database, authentication, and a Chrome extension that clips to the shared backend.

---

## Infrastructure: Railway Deployment

### Architecture change

Replace SQLite with **PostgreSQL** (Railway provisions this with one click). SQLite doesn't handle concurrent writes from multiple users safely — Postgres does.

```
Railway Project
├── Web Service (Express + React build)
│   ├── Serves the React frontend (static build)
│   ├── Express API routes (all /api/* endpoints)
│   └── Proxies Claude API calls
├── PostgreSQL Database
│   └── All tables (workstreams, articles, reporters, etc.)
└── Environment Variables
    ├── DATABASE_URL (auto-injected by Railway)
    ├── ANTHROPIC_API_KEY
    ├── JWT_SECRET (for auth tokens)
    └── ADMIN_INVITE_CODE (for initial setup)
```

### Database migration: SQLite → PostgreSQL

Convert the schema from CLAUDE.md to Postgres syntax. Key changes:
- `TEXT` stays `TEXT`
- `INTEGER` stays `INTEGER`
- `datetime('now')` → `NOW()`
- Add `SERIAL` or use `UUID` for auto-generated IDs
- Use `node-postgres` (`pg`) package instead of `better-sqlite3`
- Connection via `process.env.DATABASE_URL` (Railway auto-injects this)

### Railway setup

The project deploys as a single service:
1. `npm run build` builds the React frontend into `client/dist/`
2. Express serves `client/dist/` as static files for all non-API routes
3. Express handles `/api/*` routes
4. Railway auto-detects Node.js, runs `npm start`

Add to `package.json`:
```json
{
  "scripts": {
    "build": "cd client && npm run build",
    "start": "node server/index.js",
    "dev": "concurrently \"cd client && npm run dev\" \"node server/index.js\""
  }
}
```

Express serves the frontend:
```javascript
// In server/index.js, after all API routes:
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});
```

### Domain

Railway generates a URL like `media-intelligence-production.up.railway.app`. Optionally configure a custom domain in Railway's settings.

---

## Authentication: Simple JWT-Based Auth

No need for a full auth provider (Auth0, Clerk, etc.) at this scale. Build lightweight auth directly.

### Database: `users` table

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',   -- admin | viewer
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  active BOOLEAN DEFAULT true
);
```

### Roles

**Admin** (1-2 people — the user who configures workstreams):
- Create, edit, delete workstreams
- Edit taxonomy, strategic context, alert config
- Run classification
- Approve/reject articles
- Manage users (invite, deactivate, change roles)
- All viewer permissions

**Viewer** (the rest of the team):
- View all workstreams they have access to
- View articles, reporters, analytics, quotes, dashboards
- Clip articles via Chrome extension
- Add article annotations and reporter notes
- Export data (Excel, Word, JSON)
- Use Strategy Room
- Generate briefings and talking points
- Cannot: create/edit workstreams, run classification, approve/reject, manage users

### Auth endpoints

```
POST /api/auth/login        { email, password } → { token, user }
POST /api/auth/register     { email, name, password, invite_code } → { token, user }
POST /api/auth/logout       Invalidates token (optional — JWTs are stateless)
GET  /api/auth/me           Returns current user from token
```

### Registration flow

No open registration. Two options for adding users:

1. **Invite code:** Admin sets an `ADMIN_INVITE_CODE` env variable on Railway. New users register at `/register` with the code. Simple, no email infrastructure needed. Change the code to revoke future access.

2. **Admin creates accounts:** Admin panel at `/settings/users` where the admin enters email + name, sets a temporary password, and tells the user to log in and change it. Simpler to manage.

Implement option 1 first (invite code). Add option 2 later if needed.

### Token handling

- On login/register, server returns a JWT (signed with `JWT_SECRET` env var)
- Token contains: `{ userId, email, role, exp }` with 7-day expiry
- Frontend stores token in `localStorage`
- Every API request includes `Authorization: Bearer <token>` header
- Express middleware verifies token on all `/api/*` routes except `/api/auth/*`
- Role check middleware: `requireAdmin` for protected routes

```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};
```

### Frontend auth

- Login page at `/login`, register page at `/register`
- After login, token stored in localStorage, user object in React state
- Auth context provider wraps the app — all components can check `user.role`
- If no token or expired token, redirect to `/login`
- UI conditionally hides admin-only actions (classify button, workstream edit, user management) for viewers
- Viewer attempting an admin API route gets a 403 and a toast: "Admin access required"

### Password handling

- Hash passwords with `bcrypt` (npm package `bcryptjs`)
- Salt rounds: 10
- Never store or log plaintext passwords
- "Change password" option in user settings

---

## Workstream Access Control

At 5-10 users, every user can see every workstream for now. If you later need workstream-level permissions (team A sees Private Credit, team B sees Allstate), add a `workstream_access` join table:

```sql
CREATE TABLE workstream_access (
  user_id TEXT REFERENCES users(id),
  workstream_id TEXT REFERENCES workstreams(id),
  PRIMARY KEY (user_id, workstream_id)
);
```

Don't build this now — just note it as a future option. For now, all authenticated users see all workstreams.

---

## Chrome Extension Updates for Multi-User

The extension needs two changes to work with the deployed backend:

### 1. Server URL configuration

The extension popup's server URL field (currently defaulting to `http://localhost:3000`) should:
- Default to the Railway production URL
- Be editable in extension settings
- Persist in `chrome.storage.local`

### 2. Authentication

The extension needs to authenticate against the backend:

**Login flow in extension:**
- On first use (or when token is expired), the extension popup shows email + password fields
- On submit, calls `POST {serverUrl}/api/auth/login`
- Stores the returned JWT in `chrome.storage.local`
- All subsequent clip requests include `Authorization: Bearer <token>` header
- If a clip request returns 401, show the login fields again

**Extension popup states:**
1. Not logged in → show login form
2. Logged in → show current page URL, detected headline, workstream selector, "Clip Article" button
3. Clipping → show progress indicator
4. Success → "Saved to [workstream name]!" with link to view in the tool
5. Error → error message with retry button

### 3. Workstream selector

After login, the extension fetches `GET {serverUrl}/api/workstreams` with the auth token and populates the workstream dropdown. The selected workstream persists in `chrome.storage.local` so the user doesn't have to reselect every time.

---

## Activity Log

With multiple users, you need to know who did what.

### Database: `activity_log` table

```sql
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,             -- article | workstream | reporter | etc.
  entity_id TEXT,
  details TEXT,                 -- JSON blob with action-specific details
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_log_user ON activity_log(user_id);
CREATE INDEX idx_activity_log_created ON activity_log(created_at);
```

### What to log

- Article clipped (who, which article, which workstream)
- Classification run (who triggered, how many articles)
- Article approved/rejected (who, which article)
- Workstream created/edited (who, what changed)
- Export generated (who, what type, which workstream)
- Reporter status changed (who, which reporter, old → new status)
- User logged in
- Annotation added (who, which article/reporter)

### Frontend: Activity feed

- Visible to admins in Settings → Activity Log
- Chronological feed: "[Name] clipped 3 articles to Private Credit — 2 min ago"
- Filterable by user, action type, workstream
- Useful for seeing who's actively using the tool and what they're doing

---

## Real-Time Updates (Optional Enhancement)

When multiple users are active simultaneously, one user clipping an article should appear in another user's queue without requiring a refresh.

### Simple approach: polling

Every 30 seconds, the frontend calls `GET /api/articles?workstream_id=X&since={lastFetchTimestamp}` and merges any new articles into the local state. Lightweight, works immediately, no additional infrastructure.

### Better approach: Server-Sent Events (SSE)

Express endpoint `GET /api/events/:workstream_id` that keeps a connection open and pushes events:

```javascript
app.get('/api/events/:workstream_id', authenticate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Register this connection
  const clientId = req.user.userId;
  addClient(req.params.workstream_id, clientId, send);

  req.on('close', () => removeClient(req.params.workstream_id, clientId));
});
```

When any user clips an article, approves/rejects, or triggers classification, broadcast to all connected clients for that workstream. Frontend listens and updates state in real time.

Start with polling. Switch to SSE if the team finds the 30-second delay annoying.

---

## Deployment Checklist

1. **Create Railway account** (railway.app) — connect to GitHub
2. **Create new project** → add Web Service (from your GitHub repo) + PostgreSQL database
3. **Set environment variables** in Railway dashboard:
   - `ANTHROPIC_API_KEY` = your API key
   - `JWT_SECRET` = any long random string (e.g., `openssl rand -hex 32`)
   - `ADMIN_INVITE_CODE` = whatever you want team members to use to register
   - `DATABASE_URL` = auto-injected by Railway when you add Postgres
   - `NODE_ENV` = production
4. **Deploy** — Railway builds and deploys automatically on git push
5. **Run database migrations** — Railway lets you run one-off commands: `node server/migrate.js`
6. **Register your admin account** — go to `https://your-app.up.railway.app/register`, use the invite code, then manually update your role to `admin` in the database (or build the first registered user as auto-admin)
7. **Share the URL + invite code** with your team
8. **Distribute the Chrome extension** — team members load it unpacked in Chrome, enter the production URL and their credentials

### Estimated costs

- **Railway Web Service**: ~$5-10/month (usage-based, low traffic internal tool)
- **Railway PostgreSQL**: ~$5-7/month (small database)
- **Anthropic API**: ~$5-15/month at 400 articles/month
- **Total: ~$15-30/month** for the entire platform

---

## Implementation Priority

1. PostgreSQL migration (swap SQLite for Postgres, update all queries)
2. Auth system (users table, JWT, login/register, middleware)
3. Role-based route protection (admin vs viewer)
4. Railway deployment config (Dockerfile or nixpacks, build scripts, env vars)
5. Deploy and test
6. Chrome extension auth update (login flow, token storage, production URL)
7. Activity log
8. Polling for real-time updates (upgrade to SSE later if needed)
