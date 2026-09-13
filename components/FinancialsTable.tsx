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

export default function FinancialsTable({ financials }: { financials: Financials }) {
  const rows = ROWS.filter((r) => financials[r.key]);
  if (rows.length === 0) {
    return <p className="text-sm text-muted">No financial data available from sources.</p>;
  }

  return (
    <table className="w-full text-[15px]">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-hairline last:border-b-0">
            <td className="py-2 pr-4 text-muted">{r.label}</td>
            <td className="py-2 text-right font-medium">{financials[r.key] ?? "N/A"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
