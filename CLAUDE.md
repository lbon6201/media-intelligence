# FTI Media Intelligence Platform

## Overview

Internal media monitoring and classification tool for FTI Strategic Communications. Ingests articles from Factiva exports and manual paste, classifies them against configurable client workstream taxonomies using Claude, tracks reporters over time, extracts quotes with attribution, and generates client-ready coverage reports.

FTI team operates the tool. Clients receive outputs (Excel, Word summaries).

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React + Vite + Tailwind CSS | Fast dev, clean UI |
| Backend | Node.js + Express | Proxies Claude API calls, keeps API key server-side |
| Database | SQLite via better-sqlite3 | Zero-config, single file, easy backup |
| AI — classification | Claude Haiku (claude-haiku-4-5-20251001) | Cheap, fast batch tagging |
| AI — extraction | Claude Sonnet (claude-sonnet-4-20250514) | Accurate quotes, narrative, profiles |
| Excel export | SheetJS (xlsx) | Server-side or client-side |
| Word export | docx (npm) | Server-side generation |
| Charts | Recharts | React-native charting |

---

## Project Structure

```
media-intelligence/
├── server/
│   ├── index.js              Express app, API routes
│   ├── db.js                 SQLite setup + helpers
│   ├── schema.sql            Table definitions
│   ├── classify.js           Classification prompt assembly + Claude API call
│   ├── extract.js            Quote extraction (Module 2, future)
│   └── routes/
│       ├── workstreams.js    CRUD for workstreams
│       ├── articles.js       Ingest, list, update, delete
│       ├── classify.js       Trigger classification, poll progress
│       └── export.js         Excel/Word/JSON generation
├── client/
│   ├── index.html
│   ├── src/
│   │   ├── App.jsx           Shell: header, tabs, workstream switcher
│   │   ├── api.js            Fetch wrapper for backend routes
│   │   ├── components/
│   │   │   ├── WorkstreamSetup.jsx
│   │   │   ├── IngestTab.jsx
│   │   │   ├── QueueTab.jsx
│   │   │   ├── ReportersTab.jsx    (Module 3)
│   │   │   ├── DashboardTab.jsx    (Module 4)
│   │   │   └── ExportTab.jsx
│   │   └── lib/
│   │       ├── parser.js     Factiva text splitting + metadata extraction
│   │       └── helpers.js    Fingerprinting, formatting, etc.
│   ├── tailwind.config.js
│   └── vite.config.js
├── .env                      ANTHROPIC_API_KEY=sk-ant-...
├── package.json
└── README.md
```

---

## Data Model (SQLite Schema)

### workstreams
```sql
CREATE TABLE workstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  taxonomy TEXT NOT NULL,         -- JSON blob
  alert_config TEXT NOT NULL,     -- JSON blob
  created_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'active'    -- active | archived
);
```

### articles
```sql
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  source_type TEXT NOT NULL,      -- factiva | url | rss | paste
  headline TEXT NOT NULL,
  outlet TEXT,
  outlet_type TEXT,               -- tier1_national | tier2_trade | tier3_regional | wire | blog | broadcast
  author TEXT,
  publish_date TEXT,
  url TEXT,
  full_text TEXT NOT NULL,
  word_count INTEGER,
  fingerprint TEXT NOT NULL,      -- hash(lower(headline) + outlet + date) for dedup
  ingested_at TEXT DEFAULT (datetime('now')),

  -- Classification fields (populated by classify endpoint)
  cl_status TEXT DEFAULT 'pending',  -- pending | classified | approved | rejected
  cl_topics TEXT,                    -- JSON array
  cl_sentiment_score INTEGER,        -- 1-7
  cl_sentiment_label TEXT,
  cl_relevance_tier TEXT,            -- High | Medium | Low
  cl_geographic_tags TEXT,           -- JSON array
  cl_policy_dimensions TEXT,         -- JSON array
  cl_stakeholder_focus TEXT,         -- JSON array
  cl_key_entities TEXT,              -- JSON array
  cl_rationale TEXT,
  classified_at TEXT,
  approved_at TEXT
);

CREATE INDEX idx_articles_workstream ON articles(workstream_id);
CREATE INDEX idx_articles_fingerprint ON articles(fingerprint);
CREATE INDEX idx_articles_status ON articles(cl_status);
```

### quotes (Module 2)
```sql
CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  text TEXT NOT NULL,
  type TEXT NOT NULL,               -- direct | paraphrased | unnamed_source
  speaker TEXT,
  speaker_org TEXT,
  speaker_type TEXT,                -- client_spokesperson | third_party_expert | critic | regulator | unnamed
  sentiment TEXT,                   -- positive | neutral | negative
  context TEXT
);
```

### reporters (Module 3)
```sql
CREATE TABLE reporters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  outlets TEXT,                     -- JSON array
  profile TEXT,                     -- JSON blob: beats, sentiment tendency, quote habits, tone
  workstream_stats TEXT,            -- JSON blob: per-workstream counts, averages
  last_updated TEXT
);
```

### alerts (Module 4)
```sql
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  type TEXT NOT NULL,               -- volume_spike | negative_tier1 | new_reporter | keyword_trigger | sentiment_shift
  triggered_at TEXT DEFAULT (datetime('now')),
  read INTEGER DEFAULT 0,
  article_ids TEXT,                 -- JSON array
  summary TEXT
);
```

---

## Classification System Prompt

This is the proven prompt pattern. Do not change the structure — it works reliably.

```javascript
const CLASS_SYS = [
  "You are a media intelligence analyst. Read the full article and classify it.",
  "Return a JSON object with these fields:",
  '  "topics": array of 1-3 from the provided taxonomy',
  '  "sentiment": {"score": integer 1-7, "label": string}',
  '  "relevance_tier": "High" or "Medium" or "Low"',
  '  "geographic_tags": array from taxonomy, only if explicitly referenced',
  '  "policy_dimensions": array from taxonomy, only if substantively discussed',
  '  "stakeholder_focus": array from taxonomy, entities central to the piece',
  '  "key_entities": array of all companies, people, orgs, regulators named',
  '  "rationale": 2-3 sentences explaining classification with specific article references',
  "Sentiment scale: 1=Very Negative 2=Negative 3=Slightly Negative 4=Neutral 5=Slightly Positive 6=Positive 7=Very Positive",
  "Return ONLY valid JSON. No markdown, no preamble.",
].join("\n");
```

User message format:
```javascript
const userMsg = [
  `Workstream: "${taxonomy.name}"`,
  `Topics: ${JSON.stringify(taxonomy.topics)}`,
  `Geographic: ${JSON.stringify(taxonomy.geographic_tags)}`,
  `Policy: ${JSON.stringify(taxonomy.policy_dimensions)}`,
  `Stakeholders: ${JSON.stringify(taxonomy.stakeholder_tags)}`,
  "",
  `Headline: ${article.headline}`,
  `Outlet: ${article.outlet || "Unknown"}`,
  `Date: ${article.publish_date || "Unknown"}`,
  `Author: ${article.author || "Unknown"}`,
  "",
  article.full_text.slice(0, 6000),
].join("\n");
```

API call pattern (server-side, proven working):
```javascript
const classify = async (systemPrompt, userMessage) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.content?.[0]?.text || "";
};
```

---

## Classification Backend Flow

This is the critical path. Classification runs server-side as a sequential queue — no browser re-render issues.

```
POST /api/classify/:workstream_id
  1. Query all articles WHERE workstream_id = :id AND cl_status = 'pending'
  2. For each article:
     a. Assemble user message from article + workstream taxonomy
     b. Call Claude Haiku with CLASS_SYS system prompt
     c. Parse JSON response
     d. UPDATE article SET cl_* fields, cl_status = 'classified'
     e. 500ms delay between calls
  3. Return { total, classified, failed }
```

Frontend polls `GET /api/classify/:workstream_id/progress` for live updates:
```json
{ "total": 25, "done": 12, "failed": 1, "running": true }
```

---

## Factiva Parser

Articles from Factiva PDF copy-paste need splitting and metadata extraction.

**Splitting strategy (in order):**
1. Split on `Document [A-Za-z0-9]{10,}` patterns (Factiva document IDs appear at end of each article)
2. Split on `***` line separators
3. Split on `---` or heavy whitespace (3+ blank lines)
4. Fallback: treat entire text as one article

**Pre-cleaning:** Strip PDF noise before splitting:
- "Page X of Y" lines
- "Factiva" / "Dow Jones" branding
- Bare page numbers
- Navigation text ("Search Results", "Display Options", etc.)
- Copyright lines

**Metadata extraction per article block:**
- Tag each line in the first ~15 lines as: headline_tag, outlet_tag, date, wordcount, byline, junk, content
- Known outlet regex matches ~25 major publications (WSJ, FT, Bloomberg, Reuters, NYT, etc.)
- Headline: highest-scoring content line in header zone (substantial length, few sentences, near top, capital start, 40-150 char sweet spot)
- Body: everything after the last metadata anchor line

---

## Pre-built Workstream: Private Credit

Seed this on first run.

```json
{
  "name": "Private Credit Media Monitoring",
  "client": "AIC / MFA",
  "taxonomy": {
    "topics": [
      "Rebalancing", "Strong Fundamentals", "Safe for System", "Essential",
      "Redemption / Liquidity Risk", "Lax Lending Standards", "Retail Investor Exposure",
      "Valuation Opacity", "Fraud / Collateral Abuse", "Regulatory Scrutiny",
      "Bank Competition", "AI / Software Sector Risk", "Fund Structure Risk", "Fee Criticism"
    ],
    "relevance_tiers": ["High", "Medium", "Low"],
    "geographic_tags": ["National", "DC", "NY", "London"],
    "policy_dimensions": [
      "Regulatory (SEC, FSOC)",
      "Legislative (Hill activity, hearings)",
      "Market (deal flow, performance, earnings)"
    ],
    "stakeholder_tags": [
      "SEC", "FSOC", "Congress", "AIC", "MFA",
      "Blue Owl", "Blackstone", "Ares", "KKR", "Apollo", "BlackRock", "Goldman Sachs",
      "Retail Investors", "Institutional Investors", "Rating Agencies"
    ],
    "custom_tags": ["Rapid Response", "Proactive Opportunity", "DealBook / Newsletter"]
  },
  "alert_config": {
    "keyword_triggers": ["investigation", "default", "systemic", "contagion", "fraud", "gate", "redemption halt", "fire sale", "bailout"],
    "volume_threshold": 10,
    "sentiment_baseline": 0
  }
}
```

---

## Build Sequence

### Phase 1: Ingestion + Classification (build first)
1. Project scaffolding: Vite + React + Tailwind + Express + SQLite
2. Database schema + seed Private Credit workstream
3. Workstream CRUD (create, edit taxonomy, switch active)
4. Article ingestion: Factiva paste parser + single article form
5. Deduplication on ingest (fingerprint check)
6. Classification endpoint (sequential queue, server-side)
7. Classification queue UI with progress polling
8. Review queue: filter by status/sentiment/topic, expand detail, bulk approve/reject
9. Excel/CSV export of classified articles
10. JSON backup/restore

### Phase 2: Quote Extraction + Reports
1. Quote extraction endpoint (Sonnet, batched on approved articles)
2. Quote review UI
3. Entity extraction + Share of Voice calculation
4. Narrative trend generation (Sonnet synthesis over date range)
5. Coverage report assembly (Excel + Word doc)

### Phase 3: Reporter Profiling
1. Byline → Reporter resolution (fuzzy name + outlet matching)
2. Automated stat aggregation on article approval
3. Reporter list + profile view
4. Deep profile generation (on-demand Sonnet synthesis)
5. Cross-workstream filtering

### Phase 4: Dashboard + Alerts
1. Coverage volume + sentiment trend charts
2. Share of Voice visualization
3. Alert trigger engine (runs after each ingest/classify batch)
4. Alert feed UI
5. URL fetch + RSS input sources

---

## API Endpoints

### Workstreams
- `GET /api/workstreams` — list all
- `POST /api/workstreams` — create
- `PUT /api/workstreams/:id` — update taxonomy/config
- `DELETE /api/workstreams/:id` — archive

### Articles
- `GET /api/articles?workstream_id=X&status=Y&topic=Z` — list with filters
- `POST /api/articles/ingest` — ingest batch (parsed articles array)
- `PUT /api/articles/:id` — update classification status (approve/reject)
- `PUT /api/articles/bulk-status` — bulk approve/reject
- `DELETE /api/articles/:id` — delete

### Classification
- `POST /api/classify/:workstream_id` — start classification of all pending articles
- `GET /api/classify/:workstream_id/progress` — poll progress

### Export
- `GET /api/export/:workstream_id/excel` — download Excel
- `GET /api/export/:workstream_id/json` — download JSON backup
- `POST /api/import/json` — restore from JSON backup

---

## API Cost Estimates

| Task | Model | Per Article | 200/month batch |
|------|-------|------------|-----------------|
| Classification | Haiku | ~$0.001 | ~$0.20 |
| Quote extraction | Sonnet | ~$0.02 | ~$4.00 |
| Reporter profile | Sonnet | ~$0.05/profile | periodic |
| Narrative summary | Sonnet | ~$0.06/20 articles | periodic |

Estimated monthly cost at 400 articles: **$5–15.**

---

## Claude Code Bootstrap Prompt

Use this as your first prompt after running `claude` in the project directory:

```
Set up a full-stack media intelligence platform. Read the CLAUDE.md file in this
directory for the complete architecture, data model, API endpoints, and build
instructions. Build Phase 1 (Ingestion + Classification):

1. Scaffold: Vite + React + Tailwind frontend, Express + better-sqlite3 backend
2. Create the SQLite schema from the doc (workstreams, articles, quotes, reporters, alerts)
3. Seed the Private Credit workstream on first run
4. Build workstream CRUD routes + UI (create, edit taxonomy, switch)
5. Build article ingestion: Factiva paste parser (split on Document IDs, then ***,
   then blank lines; strip PDF noise; score-based headline detection) + single
   article form with manual metadata
6. Deduplication: fingerprint = hash(lower(headline) + outlet + date), reject on match
7. Classification: POST /api/classify/:workstream_id runs a sequential loop
   server-side calling Claude Haiku with the exact system prompt and API call
   pattern from the doc. 500ms delay between calls. Updates each article row
   individually. Frontend polls GET /api/classify/:id/progress.
8. Queue UI: table with sort/filter by status, sentiment (1-7), topic. Expand row
   for full detail. Checkbox select + bulk approve/reject.
9. Export: Excel via SheetJS with all classification fields. JSON backup/restore
   of full workstream data.

Use the proven API call pattern from the doc exactly — system prompt as top-level
parameter, user message as single message, parse response with
d.content?.[0]?.text. Classification runs entirely server-side, not in the browser.

The .env file has ANTHROPIC_API_KEY. Use anthropic-version header 2023-06-01.
```
