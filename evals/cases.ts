/**
 * The golden question set for live evals (`npm run eval:live`).
 *
 * Deliberately small: every case costs a planning call, ~6 Tavily credits and a
 * synthesis call, and the free tiers this app targets are the binding constraint.
 * The set is picked for coverage of the failure modes the prompts were written
 * against, not for breadth of tickers.
 */
export type EvalCase = {
  id: string;
  question: string;
  /** Checked by the `plan/expected-ticker` scorer. Live mode only. */
  expectTicker?: string;
  /** Why this case is in the set — printed in the report alongside failures. */
  rationale: string;
};

export const CASES: EvalCase[] = [
  {
    id: "nvda-buy",
    question: "Is Nvidia (NVDA) a buy given current datacenter capex trends?",
    expectTicker: "NVDA",
    rationale: "Baseline: ticker given, thesis-shaped question, heavily covered name.",
  },
  {
    id: "pltr-bear",
    question: "What is the bear case on Palantir (PLTR) at its current valuation?",
    expectTicker: "PLTR",
    rationale: "One-sided framing — checks the note still carries a balanced bull case.",
  },
  {
    id: "cost-membership",
    question: "How does Costco (COST) membership model support its valuation?",
    expectTicker: "COST",
    rationale: "Mechanism question rather than a rating question; exercises valuationSummary.",
  },
  {
    id: "avgo-multiple",
    question: "Is Broadcom (AVGO) attractive at its current multiple?",
    expectTicker: "AVGO",
    rationale: "Multiple-led question: the comparison-direction rule is most at risk here.",
  },
  {
    id: "asml-dual-listed",
    question: "Is ASML (ASML) attractive at current levels?",
    expectTicker: "ASML",
    rationale:
      "Dual-listed (AMS/NASDAQ, EUR/USD). Exercises the single-venue, single-currency priceContext rule.",
  },
  {
    id: "no-ticker",
    question: "Is the largest US warehouse club retailer a buy right now?",
    expectTicker: "COST",
    rationale: "No ticker in the question — tests company resolution in the planning step.",
  },
];
