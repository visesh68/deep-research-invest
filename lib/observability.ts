import { Langfuse } from "langfuse";
import type { RunTranscript } from "./transcript";

/**
 * Langfuse tracing, emitted by REPLAYING a finished transcript rather than by
 * threading SDK calls through the pipeline.
 *
 * The pipeline already records everything a tracer would capture — both prompts,
 * both raw responses, per-call usage and timings, per-angle search results, retry
 * counts, cache hits and the Zod validation outcome. Instrumenting it a second
 * time would duplicate that work and put a vendor SDK on the hot path. Instead
 * this module reads the completed RunTranscript once and reconstructs the trace
 * tree from it, which means:
 *
 *   - exactly one integration point, so the pipeline has no vendor import
 *   - failed runs are traced too, because the transcript is finalized on both paths
 *   - Langfuse cannot slow down or break research; the worst case is a missing trace
 *
 * The tradeoff is that traces appear only after a run completes. On serverless that
 * costs nothing: the function has to flush before returning anyway.
 */

// Serverless functions freeze the instant the handler returns, so batched events
// must be flushed explicitly or they are silently lost in production while working
// fine locally — the most common way a tracing integration appears to "work" and
// then records nothing on Vercel. The route schedules emitTrace through
// `after()` from next/server, which keeps the function alive past the response,
// so this flush costs the user no latency. The race below is still a backstop:
// `after` work counts against maxDuration, so a Langfuse outage must not sit
// there consuming the budget.
const FLUSH_TIMEOUT_MS = 2_500;

let cached: Langfuse | null | undefined;

/** Returns null (permanently, after the first check) when tracing is not configured. */
function getClient(): Langfuse | null {
  if (cached !== undefined) return cached;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey || process.env.LANGFUSE_TRACING === "0") {
    cached = null;
    return cached;
  }

  try {
    cached = new Langfuse({
      publicKey,
      secretKey,
      // Defaults to Langfuse Cloud US. Set for the EU region or a self-hosted instance.
      baseUrl: process.env.LANGFUSE_BASE_URL,
    });
  } catch {
    cached = null;
  }
  return cached;
}

export function tracingEnabled(): boolean {
  return getClient() !== null;
}

// Every observation is written as ONE create event carrying both startTime and
// endTime, rather than the usual create-then-end pair. A replay already knows the
// full history, so splitting it into two events buys nothing and costs correctness:
// the SDK batches events without preserving call order, and a create landing after
// its own update leaves the observation with endTime == startTime — which is exactly
// how the generations first came back from Langfuse Cloud, showing 0.00s durations
// next to correctly-timed spans.
function at(iso: string, offsetMs = 0): Date {
  return new Date(new Date(iso).getTime() + offsetMs);
}

/**
 * Emits one trace for a completed run and flushes it.
 *
 * Never throws and never rejects: observability must not be able to fail a
 * research run that otherwise succeeded.
 */
export async function emitTrace(t: RunTranscript): Promise<string | null> {
  const lf = getClient();
  if (!lf) return null;

  try {
    const start = at(t.startedAt);

    const trace = lf.trace({
      // Same id as the local transcript filename's runId, so a Langfuse trace and
      // a transcripts/*.json file can be matched up one-to-one.
      id: t.runId,
      name: "research-run",
      input: { question: t.question },
      output: t.thesis
        ? {
            company: t.thesis.company,
            ticker: t.thesis.ticker,
            rating: t.thesis.rating,
            summary: t.thesis.summary,
            sourceCount: t.thesis.sources.length,
          }
        : t.error
          ? { error: t.error }
          : undefined,
      metadata: {
        totalTokens: t.totalTokens,
        totalMs: t.totalMs,
        angleCount: t.tavily.length,
        cachedAngles: t.tavily.filter((a) => a.cached).length,
        failedAngles: t.researchFailures?.length ?? 0,
        thesisValidation: t.thesisValidation,
        environment: process.env.VERCEL ? "vercel" : "local",
      },
      tags: [
        t.error ? "error" : "ok",
        ...(t.researchFailures?.length ? ["degraded"] : []),
        ...(t.plan?.ticker ? [t.plan.ticker] : []),
      ],
    });

    if (t.planCall) {
      const c = t.planCall;
      const s = c.startedAt ? at(c.startedAt) : start;
      trace.generation({
        name: "plan",
        model: c.model,
        startTime: s,
        endTime: at(s.toISOString(), c.ms),
        input: [
          { role: "system", content: c.system },
          { role: "user", content: c.user },
        ],
        modelParameters: { temperature: 0.25, reasoning_effort: "low", response_format: "json_object" },
        output: c.response,
        usage: {
          promptTokens: c.usage.prompt_tokens,
          completionTokens: c.usage.completion_tokens,
          totalTokens: c.usage.total_tokens,
        },
      });
    }

    if (t.tavily.length > 0) {
      const first = t.tavily.reduce(
        (min, a) => (a.startedAt && a.startedAt < min ? a.startedAt : min),
        t.tavily[0].startedAt ?? t.startedAt,
      );
      // Resolve every angle's window up front so the parent span can be written
      // complete, in one event, like everything else here.
      const windows = t.tavily.map((angle) => {
        const s = angle.startedAt ? at(angle.startedAt) : at(first);
        return { angle, s, e: at(s.toISOString(), angle.ms) };
      });
      const lastEnd = windows.reduce((max, w) => (w.e > max ? w.e : max), at(first));

      const researchSpan = trace.span({
        name: "research",
        startTime: at(first),
        endTime: lastEnd,
        input: { angles: t.tavily.map((a) => a.query) },
        output: {
          rawHits: t.tavily.reduce((n, a) => n + a.results.length, 0),
          citedSources: t.thesis?.sources.length ?? 0,
          failures: t.researchFailures ?? [],
        },
      });

      for (const { angle, s, e } of windows) {
        researchSpan.span({
          name: `angle:${angle.angleId}`,
          startTime: s,
          endTime: e,
          input: { query: angle.query },
          // A failed angle is recorded at ERROR level so partial-failure runs are
          // filterable in the Langfuse UI rather than buried in a green trace.
          level: angle.error ? "ERROR" : "DEFAULT",
          statusMessage: angle.error,
          metadata: { cached: Boolean(angle.cached), attempts: angle.attempts },
          output: {
            resultCount: angle.results.length,
            results: angle.results.map((r) => ({ title: r.title, url: r.url, score: r.score })),
          },
        });
      }
    }

    if (t.synthesisCall) {
      const c = t.synthesisCall;
      const s = c.startedAt ? at(c.startedAt) : start;
      trace.generation({
        name: "synthesis",
        model: c.model,
        startTime: s,
        endTime: at(s.toISOString(), c.ms),
        input: [
          { role: "system", content: c.system },
          { role: "user", content: c.user },
        ],
        modelParameters: { temperature: 0.25, reasoning_effort: "low", response_format: "json_object" },
        output: c.response,
        usage: {
          promptTokens: c.usage.prompt_tokens,
          completionTokens: c.usage.completion_tokens,
          totalTokens: c.usage.total_tokens,
        },
        level: t.thesisValidation?.success === false ? "ERROR" : "DEFAULT",
        statusMessage: t.thesisValidation?.success === false ? "Thesis failed schema validation" : undefined,
      });
    }

    // Bounded: a Langfuse outage must never hold a user's research request open.
    // Losing a trace is acceptable; adding seconds to the response is not.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      lf.flushAsync(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);

    return trace.getTraceUrl();
  } catch (err) {
    console.error("Langfuse trace emission failed (run unaffected):", err);
    return null;
  }
}
