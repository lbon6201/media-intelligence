CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS workstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  taxonomy TEXT NOT NULL,
  alert_config TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
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
  ingested_at TEXT DEFAULT (datetime('now')),
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
  classified_at TEXT,
  approved_at TEXT,
  internal_notes TEXT,
  internal_flags TEXT,
  internal_tags TEXT,
  annotated_at TEXT,
  annotated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_workstream ON articles(workstream_id);
CREATE INDEX IF NOT EXISTS idx_articles_fingerprint ON articles(fingerprint);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(cl_status);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
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
  last_updated TEXT
);

CREATE TABLE IF NOT EXISTS reporter_statuses (
  reporter_name TEXT NOT NULL,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  status TEXT DEFAULT 'no_action',
  notes TEXT DEFAULT '',
  engagement_history TEXT DEFAULT '[]',
  last_contacted TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
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
  triggered_at TEXT DEFAULT (datetime('now')),
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
  generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watchlist_speakers (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  name TEXT NOT NULL,
  affiliation TEXT,
  role TEXT,
  notes TEXT,
  added_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_watchlist_ws ON watchlist_speakers(workstream_id);

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
  generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS talking_points (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  topic TEXT,
  article_ids TEXT,
  result TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS strategy_messages (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_strategy_ws ON strategy_messages(workstream_id);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  content TEXT NOT NULL,
  source_message_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
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
  computed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
