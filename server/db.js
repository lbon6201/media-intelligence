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
