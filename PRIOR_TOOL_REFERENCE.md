# PRIOR_TOOL_REFERENCE.md
# Media Intelligence Platform — Prior Tool Feature Reference (as of March 20, 2026)

This documents every feature of the working single-file React artifact that preceded this project. Use this as the baseline spec when building. All features described here should be preserved and extended in the new full-stack version. The new architecture (described in CLAUDE.md) adds workstream configurability, server-side classification, and SQLite persistence on top of everything listed here.

---

## 1. Article Analysis — What Claude Extracts Per Article

Each article is sent to Claude Sonnet as raw text. Claude returns a single JSON object with these fields:

```json
{
  "reporter": "Semicolon-separated author names, or Unknown",
  "outlet": "Publication name, or Unknown",
  "headline": "Article headline or first sentence",
  "pub_date": "YYYY-MM-DD if found, or null",
  "url": "Article URL if present in the text, or null",
  "sentiment": 4,
  "firm_sentiments": { "Firm Name": 4 },
  "sentiment_rationale": "One sentence explaining the overall sentiment score",
  "firms_mentioned": ["array", "of", "firm", "names"],
  "themes": ["from fixed theme list"],
  "institutional_investors": "Commentary on pension funds, endowments, insurers, sovereign wealth, asset managers. None mentioned if absent.",
  "institutional_investor_quotes": [
    { "source": "Person name and institution", "quote": "Paraphrased or direct quote", "stance": "bullish|bearish|neutral|cautious" }
  ],
  "external_quotes": [
    { "source": "Person name and affiliation", "role": "regulator|academic|politician|rating_agency|trade_group|journalist|other", "quote": "Direct or paraphrased quote", "stance": "positive|neutral|negative" }
  ],
  "key_takeaway": "One sentence summary of the article's main point"
}
```

### Sentiment Scale (1–7)
| Score | Label | Description |
|-------|-------|-------------|
| 1 | Very Negative | Strongly critical, accusatory, fraud/systemic risk framing |
| 2 | Negative | Clearly skeptical or damaging framing |
| 3 | Somewhat Negative | Cautionary, mildly critical, raises concerns |
| 4 | Neutral | Balanced or purely factual |
| 5 | Somewhat Positive | Constructive, mildly favorable |
| 6 | Positive | Favorable coverage, highlights strengths |
| 7 | Very Positive | Strongly supportive or promotional |

Sentiment is applied at two levels:
- **Article-level:** Overall tone toward the industry/topic
- **Per-firm:** Each firm in `firms_mentioned` gets its own score in `firm_sentiments`, reflecting how that specific firm is portrayed (may differ from overall)

### Theme List (fixed, Claude selects from these only)
- Lax Lending Standards
- Retail Investor Exposure
- Redemption / Liquidity Risk
- Fraud / Collateral Abuse
- Valuation Opacity
- Regulatory Scrutiny
- AI / Software Sector Risk
- Systemic / Contagion Risk
- Bank Competition
- Fee Criticism
- Default / Bankruptcy
- Fund Structure Risk
- Earnings / Performance
- Market Expansion
- Executive Commentary

NOTE: In the new tool, themes are replaced by configurable workstream taxonomy topics. The theme list above was specific to the private credit workstream and should be seeded as the default topics for that workstream.

### Quote Extraction
Two separate quote arrays:
- **institutional_investor_quotes:** Named people at pension funds, endowments, insurers, sovereign wealth funds, asset managers. Stance: bullish/bearish/neutral/cautious.
- **external_quotes:** Non-industry voices — regulators, academics, politicians, rating agencies, trade groups, journalists as commentators. People who work at private credit firms are excluded. Stance: positive/neutral/negative. Role field categorizes the speaker.

---

## 2. Article Ingestion

### Single Article Mode
- Paste article text into a textarea
- Click Analyze → Claude processes → result appears in articles list
- Article added to top of list

### Bulk / Batch Mode
- Paste multiple articles separated by delimiters
- Tool splits text into individual articles, shows a queue
- Queue processes sequentially: each item shows pending → processing → done/error
- Progress visible during processing
- Failed items retryable
- Cancel button stops the queue

### Article Splitting Logic (critical — this works reliably)
Priority order:
1. Split on `***` (three or more asterisks on their own line) — `DELIM_RE = /\n\s*\*{3,}\s*\n/`
2. Split on `Document [ID]` patterns (Factiva document IDs)
3. Split on 3+ consecutive blank lines
4. Fallback: treat entire paste as one article

### API Call Pattern (proven working, do not change structure)
```javascript
const callAPI = async (text) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: text.trim() }],
    }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.content?.[0]?.text || "";
};
```

Key: `system` is a top-level parameter, not embedded in messages. Model is `claude-sonnet-4-20250514`. Response parsed from `d.content?.[0]?.text`.

In the new full-stack version, this call moves server-side with `x-api-key` and `anthropic-version` headers added. The prompt structure stays identical.

### Queue Processing Pattern (proven working)
```javascript
const runQueue = async (q) => {
  cancelRef.current = false;
  setRunning(true);
  let cur = [...q];
  for (let i = 0; i < cur.length; i++) {
    if (cancelRef.current) break;
    if (cur[i].status !== "pending") continue;
    cur = cur.map((x, j) => j === i ? { ...x, status: "processing" } : x);
    setQueue([...cur]);
    try {
      const raw = await callAPI(cur[i].text);
      const art = parseArticle(raw);
      setResults(prev => { const next = [art, ...prev]; save(next); return next; });
      cur = cur.map((x, j) => j === i ? { ...x, status: "done" } : x);
    } catch (e) {
      cur = cur.map((x, j) => j === i ? { ...x, status: "error", error: e.message } : x);
    }
    setQueue([...cur]);
    if (i < cur.length - 1 && !cancelRef.current)
      await new Promise(r => setTimeout(r, 500));
  }
  setRunning(false);
};
```

Key: loop mutates a local `cur` array, only calls `setQueue([...cur])` for UI updates. State is never read back mid-loop. `setResults` uses functional updater. This avoids React re-render issues that break async loops.

---

## 3. Tabs and Views

### Articles Tab
- Table of all analyzed articles
- Each row: headline, outlet, reporter, date, sentiment badge (color-coded 1–7), themes as tags
- Click row to expand detail panel showing: full classification, rationale, firms + per-firm sentiment, institutional investor commentary, external quotes, key takeaway, URL link, delete button
- **Filter bar** above table:
  - Free-text search (searches headline, reporter, key_takeaway)
  - Dropdown filters: reporter, outlet, firm, theme
  - Sentiment range filter (1–7)
  - Date range filter
  - Live count: "X of Y articles"
  - Clear all filters button

### Analytics Tab — Dashboard (default sub-view)
- Filterable by all dimensions (reporter, outlet, firm, theme, date range)
- **KPI row:** total articles, avg sentiment, negative share %, top reporter, top theme
- **Monthly trend chart:** volume as colored bars, avg sentiment as dashed line overlay
- **Sentiment distribution panel:** bar chart of articles per sentiment score
- **Theme breakdown panel:** horizontal bars showing article count per theme
- **Recent articles list** at bottom

### Analytics Tab — Reporters Sub-tab
- Card per reporter showing:
  - Name, outlet(s)
  - Article count
  - Avg sentiment (color-coded)
  - Top 5 firms covered with mention count
  - 3 representative pieces (long-form or lead-author articles)
  - Engagement recommendation (summary paragraph, not numbered rank)
- Sortable by: avg sentiment (asc/desc), article count, name

### Analytics Tab — Outlets Sub-tab
- Summary per outlet: article count, avg sentiment, reporter count, top themes
- Sortable

### Analytics Tab — Firms Sub-tab
- Summary per firm: article count, overall avg sentiment, firm-specific avg sentiment
- Both overall and firm-specific scores displayed

### Analytics Tab — Themes Sub-tab
- Summary per theme: article count, avg sentiment
- Sorted by count by default

### Analytics Tab — Outlet × Firm Matrix
- Cross-tab: outlets as rows, firms as columns
- Each cell: sentiment score (firm-specific where available, overall fallback) + article count
- Color-coded cells on 1–7 scale
- Sticky first column for outlet names

### Analytics Tab — Reporter Engagement Priority
- Ranked list with three tiers: High, Medium, Low
- Score weighted by: avg sentiment, article volume, sentiment trend
- Each card shows:
  - Rank, outlet(s)
  - Avg sentiment, article count, trend (Improving / Stable / Declining based on last 3 articles vs overall)
  - Plain-language recommendation explaining priority
  - Top themes covered
  - Firms in their beat
  - Recent sentiment bar (last 3 articles) vs overall avg
- 5-6 reporters per tier

### Quotes Tab
- Combined view of institutional investor quotes and external quotes
- **Speaker tracker** at top: each person's quote count with color-coded positive/neutral/negative breakdown bar
- Filterable by: type (institutional vs. external), stance (positive/neutral/negative), free-text search
- Each quote shows: source, affiliation/role, quote text, stance badge, linked to source article

### Reporter Status Management
- Dropdown on each reporter card: No Action / Watching / Pending Outreach / Engaged / Do Not Contact
- Color-coded status indicators
- Free-text notes field per reporter
- Persisted independently of article data

---

## 4. Data Persistence

### Storage
- All article data saved to persistent storage (was browser `window.storage`, moving to SQLite)
- Storage key versioned: `pc_media_v5`
- Reporter aliases stored separately: `pc_media_aliases_v1`
- Reporter statuses/notes stored separately: `pc_reporter_status_v1`
- Auto-saves after every change

### JSON Import/Export
- Export: downloads full article dataset as JSON
- Import: upload JSON file, replaces current dataset
- Backward-compatible: handles articles from older schema versions (missing fields default gracefully)

---

## 5. CSV/Excel Export

Downloads 7 separate CSV files (staggered to avoid browser blocking):

1. **Articles** — full article log: date, reporter, outlet, headline, sentiment (score + label), rationale, firms mentioned, firm sentiments, themes, institutional investors, key takeaway, URL
2. **Reporters** — summary: name, avg sentiment + label, article count, outlets, top 3 themes, all theme counts, firms covered
3. **Outlets** — summary: name, avg sentiment + label, article count, reporter count, top 3 themes, all theme counts
4. **Firms** — summary: name, article count, overall avg sentiment + label, firm-specific avg sentiment + label
5. **Themes** — summary: name, article count, avg sentiment + label (sorted by count)
6. **Reporter × Firm matrix** — every reporter-firm pair: article count, overall avg, firm-specific avg
7. **Engagement priority** — ranked list: reporter, priority tier, avg sentiment, article count, trend, recent avg, outlets, top themes, firms, recommendation

---

## 6. Reporter Normalization

- `normName`: trims, lowercases, then title-cases each word
- `splitReporters`: splits byline on semicolons, commas, and " and " to handle multi-author articles
- Reporter matching across articles uses normalized name as key
- Reporter alias system allows merging variant spellings (e.g., "Rob Smith" → "Robert Smith")

---

## 7. UI Design Language

- **Color palette:** Navy (#002855), blue (#0057b8), light blue (#0096d6), off-white (#f0f5fb), muted (#4a6080), border (#b8cce0)
- Sentiment colors: red spectrum (1–2) → orange (3) → gold (4) → green spectrum (5–7)
- Clean, professional, tool-first aesthetic
- No decorative elements — every pixel serves a function

---

## 8. What the New Tool Adds (from CLAUDE.md)

Features NOT in the prior tool that the new architecture introduces:
- **Configurable workstreams** — multi-client with custom taxonomies per workstream (replaces hard-coded theme list)
- **Server-side classification** — Node/Express backend proxies Claude API calls, eliminates browser async issues
- **SQLite persistence** — replaces browser storage, enables backup by copying one file
- **Factiva PDF parsing** — structured parser for Factiva export text (headline detection, metadata extraction, PDF noise stripping)
- **Deduplication** — fingerprint-based duplicate detection on ingest
- **Classification review queue** — pending → classified → approved/rejected workflow with bulk actions
- **Six classification dimensions** — topics, sentiment (1-7), relevance tier, geographic tags, policy dimensions, stakeholder focus (all configurable per workstream)
- **Alert system** — volume spikes, negative tier-1 coverage, new reporters, keyword triggers, sentiment shifts
- **Word doc export** — formatted coverage summaries
- **Share of Voice** — entity mention tracking across coverage

---

## 9. Migration Notes

When porting the prior tool into the new architecture:
- The prior tool's `callAPI` + `parseArticle` + queue loop pattern is proven and should be preserved server-side
- The system prompt structure (top-level `system` param, user message as single message) must not change
- Per-firm sentiment scoring is a key differentiator — preserve `firm_sentiments` as a first-class field
- External quotes and institutional investor quotes are separate arrays with different schemas — don't merge them
- Reporter status/notes are independent of article data — store in a separate table
- The prior tool's 15 themes become the default topic values for the Private Credit workstream seed data
- Articles from JSON exports of the prior tool should be importable into the new system (backward compatibility)
