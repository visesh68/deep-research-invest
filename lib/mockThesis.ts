import type { Thesis } from "./schema";

// Used only when MOCK_RESEARCH=1, so the report layout can be reviewed
// without spending API credits or needing live keys.
export const MOCK_THESIS: Thesis = {
  company: "NVIDIA Corporation",
  ticker: "NVDA",
  exchange: "NASDAQ",
  rating: "Buy",
  priceContext: "Trading near $184, up 41% over the trailing twelve months",
  summary:
    "NVIDIA remains the default compute layer for frontier AI training and inference, with datacenter revenue compounding faster than hyperscaler capex itself. CUDA lock-in and a one-year cadence on new architectures sustain pricing power that merchant silicon rivals have not dented. The risk is not demand but concentration: a handful of customers fund most of the growth, and any capex digestion cycle would compress both volumes and multiple simultaneously.",
  bullCase: [
    { text: "Datacenter segment revenue grew 66% YoY, outpacing aggregate hyperscaler capex growth.", sourceIds: [1, 3] },
    { text: "Blackwell ramp is supply-constrained rather than demand-constrained through the next two quarters.", sourceIds: [2] },
    { text: "CUDA software moat keeps switching costs high despite credible merchant accelerator alternatives.", sourceIds: [4, 5] },
    { text: "Inference workloads now rival training as a growth driver, broadening the demand base.", sourceIds: [3] },
  ],
  bearCase: [
    { text: "Top four customers account for roughly half of datacenter revenue, concentrating risk.", sourceIds: [1, 6] },
    { text: "Hyperscalers are scaling internal silicon programs that target the same inference workloads.", sourceIds: [5] },
    { text: "Gross margin has drifted lower as Blackwell mix and memory costs weigh on unit economics.", sourceIds: [2] },
    { text: "Any capex digestion pause would hit volumes and the earnings multiple at the same time.", sourceIds: [6] },
  ],
  financials: {
    revenue: "$165.2B (TTM)",
    revenueGrowthYoY: "+62%",
    grossMargin: "73.4%",
    operatingMargin: "61.1%",
    freeCashFlowMargin: "46%",
    peRatio: "38.5x",
    evEbitda: "31.2x",
  },
  valuationSummary:
    "At roughly 38x forward earnings NVDA trades above the semiconductor peer group but below its own three-year average multiple. The premium is defensible while datacenter revenue compounds above 50%, though it leaves little cushion for a demand air pocket. Consensus targets cluster in the $200–230 range, implying mid-teens upside from current levels.",
  catalysts: [
    { text: "Q4 earnings print with first full-quarter Blackwell contribution.", sourceIds: [2] },
    { text: "Hyperscaler 2027 capex guidance updates during the upcoming reporting cycle.", sourceIds: [1, 6] },
    { text: "GTC architecture announcement extending the annual product cadence.", sourceIds: [4] },
  ],
  risks: [
    { text: "Export control changes could further restrict the China datacenter opportunity.", sourceIds: [6] },
    { text: "HBM memory supply tightness may cap unit shipments below demand.", sourceIds: [2] },
    { text: "Customer concentration means a single capex deferral moves the full-year outlook.", sourceIds: [1] },
  ],
  sources: [
    { id: 1, title: "NVIDIA Q3 FY2026 earnings release and datacenter segment detail", url: "https://example.com/nvda-q3-earnings" },
    { id: 2, title: "Blackwell supply chain and margin commentary — analyst note", url: "https://example.com/blackwell-supply" },
    { id: 3, title: "AI inference demand trends across major cloud providers", url: "https://example.com/inference-demand" },
    { id: 4, title: "CUDA ecosystem lock-in and developer adoption study", url: "https://example.com/cuda-moat" },
    { id: 5, title: "Merchant accelerator competitive landscape review", url: "https://example.com/accelerator-landscape" },
    { id: 6, title: "Hyperscaler capex outlook and customer concentration analysis", url: "https://example.com/capex-outlook" },
  ],
};
