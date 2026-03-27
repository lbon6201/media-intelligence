# PROMPT — Advanced Analysis, UI Overhaul, and Branding

---

## Branding & Design System

Remove all references to FTI, FTI Consulting, or any specific company branding throughout the entire codebase — component names, comments, seed data descriptions, color variable names, everything. This is a standalone product called **"Media Intelligence Platform"** or **"MIP"** for short.

### Design Direction

Build a design system that feels like a premium intelligence product — think Bloomberg Terminal meets Linear meets Notion. Information-dense but never cluttered. Every element earns its pixels.

### Color Palette

Use CSS variables throughout. Dark sidebar/header with a light content area.

```css
:root {
  /* Core */
  --bg-primary: #0B0F19;          /* Deep navy-black — sidebar, header */
  --bg-secondary: #111827;        /* Slightly lighter — cards on dark backgrounds */
  --bg-content: #F8FAFC;          /* Light gray — main content area */
  --bg-card: #FFFFFF;             /* White — cards, panels */
  --bg-hover: #F1F5F9;           /* Subtle hover state */
  --bg-selected: #EFF6FF;        /* Selected row/item */

  /* Text */
  --text-primary: #0F172A;       /* Near-black — headings, primary content */
  --text-secondary: #475569;     /* Slate — secondary labels, metadata */
  --text-muted: #94A3B8;         /* Light gray — timestamps, tertiary info */
  --text-inverse: #F1F5F9;       /* Light — text on dark backgrounds */

  /* Accent */
  --accent: #2563EB;             /* Blue — primary actions, active states, links */
  --accent-hover: #1D4ED8;      /* Darker blue — hover */
  --accent-subtle: #DBEAFE;     /* Light blue — badges, tag backgrounds */

  /* Sentiment spectrum (1-7) */
  --sentiment-1: #DC2626;        /* Very Negative — red */
  --sentiment-2: #EA580C;        /* Negative — orange-red */
  --sentiment-3: #D97706;        /* Slightly Negative — amber */
  --sentiment-4: #6B7280;        /* Neutral — gray */
  --sentiment-5: #059669;        /* Slightly Positive — emerald */
  --sentiment-6: #16A34A;        /* Positive — green */
  --sentiment-7: #15803D;        /* Very Positive — dark green */

  /* Status */
  --status-pending: #6B7280;
  --status-classified: #2563EB;
  --status-approved: #16A34A;
  --status-rejected: #DC2626;

  /* Borders & Dividers */
  --border: #E2E8F0;
  --border-subtle: #F1F5F9;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.03);
}
```

### Typography

Use **Inter** for body text and UI elements (highly legible at small sizes, excellent for data-dense interfaces). Use **JetBrains Mono** for data values, sentiment scores, dates, and any monospaced content. Load from Google Fonts.

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

Size scale:
- 11px: metadata, timestamps, tertiary labels (mono)
- 12px: table cells, filter labels, badge text
- 13px: body text, descriptions, form inputs
- 14px: section headers, card titles
- 16px: page titles
- 20px: main dashboard KPI numbers (mono, bold)

### Layout Principles

- **Sidebar navigation** (not top tabs): dark sidebar on the left with icon + label nav items. Collapsible to icon-only for more content space. Workstream switcher at the top of sidebar.
- **Content area**: light background, max-width 1400px, 24px padding
- **Cards**: white background, subtle shadow, 8px border-radius, 16-20px internal padding
- **Tables**: no outer borders, subtle row separators, sticky header, alternating row backgrounds on hover only (not by default)
- **Sentiment badges**: pill-shaped, colored background matching sentiment score, white or dark text for contrast. Show both number and short label: "2 — Negative"
- **Filter bars**: horizontal, compact, slightly recessed background. Dropdowns and inputs all same height (32px). Counts always visible.
- **Empty states**: centered, muted text, clear call-to-action button

### Micro-interactions

- Sidebar nav items: subtle left border highlight on active, smooth color transition on hover
- Cards: slight translateY(-1px) + shadow increase on hover for clickable cards
- Sentiment badges: tooltip on hover showing full label and description
- Table rows: background highlight on hover, smooth expand/collapse for detail panels
- Buttons: subtle scale(0.98) on click, color transition on hover
- Toast notifications: slide in from top-right, auto-dismiss after 3-5 seconds, color-coded by type (success green, error red, info blue)

---

## Feature 8: Media Briefing Generator

Auto-assemble a client-ready executive briefing from classified articles.

### Backend: `POST /api/briefings/:workstream_id/generate`

Accepts:
```json
{
  "from": "YYYY-MM-DD",
  "to": "YYYY-MM-DD",
  "include_sections": ["summary", "top_stories", "sentiment_shift", "key_quotes", "emerging_risks", "recommended_actions"],
  "max_articles_referenced": 20,
  "tone": "executive" | "detailed"
}
```

Process:
1. Pull all approved articles in the date range with full classification + quotes
2. Compute summary stats: total articles, avg sentiment, sentiment vs prior period, top themes, top entities, top reporters
3. Send to Claude Sonnet with structured prompt:

```
You are a senior strategic communications advisor preparing a media intelligence briefing for a client. Write a professional, actionable briefing based on the coverage data provided.

Sections to include: [based on include_sections param]

EXECUTIVE SUMMARY: 3-4 sentences. Lead with the single most important development. State overall sentiment trajectory. Flag any urgent items.

TOP STORIES: The 3-5 most significant articles this period. For each: one-sentence summary, why it matters strategically, outlet and date.

SENTIMENT SHIFT: How has tone changed vs. the prior period? Which entities saw the biggest moves? What's driving the change? Be specific with numbers.

KEY QUOTES: The 3-5 most strategically significant external quotes. Include speaker, affiliation, and why this quote matters for the client's positioning.

EMERGING RISKS: Coverage patterns that could become problems — new reporters entering the space, new negative frames gaining traction, regulatory signals.

RECOMMENDED ACTIONS: 2-4 specific, actionable recommendations based on the coverage. What should the client do this week? Who should they engage? What messaging should they emphasize?

Tone: {executive = concise, bullet-heavy, action-oriented | detailed = fuller paragraphs, more context}

Return as JSON with section keys matching the section names.
```

4. Store in `briefings` table: `{ id, workstream_id, from_date, to_date, sections JSON, generated_at }`

### Frontend

- "Generate Briefing" button on Dashboard and in Export tab
- Configuration modal: date range, section checkboxes, tone toggle
- Preview panel showing rendered briefing with section headers
- "Edit" mode: each section is an editable text area so the user can refine before export
- "Export as Word Doc" button: generates a formatted .docx with title page, section headers, and professional formatting
- "Copy to Clipboard" button for quick paste into email

---

## Feature 9: Source Credibility / Outlet Tier System

### Database

```sql
CREATE TABLE outlet_tiers (
  outlet_name TEXT PRIMARY KEY,
  tier TEXT NOT NULL,              -- tier1_national | tier2_trade | tier3_regional | wire | blog | broadcast | newsletter
  reach_score INTEGER,            -- 1-10, manual or estimated
  notes TEXT
);
```

Seed with known outlets:
- Tier 1: Wall Street Journal, New York Times, Financial Times, Washington Post, Bloomberg
- Tier 2: Barron's, American Banker, Institutional Investor, Pensions & Investments, Reuters Breakingviews
- Wire: Reuters, Associated Press, Dow Jones Newswires
- Newsletter: DealBook, Bloomberg Opinion, Axios
- Add more as they appear

### Auto-assignment

When an article is ingested, check `outlet_tiers` for a match. If found, set `outlet_type` automatically. If not found, leave as "unassigned" and surface in a "Classify Outlets" prompt so the user can assign tier with one click.

### Weighted Sentiment

In analytics, offer a "weighted" toggle:
- Tier 1 articles count 3x in avg sentiment and volume calculations
- Tier 2 / Wire count 2x
- Tier 3 / Blog / Newsletter count 1x
- This gives a more accurate picture of media impact vs. raw volume

### Frontend

- Outlet tier badge next to outlet name everywhere it appears
- "Outlet Management" section in workstream settings: table of all outlets seen, with tier dropdown per outlet
- Dashboard KPIs show both raw and weighted sentiment when weighted mode is on

---

## Feature 10: Coverage Gap Detection

### Backend: `GET /api/analytics/:workstream_id/gaps`

For each topic in the workstream taxonomy:
1. Count articles classified with that topic in the last 7, 14, and 30 days
2. Compare to the overall average frequency for that topic
3. Flag topics with zero coverage in the last 14 days, or >50% decline vs. 30-day average

Return:
```json
{
  "gaps": [
    {
      "topic": "Rebalancing",
      "last_7d": 0,
      "last_14d": 1,
      "last_30d": 8,
      "avg_weekly": 2.0,
      "status": "silent",           -- silent (0 in 14d) | declining | healthy
      "implication": "Your positive messaging pillar has no recent media presence"
    }
  ],
  "over_represented": [
    {
      "topic": "Redemption / Liquidity Risk",
      "last_7d": 12,
      "avg_weekly": 4.0,
      "status": "spiking",
      "implication": "3x normal volume — likely driven by [event/article]"
    }
  ]
}
```

### Frontend

- "Coverage Gaps" card on Dashboard showing silent/declining topics with red/amber indicators
- Expandable detail: topic name, volume trend mini-chart, implication text
- Link to filtered article list for each topic

---

## Feature 11: Sentiment Velocity Tracking

Track not just sentiment level but rate of change.

### Backend computation

For each entity, topic, and the workstream overall:
- Calculate rolling 7-day avg sentiment
- Compare to rolling 30-day avg sentiment
- Velocity = (7-day avg - 30-day avg) / 30-day avg
- Flag if |velocity| > 0.15 (significant movement)

### Frontend

- Velocity indicators next to sentiment scores: ▲ (improving), ▼ (deteriorating), — (stable)
- Color-coded: green ▲, red ▼, gray —
- Dashboard: "Fastest Movers" section showing the 5 entities/topics with largest velocity (positive and negative)
- Hover tooltip showing: "7-day avg: 3.2, 30-day avg: 4.1, velocity: -22%"

---

## Feature 12: Talking Points Generator

### Backend: `POST /api/talking-points/:workstream_id/generate`

Accepts:
```json
{
  "article_ids": ["id1", "id2"],       // specific articles to respond to, OR
  "topic": "Redemption / Liquidity Risk", // generate for a topic generally
  "context": "Client is doing a media interview tomorrow",  // optional user context
  "messaging_pillars": true             // whether to anchor to workstream topics
}
```

Send selected articles + workstream taxonomy to Claude Sonnet:

```
You are a strategic communications advisor. Based on the media coverage provided, draft reactive talking points for a spokesperson.

Requirements:
- 4-6 talking points, each 2-3 sentences
- Lead with the strongest positive framing
- Acknowledge legitimate concerns without amplifying them
- Bridge to the client's messaging pillars where natural
- Include a specific data point or proof point in each talking point where possible
- End with a forward-looking statement

If messaging pillars are provided, explicitly connect at least 2 talking points to specific pillars.

Return as JSON:
{
  "talking_points": [
    { "point": "text", "pillar": "connected pillar or null", "bridges_from": "what concern this addresses" }
  ],
  "do_not_say": ["phrases or framings to avoid"],
  "anticipated_followups": [
    { "question": "likely reporter follow-up", "suggested_response": "brief response guidance" }
  ]
}
```

### Frontend

- "Generate Talking Points" button in article detail view (for that specific article)
- "Generate Talking Points" in topic/theme view (for a topic cluster)
- Output displayed as editable cards
- "Export as Word Doc" and "Copy to Clipboard" buttons
- Saved to a `talking_points` table for future reference

---

## Feature 13: Command Palette (Cmd+K)

### Implementation

Use a modal overlay triggered by Cmd+K (Mac) or Ctrl+K (Windows).

Search across:
- Articles (by headline, reporter, outlet)
- Reporters (by name)
- Workstreams (switch active)
- Actions: "Generate Briefing", "Export Excel", "Classify Pending", "Generate Talking Points"
- Navigation: "Go to Dashboard", "Go to Queue", "Go to Reporters"

Fuzzy matching on input. Show results grouped by type (Articles, Reporters, Actions, Navigation). Enter or click to execute. Esc to close.

### Keyboard Shortcuts (global)

| Key | Action |
|-----|--------|
| Cmd+K | Open command palette |
| Cmd+1-5 | Switch tabs (1=Dashboard, 2=Queue, 3=Reporters, 4=Analytics, 5=Export) |
| / | Focus search/filter input on current tab |
| J / K | Navigate up/down in article list |
| A | Approve selected article |
| R | Reject selected article |
| E | Expand/collapse selected article |
| Esc | Close any open modal/sidebar/expanded panel |

Show a small "Keyboard Shortcuts" reference accessible from the sidebar footer (? icon).

---

## Feature 14: Contextual Sidebar

Instead of full-page navigation for entity details, use a slide-in sidebar from the right.

- Click any reporter name → reporter profile sidebar slides in (profile, stats, quotes, status, engagement history)
- Click any firm/entity name → entity sidebar (articles mentioning it, sentiment trend, top reporters covering it)
- Click any article headline in a summary/list → article detail sidebar (full classification, quotes, annotations)
- Sidebar width: ~480px, with subtle backdrop dim on the main content
- Close button, Esc key, or click outside to dismiss
- Sidebar doesn't disrupt the current page state — user picks up where they left off

---

## Feature 15: Data Density & View Modes

Toggle between views (persisted per user in localStorage):

**Compact mode:**
- Table rows: 32px height, 12px font
- No row padding beyond minimal
- More articles visible without scrolling
- Sentiment shown as colored dot + number only (no label)

**Comfortable mode (default):**
- Table rows: 44px height, 13px font
- Standard padding
- Sentiment shown as full pill badge with label

**Card mode (for Reporters, Firms, etc.):**
- Grid of cards instead of table rows
- More visual, less data-dense
- Good for presentation/demo contexts

Toggle lives in the page header — three small icons (list compact, list comfortable, grid).

---

## Implementation Priority

Build in this order:
1. **Branding & Design System** — foundation everything else builds on
2. **Sidebar Navigation** — restructure from top tabs to sidebar
3. **Command Palette + Keyboard Shortcuts** — power user efficiency
4. **Contextual Sidebar** — better navigation UX
5. **Data Density Modes** — user preference
6. **Outlet Tier System** — improves analytics quality
7. **Sentiment Velocity** — lightweight, high-value analytics
8. **Coverage Gap Detection** — lightweight, high-value analytics
9. **Media Briefing Generator** — highest client-value feature
10. **Talking Points Generator** — high client value
11. **Source credibility weighting in analytics** — enhances existing views
