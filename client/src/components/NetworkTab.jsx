import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { sentimentDot } from '../lib/helpers';

export default function NetworkTab({ workstream }) {
  const [rawData, setRawData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [minWeight, setMinWeight] = useState(2);
  const [minMentions, setMinMentions] = useState(2);
  const [showTypes, setShowTypes] = useState({ reporter: true, outlet: true, firm: true, speaker: true });
  const svgRef = useRef(null);

  const load = useCallback(async () => {
    const d = await api.getNetwork(workstream.id, minWeight);
    setRawData(d);
  }, [workstream.id, minWeight]);

  useEffect(() => { load(); }, [load]);

  // Filter nodes by min mentions and type
  const data = rawData ? (() => {
    const filteredNodeIds = new Set(rawData.nodes.filter(n => n.count >= minMentions && showTypes[n.type]).map(n => n.id));
    return {
      nodes: rawData.nodes.filter(n => filteredNodeIds.has(n.id)),
      edges: rawData.edges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)),
    };
  })() : null;

  // Simple force layout (no d3 dependency — basic physics simulation)
  const [positions, setPositions] = useState({});

  useEffect(() => {
    if (!data?.nodes?.length) return;
    const pos = {};
    const cx = 400, cy = 300;
    data.nodes.forEach((n, i) => {
      const angle = (i / data.nodes.length) * Math.PI * 2;
      const r = 150 + Math.random() * 100;
      pos[n.id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });

    // Simple force simulation (10 iterations)
    for (let iter = 0; iter < 30; iter++) {
      // Repulsion between all nodes
      const nodeArr = data.nodes;
      for (let i = 0; i < nodeArr.length; i++) {
        for (let j = i + 1; j < nodeArr.length; j++) {
          const a = pos[nodeArr[i].id], b = pos[nodeArr[j].id];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 500 / (dist * dist);
          a.x -= (dx / dist) * force;
          a.y -= (dy / dist) * force;
          b.x += (dx / dist) * force;
          b.y += (dy / dist) * force;
        }
      }
      // Attraction along edges
      for (const e of data.edges) {
        const a = pos[e.source], b = pos[e.target];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 80) * 0.01;
        a.x += (dx / dist) * force;
        a.y += (dy / dist) * force;
        b.x -= (dx / dist) * force;
        b.y -= (dy / dist) * force;
      }
      // Center gravity
      for (const n of nodeArr) {
        const p = pos[n.id];
        p.x += (cx - p.x) * 0.01;
        p.y += (cy - p.y) * 0.01;
      }
    }
    setPositions({ ...pos });
  }, [data]);

  const nodeShapes = { reporter: 'circle', outlet: 'rect', firm: 'diamond', speaker: 'triangle' };
  const nodeColors = { reporter: '#2563EB', outlet: '#7C3AED', firm: '#059669', speaker: '#D97706' };

  if (!data) return <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>Loading network...</div>;

  const highlightedEdges = selected ? new Set(data.edges.filter(e => e.source === selected || e.target === selected).map(e => `${e.source}||${e.target}`)) : null;
  const highlightedNodes = selected ? new Set([selected, ...data.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])]) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Relationship Network</h2>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>Min connections:</span>
          <input type="range" min="1" max="10" value={minWeight} onChange={e => setMinWeight(+e.target.value)} className="w-20" />
          <span className="font-mono w-4">{minWeight}</span>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>Min mentions:</span>
          <input type="number" min="1" max="50" value={minMentions} onChange={e => setMinMentions(Math.max(1, parseInt(e.target.value) || 1))}
            className="border rounded px-1.5 py-0.5 w-12 text-xs" style={{ borderColor: 'var(--border)' }} />
        </div>
        <div className="flex gap-2 text-xs">
          {Object.entries(nodeColors).map(([type, color]) => (
            <button key={type} onClick={() => setShowTypes(prev => ({ ...prev, [type]: !prev[type] }))}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ opacity: showTypes[type] ? 1 : 0.35, background: showTypes[type] ? `${color}15` : 'transparent' }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />{type}
            </button>
          ))}
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{data?.nodes?.length || 0} nodes · {data?.edges?.length || 0} edges</span>
        {selected && <button onClick={() => setSelected(null)} className="text-xs" style={{ color: 'var(--accent)' }}>Clear selection</button>}
      </div>

      <div className="card overflow-hidden" style={{ background: '#FAFBFC' }}>
        <svg ref={svgRef} viewBox="0 0 800 600" className="w-full" style={{ height: 500 }}>
          {/* Edges */}
          {data.edges.map((e, i) => {
            const a = positions[e.source], b = positions[e.target];
            if (!a || !b) return null;
            const key = `${e.source}||${e.target}`;
            const dimmed = highlightedEdges && !highlightedEdges.has(key);
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={dimmed ? '#E2E8F0' : '#94A3B8'} strokeWidth={Math.min(e.weight, 4)} opacity={dimmed ? 0.2 : 0.6} />;
          })}
          {/* Nodes */}
          {data.nodes.map(n => {
            const p = positions[n.id];
            if (!p) return null;
            const size = Math.min(4 + n.count * 2, 16);
            const color = nodeColors[n.type] || '#94A3B8';
            const dimmed = highlightedNodes && !highlightedNodes.has(n.id);
            return (
              <g key={n.id} onClick={() => setSelected(n.id === selected ? null : n.id)} className="cursor-pointer" opacity={dimmed ? 0.15 : 1}>
                <circle cx={p.x} cy={p.y} r={size} fill={color} stroke={n.id === selected ? '#0F172A' : 'white'} strokeWidth={n.id === selected ? 2 : 1} />
                <text x={p.x} y={p.y + size + 10} textAnchor="middle" fontSize="9" fill="#475569">{n.name.length > 15 ? n.name.slice(0, 14) + '…' : n.name}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected node info */}
      {selected && (() => {
        const node = data.nodes.find(n => n.id === selected);
        if (!node) return null;
        const connections = data.edges.filter(e => e.source === selected || e.target === selected).map(e => {
          const otherId = e.source === selected ? e.target : e.source;
          const other = data.nodes.find(n => n.id === otherId);
          return { ...other, weight: e.weight };
        }).sort((a, b) => b.weight - a.weight);
        return (
          <div className="card p-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{node.name} <span className="font-normal text-xs" style={{ color: 'var(--text-muted)' }}>({node.type})</span></h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {node.count} articles
              {node.avg_sentiment != null && <> · avg sentiment: <span style={{ color: sentimentDot(Math.round(node.avg_sentiment)), fontWeight: 600 }}>{Number(node.avg_sentiment).toFixed(1)}</span></>}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {connections.slice(0, 15).map(c => (
                <span key={c.id} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-content)', color: 'var(--text-secondary)' }}>{c.name} ({c.weight})</span>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
