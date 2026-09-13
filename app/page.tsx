"use client";

import { useEffect, useRef, useState } from "react";
import QuestionForm from "@/components/QuestionForm";
import ProgressStages, { type Stage } from "@/components/ProgressStages";
import ReportView from "@/components/ReportView";
import type { Thesis } from "@/lib/schema";

// The pipeline returns a single response, so stages are advanced on elapsed
// time to reflect the known shape of the run (plan → parallel search → synthesis).
const STAGE_TIMINGS: { at: number; stage: Stage }[] = [
  { at: 0, stage: "planning" },
  { at: 5_000, stage: "researching" },
  { at: 20_000, stage: "synthesizing" },
];

export default function Home() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("planning");
  const [elapsed, setElapsed] = useState(0);
  const [thesis, setThesis] = useState<Thesis | null>(null);
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-[860px] px-6 py-12">
      <div className="mb-10">
        <h1 className="font-serif-display text-2xl font-semibold text-navy">Thesis</h1>
        <p className="mt-1 text-sm text-muted">
          Deep research for investors — cited equity theses, built from live web sources.
        </p>
      </div>

      <QuestionForm
        value={question}
        onChange={setQuestion}
        onSubmit={runResearch}
        loading={loading}
      />

      {loading && (
        <div className="mt-8 flex items-center justify-between border-y border-hairline py-4">
          <ProgressStages current={stage} />
          <span className="text-[13px] tabular-nums text-muted">
            {(elapsed / 1000).toFixed(0)}s
          </span>
        </div>
      )}

      {error && (
        <div className="mt-8 border-l-2 border-sell bg-sell-bg/40 px-4 py-3 text-[15px] text-sell">
          {error}
        </div>
      )}

      {thesis && (
        <div className="mt-12">
          <ReportView thesis={thesis} />
        </div>
      )}
    </main>
  );
}
