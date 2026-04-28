// Firm name normalization: merges variant names to canonical short forms.
// Two-pass approach:
//   1. Known rules (regex → canonical) for major firms
//   2. Fuzzy grouping for unknown firms (longest common prefix / substring)

const FIRM_RULES = [
  // Private credit / alternative asset managers
  [/\bapollo\b/i, 'Apollo'],
  [/\bares\s*(management|capital)?\b/i, 'Ares'],
  [/\bblackstone\b/i, 'Blackstone'],
  [/\bblackrock\b/i, 'BlackRock'],
  [/\bblue\s*owl\b/i, 'Blue Owl'],
  [/\bkkr\b/i, 'KKR'],
  [/\bkohlberg\s*kravis/i, 'KKR'],
  [/\bcarlyle\b/i, 'Carlyle'],
  [/\bbain\s*capital\b/i, 'Bain Capital'],
  [/\btpg\b/i, 'TPG'],
  [/\bwarburg\s*pincus\b/i, 'Warburg Pincus'],
  [/\boaktree\b/i, 'Oaktree'],
  [/\bhps\s*(investment|partners)?\b/i, 'HPS'],
  [/\bowl\s*rock\b/i, 'Owl Rock'],
  [/\bgolub\s*capital\b/i, 'Golub Capital'],
  [/\bnew\s*mountain\b/i, 'New Mountain'],
  [/\bsilver\s*point\b/i, 'Silver Point'],
  [/\bangelo\s*gordon\b/i, 'Angelo Gordon'],
  [/\bcerberus\b/i, 'Cerberus'],
  [/\bfortress\b/i, 'Fortress'],
  [/\bman\s*group\b/i, 'Man Group'],

  // Major banks / asset managers
  [/\bgoldman\s*sachs\b/i, 'Goldman Sachs'],
  [/\bjp\s*morgan|jpmorgan\b/i, 'JPMorgan'],
  [/\bmorgan\s*stanley\b/i, 'Morgan Stanley'],
  [/\bbank\s*of\s*america\b/i, 'Bank of America'],
  [/\bcitigroup\b|\bciti\b/i, 'Citi'],
  [/\bwells\s*fargo\b/i, 'Wells Fargo'],
  [/\bbarclays\b/i, 'Barclays'],
  [/\bdeutsche\s*bank\b/i, 'Deutsche Bank'],
  [/\bubs\b/i, 'UBS'],
  [/\bcredit\s*suisse\b/i, 'Credit Suisse'],
  [/\bhsbc\b/i, 'HSBC'],
  [/\bnomura\b/i, 'Nomura'],
  [/\blazard\b/i, 'Lazard'],
  [/\bevercore\b/i, 'Evercore'],
  [/\bstate\s*street\b/i, 'State Street'],
  [/\bvanguard\b/i, 'Vanguard'],
  [/\bfidelity\b/i, 'Fidelity'],
  [/\bpimco\b/i, 'PIMCO'],
  [/\binvesco\b/i, 'Invesco'],
  [/\bt\.?\s*rowe\s*price\b/i, 'T. Rowe Price'],
  [/\bnorthern\s*trust\b/i, 'Northern Trust'],
  [/\bcharles\s*schwab\b/i, 'Charles Schwab'],

  // Insurance / diversified
  [/\bberkshire\s*hathaway\b/i, 'Berkshire Hathaway'],
  [/\baig\b/i, 'AIG'],
  [/\bprudential\b/i, 'Prudential'],
  [/\bmetlife\b/i, 'MetLife'],

  // Proxy / governance
  [/\biss\b|institutional\s*shareholder\s*services/i, 'ISS'],
  [/\bglass\s*lewis\b/i, 'Glass Lewis'],

  // Regulators (often mentioned alongside firms)
  [/\bsec\b|securities\s*and\s*exchange\s*commission/i, 'SEC'],
  [/\bfsoc\b|financial\s*stability\s*oversight/i, 'FSOC'],
  [/\bftc\b|federal\s*trade\s*commission/i, 'FTC'],
  [/\bdoj\b|department\s*of\s*justice/i, 'DOJ'],
  [/\bfed\b|federal\s*reserve/i, 'Federal Reserve'],
];

// Normalize a single firm name using known rules
function normalizeByRules(name) {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  for (const [pattern, canonical] of FIRM_RULES) {
    if (pattern.test(trimmed)) return canonical;
  }
  return null;
}

// Fuzzy merge: group remaining unknown firms by similarity.
// Uses case-insensitive comparison after stripping common suffixes.
const CORP_SUFFIXES = /\s*(capital\s*management|capital\s*partners|capital\s*group|asset\s*management|investment\s*management|investment\s*partners|investments|management|partners|group|holdings|inc\.?|corp\.?|co\.?|llc|lp|ltd\.?|plc|& co\.?|associates|advisors|advisory|consulting|solutions|fund|funds|financial|services|global|international)\s*$/i;

function stripSuffix(name) {
  let stripped = name;
  // Iteratively strip suffixes (a name might have "Capital Management Group")
  for (let i = 0; i < 3; i++) {
    const before = stripped;
    stripped = stripped.replace(CORP_SUFFIXES, '').trim();
    if (stripped === before) break;
  }
  return stripped || name;
}

// Normalize a firm name: try rules first, then strip suffixes for the short form
export function normalizeFirm(name) {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  // Try known rules first
  const byRule = normalizeByRules(trimmed);
  if (byRule) return byRule;

  // For unknown firms, strip corporate suffixes to get the short name
  return stripSuffix(trimmed) || trimmed;
}

// Normalize an array of firm names, merging duplicates
export function normalizeFirmList(firms) {
  if (!Array.isArray(firms)) return [];
  const seen = new Map(); // canonical → true
  const result = [];
  for (const f of firms) {
    const canonical = normalizeFirm(f);
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, true);
      result.push(canonical);
    }
  }
  return result;
}

// Normalize a firm_sentiments object, merging duplicate keys (average scores)
export function normalizeFirmSentiments(firmSentiments) {
  if (!firmSentiments || typeof firmSentiments !== 'object') return {};
  const merged = {};
  const counts = {};
  for (const [name, score] of Object.entries(firmSentiments)) {
    const canonical = normalizeFirm(name);
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (!merged[key]) {
      merged[key] = { name: canonical, total: 0, count: 0 };
    }
    merged[key].total += (typeof score === 'number' ? score : parseFloat(score) || 0);
    merged[key].count++;
  }
  const result = {};
  for (const { name, total, count } of Object.values(merged)) {
    result[name] = count > 0 ? Math.round((total / count) * 10) / 10 : 0;
  }
  return result;
}
