"use client";

export type Stage = "planning" | "researching" | "synthesizing";

const STAGES: { key: Stage; label: string; hint: string }[] = [
  { key: "planning", label: "Identifying company", hint: "Resolving ticker and research angles" },
  { key: "researching", label: "Researching angles", hint: "Searching sources in parallel" },
  { key: "synthesizing", label: "Synthesizing thesis", hint: "Drafting the cited note" },
];

export default function ProgressStages({
  current,
  elapsedMs,
}: {
  current: Stage;
  elapsedMs: number;
}) {
  const currentIndex = STAGES.findIndex((s) => s.key === current);
  const active = STAGES[currentIndex] ?? STAGES[0];

  return (
    <div className="no-print">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] font-medium text-navy">
          <span className="mr-2.5 inline-block size-1.5 rounded-full bg-navy align-middle [animation:pulse-dot_1.4s_ease-in-out_infinite]" />
          {active.label}
          <span className="ml-2 text-[13px] font-normal text-muted-2">{active.hint}</span>
        </p>
        <span className="nums text-[13px] text-muted-2">{(elapsedMs / 1000).toFixed(0)}s</span>
      </div>

      {/* The run returns a single response, so the rail is indeterminate by design
          rather than faking a percentage it cannot know. */}
      <div className="relative mt-3 h-px w-full overflow-hidden bg-hairline">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1/3 bg-navy [animation:indeterminate_1.8s_cubic-bezier(0.4,0,0.2,1)_infinite]"
        />
      </div>

      <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {STAGES.map((stage, i) => {
          const done = i < currentIndex;
          const isActive = i === currentIndex;
          return (
            <li
              key={stage.key}
              className={`flex items-center gap-1.5 text-[12px] transition-colors duration-500 ${
                done ? "text-muted-2" : isActive ? "font-medium text-navy" : "text-muted-2/50"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-1 rounded-full transition-colors duration-500 ${
                  done ? "bg-muted-2" : isActive ? "bg-navy" : "bg-hairline-strong"
                }`}
              />
              {stage.label}
              {done && <span className="text-buy">✓</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
