import { NextRequest, NextResponse } from "next/server";
import { runPipeline, PipelineError } from "@/lib/pipeline";

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

  try {
    const { thesis } = await runPipeline(question);
    return NextResponse.json({ thesis });
  } catch (err) {
    const stage = err instanceof PipelineError ? err.stage : "unknown";
    console.error(`Research pipeline failed at stage "${stage}":`, err);
    return NextResponse.json(
      { error: (err as Error).message || "Research pipeline failed.", stage },
      { status: 502 },
    );
  }
}
