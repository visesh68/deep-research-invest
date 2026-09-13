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
  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
          placeholder="Ask an investing question…"
          className="flex-1 border border-hairline bg-white px-4 py-3 text-[15px] outline-none focus:border-navy disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || value.trim().length < 4}
          className="bg-navy px-6 py-3 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Researching…" : "Research"}
        </button>
      </form>

      {!loading && (
        <div className="flex flex-wrap gap-2 text-[13px]">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => onChange(ex)}
              className="border border-hairline px-2.5 py-1 text-muted transition-colors hover:border-navy hover:text-navy"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
