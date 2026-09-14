import type { Financials } from "@/lib/schema";

const ROWS: { key: keyof Financials; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "revenueGrowthYoY", label: "Revenue Growth (YoY)" },
  { key: "grossMargin", label: "Gross Margin" },
  { key: "operatingMargin", label: "Operating Margin" },
  { key: "freeCashFlowMargin", label: "FCF Margin" },
  { key: "peRatio", label: "P/E Ratio" },
  { key: "evEbitda", label: "EV / EBITDA" },
];

/**
 * Stat cells, not a chart. The figures are point-in-time strings on
 * incompatible scales — "$165.2B (TTM)" next to "73.4%" — so there is no shared
 * axis to plot them against and any bar would encode nothing. Typography and
 * alignment do the work instead.
 */
export default function FinancialsTable({ financials }: { financials: Financials }) {
  const rows = ROWS.filter((r) => financials[r.key]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted italic">
        No financial data could be supported from the retrieved sources.
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-sm bg-hairline sm:grid-cols-2">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className="reveal group flex items-baseline justify-between gap-4 bg-paper px-4 py-3.5 transition-colors duration-200 hover:bg-paper-raised"
          style={{ "--i": i + 1 } as React.CSSProperties}
        >
          <dt className="text-[12px] tracking-[0.06em] text-muted uppercase">{r.label}</dt>
          <dd className="font-serif-display nums text-[17px] font-semibold text-navy">
            {financials[r.key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
