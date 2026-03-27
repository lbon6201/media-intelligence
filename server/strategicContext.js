// Helper to build strategic context block for Claude prompts.
// Returns empty string if no context set — prompts work normally without it.
export function buildContextBlock(ws, label = 'WORKSTREAM CONTEXT') {
  const ctx = ws?.strategic_context || '';
  if (!ctx.trim()) return '';
  // Truncate to ~1500 words if very long
  const words = ctx.split(/\s+/);
  const truncated = words.length > 1500 ? words.slice(0, 1500).join(' ') + '\n(context truncated for prompt length)' : ctx;
  return `\n${label}:\n${truncated}\n`;
}
