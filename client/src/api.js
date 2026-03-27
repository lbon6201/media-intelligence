const BASE = '/api';

function getAuthHeaders() {
  const token = localStorage.getItem('mip-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers },
    ...options,
  });
  if (res.status === 401) {
    localStorage.removeItem('mip-token');
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  const ct = res.headers.get('content-type');
  if (ct && ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  // Workstreams
  getWorkstreams: () => request('/workstreams'),
  createWorkstream: (data) => request('/workstreams', { method: 'POST', body: JSON.stringify(data) }),
  updateWorkstream: (id, data) => request(`/workstreams/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWorkstream: (id) => request(`/workstreams/${id}`, { method: 'DELETE' }),

  // Articles
  getArticles: (params) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
    return request(`/articles?${new URLSearchParams(filtered)}`);
  },
  ingestArticles: (articles) => request('/articles/ingest', { method: 'POST', body: JSON.stringify({ articles }) }),
  ingestUrls: (workstream_id, urls) => request('/articles/ingest-urls', { method: 'POST', body: JSON.stringify({ workstream_id, urls }) }),
  updateArticle: (id, data) => request(`/articles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  bulkStatus: (ids, cl_status) => request('/articles/bulk-status', { method: 'PUT', body: JSON.stringify({ ids, cl_status }) }),
  deleteArticle: (id) => request(`/articles/${id}`, { method: 'DELETE' }),
  bulkDelete: (ids) => request('/articles/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),

  // Classification
  startClassification: (workstreamId) => request(`/classify/${workstreamId}`, { method: 'POST' }),
  getProgress: (workstreamId) => request(`/classify/${workstreamId}/progress`),

  // Quotes
  getQuotes: (params) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
    return request(`/quotes?${new URLSearchParams(filtered)}`);
  },
  getSpeakers: (workstreamId) => request(`/quotes/speakers?workstream_id=${workstreamId}`),

  // Reporters
  getReporters: (workstreamId, sortBy) => request(`/reporters?workstream_id=${workstreamId}${sortBy ? '&sort_by=' + sortBy : ''}`),
  updateReporterStatus: (data) => request('/reporters/status', { method: 'PUT', body: JSON.stringify(data) }),
  addEngagement: (data) => request('/reporters/engagement', { method: 'POST', body: JSON.stringify(data) }),
  deleteEngagement: (data) => request('/reporters/engagement/delete', { method: 'POST', body: JSON.stringify(data) }),
  getAliases: () => request('/reporters/aliases'),
  addAlias: (data) => request('/reporters/aliases', { method: 'POST', body: JSON.stringify(data) }),

  // Narratives
  generateNarrative: (workstreamId, data) => request(`/narratives/${workstreamId}/generate`, { method: 'POST', body: JSON.stringify(data) }),
  getNarratives: (workstreamId) => request(`/narratives/${workstreamId}`),

  // Analytics comparison
  getComparison: (workstreamId, params) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString();
    return request(`/analytics/${workstreamId}/comparison?${qs}`);
  },
  getEntities: (workstreamId) => request(`/analytics/${workstreamId}/entities`),
  getCoverageGaps: (workstreamId) => request(`/analytics/${workstreamId}/gaps`),
  getVelocity: (workstreamId) => request(`/analytics/${workstreamId}/velocity`),

  // Briefings
  generateBriefing: (workstreamId, data) => request(`/briefings/${workstreamId}/generate`, { method: 'POST', body: JSON.stringify(data) }),
  getBriefings: (workstreamId) => request(`/briefings/${workstreamId}`),

  // Talking Points
  generateTalkingPoints: (workstreamId, data) => request(`/talking-points/${workstreamId}/generate`, { method: 'POST', body: JSON.stringify(data) }),

  // Outlet Tiers
  getOutletTiers: () => request('/outlet-tiers'),
  updateOutletTier: (name, data) => request(`/outlet-tiers/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),
  getUnassignedOutlets: () => request('/outlet-tiers/unassigned'),

  // Watchlist
  getWatchlist: (workstreamId) => request(`/watchlist/${workstreamId}`),
  addToWatchlist: (workstreamId, data) => request(`/watchlist/${workstreamId}`, { method: 'POST', body: JSON.stringify(data) }),
  updateWatchlistSpeaker: (workstreamId, id, data) => request(`/watchlist/${workstreamId}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWatchlistSpeaker: (workstreamId, id) => request(`/watchlist/${workstreamId}/${id}`, { method: 'DELETE' }),
  getWatchlistQuotes: (workstreamId, id) => request(`/watchlist/${workstreamId}/${id}/quotes`),
  getWatchlistSuggestions: (workstreamId) => request(`/watchlist/${workstreamId}/suggestions`),

  // Strategy Room
  getStrategyMessages: (workstreamId) => request(`/strategy/${workstreamId}/messages`),
  clearStrategyMessages: (workstreamId) => request(`/strategy/${workstreamId}/messages`, { method: 'DELETE' }),
  saveInsight: (workstreamId, data) => request(`/strategy/${workstreamId}/insights`, { method: 'POST', body: JSON.stringify(data) }),
  getInsights: (workstreamId) => request(`/strategy/${workstreamId}/insights`),
  deleteInsight: (workstreamId, id) => request(`/strategy/${workstreamId}/insights/${id}`, { method: 'DELETE' }),

  // Network
  getNetwork: (workstreamId, minWeight) => request(`/network/${workstreamId}?min_weight=${minWeight || 1}`),

  // Calendar
  getCalendarData: (workstreamId) => request(`/calendar/${workstreamId}`),
  getEvents: (workstreamId) => request(`/calendar/${workstreamId}/events`),
  addEvent: (workstreamId, data) => request(`/calendar/${workstreamId}/events`, { method: 'POST', body: JSON.stringify(data) }),
  deleteEvent: (workstreamId, id) => request(`/calendar/${workstreamId}/events/${id}`, { method: 'DELETE' }),

  // Drift
  getDrift: (workstreamId) => request(`/drift/${workstreamId}`),
  updateTargetMix: (workstreamId, data) => request(`/drift/${workstreamId}/target`, { method: 'PUT', body: JSON.stringify(data) }),
  saveSnapshot: (workstreamId, name) => request(`/drift/${workstreamId}/snapshots`, { method: 'POST', body: JSON.stringify({ name }) }),
  getSnapshots: (workstreamId) => request(`/drift/${workstreamId}/snapshots`),
  deleteSnapshot: (workstreamId, id) => request(`/drift/${workstreamId}/snapshots/${id}`, { method: 'DELETE' }),

  // Export
  downloadExcel: async (workstreamId) => {
    const res = await fetch(`${BASE}/export/${workstreamId}/excel`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'media-intelligence-export.xlsx'; a.click();
    URL.revokeObjectURL(url);
  },
  exportJson: (workstreamId) => request(`/export/${workstreamId}/json`),
  importJson: (data) => request('/export/import/json', { method: 'POST', body: JSON.stringify(data) }),
  getQuoteExportCount: (workstreamId, params) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString();
    return request(`/export/${workstreamId}/quotes/count?${qs}`);
  },
  downloadQuoteExport: async (workstreamId, params) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString();
    const res = await fetch(`${BASE}/export/${workstreamId}/quotes?${qs}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename=(.+)/);
    const filename = match ? match[1] : `quotes-export.${params.format || 'xlsx'}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
};
