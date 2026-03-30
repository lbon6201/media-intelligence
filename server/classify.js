import { buildContextBlock } from './strategicContext.js';

const CLASS_SYS_BASE = [
  "You are a media intelligence analyst. Read the full article and classify it.",
  "Return a JSON object with these fields:",
  '  "topics": array of 1-3 from the provided taxonomy',
  '  "sentiment": {"score": integer 1-7, "label": string}',
  '  "sentiment_rationale": one sentence explaining the overall sentiment score',
  '  "relevance_tier": "High" or "Medium" or "Low"',
  '  "geographic_tags": array from taxonomy, only if explicitly referenced',
  '  "policy_dimensions": array from taxonomy, only if substantively discussed',
  '  "stakeholder_focus": array from taxonomy, entities central to the piece',
  '  "key_entities": array of all companies, people, orgs, regulators named',
  '  "firms_mentioned": array of specific company/firm names mentioned in the article',
  '  "firm_sentiments": object mapping each firm name to its own sentiment score 1-7 (how that firm is specifically portrayed, may differ from overall)',
  '  "institutional_investors": commentary on pension funds, endowments, insurers, sovereign wealth funds, asset managers mentioned. "None mentioned" if absent',
  '  "institutional_investor_quotes": array of {source, quote, stance} where stance is ONLY one of: positive|neutral|negative. Only named people at institutional investors — the LPs who invest in funds: pension funds, endowments, insurers, sovereign wealth funds, asset managers.',
  '  "internal_quotes": array of {source, role, quote, stance} where role is one of: fund_executive | portfolio_manager | spokesperson | trade_association. Stance is ONLY one of: positive|neutral|negative. These are people who work AT the private credit firms or their trade associations (AIC, MFA).',
  '  "external_quotes": array of {source, role, quote, stance} where role is one of: regulator | legislator | academic | rating_agency | legal_expert | former_official | journalist | analyst | investor_advocate | other. Stance is ONLY one of: positive|neutral|negative. These are voices OUTSIDE the industry.',
  '',
  'CRITICAL QUOTE RULES:',
  '1. Stance must ALWAYS be exactly one of: "positive", "neutral", or "negative". Never use bullish, bearish, cautious, supportive, defensive, or any other label.',
  '2. ONLY include quotes that are directly and specifically about the workstream topic (e.g. private credit, direct lending, private debt, alternative credit, fund structures, redemption gates, etc.). If someone is quoted about an unrelated topic (e.g. public markets, politics, tech, general economy) in the same article, DO NOT include that quote.',
  '3. A quote must contain a substantive statement — not just a name mention or passing reference. The person must be expressing a view, opinion, analysis, or providing information specifically about the workstream topic.',
  '  "key_takeaway": one sentence summary of the article\'s main point',
  '  "rationale": 2-3 sentences explaining classification with specific article references',
  "Sentiment scale: 1=Very Negative 2=Negative 3=Slightly Negative 4=Neutral 5=Slightly Positive 6=Positive 7=Very Positive",
  "Return ONLY valid JSON. No markdown, no preamble.",
].join("\n");

function buildClassSys(ws) {
  const ctxBlock = buildContextBlock(ws, 'WORKSTREAM CONTEXT');
  if (!ctxBlock) return CLASS_SYS_BASE;
  return CLASS_SYS_BASE + '\n' + ctxBlock + '\nUse this context to inform your classification. Understand not just what the article discusses, but how it relates to the client\'s strategic position and communications goals.';
}

// Keep backward-compat export
const CLASS_SYS = CLASS_SYS_BASE;

function buildUserMessage(taxonomy, article) {
  return [
    `Workstream: "${taxonomy.name || ''}"`,
    `Topics: ${JSON.stringify(taxonomy.topics)}`,
    `Geographic: ${JSON.stringify(taxonomy.geographic_tags)}`,
    `Policy: ${JSON.stringify(taxonomy.policy_dimensions)}`,
    `Stakeholders: ${JSON.stringify(taxonomy.stakeholder_tags)}`,
    "",
    `Headline: ${article.headline}`,
    `Outlet: ${article.outlet || "Unknown"}`,
    `Date: ${article.publish_date || "Unknown"}`,
    `Author: ${article.author || "Unknown"}`,
    "",
    article.full_text.slice(0, 6000),
  ].join("\n");
}

async function classifyArticle(systemPrompt, userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  let text = d.content?.[0]?.text || "";
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return text;
}

export { CLASS_SYS, buildClassSys, buildUserMessage, classifyArticle };
