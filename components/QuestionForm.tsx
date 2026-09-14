"use client";

const EXAMPLES = [
  "Is Nvidia (NVDA) a buy given current datacenter capex trends?",
  "How does Costco's membership model support its valuation?",
  "What's the bear case on Palantir at its current multiple?",
];

export default function QuestionForm({
  value,
  onChange,
  onSubmit,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  const disabled = loading || value.trim().length < 4;

  return (
    <div className="no-print">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="group relative flex flex-col gap-2 rounded-sm border border-hairline bg-paper-raised p-2 shadow-sm transition-all duration-300 focus-within:border-navy/40 focus-within:shadow-md sm:flex-row sm:items-center"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          placeholder="Ask an investing question…"
          aria-label="Investing question"
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-muted-2 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled}
          className="relative shrink-0 overflow-hidden rounded-sm bg-navy px-6 py-2.5 text-[14px] font-medium text-white transition-all duration-200 hover:bg-navy-soft disabled:cursor-not-allowed disabled:opacity-35"
        >
          <span className={loading ? "opacity-0" : "opacity-100"}>Research</span>
          {loading && (
            <span className="absolute inset-0 flex items-center justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1 rounded-full bg-white [animation:pulse-dot_1.2s_ease-in-out_infinite]"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </span>
          )}
        </button>
      </form>

      <div
        className={`mt-3 flex flex-wrap gap-2 transition-all duration-300 ${
          loading ? "pointer-events-none translate-y-1 opacity-0" : "opacity-100"
        }`}
      >
        {EXAMPLES.map((ex, i) => (
          <button
            key={ex}
            type="button"
            onClick={() => onChange(ex)}
            className="reveal rounded-full border border-hairline bg-paper-raised px-3 py-1.5 text-left text-[12.5px] text-muted transition-all duration-200 hover:-translate-y-px hover:border-navy/30 hover:text-navy hover:shadow-sm"
            style={{ "--i": i + 1 } as React.CSSProperties}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
