"use client";

import { useEffect, useRef, useState } from "react";
import QuestionForm from "@/components/QuestionForm";
import ProgressStages, { type Stage } from "@/components/ProgressStages";
import ReportSkeleton from "@/components/ReportSkeleton";
import ReportView from "@/components/ReportView";
import type { Thesis } from "@/lib/schema";

// The pipeline returns a single response, so stages advance on elapsed time to
// reflect the known shape of the run (plan → parallel search → synthesis).
const STAGE_TIMINGS: { at: number; stage: Stage }[] = [
  { at: 0, stage: "planning" },
  { at: 5_000, stage: "researching" },
  { at: 20_000, stage: "synthesizing" },
];

function formatAge(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "moments";
  if (mins === 1) return "1 minute";
  return `${mins} minutes`;
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "warn" | "info" | "error";
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    warn: "border-hold/30 bg-hold-bg text-hold",
    info: "border-hairline bg-paper-raised text-muted",
    error: "border-sell/30 bg-sell-bg text-sell",
  }[tone];
  return (
    <div className={`reveal rounded-sm border px-4 py-3 text-[13.5px] ${styles}`}>
      <strong className="font-semibold">{title}</strong> {children}
    </div>
  );
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("planning");
  const [elapsed, setElapsed] = useState(0);
  const [thesis, setThesis] = useState<Thesis | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [cachedAgeMs, setCachedAgeMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      const match = [...STAGE_TIMINGS].reverse().find((s) => ms >= s.at);
      if (match) setStage(match.stage);
    }, 250);
    return () => clearInterval(timer);
  }, [loading]);

  async function runResearch() {
    setLoading(true);
    setError(null);
    setThesis(null);
    setWarnings([]);
    setCachedAgeMs(null);
    setStage("planning");
    setElapsed(0);
    startedAt.current = Date.now();

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Research failed.");
      setThesis(data.thesis);
      setIsMock(Boolean(data.mock));
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setCachedAgeMs(data.cached ? (data.cachedAgeMs ?? 0) : null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-[860px] px-5 py-10 sm:px-6 sm:py-14">
      <header className="no-print mb-9">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif-display reveal text-[26px] font-semibold tracking-tight text-navy">
            Thesis
          </h1>
          <span
            className="reveal text-[10px] font-semibold tracking-[0.2em] text-muted-2 uppercase"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            Equity Research
          </span>
        </div>
        <p
          className="reveal mt-2 max-w-lg text-[14px] leading-relaxed text-muted"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          Ask an investing question. Get a cited equity thesis, assembled from live web
          sources and rendered as a research note.
        </p>
        <span
          aria-hidden="true"
          className="rule-in mt-6 block h-px bg-hairline"
          style={{ "--d": "160ms" } as React.CSSProperties}
        />
      </header>

      <QuestionForm
        value={question}
        onChange={setQuestion}
        onSubmit={runResearch}
        loading={loading}
      />

      {loading && (
        <>
          <div className="mt-8 border-t border-hairline pt-6">
            <ProgressStages current={stage} elapsedMs={elapsed} />
          </div>
          <div className="mt-10">
            <ReportSkeleton />
          </div>
        </>
      )}

      {error && (
        <div className="mt-8">
          <Notice tone="error" title="Research failed.">
            {error}
          </Notice>
        </div>
      )}

      {thesis && (
        <div className="mt-12">
          <div className="mb-8 space-y-3">
            {isMock && (
              <Notice tone="warn" title="Sample data.">
                No API keys are configured, so this is a fixture report — the figures and
                sources below are illustrative, not live research.
              </Notice>
            )}
            {cachedAgeMs !== null && (
              <Notice tone="info" title="Cached result.">
                Researched {formatAge(cachedAgeMs)} ago and re-served without new searches.
              </Notice>
            )}
            {warnings.map((w) => (
              <Notice key={w} tone="warn" title="Partial research.">
                {w}
              </Notice>
            ))}
          </div>
          <ReportView thesis={thesis} />
        </div>
      )}
    </main>
  );
}
