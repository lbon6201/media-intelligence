import React, { useState } from 'react';
import { api } from '../api';

export default function WorkstreamSetup({ workstreams, activeWs, onRefresh, onSelect }) {
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', client: '', strategic_context: '', topics: '', geographic_tags: '', policy_dimensions: '', stakeholder_tags: '' });
  const [saving, setSaving] = useState(false);
  const [contextSaved, setContextSaved] = useState(false);
  const [showTips, setShowTips] = useState(false);

  function loadForm(ws) {
    setForm({
      name: ws.name, client: ws.client,
      strategic_context: ws.strategic_context || '',
      topics: ws.taxonomy.topics?.join('\n') || '',
      geographic_tags: ws.taxonomy.geographic_tags?.join('\n') || '',
      policy_dimensions: ws.taxonomy.policy_dimensions?.join('\n') || '',
      stakeholder_tags: ws.taxonomy.stakeholder_tags?.join('\n') || '',
    });
    setEditing(ws.id);
    setCreating(false);
  }

  function startCreate() {
    setForm({ name: '', client: '', strategic_context: '', topics: '', geographic_tags: '', policy_dimensions: '', stakeholder_tags: '' });
    setEditing(null);
    setCreating(true);
  }

  function buildTaxonomy() {
    return {
      topics: form.topics.split('\n').map(s => s.trim()).filter(Boolean),
      geographic_tags: form.geographic_tags.split('\n').map(s => s.trim()).filter(Boolean),
      policy_dimensions: form.policy_dimensions.split('\n').map(s => s.trim()).filter(Boolean),
      stakeholder_tags: form.stakeholder_tags.split('\n').map(s => s.trim()).filter(Boolean),
    };
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (creating) {
        await api.createWorkstream({ name: form.name, client: form.client, taxonomy: buildTaxonomy(), alert_config: {}, strategic_context: form.strategic_context });
      } else {
        await api.updateWorkstream(editing, { name: form.name, client: form.client, taxonomy: buildTaxonomy(), strategic_context: form.strategic_context });
      }
      await onRefresh();
      setCreating(false);
      setEditing(null);
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleContextBlur() {
    if (!editing) return;
    try {
      await api.updateWorkstream(editing, { strategic_context: form.strategic_context });
      setContextSaved(true);
      setTimeout(() => setContextSaved(false), 2000);
    } catch {}
  }

  async function handleDelete(id) {
    if (!confirm('Archive this workstream?')) return;
    await api.deleteWorkstream(id);
    await onRefresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Workstreams</h2>
        <button onClick={startCreate} className="btn-primary px-4 py-2 text-sm">New Workstream</button>
      </div>

      <div className="grid gap-3">
        {workstreams.map(ws => (
          <div key={ws.id} className="card p-4 flex items-center justify-between card-hover cursor-pointer transition-all" style={{ borderColor: activeWs?.id === ws.id ? 'var(--accent)' : undefined }}>
            <div>
              <h3 className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{ws.name}</h3>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{ws.client} · {ws.taxonomy.topics?.length || 0} topics{ws.strategic_context ? ' · Context set' : ''}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onSelect(ws)} className="text-xs" style={{ color: 'var(--accent)' }}>Select</button>
              <button onClick={() => loadForm(ws)} className="text-xs" style={{ color: 'var(--text-secondary)' }}>Edit</button>
              <button onClick={() => handleDelete(ws.id)} className="text-xs text-red-500">Archive</button>
            </div>
          </div>
        ))}
      </div>

      {(editing || creating) && (
        <div className="card p-6 space-y-5">
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{creating ? 'New Workstream' : 'Edit Workstream'}</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Name</label>
              <input className="w-full rounded px-3 py-2 text-sm" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Client</label>
              <input className="w-full rounded px-3 py-2 text-sm" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
            </div>
          </div>

          {/* Strategic Context */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Strategic Context</label>
              {contextSaved && <span className="text-xs" style={{ color: 'var(--status-approved)' }}>Saved</span>}
            </div>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              Describe the client's situation, strategic position, why this coverage matters, and what your communications goals are. This context is included in every analysis Claude performs for this workstream.
            </p>
            <textarea
              className="w-full rounded px-3 py-2 text-sm min-h-[120px]"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
              placeholder="e.g., Our client is [who] responding to [what]. The key issue is [context]. Our messaging priorities are [goals]. We want to track whether coverage lands in [our frame] or in [competing narratives]."
              value={form.strategic_context}
              onChange={e => setForm({ ...form, strategic_context: e.target.value })}
              onBlur={handleContextBlur}
            />
            <button onClick={() => setShowTips(!showTips)} className="text-xs mt-1" style={{ color: 'var(--accent)' }}>
              {showTips ? 'Hide editing tips' : 'Editing tips'}
            </button>
            {showTips && (
              <div className="mt-2 p-3 rounded text-xs space-y-1" style={{ background: 'var(--bg-content)', color: 'var(--text-secondary)' }}>
                <p>Consider including:</p>
                <ul className="list-disc list-inside space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                  <li>Who is the client and what is their role in the space?</li>
                  <li>What is the current media environment they're operating in?</li>
                  <li>What event, trend, or crisis is driving coverage?</li>
                  <li>What are the client's messaging pillars or narrative goals?</li>
                  <li>What does "good" coverage look like vs. "bad" coverage?</li>
                  <li>Are there specific firms, individuals, or regulators that matter most?</li>
                  <li>What is the client trying to achieve with their communications strategy?</li>
                </ul>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Topics (one per line)</label>
            <textarea className="w-full rounded px-3 py-2 text-sm h-32" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} value={form.topics} onChange={e => setForm({ ...form, topics: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Geographic Tags</label>
              <textarea className="w-full rounded px-3 py-2 text-sm h-24" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} value={form.geographic_tags} onChange={e => setForm({ ...form, geographic_tags: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Policy Dimensions</label>
              <textarea className="w-full rounded px-3 py-2 text-sm h-24" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} value={form.policy_dimensions} onChange={e => setForm({ ...form, policy_dimensions: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Stakeholder Tags</label>
              <textarea className="w-full rounded px-3 py-2 text-sm h-24" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }} value={form.stakeholder_tags} onChange={e => setForm({ ...form, stakeholder_tags: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving} className="btn-primary px-4 py-2 text-sm">{saving ? 'Saving...' : 'Save'}</button>
            <button onClick={() => { setEditing(null); setCreating(false); }} className="text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
