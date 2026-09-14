import type { ResearchPlan } from "./schema";

/**
 * A search engine reads "2026-09-13" as a literal token, not as "recent" — live runs
 * produced queries like "Palantir PLTR bear case risks 2026-09-13", where the date
 * was pure noise diluting the real search terms. Deriving the year and quarter here
 * and handing those to the model removes the temptation to paste the raw date.
 */
export function currentPeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  // Companies report a quarter after it closes, so the latest *reported* quarter
  // is the previous one.
  const reportedQuarter = quarter === 1 ? 4 : quarter - 1;
  const reportedYear = quarter === 1 ? year - 1 : year;
  return {
    today: now.toISOString().slice(0, 10),
    year,
    quarter,
    reportedQuarter,
    reportedYear,
  };
}

/**
 * Deterministic backstop to the prompt rule above. Prompt instructions drift between
 * model versions; a regex does not. Any ISO date left in a query collapses to its
 * year, which is the part that actually carries recency signal.
 */
export function stripLiteralDates(query: string): string {
  return query
    .replace(/\b(\d{4})-\d{2}-\d{2}\b/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildPlanPrompt(question: string) {
  const { today, year, quarter, reportedQuarter, reportedYear } = currentPeriod();
  const system = `Today's date is ${today} (Q${quarter} ${year}). You are a financial research planner. Given an investing question, identify the company and stock ticker being asked about, then produce 4-6 short research angles as Tavily-ready search queries. Always make one angle a current share price / valuation snapshot query. Fill the rest from: financials & fundamentals (most recent quarter), competitive positioning, valuation, catalysts, recent news & events, risks — choosing those relevant to the question.

Queries must target the most recent available data, but express recency as a YEAR or a QUARTER LABEL only. Never write a full calendar date into a query — a search engine treats "${today}" as a literal token and it only dilutes the real search terms.
WRONG: "Palantir PLTR bear case risks ${today}"
RIGHT: "Palantir PLTR bear case risks ${year}"
RIGHT: "Palantir PLTR Q${reportedQuarter} ${reportedYear} earnings revenue margins"
Use ${year} for general recency, and Q${reportedQuarter} ${reportedYear} (the most recently reported quarter) for financial-results angles. Never anchor a query on a year before ${year - 1}.

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
  const today = new Date().toISOString().slice(0, 10);
  const system = `Today's date is ${today}. You are a sell-side equity research analyst writing a concise investment thesis note for a banker audience. Use ONLY the numbered sources provided below — never invent data that isn't present in them. Prefer the most recent figures available in the sources, and always label a figure with its period (e.g. "Q2 FY2027") so stale data is visible rather than implied to be current. Some sources carry a "(published YYYY-MM-DD)" marker — use it to date any figure whose period is not stated in the text itself, and prefer the more recently published source when two disagree. Every bullet point in bullCase, bearCase, catalysts, and risks MUST include sourceIds referencing the numbered sources that support it. If a data point is missing from the sources, omit it or say so briefly rather than guessing.

STRICT STYLE RULES (token efficiency and readability are both critical):
- Bullet points, not paragraphs. Each bullet <= 25 words.
- bullCase and bearCase: 3-5 bullets each, max.
- catalysts and risks: 2-4 bullets each, max.
- summary: exactly one paragraph, 60-90 words.
- valuationSummary: 2-4 sentences, no more.
- Never quote source text verbatim; paraphrase and compress.
- No filler phrases ("it is worth noting", "in conclusion", "overall").
- Citations belong ONLY in sourceIds arrays. Never write "(source 4)", "[4]" or similar into any text field.
- priceContext: quote ONE listing only, in ONE currency — the primary exchange, matching the "exchange" field. Never put two venues or two currencies in it. Date the quote from its source's published marker (e.g. "€1,500 as of 2026-09-12"), and cite that source in sourceIds. Do not compare the price to a moving average, 52-week level or prior price unless both figures come from the same source and the same currency.
- exchange: a single primary listing venue, never a list ("NASDAQ", not "NASDAQ/AMS"). A dual-listed name gets the venue whose currency priceContext quotes.
- Any comparison must be directionally correct. Before writing a comparison, check which number is larger. WRONG: "P/E of 149 is far above the 3-year average of 202". RIGHT: "P/E of 149 sits below the 3-year average of 202". If two figures come from different periods or definitions and are not comparable, state the figure alone rather than comparing it.

Respond with ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:
{"company": string, "ticker": string, "exchange": string, "rating": "Buy"|"Hold"|"Sell", "priceContext": {"text": string, "sourceIds": [number]}, "summary": string, "bullCase": [{"text": string, "sourceIds": [number]}], "bearCase": [{"text": string, "sourceIds": [number]}], "financials": {"revenue": string, "revenueGrowthYoY": string, "grossMargin": string, "operatingMargin": string, "peRatio": string, "evEbitda": string, "freeCashFlowMargin": string}, "valuationSummary": string, "catalysts": [{"text": string, "sourceIds": [number]}], "risks": [{"text": string, "sourceIds": [number]}], "sources": [{"id": number, "title": string, "url": string}]}`;

  const user = `Original question: ${question}
Company: ${plan.company} (${plan.ticker})

SOURCES:
${sourcesBlock}

Produce the thesis JSON now. The "sources" array in your output must exactly mirror the numbered sources above (same id/title/url). Any field in "financials" you cannot support from the sources should be omitted.`;

  return { system, user };
}
