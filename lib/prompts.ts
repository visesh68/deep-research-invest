import type { ResearchPlan } from "./schema";

export function buildPlanPrompt(question: string) {
  const system = `You are a financial research planner. Given an investing question, identify the company and stock ticker being asked about, then produce 4-6 short research angles as Tavily-ready search queries. Only include angles relevant to the question, drawn from: financials & fundamentals, competitive positioning, valuation, catalysts, recent news & events, risks.

Respond with ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:
{"company": string, "ticker": string, "exchange": string, "angles": [{"id": string, "query": string}]}

Each query must be a specific, high-signal web search string that includes the company name and ticker (e.g. "Nvidia NVDA Q2 2026 earnings revenue margins"), not a restatement of the user's raw question.`;

  return { system, user: question };
}

export function buildSynthesisPrompt(
  question: string,
  plan: ResearchPlan,
  sourcesBlock: string,
) {
  const system = `You are a sell-side equity research analyst writing a concise investment thesis note for a banker audience. Use ONLY the numbered sources provided below — never invent data that isn't present in them. Every bullet point in bullCase, bearCase, catalysts, and risks MUST include sourceIds referencing the numbered sources that support it. If a data point is missing from the sources, omit it or say so briefly rather than guessing.

STRICT STYLE RULES (token efficiency and readability are both critical):
- Bullet points, not paragraphs. Each bullet <= 25 words.
- bullCase and bearCase: 3-5 bullets each, max.
- catalysts and risks: 2-4 bullets each, max.
- summary: exactly one paragraph, 60-90 words.
- valuationSummary: 2-4 sentences, no more.
- Never quote source text verbatim; paraphrase and compress.
- No filler phrases ("it is worth noting", "in conclusion", "overall").

Respond with ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:
{"company": string, "ticker": string, "exchange": string, "rating": "Buy"|"Hold"|"Sell", "priceContext": string, "summary": string, "bullCase": [{"text": string, "sourceIds": [number]}], "bearCase": [{"text": string, "sourceIds": [number]}], "financials": {"revenue": string, "revenueGrowthYoY": string, "grossMargin": string, "operatingMargin": string, "peRatio": string, "evEbitda": string, "freeCashFlowMargin": string}, "valuationSummary": string, "catalysts": [{"text": string, "sourceIds": [number]}], "risks": [{"text": string, "sourceIds": [number]}], "sources": [{"id": number, "title": string, "url": string}]}`;

  const user = `Original question: ${question}
Company: ${plan.company} (${plan.ticker})

SOURCES:
${sourcesBlock}

Produce the thesis JSON now. The "sources" array in your output must exactly mirror the numbered sources above (same id/title/url). Any field in "financials" you cannot support from the sources should be omitted.`;

  return { system, user };
}
