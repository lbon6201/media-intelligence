// Run this once to set up PostgreSQL schema on Railway
// Usage: DATABASE_URL=postgres://... node server/migrate-postgres.js

import pg from 'pg';
import bcrypt from 'bcryptjs';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const schema = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS workstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  taxonomy TEXT NOT NULL,
  alert_config TEXT NOT NULL,
  strategic_context TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  source_type TEXT NOT NULL,
  headline TEXT NOT NULL,
  outlet TEXT,
  outlet_type TEXT,
  author TEXT,
  publish_date TEXT,
  url TEXT,
  full_text TEXT NOT NULL,
  word_count INTEGER,
  fingerprint TEXT NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  cl_status TEXT DEFAULT 'pending',
  cl_topics TEXT,
  cl_sentiment_score INTEGER,
  cl_sentiment_label TEXT,
  cl_sentiment_rationale TEXT,
  cl_relevance_tier TEXT,
  cl_geographic_tags TEXT,
  cl_policy_dimensions TEXT,
  cl_stakeholder_focus TEXT,
  cl_key_entities TEXT,
  cl_firms_mentioned TEXT,
  cl_firm_sentiments TEXT,
  cl_institutional_investors TEXT,
  cl_institutional_investor_quotes TEXT,
  cl_external_quotes TEXT,
  cl_key_takeaway TEXT,
  cl_rationale TEXT,
  classified_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  internal_notes TEXT,
  internal_flags TEXT,
  internal_tags TEXT,
  annotated_at TIMESTAMPTZ,
  annotated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_workstream ON articles(workstream_id);
CREATE INDEX IF NOT EXISTS idx_articles_fingerprint ON articles(fingerprint);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(cl_status);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  workstream_id TEXT REFERENCES workstreams(id),
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  speaker TEXT,
  speaker_org TEXT,
  speaker_type TEXT,
  sentiment TEXT,
  stance TEXT,
  role TEXT,
  context TEXT
);

CREATE INDEX IF NOT EXISTS idx_quotes_article ON quotes(article_id);
CREATE INDEX IF NOT EXISTS idx_quotes_speaker ON quotes(speaker);

CREATE TABLE IF NOT EXISTS reporters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  outlets TEXT,
  profile TEXT,
  workstream_stats TEXT,
  last_updated TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reporter_statuses (
  reporter_name TEXT NOT NULL,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  status TEXT DEFAULT 'no_action',
  notes TEXT DEFAULT '',
  engagement_history TEXT DEFAULT '[]',
  last_contacted TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (reporter_name, workstream_id)
);

CREATE TABLE IF NOT EXISTS reporter_aliases (
  alias TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  type TEXT NOT NULL,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  read INTEGER DEFAULT 0,
  article_ids TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS narratives (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  window TEXT NOT NULL,
  result TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlist_speakers (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  name TEXT NOT NULL,
  affiliation TEXT,
  role TEXT,
  notes TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outlet_tiers (
  outlet_name TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  reach_score INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  sections TEXT NOT NULL,
  tone TEXT DEFAULT 'executive',
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS talking_points (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  topic TEXT,
  article_ids TEXT,
  result TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_messages (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  content TEXT NOT NULL,
  source_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS drift_snapshots (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  target_mix TEXT NOT NULL,
  actual_mix TEXT NOT NULL,
  drift_score REAL,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT REFERENCES users(id),
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
`;

async function migrate() {
  console.log('Running PostgreSQL migration...');
  await pool.query(schema);
  console.log('Schema created.');

  // Seed outlet tiers
  const tierCount = await pool.query('SELECT COUNT(*) as c FROM outlet_tiers');
  if (parseInt(tierCount.rows[0].c) === 0) {
    const tiers = [
      ['The Wall Street Journal', 'tier1_national', 10], ['The New York Times', 'tier1_national', 10],
      ['Financial Times', 'tier1_national', 9], ['The Washington Post', 'tier1_national', 9],
      ['Bloomberg', 'tier1_national', 10], ["Barron's", 'tier2_trade', 7],
      ['Reuters', 'wire', 9], ['Associated Press', 'wire', 8],
      ['CNBC', 'broadcast', 8], ['Business Insider', 'tier2_trade', 7],
    ];
    for (const [name, tier, score] of tiers) {
      await pool.query('INSERT INTO outlet_tiers (outlet_name, tier, reach_score) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [name, tier, score]);
    }
    console.log('Seeded outlet tiers.');
  }

  await pool.end();
  console.log('Migration complete.');
}

migrate().catch(e => { console.error(e); process.exit(1); });
