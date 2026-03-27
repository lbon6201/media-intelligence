import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';

const QUICK_PROMPTS = [
  'Weekly coverage summary',
  'Who should we engage this week?',
  'What are the emerging risks?',
  'Compare the top 3 firms by sentiment',
  'Draft pitch angle for positive coverage',
  'Which reporters are going more negative?',
];

const SCENARIO_PREFIX = 'If [describe event], predict the likely media coverage response. Include: which reporters will cover it first, expected timeline, predicted sentiment range, likely narrative frames, and recommended preemptive actions.\n\nEvent: ';

export default function StrategyTab({ workstream }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [insights, setInsights] = useState([]);
  const [showInsights, setShowInsights] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const loadHistory = useCallback(async () => {
    try {
      const [msgs, ins] = await Promise.all([
        api.getStrategyMessages(workstream.id),
        api.getInsights(workstream.id),
      ]);
      setMessages(msgs);
      setInsights(ins);
    } catch {}
  }, [workstream.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamText]);

  async function send(text) {
    const msg = text || input.trim();
    if (!msg || streaming) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, id: 'temp-' + Date.now() }]);
    setStreaming(true);
    setStreamText('');

    try {
      const res = await fetch(`/api/strategy/${workstream.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) { full += data.text; setStreamText(full); }
              if (data.done) {
                setMessages(prev => [...prev, { role: 'assistant', content: full, id: data.message_id }]);
                setStreamText('');
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}`, id: 'err-' + Date.now() }]);
    } finally {
      setStreaming(false);
    }
  }

  async function clearHistory() {
    if (!confirm('Clear all conversation history?')) return;
    await api.clearStrategyMessages(workstream.id);
    setMessages([]);
  }

  async function saveInsight(content, msgId) {
    await api.saveInsight(workstream.id, { content, source_message_id: msgId });
    const ins = await api.getInsights(workstream.id);
    setInsights(ins);
  }

  async function deleteInsight(id) {
    await api.deleteInsight(workstream.id, id);
    setInsights(prev => prev.filter(i => i.id !== id));
  }

  return (
    <div className="flex h-[calc(100vh-120px)]">
      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="text-center py-12">
              <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Strategy Room</h3>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Ask questions about your coverage data. Claude has access to all articles, reporters, and analytics.</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
                {QUICK_PROMPTS.map(q => (
                  <button key={q} onClick={() => send(q)} className="px-3 py-1.5 rounded-full text-xs border transition-colors" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} onMouseEnter={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.color = 'var(--accent)'; }} onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}>{q}</button>
                ))}
                <button onClick={() => setInput(SCENARIO_PREFIX)} className="px-3 py-1.5 rounded-full text-xs border" style={{ borderColor: 'var(--sentiment-3)', color: 'var(--sentiment-3)' }}>Run Scenario Simulation</button>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={m.id || i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${m.role === 'user' ? 'text-white' : ''}`} style={{ background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-card)', color: m.role === 'user' ? 'white' : 'var(--text-primary)', boxShadow: 'var(--shadow-sm)' }}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.role === 'assistant' && (
                  <button onClick={() => saveInsight(m.content, m.id)} className="mt-2 text-xs hover:underline" style={{ color: 'var(--accent)' }}>Save Insight</button>
                )}
              </div>
            </div>
          ))}

          {streaming && streamText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-sm)' }}>
                {streamText}<span className="animate-pulse">|</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <div className="flex gap-2">
            <input ref={inputRef} className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none" style={{ background: 'var(--bg-content)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              placeholder="Ask about your coverage data..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()} disabled={streaming} />
            <button onClick={() => send()} disabled={streaming || !input.trim()} className="btn-primary px-4 py-2.5 text-sm">Send</button>
          </div>
          <div className="flex justify-between mt-2">
            <div className="flex gap-2">
              {messages.length > 0 && <button onClick={clearHistory} className="text-xs" style={{ color: 'var(--text-muted)' }}>Clear history</button>}
            </div>
            <button onClick={() => setShowInsights(!showInsights)} className="text-xs" style={{ color: 'var(--accent)' }}>{insights.length} saved insights</button>
          </div>
        </div>
      </div>

      {/* Insights sidebar */}
      {showInsights && (
        <div className="w-80 border-l overflow-y-auto p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Saved Insights</h3>
            <button onClick={() => setShowInsights(false)} className="text-xs" style={{ color: 'var(--text-muted)' }}>Close</button>
          </div>
          {insights.map(ins => (
            <div key={ins.id} className="mb-3 p-3 rounded-lg text-xs" style={{ background: 'var(--bg-content)', color: 'var(--text-secondary)' }}>
              <p className="whitespace-pre-wrap line-clamp-6">{ins.content.slice(0, 500)}</p>
              <div className="flex justify-between mt-2" style={{ color: 'var(--text-muted)' }}>
                <span className="font-mono" style={{ fontSize: 10 }}>{ins.created_at?.split('T')[0]}</span>
                <button onClick={() => deleteInsight(ins.id)} className="hover:text-red-500">Remove</button>
              </div>
            </div>
          ))}
          {insights.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No saved insights yet</p>}
        </div>
      )}
    </div>
  );
}
