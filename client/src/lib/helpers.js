export function fingerprint(headline, outlet, date) {
  const raw = `${(headline || '').toLowerCase().trim()}|${(outlet || '').toLowerCase().trim()}|${(date || '').trim()}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

export function sentimentClass(score) {
  return score >= 1 && score <= 7 ? `sentiment-${score}` : 'sentiment-4';
}

export function sentimentDot(score) {
  const colors = { 1: '#DC2626', 2: '#EA580C', 3: '#D97706', 4: '#6B7280', 5: '#059669', 6: '#16A34A', 7: '#15803D' };
  return colors[score] || '#94A3B8';
}

export function statusClass(status) {
  return `status-${status || 'pending'}`;
}

// Compat aliases used in components
export function sentimentColor(score) {
  if (!score) return 'text-slate-400';
  const m = { 1: 'text-red-600', 2: 'text-orange-500', 3: 'text-amber-600', 4: 'text-slate-500', 5: 'text-emerald-500', 6: 'text-green-600', 7: 'text-green-700' };
  return m[score] || 'text-slate-400';
}

export function sentimentBg(score) {
  if (!score) return 'bg-slate-50';
  const m = { 1: 'bg-red-50', 2: 'bg-orange-50', 3: 'bg-amber-50', 4: 'bg-slate-50', 5: 'bg-emerald-50', 6: 'bg-green-50', 7: 'bg-green-50' };
  return m[score] || 'bg-slate-50';
}

export function statusBadge(status) {
  const m = { pending: 'bg-slate-100 text-slate-600', classified: 'bg-blue-100 text-blue-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700' };
  return m[status] || 'bg-slate-100 text-slate-600';
}

export function tierBadge(tier) {
  const m = { High: 'bg-red-100 text-red-700', Medium: 'bg-amber-100 text-amber-700', Low: 'bg-slate-100 text-slate-500' };
  return m[tier] || 'bg-slate-100 text-slate-500';
}

export const SENTIMENT_LABELS = {
  1: 'Very Negative', 2: 'Negative', 3: 'Slightly Negative', 4: 'Neutral',
  5: 'Slightly Positive', 6: 'Positive', 7: 'Very Positive'
};

export function sentimentLabel(score) { return SENTIMENT_LABELS[score] || ''; }

export function tierBadgeClass(tier) {
  const m = { High: 'bg-red-100 text-red-700', Medium: 'bg-amber-100 text-amber-700', Low: 'bg-slate-100 text-slate-500' };
  return m[tier] || 'bg-slate-100 text-slate-500';
}

export const REPORTER_STATUSES = [
  { value: 'no_action', label: 'No Action', cls: 'bg-slate-100 text-slate-600' },
  { value: 'watching', label: 'Watching', cls: 'bg-blue-100 text-blue-700' },
  { value: 'pending_outreach', label: 'Pending Outreach', cls: 'bg-amber-100 text-amber-700' },
  { value: 'engaged', label: 'Engaged', cls: 'bg-emerald-100 text-emerald-700' },
  { value: 'do_not_contact', label: 'Do Not Contact', cls: 'bg-red-100 text-red-700' },
];

export function reporterStatusColor(status) {
  return REPORTER_STATUSES.find(s => s.value === status)?.cls || 'bg-slate-100 text-slate-600';
}

export function formatDate(d) {
  if (!d) return '';
  try {
    // Append T12:00:00 to date-only strings to avoid timezone shift
    const dateStr = d.length === 10 ? d + 'T12:00:00' : d;
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return d; }
}

// Velocity
export function velocityIndicator(v) {
  if (v > 0.15) return { symbol: '▲', cls: 'velocity-up', label: 'Improving' };
  if (v < -0.15) return { symbol: '▼', cls: 'velocity-down', label: 'Deteriorating' };
  return { symbol: '—', cls: 'velocity-stable', label: 'Stable' };
}

// Sidebar nav icons as SVG paths
export const NAV_ICONS = {
  Ingest: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4"/>',
  Queue: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>',
  Analytics: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 13h4v8H3zM10 9h4v12h-4zM17 5h4v16h-4z"/>',
  Quotes: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>',
  Watchlist: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>',
  Briefing: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>',
  Export: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>',
  Setup: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>',
};
