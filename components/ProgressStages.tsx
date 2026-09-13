"use client";

export type Stage = "planning" | "researching" | "synthesizing";

const STAGES: { key: Stage; label: string }[] = [
  { key: "planning", label: "Identifying company" },
  { key: "researching", label: "Researching angles" },
  { key: "synthesizing", label: "Synthesizing thesis" },
];

export default function ProgressStages({ current }: { current: Stage }) {
  const currentIndex = STAGES.findIndex((s) => s.key === current);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
      {STAGES.map((stage, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={stage.key} className="flex items-center gap-3">
            {i > 0 && <span className="text-hairline">→</span>}
            <span
              className={
                done
                  ? "text-muted line-through"
                  : active
                    ? "font-medium text-navy"
                    : "text-muted/50"
              }
            >
              {active && (
                <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-navy align-middle" />
              )}
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
