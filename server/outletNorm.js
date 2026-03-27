// Outlet normalization: maps variant names to canonical forms.
// Rules are checked in order — first match wins.
// Each rule: [regex pattern, canonical name]

const OUTLET_RULES = [
  // Wall Street Journal family
  [/\bwsj\b/i, 'The Wall Street Journal'],
  [/wall\s*street\s*journal/i, 'The Wall Street Journal'],
  [/wsj\.com/i, 'The Wall Street Journal'],
  [/wsj\s*pro/i, 'The Wall Street Journal'],

  // Financial Times
  [/\bft\.com\b/i, 'Financial Times'],
  [/financial\s*times/i, 'Financial Times'],

  // New York Times
  [/nytimes\.com/i, 'The New York Times'],
  [/new\s*york\s*times/i, 'The New York Times'],
  [/\bnyt\b/i, 'The New York Times'],

  // Bloomberg
  [/bloomberg\.com/i, 'Bloomberg'],
  [/bloomberg\s*(news|law|intelligence|opinion)?/i, 'Bloomberg'],

  // Reuters
  [/reuters\s*(news)?/i, 'Reuters'],

  // Washington Post
  [/washingtonpost\.com/i, 'The Washington Post'],
  [/washington\s*post/i, 'The Washington Post'],

  // Barron's
  [/barrons\.com/i, "Barron's"],
  [/barron'?s/i, "Barron's"],

  // Business Insider
  [/businessinsider\.com/i, 'Business Insider'],
  [/business\s*insider/i, 'Business Insider'],

  // CNBC
  [/cnbc\.com/i, 'CNBC'],
  [/\bcnbc\b/i, 'CNBC'],

  // Politico
  [/politico\.com/i, 'Politico'],
  [/\bpolitico\b/i, 'Politico'],

  // Axios
  [/axios\.com/i, 'Axios'],
  [/\baxios\b/i, 'Axios'],

  // The Hill
  [/thehill\.com/i, 'The Hill'],
  [/\bthe\s*hill\b/i, 'The Hill'],

  // Fortune
  [/fortune\.com/i, 'Fortune'],
  [/\bfortune\b/i, 'Fortune'],

  // Associated Press
  [/\bap\s*news\b/i, 'Associated Press'],
  [/associated\s*press/i, 'Associated Press'],

  // BBC
  [/bbc\.(com|co\.uk)/i, 'BBC'],
  [/\bbbc\b/i, 'BBC'],

  // The Guardian
  [/theguardian\.com/i, 'The Guardian'],
  [/\bguardian\b/i, 'The Guardian'],

  // MarketWatch
  [/marketwatch\.com/i, 'MarketWatch'],
  [/market\s*watch/i, 'MarketWatch'],

  // S&P Global
  [/spglobal\.com/i, 'S&P Global'],
  [/s&p\s*global/i, 'S&P Global'],

  // Law360
  [/law360\.com/i, 'Law360'],
  [/\blaw\s*360\b/i, 'Law360'],

  // American Banker
  [/americanbanker\.com/i, 'American Banker'],
  [/american\s*banker/i, 'American Banker'],

  // Institutional Investor
  [/institutionalinvestor\.com/i, 'Institutional Investor'],
  [/institutional\s*investor/i, 'Institutional Investor'],

  // Private Debt Investor
  [/privatedebtinvestor\.com/i, 'Private Debt Investor'],
  [/private\s*debt\s*investor/i, 'Private Debt Investor'],

  // Pensions & Investments
  [/pionline\.com/i, 'Pensions & Investments'],
  [/pensions\s*&?\s*investments/i, 'Pensions & Investments'],
];

export function normalizeOutlet(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  for (const [pattern, canonical] of OUTLET_RULES) {
    if (pattern.test(trimmed)) return canonical;
  }
  // If no rule matches but it looks like a domain, try to clean it
  const domainMatch = trimmed.match(/^(?:www\.)?([a-z0-9-]+)\.(com|org|net|co\.uk)/i);
  if (domainMatch) {
    // Title-case the domain name
    return domainMatch[1].charAt(0).toUpperCase() + domainMatch[1].slice(1);
  }
  return trimmed;
}

// Strip trailing metadata that Factiva sometimes appends (e.g. ", 26 Mar 2026")
export function cleanOutletName(raw) {
  if (!raw) return null;
  // Remove trailing date patterns like ", 26 Mar 2026" or ", 23 Mar 2026"
  let cleaned = raw.replace(/,\s*\d{1,2}\s+\w+\s+\d{4}\s*$/, '').trim();
  // Remove trailing word counts like ", 2572 words"
  cleaned = cleaned.replace(/,\s*\d+\s+words.*$/i, '').trim();
  // Remove "By " prefix that sometimes gets captured as outlet
  if (/^by\s+/i.test(cleaned)) return null;
  return normalizeOutlet(cleaned);
}
