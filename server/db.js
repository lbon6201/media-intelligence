// Unified async database layer
// Auto-detects DATABASE_URL for PostgreSQL, falls back to SQLite for local dev
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { v4 as uuid } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_POSTGRES = !!process.env.DATABASE_URL;

let _sqlite, _pgPool;

// ── PostgreSQL setup ──
if (IS_POSTGRES) {
  const pg = await import('pg');
  _pgPool = new pg.default.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  // Auto-create tables on startup
  try {
    await _pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', created_at TIMESTAMPTZ DEFAULT NOW(), last_login TIMESTAMPTZ, active BOOLEAN DEFAULT true);
      CREATE TABLE IF NOT EXISTS activity_log (id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS workstreams (id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT NOT NULL, taxonomy TEXT NOT NULL, alert_config TEXT NOT NULL, strategic_context TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), status TEXT DEFAULT 'active');
      CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), source_type TEXT NOT NULL, headline TEXT NOT NULL, outlet TEXT, outlet_type TEXT, author TEXT, publish_date TEXT, url TEXT, full_text TEXT NOT NULL, word_count INTEGER, fingerprint TEXT NOT NULL, ingested_at TIMESTAMPTZ DEFAULT NOW(), cl_status TEXT DEFAULT 'pending', cl_topics TEXT, cl_sentiment_score INTEGER, cl_sentiment_label TEXT, cl_sentiment_rationale TEXT, cl_relevance_tier TEXT, cl_geographic_tags TEXT, cl_policy_dimensions TEXT, cl_stakeholder_focus TEXT, cl_key_entities TEXT, cl_firms_mentioned TEXT, cl_firm_sentiments TEXT, cl_institutional_investors TEXT, cl_institutional_investor_quotes TEXT, cl_external_quotes TEXT, cl_key_takeaway TEXT, cl_rationale TEXT, classified_at TIMESTAMPTZ, approved_at TIMESTAMPTZ, internal_notes TEXT, internal_flags TEXT, internal_tags TEXT, annotated_at TIMESTAMPTZ, annotated_by TEXT);
      CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE, workstream_id TEXT, text TEXT NOT NULL, type TEXT NOT NULL, speaker TEXT, speaker_org TEXT, speaker_type TEXT, sentiment TEXT, stance TEXT, role TEXT, context TEXT);
      CREATE TABLE IF NOT EXISTS reporters (id TEXT PRIMARY KEY, name TEXT NOT NULL, outlets TEXT, profile TEXT, workstream_stats TEXT, last_updated TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS reporter_statuses (reporter_name TEXT NOT NULL, workstream_id TEXT NOT NULL, status TEXT DEFAULT 'no_action', notes TEXT DEFAULT '', engagement_history TEXT DEFAULT '[]', last_contacted TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (reporter_name, workstream_id));
      CREATE TABLE IF NOT EXISTS reporter_aliases (alias TEXT PRIMARY KEY, canonical_name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), type TEXT NOT NULL, triggered_at TIMESTAMPTZ DEFAULT NOW(), read INTEGER DEFAULT 0, article_ids TEXT, summary TEXT);
      CREATE TABLE IF NOT EXISTS narratives (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), from_date TEXT NOT NULL, to_date TEXT NOT NULL, window TEXT NOT NULL, result TEXT NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS watchlist_speakers (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), name TEXT NOT NULL, affiliation TEXT, role TEXT, notes TEXT, added_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS outlet_tiers (outlet_name TEXT PRIMARY KEY, tier TEXT NOT NULL, reach_score INTEGER, notes TEXT);
      CREATE TABLE IF NOT EXISTS briefings (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), from_date TEXT NOT NULL, to_date TEXT NOT NULL, sections TEXT NOT NULL, tone TEXT DEFAULT 'executive', generated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS talking_points (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), topic TEXT, article_ids TEXT, result TEXT NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS strategy_messages (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS insights (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), content TEXT NOT NULL, source_message_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), date TEXT NOT NULL, title TEXT NOT NULL, type TEXT, notes TEXT);
      CREATE TABLE IF NOT EXISTS drift_snapshots (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), target_mix TEXT NOT NULL, actual_mix TEXT NOT NULL, drift_score REAL, computed_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id), name TEXT NOT NULL, data TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
    `);
    console.log('PostgreSQL tables created/verified');
  } catch (e) {
    console.error('PostgreSQL schema error:', e.message);
  }
  console.log('Using PostgreSQL');
} else {
  // ── SQLite setup (local dev only) ──
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch {
    console.error('better-sqlite3 not available. Set DATABASE_URL for PostgreSQL in production.');
    process.exit(1);
  }
  const dbPath = join(__dirname, '..', 'media-intelligence.db');
  _sqlite = new Database(dbPath);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');

  // Run schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  _sqlite.exec(schema);

  // Migrations for existing tables
  function migrateTable(table, cols) {
    const existing = _sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const [col, type, dflt] of cols) {
      if (!existing.includes(col)) {
        _sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}${dflt ? ' DEFAULT ' + dflt : ''}`);
      }
    }
  }

  migrateTable('articles', [
    ['cl_sentiment_rationale', 'TEXT'], ['cl_firms_mentioned', 'TEXT'], ['cl_firm_sentiments', 'TEXT'],
    ['cl_institutional_investors', 'TEXT'], ['cl_institutional_investor_quotes', 'TEXT'],
    ['cl_external_quotes', 'TEXT'], ['cl_key_takeaway', 'TEXT'],
    ['internal_notes', 'TEXT'], ['internal_flags', 'TEXT'], ['internal_tags', 'TEXT'],
    ['annotated_at', 'TEXT'], ['annotated_by', 'TEXT'],
  ]);
  migrateTable('quotes', [['workstream_id', 'TEXT'], ['stance', 'TEXT'], ['role', 'TEXT']]);
  migrateTable('reporter_statuses', [['engagement_history', 'TEXT', "'[]'"], ['last_contacted', 'TEXT']]);
  migrateTable('workstreams', [['strategic_context', 'TEXT', "''"]]);

  // Seed workstreams
  const count = _sqlite.prepare('SELECT COUNT(*) as c FROM workstreams').get();
  if (count.c === 0) {
    const taxonomy = {
      topics: ["Rebalancing","Strong Fundamentals","Safe for System","Essential","Redemption / Liquidity Risk","Lax Lending Standards","Retail Investor Exposure","Valuation Opacity","Fraud / Collateral Abuse","Regulatory Scrutiny","Bank Competition","AI / Software Sector Risk","Fund Structure Risk","Fee Criticism","Systemic / Contagion Risk","Default / Bankruptcy","Earnings / Performance","Market Expansion","Executive Commentary"],
      relevance_tiers: ["High","Medium","Low"], geographic_tags: ["National","DC","NY","London"],
      policy_dimensions: ["Regulatory (SEC, FSOC)","Legislative (Hill activity, hearings)","Market (deal flow, performance, earnings)"],
      stakeholder_tags: ["SEC","FSOC","Congress","AIC","MFA","Blue Owl","Blackstone","Ares","KKR","Apollo","BlackRock","Goldman Sachs","Retail Investors","Institutional Investors","Rating Agencies"],
      custom_tags: ["Rapid Response","Proactive Opportunity","DealBook / Newsletter"]
    };
    const alertConfig = { keyword_triggers: ["investigation","default","systemic","contagion","fraud","gate","redemption halt","fire sale","bailout"], volume_threshold: 10, sentiment_baseline: 0 };
    const ctx = `This workstream monitors media coverage of the private credit industry on behalf of a coalition including trade associations (AIC, MFA) and major firms. The goal is to shift coverage from crisis/contagion framing toward educational, rebalancing-oriented narratives.`;
    _sqlite.prepare('INSERT INTO workstreams (id, name, client, taxonomy, alert_config, strategic_context) VALUES (?, ?, ?, ?, ?, ?)').run(uuid(), 'Private Credit Media Monitoring', 'AIC / MFA', JSON.stringify(taxonomy), JSON.stringify(alertConfig), ctx);
  }

  // Seed outlet tiers
  try {
    const tierCount = _sqlite.prepare('SELECT COUNT(*) as c FROM outlet_tiers').get();
    if (tierCount.c === 0) {
      const tiers = [['The Wall Street Journal','tier1_national',10],['The New York Times','tier1_national',10],['Financial Times','tier1_national',9],['Bloomberg','tier1_national',10],['Reuters','wire',9],["Barron's",'tier2_trade',7],['Business Insider','tier2_trade',7],['CNBC','broadcast',8]];
      const ins = _sqlite.prepare('INSERT INTO outlet_tiers (outlet_name, tier, reach_score) VALUES (?, ?, ?)');
      for (const [n, t, s] of tiers) ins.run(n, t, s);
    }
  } catch {}

  // Seed strategic context on existing workstream if empty
  try {
    const ws = _sqlite.prepare("SELECT id FROM workstreams WHERE strategic_context IS NULL OR strategic_context = ''").get();
    if (ws) {
      _sqlite.prepare('UPDATE workstreams SET strategic_context = ? WHERE id = ?').run(
        `This workstream monitors media coverage of the private credit industry on behalf of a coalition including trade associations (AIC, MFA) and major firms (Blue Owl, Ares, Blackstone, KKR, Apollo, BlackRock, Goldman Sachs). Four messaging pillars: Rebalancing, Strong Fundamentals, Safe for System, Essential. Goal: shift from crisis framing to educational narratives.`,
        ws.id
      );
    }
  } catch {}

  console.log('Using SQLite');
}

// ── Unified async API ──
// All methods are async. For SQLite, we wrap sync calls.
// SQL uses ? placeholders everywhere. For Postgres, we convert to $1, $2, etc.

function pgConvert(sql) {
  let idx = 0;
  let s = sql.replace(/\?/g, () => `$${++idx}`);
  // SQLite → Postgres function conversions
  s = s.replace(/datetime\('now'\)/g, 'NOW()');
  s = s.replace(/datetime\(\?\)/g, () => `$${++idx}`); // pass date as param
  return s;
}

const db = {
  // Query returning multiple rows
  async all(sql, ...params) {
    if (IS_POSTGRES) {
      const result = await _pgPool.query(pgConvert(sql), params);
      return result.rows;
    }
    return _sqlite.prepare(sql).all(...params);
  },

  // Query returning single row
  async get(sql, ...params) {
    if (IS_POSTGRES) {
      const result = await _pgPool.query(pgConvert(sql), params);
      return result.rows[0] || null;
    }
    return _sqlite.prepare(sql).get(...params);
  },

  // Insert/Update/Delete
  async run(sql, ...params) {
    if (IS_POSTGRES) {
      const result = await _pgPool.query(pgConvert(sql), params);
      return { changes: result.rowCount };
    }
    return _sqlite.prepare(sql).run(...params);
  },

  // Execute raw SQL (for schema, etc.)
  async exec(sql) {
    if (IS_POSTGRES) {
      return _pgPool.query(sql);
    }
    return _sqlite.exec(sql);
  },

  // Transaction helper
  async transaction(fn) {
    if (IS_POSTGRES) {
      const client = await _pgPool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn();
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else {
      // SQLite transactions are sync — wrap in promise
      const txn = _sqlite.transaction(fn);
      return txn();
    }
  },

  // For SQLite sync transaction that needs the sqlite db directly
  // Used sparingly in classify route's sync loop
  get sqlite() { return _sqlite; },
  get isPostgres() { return IS_POSTGRES; },
};

export default db;
