# PROMPT — High-Impact Feature Expansion

---

## Feature: Strategy Room (Sidebar Tab — "Strategy")

A conversational AI interface inside the tool where Claude has full read access to the workstream's data. This is the single highest-impact feature because it turns stored data into live strategic intelligence.

### How it works

A chat interface (similar to Claude.ai) embedded in the app as its own sidebar tab. When the user sends a message, the backend:

1. Assembles a context payload from the active workstream:
   - Summary stats: article count, date range, avg sentiment, top themes, top entities, top reporters
   - Recent articles (last 20): headline, outlet, date, sentiment, topics, key entities, rationale
   - Reporter profiles: names, outlets, avg sentiment, beat topics, status, recent articles
   - Active alerts
   - Narrative trend analysis (if generated)
   - Coverage gaps (if detected)
   - Speaker watchlist with recent quotes
2. Sends the user's message + context payload to Claude Sonnet as a system prompt + user message
3. Streams the response back to the frontend

### System prompt structure

```
You are a senior strategic communications advisor with deep expertise in media intelligence. You have access to the full media monitoring dataset for the "{workstream_name}" workstream ({client}).

CURRENT DATA SNAPSHOT:
{assembled context — stats, recent articles, reporters, trends, etc.}

Use this data to answer the user's questions with specificity. Reference actual articles, reporters, dates, and sentiment scores. Do not speculate beyond what the data shows — if the data doesn't support a conclusion, say so.

When recommending actions, anchor them to the workstream's messaging taxonomy: {topics list}.

You can:
- Analyze coverage patterns and explain what's driving them
- Identify strategic opportunities and risks
- Draft messaging, talking points, pitch angles, and narrative frames
- Compare entities, reporters, and outlets
- Predict likely coverage trajectories based on current patterns
- Recommend specific reporters to engage and why
- Draft responses to specific articles
- Identify gaps in coverage or messaging

Be direct, analytical, and actionable. No filler. Lead with the insight.
```

### Frontend

- Chat interface in the "Strategy" sidebar tab
- Message history persisted per workstream (stored in a `strategy_messages` table)
- Streaming response display (show tokens as they arrive)
- Quick-prompt buttons above the input for common queries:
  - "Weekly coverage summary"
  - "Who should we engage this week?"
  - "Draft pitch angle for [topic]"
  - "What are the emerging risks?"
  - "Compare coverage: [Entity A] vs [Entity B]"
- Ability to reference specific articles by clicking them in other tabs and choosing "Ask about this in Strategy Room" — pre-fills the input with context
- "Save Insight" button on any response — saves it to an `insights` table for later reference
- Saved insights viewable in a sub-tab, searchable, with timestamps

### Context window management

The full dataset may exceed Claude's context window for large workstreams. Strategy:
- Always include summary stats (small)
- Include the 30 most recent articles (truncated: headline, outlet, date, sentiment, topics, entities, rationale — no full_text)
- Include top 15 reporters with profiles
- Include last narrative trend analysis
- Include all active alerts and coverage gaps
- If the user's query references a specific article, reporter, or entity, pull in full detail for those specific items
- Total context target: ~15,000 tokens of data + user's message

### Full-text retrieval for specific-article queries

The `full_text` of every article is stored in the SQLite `articles` table. Storage cost is negligible (~5-10KB per article, ~10MB per 1,000 articles). The Strategy Room should use full text when relevant:

1. **Default context (general questions):** Send metadata only — headline, outlet, date, sentiment, topics, entities, rationale. No full_text. This keeps context small and allows 30+ articles.

2. **Specific-article queries:** When the user references a specific article (by headline keyword, date, outlet, or reporter), the backend should:
   - Identify matching articles via SQL query (LIKE match on headline, exact match on date/outlet/reporter)
   - Pull `full_text` for those specific matches (up to 5 articles)
   - Include the full text in the Claude call alongside the truncated metadata for the rest
   - This allows Claude to answer precisely: "What exactly did the FT say about Blue Owl's leverage?" → Claude reads the actual article

3. **Detection logic:** Before assembling context, run the user's message through a lightweight check:
   - Contains a headline fragment in quotes → search `articles.headline LIKE '%fragment%'`
   - Contains "the [Outlet] article" or "the article from [Date]" → match on outlet/date
   - Contains "what did [Reporter] write about [Topic]" → match reporter + topic, pull their most recent matching articles
   - If matches found, include their `full_text` in the context payload (trimmed to 6,000 chars each if very long)
   - If no specific match detected, use default metadata-only context

4. **Important:** Always store `full_text` as clean plaintext, not HTML. URL extraction via Readability must use `textContent` (not `content`). Browser extension must strip HTML tags. Factiva paste is already plaintext. This ensures full text is directly usable in Claude prompts without any preprocessing.

---

## Feature: Scenario Simulator (Sub-section of Strategy Room)

Let the user describe a hypothetical event and Claude predicts the likely media response based on historical patterns in the data.

### Examples

User: *"If Blue Owl announces another fund gate tomorrow, how will coverage play out?"*

Claude (with access to historical data): *"Based on the 14 articles following the February gate announcement, expect: Reuters (Saini, Azhar) will publish within 4 hours — their avg response time on Blue Owl developments is 3.2 hours. FT (Platt) typically follows within 24 hours with a deeper analytical piece. DealBook will frame it in their morning newsletter. Predicted sentiment: 1.8 avg across initial coverage, rising to 2.4 as industry response articles follow 48-72 hours later. The dominant frame will be 'contagion' (appeared in 11/14 prior articles). Recommended preemptive action: brief Saini and Platt before the announcement with your Rebalancing narrative and institutional investor commitment data."*

### Implementation

No separate backend needed — this runs through the Strategy Room's existing Claude call. The system prompt already includes historical data. Add a "Scenario" quick-prompt button that pre-fills: "If [describe event], predict the likely media coverage response. Include: which reporters will cover it first, expected timeline, predicted sentiment range, likely narrative frames, and recommended preemptive actions."

---

## Feature: Relationship Map (Sidebar Tab — "Network")

A visual graph showing the connections between reporters, outlets, firms, topics, and stakeholders.

### What it shows

- **Nodes**: reporters (circles), outlets (squares), firms (diamonds), key external speakers (triangles)
- **Edges**: a reporter is connected to the outlets they write for, the firms they cover, and the speakers they quote
- **Node size**: proportional to article count or quote count
- **Node color**: sentiment (1-7 spectrum)
- **Edge thickness**: proportional to frequency of the connection

### Interactions

- Click a node to highlight its connections and dim everything else
- Hover for tooltip: name, role, article count, avg sentiment
- Filter by: entity type, sentiment range, minimum connection count
- Click a node to open the contextual sidebar with that entity's profile
- Zoom and pan
- Layout algorithm: force-directed (d3-force) with manual pin capability

### Implementation

Use D3.js force-directed graph. Data assembled from:
- Reporter → outlet connections from article bylines
- Reporter → firm connections from articles they wrote mentioning each firm
- Reporter → speaker connections from quotes in their articles
- Firm → firm co-occurrence (appear in same article)

### Backend: `GET /api/network/:workstream_id`

Returns nodes and edges arrays. Compute on demand from articles + reporters + quotes tables.

### Why this matters

It lets you visually answer: "Who is the most connected reporter in this space?" "Which firms always get covered together?" "Which external speakers are being quoted by the most reporters?" These are the relationships that drive narrative propagation.

---

## Feature: Coverage Calendar (Sidebar Tab — "Calendar")

A calendar view showing article volume and sentiment by day, with drill-down.

### Monthly calendar view

- Each day cell shows: article count as a number, background color on sentiment spectrum (avg for that day)
- Days with alerts get a small indicator dot
- Click a day → expands to show that day's articles in a list below the calendar
- Hover a day → tooltip with count, avg sentiment, top headline

### Weekly timeline view (toggle)

- Horizontal timeline with each day as a column
- Articles stacked vertically within each day, color-coded by sentiment
- Taller stacks = more volume — gives an instant visual of coverage spikes
- Each article block is clickable → opens contextual sidebar

### Event overlay

Let users pin events to specific dates:
- "Blue Owl earnings call"
- "SEC hearing on private credit"
- "Client press release"
- These appear as labeled markers on the calendar
- Useful for correlating coverage spikes with events

### Implementation

Simple date-grouping from articles table. Event pins stored in an `events` table: `{ id, workstream_id, date, title, type, notes }`. Frontend uses a custom calendar grid (not a heavy library) — just CSS grid with day cells.

---

## Feature: Influence Score (Computed field on reporters and outlets)

A composite score that captures how much a reporter or outlet actually moves the conversation, not just how much they publish.

### Computation

For each reporter:
```
influence_score = (
  article_count_weight * normalized_article_count +
  outlet_tier_weight * outlet_tier_score +
  pickup_weight * avg_pickup_rate +
  quote_frequency_weight * times_quoted_elsewhere +
  recency_weight * recency_factor
)
```

Where:
- `normalized_article_count`: their count relative to the most prolific reporter
- `outlet_tier_score`: tier 1 = 1.0, tier 2 = 0.7, wire = 0.5, tier 3 = 0.3, blog = 0.1
- `avg_pickup_rate`: how often their stories get followed by other outlets (estimated by counting articles on the same topic within 48 hours of theirs)
- `times_quoted_elsewhere`: how often other articles reference their reporting (detected via entity extraction)
- `recency_factor`: more recent activity weighted higher (exponential decay over 30 days)

### Display

- Influence score shown as a 0-100 number on reporter cards and in the reporter table
- Sortable column
- Used in Engagement Priority ranking as an additional weight
- Tooltip explaining the score breakdown

---

## Feature: Drift Detection (Automated, runs daily)

Detect when your client's media positioning is drifting away from their intended messaging.

### How it works

Compare the distribution of topics in recent coverage against the workstream's "desired" topic distribution (configured by the user).

Example:
- Desired: 40% Rebalancing + Strong Fundamentals, 20% Essential, 10% Safe for System, 30% other
- Actual (last 14 days): 5% Rebalancing, 2% Strong Fundamentals, 60% Redemption/Liquidity Risk, 20% Regulatory Scrutiny, 13% other

Drift score = distance between desired and actual distributions.

### Configuration

In workstream settings, add a "Target Narrative Mix" section where the user assigns percentage weights to each topic. These represent what the ideal coverage distribution looks like.

### Backend

Cron job or post-classification hook computes drift daily. Stores in `drift_snapshots` table. Alerts when drift exceeds a threshold.

### Frontend

- "Narrative Drift" card on Dashboard: side-by-side bar chart showing target vs. actual topic distribution
- Drift score: 0 (perfectly aligned) to 100 (completely off-target)
- Trend line showing drift score over time
- Specific recommendations: "Coverage of 'Rebalancing' is 35 percentage points below target. Consider: proactive earned media push, op-ed placement, or third-party validator engagement."

---

## Feature: Comparison Snapshots (Export)

Save and compare analytics snapshots across time periods.

### How it works

At any point, user can "Save Snapshot" — captures current state of all analytics:
- Article count, avg sentiment, topic distribution, top reporters, top entities, coverage gaps, drift score, influence rankings

Snapshots stored in `snapshots` table with timestamp and a name the user provides.

### Comparison view

Select two snapshots → side-by-side comparison:
- Delta columns for every metric (▲+12 articles, ▼-0.4 avg sentiment, etc.)
- Highlight biggest changes in green (improvement) and red (deterioration)
- "What Changed" summary: auto-generated narrative explaining the major shifts between the two periods

### Use case

"Compare this week vs. last week" or "Compare before and after our media blitz" — quantifies the impact of communications interventions.

---

## Feature: Custom Dashboards (Sidebar Tab — "Dashboards")

Let users build their own dashboard layouts from modular widgets.

### Available widgets

Each widget is a self-contained component that queries a specific data slice:

- **KPI Card**: single number + trend arrow (configurable: total articles, avg sentiment, negative %, article count for specific topic, etc.)
- **Sentiment Trend Line**: line chart over time, configurable entity/topic filter
- **Volume Bar Chart**: articles per day/week/month, configurable filter
- **Topic Distribution**: horizontal bar or donut chart
- **Top Reporters Table**: sortable mini-table
- **Top Entities Table**: sortable mini-table
- **Recent Articles Feed**: scrollable list, configurable filter
- **Coverage Gap Indicator**: shows silent/declining topics
- **Narrative Drift Gauge**: target vs. actual distribution
- **Sentiment Velocity Movers**: top 5 fastest-moving entities
- **Quote Feed**: recent quotes, filterable by stance
- **Alert Feed**: recent alerts

### Layout

- Drag-and-drop grid layout (use react-grid-layout)
- Widgets snap to a 12-column grid
- Resize handles on each widget
- "Add Widget" button opens a picker with all available widgets + configuration options
- Layout saved per user per workstream in localStorage
- "Reset to Default" restores the standard dashboard

### Default layout

Ship with a sensible default: KPI row across the top, sentiment trend + volume chart in the middle row, topic distribution + top reporters on the bottom row. User customizes from there.

---

## Feature: Smart Search (Enhancement to Command Palette)

Extend the Cmd+K command palette with natural language search powered by Claude.

### How it works

If the user types a natural language query (not matching any article headline, reporter name, or command), route it to Claude with the workstream context:

- "articles about SEC enforcement" → Claude identifies matching articles by topic, entity, or content — returns article IDs that the palette displays as results
- "reporters who've gone more negative lately" → Claude queries reporter stats and returns names with sentiment velocity data
- "coverage from last Tuesday" → Claude interprets the date and returns matching articles

### Implementation

Detect natural language vs. direct match:
- If the query matches a headline, reporter, or command → show direct results (instant, no API call)
- If no direct match and query is >3 words → route to Claude mini-call (Haiku for speed) with a constrained prompt that returns entity IDs/types
- Show results with a subtle "AI-powered" indicator

---

## Sidebar Navigation Structure

Putting it all together, here's the full sidebar layout:

```
[Logo: MIP]
[Workstream Selector Dropdown]

──────────────────
MONITOR
  📊 Dashboard        (customizable widget grid)
  📋 Queue            (ingest + classify + review)
  📅 Calendar         (coverage by day/week)

ANALYZE
  📈 Analytics        (sub-tabs: reporters, outlets, firms, themes, comparison, engagement)
  🔗 Network          (relationship map)
  🎯 Strategy         (AI chat with data context)

INTELLIGENCE
  💬 Quotes           (external + institutional, speaker tracker, watchlist)
  👤 Reporters        (profiles, status, engagement history, annotations)
  🔔 Alerts           (triggered alerts feed)

EXPORT
  📤 Export           (Excel, Word, JSON, briefings, talking points, quotes)
  📸 Snapshots        (saved comparisons)

──────────────────
⚙️ Settings          (workstream config, taxonomy, outlet tiers, target narrative mix)
⌨️ Shortcuts         (keyboard shortcut reference)
```

Each top-level item is a sidebar nav link. Sub-tabs within Analytics are handled as a horizontal tab bar within the content area, not in the sidebar.

---

## Implementation Priority

After the base tool is working (Phase 1 from CLAUDE.md):

**Tier 1 — Build immediately (transforms the tool):**
1. Strategy Room — the AI chat with data context
2. Sidebar navigation restructure
3. Design system / branding overhaul
4. Media Briefing Generator

**Tier 2 — Build next (deepens intelligence):**
5. Coverage Calendar
6. Narrative Drift Detection
7. Relationship Map / Network view
8. Influence Score
9. Talking Points Generator

**Tier 3 — Build when ready (power user features):**
10. Custom Dashboards with drag-and-drop widgets
11. Scenario Simulator
12. Comparison Snapshots
13. Smart Search in command palette
14. Sentiment Velocity tracking
15. Coverage Gap Detection
