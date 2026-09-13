import type { Thesis } from "@/lib/schema";
import RatingBadge from "./RatingBadge";
import ThesisSummary from "./ThesisSummary";
import BullBearColumns from "./BullBearColumns";
import FinancialsTable from "./FinancialsTable";
import ValuationSummary from "./ValuationSummary";
import CatalystsRisks from "./CatalystsRisks";
import SourcesFootnotes from "./SourcesFootnotes";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline pt-6">
      <h2 className="font-serif-display mb-3 text-sm font-semibold tracking-wider text-muted uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ReportView({ thesis }: { thesis: Thesis }) {
  return (
    <article className="mx-auto max-w-[860px] space-y-6 pb-16">
      <header className="border-b-2 border-navy pb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="font-serif-display text-3xl font-semibold text-navy">
              {thesis.company}
              <span className="ml-2 text-lg font-normal text-muted">
                {thesis.ticker}
                {thesis.exchange ? ` · ${thesis.exchange}` : ""}
              </span>
            </h1>
            <p className="mt-1 text-sm text-muted">{thesis.priceContext}</p>
            <p className="mt-0.5 text-[13px] text-muted/70">
              Generated{" "}
              {new Date().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}{" "}
              · {thesis.sources.length} sources
            </p>
          </div>
          <RatingBadge rating={thesis.rating} />
        </div>
      </header>

      <Section title="Thesis Summary">
        <ThesisSummary summary={thesis.summary} />
      </Section>

      <Section title="Bull &amp; Bear Case">
        <BullBearColumns bullCase={thesis.bullCase} bearCase={thesis.bearCase} />
      </Section>

      <Section title="Key Financials">
        <FinancialsTable financials={thesis.financials} />
      </Section>

      <Section title="Valuation">
        <ValuationSummary text={thesis.valuationSummary} />
      </Section>

      <Section title="Catalysts &amp; Risks">
        <CatalystsRisks catalysts={thesis.catalysts} risks={thesis.risks} />
      </Section>

      <Section title="Sources">
        <SourcesFootnotes sources={thesis.sources} />
      </Section>
    </article>
  );
}
