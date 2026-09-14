import type { Thesis } from "@/lib/schema";
import RatingBadge from "./RatingBadge";
import ThesisSummary from "./ThesisSummary";
import BullBearColumns from "./BullBearColumns";
import FinancialsTable from "./FinancialsTable";
import ValuationSummary from "./ValuationSummary";
import CatalystsRisks from "./CatalystsRisks";
import SourcesFootnotes from "./SourcesFootnotes";

function Section({
  title,
  index,
  children,
}: {
  title: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className="reveal print-break-avoid border-t border-hairline pt-7"
      style={{ "--d": `${260 + index * 90}ms` } as React.CSSProperties}
    >
      <h2 className="mb-4 flex items-center gap-3">
        <span className="nums text-[11px] font-medium text-muted-2">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
          {title}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
      </h2>
      {children}
    </section>
  );
}

export default function ReportView({ thesis }: { thesis: Thesis }) {
  const generated = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <article className="mx-auto max-w-[860px] pb-20">
      <header className="print-break-avoid relative">
        <p
          className="reveal text-[10px] font-semibold tracking-[0.24em] text-muted-2 uppercase"
          style={{ "--d": "0ms" } as React.CSSProperties}
        >
          Equity Research Note
        </p>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1
              className="font-serif-display reveal text-[34px] leading-[1.1] font-semibold text-navy sm:text-[40px]"
              style={{ "--d": "60ms" } as React.CSSProperties}
            >
              {thesis.company}
            </h1>
            <div
              className="reveal mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm"
              style={{ "--d": "120ms" } as React.CSSProperties}
            >
              <span className="nums rounded-sm bg-navy px-2 py-0.5 text-[12px] font-semibold tracking-wider text-white">
                {thesis.ticker}
              </span>
              {thesis.exchange && <span className="text-muted-2">{thesis.exchange}</span>}
              <span aria-hidden="true" className="text-hairline-strong">·</span>
              <span className="text-muted">{thesis.priceContext}</span>
            </div>
          </div>
          <RatingBadge rating={thesis.rating} />
        </div>

        <p
          className="reveal mt-5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-2"
          style={{ "--d": "180ms" } as React.CSSProperties}
        >
          <span>Generated {generated}</span>
          <span aria-hidden="true">·</span>
          <span className="nums">{thesis.sources.length} cited sources</span>
          <span aria-hidden="true">·</span>
          <span>Not investment advice</span>
        </p>

        <span
          aria-hidden="true"
          className="rule-in mt-5 block h-0.5 bg-navy"
          style={{ "--d": "220ms" } as React.CSSProperties}
        />
      </header>

      {/* Pure CSS sticky — no scroll listener, so this subtree stays a Server Component. */}
      <div className="no-print sticky top-0 z-10 -mx-2 mt-0 flex items-center gap-3 border-b border-hairline bg-paper/85 px-2 py-2.5 backdrop-blur-sm">
        <span className="nums text-[11px] font-semibold tracking-wider text-navy">
          {thesis.ticker}
        </span>
        <span className="truncate text-[11px] text-muted-2">{thesis.company}</span>
        <span className="ml-auto text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
          {thesis.rating}
        </span>
      </div>

      <div className="mt-8 space-y-8">
        <Section title="Thesis Summary" index={0}>
          <ThesisSummary summary={thesis.summary} />
        </Section>

        <Section title="Bull &amp; Bear Case" index={1}>
          <BullBearColumns bullCase={thesis.bullCase} bearCase={thesis.bearCase} />
        </Section>

        <Section title="Key Financials" index={2}>
          <FinancialsTable financials={thesis.financials} />
        </Section>

        <Section title="Valuation" index={3}>
          <ValuationSummary text={thesis.valuationSummary} />
        </Section>

        <Section title="Catalysts &amp; Risks" index={4}>
          <CatalystsRisks catalysts={thesis.catalysts} risks={thesis.risks} />
        </Section>

        <Section title="Sources" index={5}>
          <SourcesFootnotes sources={thesis.sources} />
        </Section>
      </div>
    </article>
  );
}
