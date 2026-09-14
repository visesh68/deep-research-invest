import { NextRequest, NextResponse, after } from "next/server";
import { runPipeline, PipelineError, transcriptFromError } from "@/lib/pipeline";
import { emitTrace } from "@/lib/observability";
import { createLruCache, questionCacheKey } from "@/lib/cache";
import type { Thesis } from "@/lib/schema";

// One hour. Equity figures move intraday, so a longer TTL would start serving
// stale theses as current — which is a correctness problem, not just a stale
// cache. This bounds the hit rate on purpose.
const THESIS_TTL_MS = 60 * 60 * 1000;
const thesisCache = createLruCache<Thesis>({ max: 50, ttlMs: THESIS_TTL_MS });

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let question: string;
  try {
    const body = await req.json();
    question = typeof body?.question === "string" ? body.question.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!question || question.length < 4) {
    return NextResponse.json({ error: "Please enter an investing question." }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "Question is too long (max 500 characters)." }, { status: 400 });
  }

  if (process.env.MOCK_RESEARCH === "1") {
    const { MOCK_THESIS } = await import("@/lib/mockThesis");
    await new Promise((r) => setTimeout(r, 2500));
    return NextResponse.json({ thesis: MOCK_THESIS, mock: true });
  }

  const cacheKey = questionCacheKey(question);
  const cached = thesisCache.get(cacheKey);
  if (cached) {
    return NextResponse.json({
      thesis: cached.value,
      cached: true,
      cachedAgeMs: cached.ageMs,
    });
  }

  try {
    const { thesis, warnings, transcript } = await runPipeline(question);
    // Tracing runs after the response is sent, so flushing costs the user nothing.
    after(async () => {
      const url = await emitTrace(transcript);
      if (url) console.log(`Langfuse trace: ${url}`);
    });
    // A degraded run is not cached: serving a thesis built on half its angles
    // for the next hour would turn one transient Tavily blip into sustained
    // low-quality output.
    if (warnings.length === 0) thesisCache.set(cacheKey, thesis);
    return NextResponse.json(warnings.length ? { thesis, warnings } : { thesis });
  } catch (err) {
    const stage = err instanceof PipelineError ? err.stage : "unknown";
    console.error(`Research pipeline failed at stage "${stage}":`, err);
    const failed = transcriptFromError(err);
    if (failed) {
      after(async () => {
        const url = await emitTrace(failed);
        if (url) console.log(`Langfuse trace (failed run): ${url}`);
      });
    }
    return NextResponse.json(
      { error: (err as Error).message || "Research pipeline failed.", stage },
      { status: 502 },
    );
  }
}
