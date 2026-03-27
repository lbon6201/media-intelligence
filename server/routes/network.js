import { Router } from 'express';
import db from '../db.js';

const router = Router();

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

router.get('/:workstream_id', async (req, res) => {
  const articles = await db.all(`SELECT author, outlet, cl_key_entities, cl_firms_mentioned, cl_external_quotes, cl_institutional_investor_quotes, cl_sentiment_score FROM articles WHERE workstream_id = ? AND cl_status IN ('classified','approved')`, req.params.workstream_id);

  const nodes = {};
  const edgeMap = {};

  function addNode(id, type, name) {
    if (!nodes[id]) nodes[id] = { id, type, name, count: 0, sentSum: 0, sentCount: 0 };
    return nodes[id];
  }

  function addEdge(src, tgt) {
    const key = [src, tgt].sort().join('||');
    if (!edgeMap[key]) edgeMap[key] = { source: src, target: tgt, weight: 0 };
    edgeMap[key].weight++;
  }

  for (const a of articles) {
    const reporter = a.author;
    const outlet = a.outlet;
    const firms = safeJson(a.cl_firms_mentioned) || [];
    const extQuotes = safeJson(a.cl_external_quotes) || [];
    const iiQuotes = safeJson(a.cl_institutional_investor_quotes) || [];

    // Reporter node
    if (reporter) {
      const rNode = addNode(`reporter:${reporter}`, 'reporter', reporter);
      rNode.count++;
      if (a.cl_sentiment_score) { rNode.sentSum += a.cl_sentiment_score; rNode.sentCount++; }

      // Reporter → Outlet
      if (outlet) {
        addNode(`outlet:${outlet}`, 'outlet', outlet);
        addEdge(`reporter:${reporter}`, `outlet:${outlet}`);
      }

      // Reporter → Firm
      for (const f of firms) {
        const fNode = addNode(`firm:${f}`, 'firm', f);
        fNode.count++;
        if (a.cl_sentiment_score) { fNode.sentSum += a.cl_sentiment_score; fNode.sentCount++; }
        addEdge(`reporter:${reporter}`, `firm:${f}`);
      }

      // Reporter → Speaker (quotes)
      for (const q of [...extQuotes, ...iiQuotes]) {
        if (q.source) {
          addNode(`speaker:${q.source}`, 'speaker', q.source);
          addEdge(`reporter:${reporter}`, `speaker:${q.source}`);
        }
      }
    }

    // Outlet node
    if (outlet) {
      const oNode = addNode(`outlet:${outlet}`, 'outlet', outlet);
      oNode.count++;
      if (a.cl_sentiment_score) { oNode.sentSum += a.cl_sentiment_score; oNode.sentCount++; }
    }

    // Firm co-occurrence
    for (let i = 0; i < firms.length; i++) {
      for (let j = i + 1; j < firms.length; j++) {
        addNode(`firm:${firms[i]}`, 'firm', firms[i]);
        addNode(`firm:${firms[j]}`, 'firm', firms[j]);
        addEdge(`firm:${firms[i]}`, `firm:${firms[j]}`);
      }
    }
  }

  // Finalize nodes
  const nodeList = Object.values(nodes).map(n => ({
    ...n,
    avg_sentiment: n.sentCount > 0 ? +(n.sentSum / n.sentCount).toFixed(1) : null,
  }));

  // Filter: min connections
  const minWeight = parseInt(req.query.min_weight) || 1;
  const edges = Object.values(edgeMap).filter(e => e.weight >= minWeight);

  // Filter out unconnected nodes
  const connectedIds = new Set();
  edges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target); });

  res.json({
    nodes: nodeList.filter(n => connectedIds.has(n.id)),
    edges,
  });
});

export default router;
